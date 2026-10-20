import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config, readSettings, writeSettings } from './lib/config.js';
import { toCleanJpg } from './lib/media.js';
import { fbConfigured, checkPage } from './lib/facebook.js';
import crypto from 'node:crypto';
import * as FB from './lib/fb-auth.js';
import * as P from './lib/posts.js';
import * as CA from './lib/claude-accounts.js';
import * as GA from './lib/gemini-accounts.js';
import { VOICES, isVoice } from './lib/voices.js';
import * as FC from './lib/flow-chrome.js';
import * as FBC from './lib/fb-chrome.js';
import * as FBB from './lib/fb-browser.js';
import { FLOW_MODELS } from './lib/flow-auto.js';
import * as J from './lib/jobs.js';
import * as SK from './lib/skills.js';
import * as DC from './lib/daily-content.js';
import { extractBriefFromSkills, askWithSkills, resolveAgentSkills, generateViralTopics, testAiModel, VIRAL_FORMATS, TRAFFIC_GOALS } from './lib/llm.js';
import { AI_PROVIDERS, AI_MODELS, getDefaultAiSelection, saveAiSettings, getAllAiStatus, startChatGptBrowserLogin } from './lib/ai-providers.js';

fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'content-campaigns'), { recursive: true });
SK.initSkills();
DC.ensureDefaultFtCampaign();
J.loadAll();

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
app.use(express.static(path.join(config.root, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
// File của từng job (clip, khung hình, video cuối) — chỉ phục vụ trong thư mục data/jobs.
app.use('/files', express.static(path.join(config.dataDir, 'jobs'), { index: false, dotfiles: 'deny' }));
// File của chiến dịch Content Hàng Ngày (ảnh render, sản phẩm, logo, tài liệu).
app.use('/content-files', express.static(path.join(config.dataDir, 'content-campaigns'), { index: false, dotfiles: 'deny' }));

const upload = multer({
  dest: path.join(config.dataDir, 'uploads'),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const uploadSkillFiles = multer({
  dest: path.join(config.dataDir, 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Clip mp4 người dùng tải về từ Flow (thường 5–30MB / 8 giây).
const uploadVideo = multer({
  dest: path.join(config.dataDir, 'uploads'),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^video\//.test(file.mimetype) || /\.(mp4|mov|webm)$/i.test(file.originalname)),
});

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

function jobOr404(req, res) {
  const job = J.getJob(req.params.id);
  if (!job) res.status(404).json({ error: 'Không tìm thấy job' });
  return job;
}

app.get('/api/config', (_req, res) => {
  res.json({
    fbConfigured: fbConfigured(),
    voices: VOICES,
    flowModels: FLOW_MODELS,
    viralFormats: VIRAL_FORMATS,
    trafficGoals: TRAFFIC_GOALS,
    postFormats: DC.POST_FORMATS,
    funnelStages: DC.FUNNEL_STAGES,
    aiProviders: AI_PROVIDERS,
    aiModels: AI_MODELS,
    defaultAi: getDefaultAiSelection(),
  });
});

app.get('/api/fb/check', wrap(async (_req, res) => res.json(await checkPage())));

// ---------- Đăng nhập Facebook (OAuth popup, giống Ads OS) ----------
// Origin lấy theo Host người dùng đang mở (localhost hay 127.0.0.1) để cookie state và redirect_uri khớp nhau.
const originOf = (req) => `${req.protocol}://${req.get('host')}`;
const readCookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];

app.get('/api/fb/status', (req, res) => res.json({
  oauthReady: FB.oauthReady(), app: { ...FB.appInfo(originOf(req)), name: readSettings().fbAppName || null },
  ...FB.status(), envPage: Boolean(config.fbPageId && config.fbPageToken),
}));
app.post('/api/fb/app', wrap(async (req, res) => res.json(await FB.saveApp(req.body?.appId, req.body?.appSecret))));
app.delete('/api/fb/app', wrap(async (_req, res) => { FB.clearApp(); res.json({ ok: true }); }));

app.get('/api/fb/start', (req, res) => {
  if (!FB.oauthReady()) return res.status(503).send('Chưa cấu hình FB_APP_ID / FB_APP_SECRET / ENCRYPTION_KEY trong .env');
  const state = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Set-Cookie', `fb_state=${state}; HttpOnly; SameSite=Lax; Path=/api/fb; Max-Age=600`);
  res.redirect(FB.authorizeUrl(originOf(req), state));
});

app.get('/api/fb/callback', async (req, res) => {
  const origin = originOf(req);
  const send = (payload, code = 200) => res.status(code).type('html').send(FB.closePopupHtml(origin, payload));
  res.setHeader('Set-Cookie', 'fb_state=; HttpOnly; SameSite=Lax; Path=/api/fb; Max-Age=0');
  if (req.query.error) return send({ type: 'fb-login', ok: false, error: req.query.error_description || req.query.error });
  const expected = readCookie(req, 'fb_state');
  const state = String(req.query.state || '');
  // State phải khớp cookie — chặn trang khác ép nối tài khoản Facebook lạ vào web này.
  if (!expected || expected.length !== state.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(state))) {
    return send({ type: 'fb-login', ok: false, error: 'State không khớp — thử đăng nhập lại' }, 400);
  }
  try {
    const r = await FB.completeLogin(origin, String(req.query.code || ''));
    send({ type: 'fb-login', ok: true, user: r.user.name, pages: r.pages });
  } catch (e) {
    send({ type: 'fb-login', ok: false, error: e.message });
  }
});

app.post('/api/fb/page', wrap(async (req, res) => { FB.selectPage(String(req.body?.pageId || '')); res.json(FB.status()); }));
app.post('/api/fb/disconnect', (_req, res) => { FB.disconnect(); res.json({ ok: true }); });

app.get('/api/jobs', (_req, res) => res.json(J.listJobs()));

app.post('/api/jobs', upload.single('refImage'), wrap(async (req, res) => {
  const b = req.body;
  const sceneCount = Math.round(Number(b.sceneCount));
  if (!b.topic?.trim()) throw new Error('Thiếu chủ đề');
  if (!(sceneCount >= 2 && sceneCount <= 11)) throw new Error('Số cảnh phải từ 2 đến 11 (Reel tối đa 90 giây)');
  let ref = null;
  if (req.file) {
    ref = req.file.path + '.jpg';
    await toCleanJpg(req.file.path, ref);
    fs.rmSync(req.file.path, { force: true });
  }
  let skills = [];
  if (Array.isArray(b.skills)) skills = b.skills.map(String).filter(Boolean);
  else if (typeof b.skills === 'string' && b.skills.trim()) {
    try {
      const parsed = JSON.parse(b.skills);
      skills = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [String(b.skills).trim()];
    } catch {
      skills = b.skills.split(',').map((x) => x.trim()).filter(Boolean);
    }
  }
  const input = {
    topic: b.topic.trim(),
    sceneCount,
    aiModel: b.aiModel?.trim() || '',
    videoType: b.videoType === 'viral' ? 'viral' : 'ads',
    viralFormat: b.viralFormat?.trim() || 'storytelling',
    trafficGoal: b.trafficGoal?.trim() || 'engage_comment',
    audience: b.audience?.trim() || '',
    cta: b.cta?.trim() || '',
    character: b.character?.trim() || '',
    mustSay: b.mustSay?.trim() || '',
    avoid: b.avoid?.trim() || '',
    tone: b.tone?.trim() || '',
    flowModel: FLOW_MODELS.includes(b.flowModel) ? b.flowModel : 'Veo 3.1 - Fast',
    consistency: b.consistency === 'frames' ? 'frames' : 'identity',
    voice: isVoice(b.voice) ? b.voice : null,
    skills,
    autoSkill: b.autoSkill !== 'false' && b.autoSkill !== '0' && b.autoSkill !== false,
  };
  const job = await J.createJob(input, ref);
  res.json({ id: job.id });
}));

app.get('/api/jobs/:id', (req, res) => {
  const job = jobOr404(req, res);
  if (!job) return;
  // Kịch bản cũ chỉ có onScreenText → chuyển sẵn thành danh sách chữ để sửa trên web.
  job.scenes.forEach((_, i) => J.sceneOverlays(job, i));
  res.json(job);
});

app.patch('/api/jobs/:id', wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (!job) return;
  J.updateJob(job, req.body);
  res.json({ ok: true });
}));

app.patch('/api/jobs/:id/scenes/:i', wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (!job) return;
  res.json(J.updateScene(job, Number(req.params.i), req.body));
}));

const action = (fn) => wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (!job) return;
  const out = await fn(job, req.body || {});
  res.json(out ?? { ok: true });
});

app.post('/api/jobs/:id/script', action((job) => J.startScript(job)));
app.post('/api/jobs/:id/scenes/:i/clip', uploadVideo.single('clip'), wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (!job) { if (req.file) fs.rmSync(req.file.path, { force: true }); return; }
  if (!req.file) throw new Error('Chưa chọn file video (mp4)');
  res.json(await J.attachClip(job, Number(req.params.i), req.file.path, { force: req.body?.force === '1' }));
}));
app.delete('/api/jobs/:id/scenes/:i/clip', wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (job) res.json(J.removeClip(job, Number(req.params.i)));
}));
app.post('/api/jobs/:id/compress', action((job, b) => J.startCompress(job, Number(b.i))));
app.post('/api/jobs/:id/auto', action((job, b) => J.startAutoFlow(job, { from: b.from ?? null })));

// ---------- Chrome Flow (tự động hoàn toàn) ----------
app.get('/api/flow/status', wrap(async (_req, res) => res.json(await FC.status())));
app.post('/api/flow/sync', wrap(async (req, res) => {
  const s = await FC.syncProfile(String(req.body?.dir || ''));
  await FC.ensure({ show: true });
  const login = await FC.checkLogin({ switchToSourceEmail: true }).catch(() => null);
  res.json({ ...s, login });
}));
app.post('/api/flow/switch-account', wrap(async (req, res) => res.json(await FC.switchAccount(String(req.body?.email || '')))));
app.post('/api/flow/show', wrap(async (req, res) => { await FC.ensure({ show: req.body?.show !== false }); res.json({ ok: true }); }));
app.post('/api/flow/check', wrap(async (_req, res) => res.json(await FC.checkLogin())));
app.post('/api/flow/close', wrap(async (_req, res) => { await FC.close(); res.json({ ok: true }); }));
const fbSelectedPageId = () => FBB.browserPage()?.id || FB.status().selectedPageId || config.fbPageId || null;
app.get('/api/fbchrome/status', wrap(async (_req, res) => res.json({
  up: await FBC.isUp(), source: FBC.source(), profiles: FBC.listProfiles(), port: FBC.CDP_PORT,
  page: FBB.browserPage(), pages: readSettings().fbBrowserPages || [],
})));
// Danh sách Page lấy từ bảng chuyển tài sản của Business Suite (không cần Graph API).
app.post('/api/fbchrome/pages', wrap(async (_req, res) => {
  const r = await FBB.listPages();
  writeSettings({ fbBrowserPages: r.pages });
  if (!FBB.browserPage() && r.current?.id) writeSettings({ fbBrowserPage: r.current });
  res.json({ pages: r.pages, page: FBB.browserPage() });
}));
app.post('/api/fbchrome/page', wrap(async (req, res) => res.json(await FBB.selectPage(String(req.body?.name || '')))));
app.post('/api/fbchrome/sync', wrap(async (req, res) => {
  const s = await FBC.syncProfile(String(req.body?.dir || ''));
  await FBC.ensure({ show: true });
  const id = fbSelectedPageId();
  const r = await FBB.checkLogin(id).catch(() => null);
  const login = r ? { ...r, page: r.ok && id ? FBB.browserPage()?.name || id : null } : null;
  res.json({ ...s, login });
}));
app.post('/api/fbchrome/show', wrap(async (req, res) => { await FBC.ensure({ show: req.body?.show !== false }); res.json({ ok: true }); }));
app.post('/api/fbchrome/check', wrap(async (_req, res) => {
  const id = fbSelectedPageId();
  const r = await FBB.checkLogin(id);
  res.json({ ...r, page: r.ok && id ? FBB.browserPage()?.name || FB.status().pages?.find((p) => p.id === id)?.name || id : null });
}));
app.post('/api/fbchrome/close', wrap(async (_req, res) => { await FBC.close(); res.json({ ok: true }); }));

app.post('/api/jobs/:id/cancel', action((job) => J.cancelGenerate(job)));
app.post('/api/jobs/:id/stitch', action((job, b) => J.startStitch(job, { removeWatermark: b.removeWatermark !== false, force: Boolean(b.force) })));
app.post('/api/jobs/:id/facebook', action((job, b) => J.startFacebook(job, { mode: b.mode, scheduledAt: b.scheduledAt })));

// ---------- Quản lý đa Model AI (Claude · ChatGPT · Gemini) ----------
app.get('/api/ai/status', wrap(async (_req, res) => res.json(await getAllAiStatus())));
app.post('/api/ai/settings', wrap(async (req, res) => {
  saveAiSettings(req.body || {});
  res.json(await getAllAiStatus());
}));
app.post('/api/ai/test', wrap(async (req, res) => res.json(await testAiModel(req.body?.aiModel || req.body?.provider || ''))));
app.post('/api/ai/chatgpt/login', wrap(async (_req, res) => res.json(await startChatGptBrowserLogin())));

// ---------- Tài khoản Claude ----------
app.get('/api/claude/accounts', wrap(async (_req, res) => res.json(await CA.list())));
app.post('/api/claude/active', wrap(async (req, res) => { CA.setActive(String(req.body?.id || '')); res.json({ ok: true }); }));
app.post('/api/claude/login/start', wrap(async (_req, res) => res.json(await CA.startLogin())));
app.post('/api/claude/login/code', wrap(async (req, res) => res.json(await CA.submitCode(String(req.body?.sessionId || ''), req.body?.code))));
app.post('/api/claude/login/cancel', (req, res) => { CA.cancelLogin(String(req.body?.sessionId || '')); res.json({ ok: true }); });
app.post('/api/claude/logout', wrap(async (req, res) => { await CA.logout(String(req.body?.id || '')); res.json({ ok: true }); }));

// ---------- Tài khoản Gemini (Google OAuth + API Key đa tài khoản) ----------
app.get('/api/gemini/accounts', wrap(async (_req, res) => res.json(await GA.list())));
app.post('/api/gemini/active', wrap(async (req, res) => res.json(await GA.setActive(String(req.body?.id || '')))));
app.post('/api/gemini/login/start', wrap(async (_req, res) => res.json(await GA.startLogin())));
app.post('/api/gemini/login/code', wrap(async (req, res) => res.json(await GA.submitCode(String(req.body?.sessionId || ''), req.body?.code))));
app.post('/api/gemini/login/cancel', wrap(async (req, res) => { await GA.cancelLogin(String(req.body?.sessionId || '')); res.json({ ok: true }); }));
app.post('/api/gemini/apikey', wrap(async (req, res) => res.json(GA.addApiKeyAccount({ apiKey: req.body?.apiKey, label: req.body?.label }))));
app.post('/api/gemini/logout', wrap(async (req, res) => res.json(await GA.removeAccount(String(req.body?.id || '')))));

// ---------- Kho Skill AI (đồng bộ từ Claude, tải lên, Agent tự động nhận diện Skill, trích xuất dữ liệu & chạy yêu cầu AI) ----------
app.get('/api/skills', wrap(async (_req, res) => res.json(SK.listSkills())));
app.post('/api/skills/sync', wrap(async (_req, res) => res.json(SK.syncFromClaude())));
app.post('/api/skills/detect', wrap(async (req, res) => {
  const { userInput = {}, mode = 'fast', taskType = 'any', excludeIds = [], aiModel = '' } = req.body || {};
  if (mode === 'ai') {
    const r = await resolveAgentSkills({ skillIds: excludeIds, userInput, autoDetect: true, taskType, maxAuto: 3, aiModel });
    return res.json({ matchedSkills: r.autoDetected, candidates: r.candidates, costUsd: r.costUsd });
  }
  const matchedSkills = SK.detectSkillsForInput(userInput, { limit: 4, taskType, excludeIds });
  res.json({ matchedSkills });
}));
app.post('/api/skills/upload', uploadSkillFiles.array('files', 30), wrap(async (req, res) => {
  res.json(await SK.importUploadedFiles({
    files: req.files || [],
    targetSkillId: req.body?.targetSkillId || '',
    name: req.body?.name || '',
    description: req.body?.description || '',
  }));
}));
app.post('/api/skills/extract-brief', wrap(async (req, res) => res.json(await extractBriefFromSkills(req.body || {}))));
app.post('/api/skills/ask', wrap(async (req, res) => res.json(await askWithSkills(req.body || {}))));
app.post('/api/viral/topics', wrap(async (req, res) => res.json(await generateViralTopics(req.body || {}))));
app.post('/api/skills', wrap(async (req, res) => res.json(SK.saveSkill(req.body || {}))));
app.get('/api/skills/:id', wrap(async (req, res) => res.json(SK.getSkill(req.params.id))));
app.patch('/api/skills/:id', wrap(async (req, res) => res.json(SK.patchSkillMeta(req.params.id, req.body || {}))));
app.delete('/api/skills/:id', wrap(async (req, res) => res.json(SK.deleteSkill(req.params.id))));
app.get('/api/skills/:id/file', wrap(async (req, res) => res.json(SK.readSkillFile(req.params.id, String(req.query.path || 'SKILL.md')))));
app.put('/api/skills/:id/file', wrap(async (req, res) => res.json(SK.writeSkillFile(req.params.id, req.body?.path, req.body?.content))));
app.delete('/api/skills/:id/file', wrap(async (req, res) => res.json(SK.deleteSkillFile(req.params.id, String(req.query.path || req.body?.path || '')))));

// ---------- Module Tạo Content & Hình Ảnh Lên Lịch Đăng Bài Hàng Ngày Cho Fanpage ----------
const uploadCampaignFiles = uploadSkillFiles.fields([
  { name: 'productDoc', maxCount: 1 },
  { name: 'scheduleDoc', maxCount: 1 },
  { name: 'productImage', maxCount: 1 },
  { name: 'logoImage', maxCount: 1 },
]);

app.get('/api/daily-content/campaigns', wrap(async (_req, res) => res.json(DC.listCampaigns())));
app.get('/api/daily-content/campaigns/:id', wrap(async (req, res) => res.json(DC.getCampaign(req.params.id))));
app.post('/api/daily-content/campaigns', uploadCampaignFiles, wrap(async (req, res) => {
  res.json(await DC.upsertCampaign({
    ...(req.body || {}),
    files: req.files || {},
  }));
}));
app.delete('/api/daily-content/campaigns/:id', wrap(async (req, res) => res.json(DC.deleteCampaign(req.params.id))));

// Bước 1: Gọi AI đọc thông tin sản phẩm & đề xuất các tuyến nội dung phễu kéo traffic (TOFU / MOFU / BOFU)
app.post('/api/daily-content/campaigns/:id/analyze', wrap(async (req, res) => {
  res.json(await DC.analyzeProductAndProposePillars(req.params.id, req.body || {}));
}));

// Bước 2: Lựa chọn số bài đăng/ngày -> Đề xuất danh sách tiêu đề bài đăng theo 3 dạng bài
app.post('/api/daily-content/campaigns/:id/propose-titles', wrap(async (req, res) => {
  res.json(await DC.proposeTitles(req.params.id, req.body || {}));
}));

// Nạp lại 3 bài mẫu chuẩn theo 3 dạng (Dạng 1 Text nền + 4 Comment, Dạng 2 Text nền + Bộ 5 ảnh, Dạng 3 Content + 1 Ảnh)
app.post('/api/daily-content/campaigns/:id/reset-samples', wrap(async (req, res) => {
  res.json(await DC.resetCampaignSamplePosts(req.params.id));
}));

// Bước 3: Viết content theo tiêu đề lựa chọn (tuân thủ 15 quy tắc viết content)
app.post('/api/daily-content/campaigns/:id/posts/:postId/write', wrap(async (req, res) => {
  res.json(await DC.generatePostContent(req.params.id, req.params.postId, req.body || {}));
}));

// Bước 4: Làm ảnh minh họa (tuân thủ 12 quy tắc tạo ảnh: Times New Roman, 1080x1080 / 1080x1350, logo góc cố định, bao bì chuẩn)
app.post('/api/daily-content/campaigns/:id/posts/:postId/render-images', wrap(async (req, res) => {
  res.json(await DC.renderPostImagesForItem(req.params.id, req.params.postId, req.body || {}));
}));

// Cập nhật / chỉnh sửa thủ công tiêu đề, nội dung, comment, thẻ ảnh hoặc giờ đăng của 1 bài
app.patch('/api/daily-content/campaigns/:id/posts/:postId', wrap(async (req, res) => {
  res.json(DC.updateDailyPost(req.params.id, req.params.postId, req.body || {}));
}));

app.delete('/api/daily-content/campaigns/:id/posts/:postId', wrap(async (req, res) => {
  res.json(DC.deleteDailyPost(req.params.id, req.params.postId));
}));

// Bước 5: Đăng ngay hoặc Lên lịch đăng bài (Text + Ảnh + Tự động thả Comment) lên Fanpage
app.post('/api/daily-content/campaigns/:id/posts/:postId/publish', wrap(async (req, res) => {
  res.json(await DC.publishOrScheduleDailyPost(req.params.id, req.params.postId, req.body || {}));
}));

// ---------- Lịch đăng ----------
app.get('/api/posts', (_req, res) => res.json(P.listPosts()));
app.post('/api/posts/sync', wrap(async (_req, res) => res.json(await P.syncAll())));
app.post('/api/posts/:id/sync', wrap(async (req, res) => res.json(await P.syncPost(req.params.id))));
app.post('/api/posts/:id/reschedule', wrap(async (req, res) => res.json(await P.reschedule(req.params.id, Number(req.body?.at)))));
app.post('/api/posts/:id/cancel', wrap(async (req, res) => res.json(await P.cancel(req.params.id))));
app.post('/api/jobs/:id/facebook/refresh', action((job) => J.refreshFacebook(job)));

app.listen(config.port, config.host, () => {
  console.log(`Post AI Studio: http://${config.host}:${config.port}`);
});
