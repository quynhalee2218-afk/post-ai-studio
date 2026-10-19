const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let cfg = {};
let currentId = null;
let currentJob = null;
let pollTimer = null;
let fb = { connected: false }; // trạng thái đăng nhập Facebook
let fbEditingApp = false;      // đang mở form đổi App ID/Secret
const LIMIT = 4000; // Flow cắt prompt sau 4000 ký tự

async function api(url, opts = {}) {
  const isGet = !opts.method || opts.method.toUpperCase() === 'GET';
  const timeoutMs = opts.timeoutMs || (isGet ? 15000 : 120000);
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function toast(msg, ms = 4000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

function show(view) {
  for (const v of ['new', 'job', 'empty', 'skills', 'posts', 'accounts']) {
    const el = $(`#view-${v}`);
    if (el) el.hidden = v !== view;
  }
  $('#tab-skills')?.classList.toggle('active', view === 'skills');
  $('#tab-posts').classList.toggle('active', view === 'posts');
  $('#tab-accounts').classList.toggle('active', view === 'accounts');
  $('#tab-videos').classList.toggle('active', !['skills', 'posts', 'accounts'].includes(view));
  document.body.dataset.view = view;
  $('.side').classList.remove('open'); // mobile: mở video xong thì gấp danh sách lại
  if (typeof sideLabel === 'function') sideLabel();
  window.scrollTo({ top: 0 });
}

const STAGE = {
  scripting: 'Đang viết kịch bản', script_failed: 'Lỗi kịch bản', script_ready: 'Chờ tạo cảnh',
  generating: 'Đang tạo cảnh', clips_ready: 'Đủ cảnh — chờ ghép', stitched: 'Đã ghép', posted_draft: 'Đã gửi nháp FB', posted: 'Đã đăng FB', scheduled: 'Đã hẹn giờ FB',
};

function aiShortBadge(aiModelStr) {
  const raw = String(aiModelStr || cfg.defaultAi?.combined || 'claude');
  const prov = raw.split(':')[0] || 'claude';
  if (prov === 'chatgpt') return '<span class="badge gpt-pill" style="font-size:10px;padding:1px 6px;margin-right:4px;vertical-align:middle">🟢 ChatGPT</span>';
  if (prov === 'gemini') return '<span class="badge gem-pill" style="font-size:10px;padding:1px 6px;margin-right:4px;vertical-align:middle">♊ Gemini</span>';
  return '<span class="badge cl-pill" style="font-size:10px;padding:1px 6px;margin-right:4px;vertical-align:middle">✦ Claude</span>';
}

function aiModelOpts(selectedVal = '') {
  const sel = selectedVal || cfg.defaultAi?.combined || 'claude:claude-sonnet-4-5';
  return (cfg.aiProviders || []).map((p) => `
    <optgroup label="${esc(`${p.icon} ${p.name}`)}">
      ${(p.models || []).map((m) => {
        const val = `${p.id}:${m.id}`;
        return `<option value="${esc(val)}" ${val === sel || m.id === sel ? 'selected' : ''}>${esc(p.icon)} ${esc(m.name)}</option>`;
      }).join('')}
    </optgroup>`).join('');
}

let currentNewAiProvider = 'claude';

function updateNewAiModelUI() {
  const selEl = $('#new-ai-model-select');
  if (!selEl) return;
  const val = selEl.value || cfg.defaultAi?.combined || 'claude:claude-sonnet-4-5';
  const provId = val.split(':')[0] || 'claude';
  currentNewAiProvider = provId;
  for (const btn of document.querySelectorAll('#new-ai-provider-chips button[data-ai-prov]')) {
    btn.classList.toggle('on', btn.dataset.aiProv === provId);
  }
  const provObj = (cfg.aiProviders || []).find((p) => p.id === provId);
  if ($('#new-ai-model-hint') && provObj) {
    $('#new-ai-model-hint').textContent = provObj.desc || '';
  }
}

function populateAiModelSelects(keepCurrent = false) {
  const defVal = cfg.defaultAi?.combined || 'claude:claude-sonnet-4-5';
  for (const selId of ['#new-ai-model-select', '#ask-ai-model-select', '#default-ai-select']) {
    const el = $(selId);
    if (!el) continue;
    const targetVal = (keepCurrent && el.value) ? el.value : defVal;
    el.innerHTML = aiModelOpts(targetVal);
    el.value = targetVal;
  }
  updateNewAiModelUI();
}

// ---------- danh sách ----------
async function loadList() {
  const jobs = await api('/api/jobs');
  $('#job-list').innerHTML = jobs.map((j) => {
    const isViral = j.videoType === 'viral';
    const typeBadge = `<span class="badge ${isViral ? 'viral-pill' : 'ads-pill'}" style="font-size:10px;padding:1px 6px;margin-right:4px;vertical-align:middle">${isViral ? '🔥 Viral' : '🛍️ Ads'}</span>`;
    return `
    <li data-id="${j.id}" class="${j.id === currentId ? 'active' : ''} ${j.busy ? 'st-busy' : ({ posted: 'st-done', posted_draft: 'st-done', scheduled: 'st-scheduled', stitched: 'st-done' }[j.stage] || '')}">
      ${typeBadge}${aiShortBadge(j.aiModel)}${esc(j.topic.slice(0, 52))}
      <div class="meta">${j.sceneCount} cảnh · ${esc(STAGE[j.stage] || j.stage)}${j.busy ? ' · ⏳' : ''}</div>
    </li>`;
  }).join('') || '<li class="muted">Chưa có video nào</li>';
  sideJobs = jobs;
  sideLabel();
}
let sideJobs = [];
function sideLabel() {
  const cur = document.body.dataset.view === 'job' && sideJobs.find((j) => j.id === currentId);
  $('#side-toggle').innerHTML = `<span>${cur ? esc(cur.topic.slice(0, 60)) : `Các video (${sideJobs.length})`}</span><span class="chev">▾</span>`;
}
$('#side-toggle').addEventListener('click', () => $('.side').classList.toggle('open'));

$('#job-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openJob(li.dataset.id);
});

// ---------- tạo mới & chọn loại video (Quảng Cáo Sản Phẩm vs Viral Kéo Traffic Hàng Ngày) ----------
let currentVideoType = 'ads';
let lastViralTopics = [];

function updateViralSelectHints() {
  const fmtVal = $('#viral-format-select')?.value;
  const fmtObj = (cfg.viralFormats || []).find((f) => f.id === fmtVal) || (cfg.viralFormats || [])[0];
  if ($('#viral-format-desc') && fmtObj) $('#viral-format-desc').textContent = fmtObj.desc || '';

  const goalVal = $('#traffic-goal-select')?.value;
  const goalObj = (cfg.trafficGoals || []).find((g) => g.id === goalVal) || (cfg.trafficGoals || [])[0];
  if ($('#traffic-goal-desc') && goalObj) $('#traffic-goal-desc').textContent = goalObj.defaultCta || '';
}

function setNewVideoMode(mode) {
  currentVideoType = mode === 'viral' ? 'viral' : 'ads';
  const vtInput = $('#new-videotype-input');
  if (vtInput) vtInput.value = currentVideoType;

  for (const card of document.querySelectorAll('#video-type-cards .mode-card')) {
    card.classList.toggle('active', card.dataset.vtype === currentVideoType);
  }
  const isViral = currentVideoType === 'viral';
  const viralBox = $('#viral-config-box');
  if (viralBox) viralBox.hidden = !isViral;

  if ($('#new-eyebrow')) {
    $('#new-eyebrow').textContent = isViral
      ? '🔥 Video Viral Hàng Ngày · Kéo Traffic & Tiếp cận khách hàng Fanpage'
      : '🛍️ AI viết kịch bản · Video Quảng Cáo Sản Phẩm & Dịch Vụ';
  }
  if ($('#new-title')) {
    $('#new-title').textContent = isViral
      ? 'Làm Video Viral Kéo Traffic Cho Fanpage'
      : 'Làm Video Quảng Cáo Sản Phẩm Mới';
  }
  if ($('#new-desc')) {
    $('#new-desc').innerHTML = isViral
      ? 'Xây dựng kịch bản & video Reels đăng bài hàng ngày theo công thức <b>Kể chuyện đời thường / Bóc sự thật / Bí kíp / Đạo lý</b> giúp giữ chân người lạ xem hết 100%, kích thích Bình luận & Chia sẻ để kéo khách hàng tiềm năng về Fanpage tự nhiên.'
      : 'Model AI (<b>Claude, ChatGPT, hoặc Gemini</b>) đọc hiểu kiến thức từ kho Skill AI bạn chọn để trích xuất USP sản phẩm, đánh trúng nỗi đau khách hàng và viết kịch bản chuyển đổi.';
  }
  if ($('#lbl-topic')) {
    $('#lbl-topic').textContent = isViral
      ? 'Chủ đề / Tình huống / Câu chuyện Viral hôm nay *'
      : 'Chủ đề / sản phẩm / dịch vụ *';
  }
  if ($('#inp-topic')) {
    $('#inp-topic').placeholder = isViral
      ? 'VD: Câu chuyện 30 tuổi mới nhận ra sai lầm khi thức khuya làm việc / 3 dấu hiệu cơ thể cảnh báo nóng trong mà 90% chị em bỏ qua / Hoặc bấm nút "🔥 AI Gợi ý 8 Chủ đề Viral hôm nay" ở trên để chọn 1 chạm!'
      : 'VD: Chị Giang pha trà dưỡng nhan An Nhiên buổi sáng / Hoạt hình 3D yến mạch cho bé / Khóa học AI cho chủ doanh nghiệp... (Agent sẽ tự nhận biết Skill tương ứng)';
  }
  if ($('#lbl-audience')) {
    $('#lbl-audience').textContent = isViral
      ? 'Tệp khách hàng tiềm năng muốn tiếp cận & kéo về Fanpage'
      : 'Đối tượng xem';
  }
  if ($('#inp-audience')) {
    $('#inp-audience').placeholder = isViral
      ? 'VD: Phụ nữ 25–45 tuổi quan tâm sức khỏe, làm đẹp, gia đình / Chủ shop kinh doanh...'
      : 'VD: chủ shop online 25–40 tuổi';
  }
  if ($('#lbl-cta')) {
    $('#lbl-cta').textContent = isViral
      ? 'Câu hỏi mở kéo Bình luận / Lời nhắn cuối video (CTA tương tác)'
      : 'CTA (Lời kêu gọi mua hàng / hành động)';
  }
  if ($('#inp-cta')) {
    $('#inp-cta').placeholder = isViral
      ? 'VD: Còn bạn thì sao, bạn đã từng gặp tình huống này chưa? Bình luận bên dưới nhé!'
      : 'VD: comment "AI" để nhận lịch học';
  }
  if ($('#hint-cta')) {
    $('#hint-cta').textContent = isViral
      ? 'Để trống = AI tự động tạo câu hỏi mở kích thích tranh luận / chia sẻ theo đúng "Mục tiêu kéo Traffic" bạn chọn ở trên.'
      : 'Để trống = video không có lời kêu gọi hành động.';
  }
  if ($('#lbl-mustsay')) {
    $('#lbl-mustsay').textContent = isViral
      ? 'Thông điệp cốt lõi / Điểm chạm thương hiệu muốn lồng ghép khéo léo (tuỳ chọn)'
      : 'Thông tin bắt buộc phải nói';
  }
  if ($('#inp-mustsay')) {
    $('#inp-mustsay').placeholder = isViral
      ? 'VD: Lồng ghép nhẹ nhàng thói quen uống trà thảo mộc buổi sáng (không nói giá, không chào hàng lộ liễu)'
      : 'VD: học 4 tuần, học phí 2 triệu';
  }
  if ($('#btn-submit-new')) {
    $('#btn-submit-new').textContent = isViral
      ? '🔥 Viết kịch bản Video Viral Kéo Traffic'
      : '🛍️ Viết kịch bản Video Quảng Cáo';
    $('#btn-submit-new').className = isViral ? 'viral-btn' : 'primary';
  }
  updateViralSelectHints();
  if (typeof scheduleDetectNewSkills === 'function') scheduleDetectNewSkills();
}

$('#btn-new').addEventListener('click', () => {
  currentId = null;
  stopPoll();
  loadList();
  setNewVideoMode('ads');
  show('new');
});

$('#btn-new-viral')?.addEventListener('click', () => {
  currentId = null;
  stopPoll();
  loadList();
  setNewVideoMode('viral');
  show('new');
});

$('#video-type-cards')?.addEventListener('click', (e) => {
  const card = e.target.closest('.mode-card[data-vtype]');
  if (!card) return;
  setNewVideoMode(card.dataset.vtype);
});

$('#new-ai-provider-chips')?.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ai-prov]');
  if (!b) return;
  const provId = b.dataset.aiProv;
  const provObj = (cfg.aiProviders || []).find((p) => p.id === provId);
  if (!provObj) return;
  const defModel = provObj.models.find((m) => m.default) || provObj.models[0];
  const selEl = $('#new-ai-model-select');
  if (selEl && defModel) {
    selEl.value = `${provId}:${defModel.id}`;
    updateNewAiModelUI();
  }
});
$('#new-ai-model-select')?.addEventListener('change', updateNewAiModelUI);

$('#viral-format-select')?.addEventListener('change', () => {
  updateViralSelectHints();
  if (typeof scheduleDetectNewSkills === 'function') scheduleDetectNewSkills();
});
$('#traffic-goal-select')?.addEventListener('change', updateViralSelectHints);

// Nút 🔥 AI Gợi ý 8 Chủ đề Viral hôm nay
$('#btn-viral-suggest')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const niche = ($('#viral-niche-input')?.value || $('#inp-topic')?.value || '').trim();
  const audience = ($('#inp-audience')?.value || '').trim();
  const character = ($('#form-new [name=character]')?.value || '').trim();
  const viralFormat = $('#viral-format-select')?.value || 'storytelling';
  const trafficGoal = $('#traffic-goal-select')?.value || 'engage_comment';
  const aiModel = $('#new-ai-model-select')?.value || '';
  const pinnedIds = skillsList.filter((s) => s.pinned && !s.builtin).map((s) => s.id);
  const skillIds = [...new Set([...newSelectedSkills, ...pinnedIds])];
  const autoDetect = $('#new-auto-skill')?.checked !== false;

  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ AI đang lên 8 chủ đề Viral…';
  const box = $('#viral-topics-result');
  if (box) {
    box.hidden = false;
    box.innerHTML = `<div class="card muted" style="grid-column:1/-1;margin:0;text-align:center;padding:18px"><span class="busy"><span class="spin"></span>Model AI đang phân tích ngách Fanpage, tệp khách hàng & kho Skill để tạo 8 ý tưởng Video Viral kéo Traffic hôm nay (khoảng 15–30s)…</span></div>`;
  }
  try {
    const r = await api('/api/viral/topics', {
      method: 'POST',
      body: { niche, audience, character, viralFormat, trafficGoal, skillIds, autoDetect, aiModel },
    });
    lastViralTopics = r.topics || [];
    if (Array.isArray(r.selectedIds) && r.selectedIds.length) {
      for (const sid of r.selectedIds) {
        if (!newSelectedSkills.includes(sid)) newSelectedSkills.push(sid);
      }
      syncNewSkillsInput();
      populateSkillSelects();
    }
    if (!lastViralTopics.length) {
      if (box) box.innerHTML = '<div class="muted" style="grid-column:1/-1">Chưa tạo được chủ đề, vui lòng thử lại.</div>';
      return;
    }
    if (box) {
      box.hidden = false;
      box.innerHTML = lastViralTopics.map((t, idx) => `
        <div class="viral-topic-card" data-viral-idx="${idx}">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px">
              <span class="badge viral-pill">${esc(t.groupLabel || t.viralFormat)}</span>
              <small class="muted">Ý tưởng #${idx + 1}</small>
            </div>
            <div style="font-weight:800;font-size:14.5px;color:var(--ink);margin-bottom:6px;line-height:1.35">${esc(t.title)}</div>
            <div class="viral-topic-hook">🪝 <b>Hook 3s đầu:</b> "${esc(t.hook)}"</div>
            <div style="font-size:12.5px;color:var(--ink-2);margin-top:6px;line-height:1.45"><b>🎬 Mạch truyện & Twist:</b> ${esc(t.angle)}</div>
            <div style="font-size:12px;color:#047857;margin-top:5px;line-height:1.4"><b>📈 Cơ chế kéo Traffic:</b> ${esc(t.trafficReason)}</div>
            ${t.suggestedCta ? `<div style="font-size:12px;color:var(--muted);margin-top:4px"><b>💬 Kết câu tương tác:</b> ${esc(t.suggestedCta)}</div>` : ''}
          </div>
          <div class="row" style="margin:8px 0 0;gap:6px">
            <button type="button" class="small viral-btn" data-pick-viral="${idx}" style="flex:1">✨ Chọn chủ đề này</button>
            <button type="button" class="small" data-run-viral-now="${idx}" title="Điền và bắt đầu viết kịch bản luôn">🚀 Viết kịch bản luôn</button>
          </div>
        </div>`).join('');
    }
    toast(`🔥 Đã tạo ${lastViralTopics.length} ý tưởng Video Viral kéo Traffic! Bấm chọn 1 chủ đề để làm ngay.`, 4500);
  } catch (err) {
    if (box) box.hidden = true;
    toast(err.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

function applyViralTopicIdea(idx) {
  const t = lastViralTopics[Number(idx)];
  if (!t) return false;
  const form = $('#form-new');
  if (!form) return false;
  form.querySelector('[name=topic]').value = `${t.title}\n- Hook mở đầu: "${t.hook}"\n- Mạch câu chuyện: ${t.angle}`;
  if (t.viralFormat && $('#viral-format-select')) {
    $('#viral-format-select').value = t.viralFormat;
    updateViralSelectHints();
  }
  if (t.suggestedCta) form.querySelector('[name=cta]').value = t.suggestedCta;
  if (t.characterHint && !form.querySelector('[name=character]').value.trim()) {
    form.querySelector('[name=character]').value = t.characterHint;
  }
  if ($('#viral-niche-input')?.value?.trim() && !form.querySelector('[name=audience]').value.trim()) {
    form.querySelector('[name=audience]').value = $('#viral-niche-input').value.trim();
  }
  if (typeof scheduleDetectNewSkills === 'function') scheduleDetectNewSkills();
  return true;
}

$('#viral-topics-result')?.addEventListener('click', (e) => {
  const pickBtn = e.target.closest('[data-pick-viral]');
  if (pickBtn) {
    if (applyViralTopicIdea(pickBtn.dataset.pickViral)) {
      $('#inp-topic')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#inp-topic')?.focus();
      toast('✓ Đã điền chủ đề Viral, Hook & CTA tương tác vào form!');
    }
    return;
  }
  const runBtn = e.target.closest('[data-run-viral-now]');
  if (runBtn) {
    if (applyViralTopicIdea(runBtn.dataset.runViralNow)) {
      $('#form-new')?.requestSubmit($('#btn-submit-new'));
    }
  }
});

// Số cảnh: nhập tự do 2–11 (11 × 8s = 88s, vừa giới hạn 90s của Reel), có nút −/+ và chọn nhanh.
const sceneSel = $('#form-new [name=sceneCount]');
const MIN_SCENES = 2, MAX_SCENES = 11;
const setScenes = (n) => {
  sceneSel.value = Math.min(MAX_SCENES, Math.max(MIN_SCENES, Math.round(Number(n) || 8)));
  durHint();
};
const durHint = () => {
  const n = Number(sceneSel.value) || 0;
  $('#dur-hint').textContent = `${n} cảnh ≈ ${n * 8} giây${n * 8 > 90 ? ' — vượt 90s, không đăng Reel được' : ''}`;
  for (const b of document.querySelectorAll('#scene-chips button')) b.classList.toggle('on', Number(b.dataset.n) === n);
  document.querySelector('.count-btn[data-step="-1"]').disabled = n <= MIN_SCENES;
  document.querySelector('.count-btn[data-step="1"]').disabled = n >= MAX_SCENES;
};
sceneSel.addEventListener('input', durHint);
sceneSel.addEventListener('change', () => setScenes(sceneSel.value));
document.querySelectorAll('.count-btn').forEach((b) => b.addEventListener('click', () => setScenes(Number(sceneSel.value) + Number(b.dataset.step))));
$('#scene-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) setScenes(b.dataset.n); });

$('#form-new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('#btn-submit-new');
  if (btn) btn.disabled = true;
  try {
    syncNewSkillsInput();
    const keepAiModel = $('#new-ai-model-select')?.value || cfg.defaultAi?.combined || '';
    const { id } = await api('/api/jobs', { method: 'POST', body: new FormData(e.target) });
    const keepMode = currentVideoType;
    e.target.reset();
    if ($('#new-ai-model-select') && keepAiModel) {
      $('#new-ai-model-select').value = keepAiModel;
      updateNewAiModelUI();
    }
    newSelectedSkills = [];
    syncNewSkillsInput();
    $('#new-skill-topics').hidden = true;
    if ($('#viral-topics-result')) $('#viral-topics-result').hidden = true;
    setNewVideoMode(keepMode);
    durHint();
    openJob(id);
  } catch (err) {
    toast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

// ---------- chi tiết job ----------
async function openJob(id) {
  currentId = id;
  currentJob = null;
  show('job');
  await refresh(true);
  loadList();
}

function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }

async function refresh(force = false) {
  stopPoll();
  if (!currentId) return;
  let nextMs = 4000;
  try {
    const job = await api(`/api/jobs/${currentId}`);
    nextMs = job.busy ? 1800 : 5000;
    const editing = document.activeElement?.matches?.('#view-job textarea, #view-job input[type="text"], #view-job input[type="number"], #view-job input:not([type])');
    const majorChange = !currentJob
      || job.stage !== currentJob.stage
      || (job.busy || '') !== (currentJob.busy || '')
      || (job.error || '') !== (currentJob.error || '')
      || job.final?.file !== currentJob.final?.file
      || job.scenes.filter((s) => s.clip).length !== currentJob.scenes.filter((s) => s.clip).length;
    if (force || majorChange || !editing) {
      if (force || majorChange || !currentJob || job.updatedAt !== currentJob.updatedAt) {
        const wasBusy = currentJob?.busy;
        currentJob = job;
        renderJob(job);
        if (wasBusy !== job.busy) loadList();
      }
    }
  } catch (e) {
    nextMs = 3000;
  } finally {
    if (currentId) pollTimer = setTimeout(() => refresh(false), nextMs);
  }
}

window.addEventListener('focus', () => {
  if (currentId && !$('#view-job')?.hidden) refresh(true);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentId && !$('#view-job')?.hidden) refresh(true);
});
setInterval(() => {
  if (currentId && !$('#view-job')?.hidden && !pollTimer) refresh(false);
}, 5000);

function renderJob(job) {
  const busy = Boolean(job.busy);
  const doneCount = job.scenes.filter((s) => s.clip).length;
  const total = job.scenes.reduce((a, s) => a + (s.duration || 8) - (s.trimStart || 0) - (s.trimEnd || 0), 0);
  const nextIdx = job.scenes.findIndex((s) => !s.clip);
  const fileUrl = (rel) => `/files/${job.id}/${rel}`;

  const jobSkillIds = Array.isArray(job.input?.skills) ? job.input.skills : [];
  const rawUsed = job.usedSkills?.length
    ? job.usedSkills
    : jobSkillIds.map((id) => skillsList.find((x) => x.id === id) || { id, name: id });
  const usedList = rawUsed.map((item) => {
    if (typeof item === 'string') {
      const found = skillsList.find((x) => x.id === item || x.title === item || x.name === item);
      return found ? { id: found.id, name: skTitle(found), auto: false } : { id: item, name: item, auto: false };
    }
    return { id: item.id, name: item.title || item.name || item.id, auto: Boolean(item.auto), reason: item.reason || '' };
  });

  const isViral = job.input?.videoType === 'viral';
  const vFmt = (cfg.viralFormats || []).find((f) => f.id === job.input?.viralFormat) || (cfg.viralFormats || [])[0];
  const tGoal = (cfg.trafficGoals || []).find((g) => g.id === job.input?.trafficGoal) || (cfg.trafficGoals || [])[0];
  const curJobAi = job.input?.aiModel || job.aiSelection?.combined || cfg.defaultAi?.combined || 'claude:claude-sonnet-4-5';

  const modeBarHtml = `
    <div class="row" style="margin:8px 0 0;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="badge ${isViral ? 'viral-pill' : 'ads-pill'}" style="font-size:12px;padding:4px 10px">
        ${isViral ? '🔥 Video Viral Kéo Traffic Fanpage' : '🛍️ Video Quảng Cáo Sản Phẩm'}
      </span>
      <select id="job-ai-model" style="width:auto;max-width:310px;font-size:12.5px;padding:4px 8px;font-weight:600" ${busy ? 'disabled' : ''} title="Chọn Model AI (Claude / ChatGPT / Gemini) rồi bấm Viết lại kịch bản">
        ${aiModelOpts(curJobAi)}
      </select>
      <select id="job-videotype" style="width:auto;font-size:12.5px;padding:4px 8px" ${busy ? 'disabled' : ''} title="Đổi loại video rồi bấm Viết lại kịch bản">
        <option value="ads" ${!isViral ? 'selected' : ''}>Chế độ: 🛍️ Quảng cáo sản phẩm</option>
        <option value="viral" ${isViral ? 'selected' : ''}>Chế độ: 🔥 Viral kéo Traffic hàng ngày</option>
      </select>
      ${isViral ? `
        <select id="job-viral-format" style="width:auto;max-width:290px;font-size:12.5px;padding:4px 8px" ${busy ? 'disabled' : ''}>
          ${(cfg.viralFormats || []).map((f) => `<option value="${esc(f.id)}" ${f.id === (job.input?.viralFormat || 'storytelling') ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
        </select>
        <select id="job-traffic-goal" style="width:auto;max-width:290px;font-size:12.5px;padding:4px 8px" ${busy ? 'disabled' : ''}>
          ${(cfg.trafficGoals || []).map((g) => `<option value="${esc(g.id)}" ${g.id === (job.input?.trafficGoal || 'engage_comment') ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
        </select>
      ` : ''}
    </div>`;

  const skillBoxHtml = `
    <div class="skill-pick-box" style="margin-top:12px;padding:10px 12px">
      <div class="row" style="margin:0;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:700;color:var(--ink-2)">📚 Skill AI áp dụng cho kịch bản này:</span>
        <select id="job-skill-add" style="width:auto;max-width:340px;font-size:12.5px;padding:5px 8px" ${busy ? 'disabled' : ''}>
          <option value="">＋ Gắn thêm Skill rồi Viết lại kịch bản…</option>
          ${skillsList.filter((s) => !s.builtin).map((sk) => `<option value="${esc(sk.id)}" ${jobSkillIds.includes(sk.id) ? 'disabled' : ''}>${esc(skTitle(sk))} (${esc(sk.id)})</option>`).join('')}
        </select>
      </div>
      <div class="skill-tags" style="margin-top:6px">
        ${usedList.length
          ? usedList.map((sk) => `<span class="skill-tag ${sk.auto ? 'auto' : ''}" title="${esc(sk.reason || '')}">${sk.auto ? '🤖 Agent tự chọn: ' : ''}${esc(sk.name)} <code>${esc(sk.id)}</code>${!busy && jobSkillIds.includes(sk.id) ? `<button type="button" data-job-rm-skill="${esc(sk.id)}" title="Bỏ Skill này">✕</button>` : ''}</span>`).join('')
          : '<span class="muted" style="font-size:12.5px">Chưa gắn Skill riêng (Agent sẽ tự động nhận biết Skill khi bấm Viết lại kịch bản).</span>'}
      </div>
    </div>`;

  const head = `
    <div class="card">
      <div class="job-head">
        <div class="grow">
          <h1>${esc(job.input.topic)}</h1>
          <div class="muted">${job.input.sceneCount} cảnh · ${doneCount}/${job.scenes.length} cảnh có video · ${esc(STAGE[job.stage] || job.stage)}${isViral && vFmt ? ` · ${esc(vFmt.name)}` : ''}${isViral && tGoal ? ` · ${esc(tGoal.name)}` : ''}
          </div>
          ${modeBarHtml}
        </div>
        ${busy ? `<div class="busy"><span class="spin"></span>${esc(job.busy)}</div>` : ''}
      </div>
      ${stepper(job)}
      ${skillBoxHtml}
      ${job.error ? `<div class="error-box">${esc(job.error)}</div>` : ''}
      ${!job.script && !busy ? `<div class="row"><button data-act="script" class="primary">Viết lại kịch bản</button></div>` : ''}
    </div>`;

  if (!job.script) {
    $('#view-job').innerHTML = head + logCard(job);
    return;
  }

  const s = job.script.summary;
  const summary = `
    <div class="card">
      <h2>✦ Mạch video ${isViral ? '(Công thức Viral Kéo Traffic Fanpage)' : '(Công thức Quảng Cáo Chuyển Đổi)'}</h2>
      <dl class="summary">
        <dt>Hook</dt><dd>${esc(s.hook)}</dd>
        <dt>${isViral ? 'Thông điệp / Sự thật' : 'Lời hứa chính'}</dt><dd>${esc(s.corePromise)}</dd>
        <dt>${isViral ? 'Chuyển biến cảm xúc' : 'Biến đổi'}</dt><dd>${esc(s.transformation)}</dd>
        <dt>${isViral ? 'Cao trào / Cú Twist' : 'Cao trào'}</dt><dd>${esc(s.climax)}</dd>
        <dt>${isViral ? 'Mồi kéo Traffic / CTA' : 'CTA'}</dt><dd>${esc(s.cta)}</dd>
      </dl>
      <details><summary>B. Bảng nối cảnh</summary>
        <table class="cmap"><tr><th>Cảnh</th><th>Bắt đầu từ</th><th>Kết thúc bằng</th></tr>
        ${job.script.continuityMap.map((c) => `<tr><td>${c.scene}</td><td>${esc(c.startsFrom)}</td><td>${esc(c.endsWith)}</td></tr>`).join('')}
        </table>
      </details>
      <div class="row">
        <button data-act="script" ${busy ? 'disabled' : ''}>Viết lại toàn bộ kịch bản (theo Chế độ & Skill đã chọn)</button>
      </div>
    </div>`;

  const genBar = `
    <div class="card">
      <h2>Tạo video trên Flow (tự động)</h2>
      <div class="row" style="margin:0 0 10px">
        <label style="display:flex;gap:8px;align-items:center;font-weight:600">Giọng đọc:
          <select id="job-voice" style="width:auto;margin:0" ${busy ? 'disabled' : ''}>
            <option value="">Không cố định — mỗi cảnh một giọng</option>${window.voiceOpts ? window.voiceOpts(job.voice) : ''}
          </select></label>
        ${job.voice === 'me' ? '<span class="muted" style="font-size:12px">@me: mặt + giọng lấy từ hình đại diện "Tôi"; không dùng ảnh nhân vật hay khung cuối cảnh trước (Flow chặn ảnh mặt người thật)</span>'
          : job.voice && job.refImage && (job.consistency || 'identity') === 'frames' ? '<span class="over" style="font-size:12px">Chế độ "Nối cảnh liền khung" không gắn được giọng cho cảnh 2+</span>' : ''}
      </div>
      ${job.refImage && job.voice !== 'me' ? `<div class="row" style="margin:0 0 10px">
        <label style="display:flex;gap:8px;align-items:center;font-weight:600">Cảnh 2 trở đi:
          <select id="job-consistency" style="width:auto;margin:0" ${busy ? 'disabled' : ''}>
            <option value="identity" ${(job.consistency || 'identity') === 'identity' ? 'selected' : ''}>Giữ đúng mặt nhân vật (ảnh nhân vật + khung cuối cảnh trước)</option>
            <option value="frames" ${job.consistency === 'frames' ? 'selected' : ''}>Nối cảnh liền khung (chỉ khung đầu — mặt dễ trôi)</option>
          </select></label></div>` : ''}
      <div class="auto-box">
        <div class="row" style="margin:0">
          <label style="display:flex;gap:8px;align-items:center;font-weight:600">Model Flow:
            <select id="job-flow-model" style="width:auto;margin:0" ${busy ? 'disabled' : ''}>
              ${(cfg.flowModels || []).map((m) => `<option ${m === (job.flowModel || 'Veo 3.1 - Fast') ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select></label>
          ${nextIdx >= 0 ? `<button class="primary" data-act="auto-run" data-i="${nextIdx}" ${busy ? 'disabled' : ''}>▶ Tự tạo ${nextIdx === 0 ? `cả ${job.scenes.length} cảnh` : `từ cảnh ${nextIdx + 1} (${job.scenes.length - nextIdx} cảnh)`}</button>` : '<span class="badge done">Đủ cảnh</span>'}
          ${busy && job.stage === 'generating' ? '<button class="danger" data-act="cancel">Dừng sau cảnh này</button>' : ''}
        </div>
        <p class="muted" style="margin:8px 0 0;font-size:13px">Server mở <b>Chrome Flow</b> (tab Tài khoản), tự điền, <b>tự bấm tạo</b>, chờ, tải clip và gắn vào từng cảnh — mỗi cảnh trừ credit Flow. Flow báo "hết thời gian" thì tự thử lại 2 lần; vi phạm chính sách / hết credit thì dừng và báo.</p>
      </div>
    </div>`;

  const scenes = job.scenes.map((sc, i) => {
    const st = sc.stale ? 'stale' : sc.status;
    const label = { pending: 'Chưa tạo', queued: 'Đang chờ', running: 'Đang tạo…', done: 'Xong', error: 'Lỗi', stale: 'Lệch nối cảnh' }[st];
    const locked = busy || sc.status === 'running';
    return `
    <div class="card" id="scene-${i}">
      <div class="scene">
        <div>
          <div class="scene-head">
            <span class="scene-no">${i + 1}</span><h3>${esc(sc.title)}</h3>
            <span class="badge ${st}">${label}</span>
            ${sc.attempts ? `<span class="muted" style="font-size:12px">đã tạo ${sc.attempts} lần</span>` : ''}
          </div>
          <div class="dialogue">🎙 ${esc(sc.dialogue)}</div>
          ${overlayEditor(sc, i, locked)}
          ${sc.stale ? `<div class="error-box" style="color:var(--warn)">Cảnh trước đã được tạo lại nên khung đầu cảnh này không còn khớp. Nên tạo lại từ cảnh này.</div>` : ''}
          ${sc.error ? `<div class="error-box">${esc(sc.error)}${/tín dụng|Bắt đầu tạo/i.test(sc.error) ? `<div class="row" style="margin-top:8px"><button type="button" class="small primary" data-goto-accounts>🔄 Mở Tài khoản → Đổi tài khoản Google Flow khác</button></div>` : ''}</div>` : ''}
          <details ${sc.clip ? '' : 'open'}><summary>Prompt Flow (sửa được, tự lưu khi rời ô) ·
            <span class="${sc.prompt.length > LIMIT ? 'over' : ''}" data-count="${i}">${sc.prompt.length}/${LIMIT} ký tự</span></summary>
            <textarea class="prompt" rows="14" data-field="prompt" data-i="${i}" ${locked ? 'disabled' : ''}>${esc(sc.prompt)}</textarea>
          </details>
          ${sc.promptOriginal ? `<div class="manual" style="border-color:#f3d9a8;background:var(--warn-bg)">Prompt đã được <b>tự viết lại ${sc.policyRewrites || 1} lần</b> để né bộ lọc "người nổi tiếng" của Flow (lời thoại giữ nguyên).
            <div class="row"><button class="small" data-act="restore-prompt" data-i="${i}" ${locked ? 'disabled' : ''}>Dùng lại prompt gốc</button></div></div>` : ''}
          ${sceneSteps(job, i)}
          ${sc.prompt.length > LIMIT - 300 ? `<div class="row"><button class="small" data-act="compress" data-i="${i}" ${locked ? 'disabled' : ''}>Rút gọn prompt</button></div>` : ''}
        </div>
        <div class="player">
          ${sc.clip
            ? `<video src="${fileUrl(sc.clip)}" controls preload="metadata" playsinline></video>
               <div class="trim">
                 <label>Cắt đầu (s)<input type="number" min="0" max="4" step="0.1" value="${sc.trimStart}" data-field="trimStart" data-i="${i}" ${busy ? 'disabled' : ''}></label>
                 <label>Cắt cuối (s)<input type="number" min="0" max="4" step="0.1" value="${sc.trimEnd}" data-field="trimEnd" data-i="${i}" ${busy ? 'disabled' : ''}></label>
               </div>`
            : `<div class="ph drop" data-drop="${i}">${sc.status === 'running'
                ? '<span class="busy"><span class="spin"></span>Flow đang render</span>'
                : 'Kéo file mp4 từ Flow vào đây<br>hoặc bấm để chọn file'}</div>`}
          ${sc.clip ? `<button class="small block" style="margin-top:8px" data-act="pick" data-i="${i}" ${busy ? 'disabled' : ''}>Thay clip khác…</button>
             <button class="small block danger" style="margin-top:6px" data-act="unclip" data-i="${i}" ${busy ? 'disabled' : ''}>Bỏ clip cảnh này</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  const allClips = job.scenes.length > 0 && job.scenes.every((s) => s.clip);
  const missingScenes = job.scenes.filter((s) => !s.clip).map((s, idx) => (s.index ?? idx) + 1);
  const isStitching = /^Đang ghép video/i.test(job.busy || '');
  const prevMode = $('#fb-mode')?.value || 'schedule';
  const prevWhenEl = $('#fb-when');
  const prevWhenVal = prevWhenEl?.value && (new Date(prevWhenEl.value).getTime() >= Date.now() + 28 * 60 * 1000) ? prevWhenEl.value : defaultWhen();
  const final = `
    <div class="card">
      <h2>Ghép video & đăng Facebook ${isStitching ? `<span class="busy" style="margin-left:auto"><span class="spin"></span>${esc(job.busy)}</span>` : ''}</h2>
      <div class="final">
        <div class="player">
          ${job.final ? `<video src="${fileUrl(job.final.file)}" controls preload="metadata" playsinline></video>
                         <div class="row"><a href="${fileUrl(job.final.file)}" download>⬇ Tải MP4 về máy</a> · ${Number(job.final.duration || total).toFixed(1)}s</div>`
                      : isStitching
                        ? `<div class="ph"><div style="display:grid;gap:8px;justify-items:center"><span class="busy"><span class="spin"></span>${esc(job.busy)}</span><small class="muted">Đang nối ${job.scenes.length} cảnh (1080×1920, xoá watermark) — vui lòng chờ 10–20 giây…</small></div></div>`
                        : allClips
                          ? `<div class="ph"><div><b>Đã đủ ${job.scenes.length}/${job.scenes.length} cảnh</b><small class="muted" style="margin-top:4px">Bấm <b>"Ghép video"</b> bên cạnh để xuất MP4 hoàn chỉnh</small></div></div>`
                          : `<div class="ph"><div>Chưa ghép<small class="muted" style="margin-top:4px">Còn thiếu clip cảnh ${missingScenes.join(', ')}</small></div></div>`}
        </div>
        <div>
          <p class="muted" style="margin-top:0">Độ dài dự kiến ≈ ${total.toFixed(1)}s (Reel cho phép 3–90s). Ghép sẽ xoá watermark "Veo", cắt đầu/cuối theo từng cảnh, chèn chữ (nếu bật), xuất 1080×1920.</p>
          <div class="row">
            <button data-act="stitch" class="${job.final && !isStitching ? '' : 'primary'}" ${busy || !allClips ? 'disabled' : ''}>${isStitching ? `⏳ ${esc(job.busy)}` : (job.final ? '🔄 Ghép lại video' : '🎬 Ghép video')}</button>
            <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="wm" checked style="width:auto"> Xoá watermark Veo</label>
            <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="txt-on" ${job.text?.enabled === true ? 'checked' : ''} style="width:auto"> Chèn chữ</label>
            <select id="txt-style" style="width:auto" ${job.text?.enabled === true ? '' : 'disabled'}>
              ${[['brand', 'Khung gradient tím-xanh'], ['dark', 'Khung nền tối'], ['light', 'Khung nền sáng']].map(([v, l]) => `<option value="${v}" ${(job.text?.style || 'brand') === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          ${!allClips ? `<div class="muted" style="font-size:12.5px;margin-top:6px">⚠️ Cần có đủ video của cả ${job.scenes.length} cảnh trước khi ghép (hiện đang thiếu cảnh ${missingScenes.join(', ')}).</div>` : ''}
          ${job.scenes.some((s) => s.stale) ? `<div class="error-box" style="color:var(--warn)">Có cảnh bị lệch nối — vẫn ghép được nhưng chỗ nối sẽ giật.</div>` : ''}
          <label style="margin-top:16px">Caption Facebook
            <textarea rows="4" data-field="caption" ${busy ? 'disabled' : ''}>${esc(job.caption)}</textarea>
          </label>
          <div class="row" style="align-items:center">
            <select id="fb-mode" style="width:auto">
              <option value="schedule" ${prevMode === 'schedule' ? 'selected' : ''}>Hẹn giờ đăng</option>
              <option value="publish" ${prevMode === 'publish' ? 'selected' : ''}>Đăng ngay (công khai)</option>
              <option value="draft" ${prevMode === 'draft' ? 'selected' : ''}>Lưu nháp</option>
            </select>
            <input type="datetime-local" id="fb-when" style="width:auto" value="${prevWhenVal}">
            <button data-act="facebook" class="primary" ${busy || !job.final || !cfg.fbReady ? 'disabled' : ''}>Đăng lên ${esc(fbc.page?.name || 'Page')}</button>
          </div>
          ${!cfg.fbReady ? '<div class="muted">Chưa sẵn sàng đăng — tab <a href="#" data-goto-accounts>Tài khoản</a> → Chrome Facebook: chép profile, đăng nhập Facebook và chọn <b>Page để đăng</b>.</div>' : ''}
          ${job.facebook ? `
            <div class="dialogue" style="margin-top:12px">
              ${{ published: 'Đã đăng công khai', scheduled: `Đã hẹn đăng lúc ${job.facebook.scheduledAt ? new Date(job.facebook.scheduledAt).toLocaleString('vi-VN') : ''}`, draft: 'Đã gửi nháp' }[job.facebook.state || (job.facebook.published ? 'published' : 'draft')]}${job.facebook.pageName ? ` lên <b>${esc(job.facebook.pageName)}</b>` : ''}${job.facebook.videoId ? ` · video_id <code>${esc(job.facebook.videoId)}</code>` : ''} · ${new Date(job.facebook.at).toLocaleString('vi-VN')}
              ${job.facebook.file !== job.final?.file ? '<br><b>Lưu ý:</b> bản nháp là video ghép trước đó, không phải bản hiện tại.' : ''}
              ${job.facebook.status?.status?.publishing_phase?.publish_status ? `<br>Facebook: <b>${esc(job.facebook.status.status.video_status)}</b> · ${esc(job.facebook.status.status.publishing_phase.publish_status)}` : ''}
              <div class="row"><button class="small" data-act="fb-refresh">Kiểm tra trạng thái</button>
              ${postLinks({ id: job.facebook.videoId, state: job.facebook.state || (job.facebook.published ? 'published' : 'draft'), jobId: job.id, file: job.facebook.file })}
              <a href="#" data-goto-posts>Quản lý ở tab Lịch đăng</a></div>
            </div>` : ''}
        </div>
      </div>
    </div>`;

  $('#view-job').innerHTML = head + summary + genBar + scenes + final + logCard(job);
}

// Chữ trên màn hình (web vẽ lúc ghép): mỗi dòng = nội dung + giây bắt đầu/kết thúc + vị trí.
function overlayEditor(sc, i, locked) {
  const rows = (sc.overlays || []).map((o, k) => `
    <div class="ov-row" data-k="${k}">
      <input class="ov-text" value="${esc(o.text)}" placeholder="Chữ hiển thị (có dấu)" ${locked ? 'disabled' : ''}>
      <input class="ov-start" type="number" step="0.1" min="0" max="8" value="${o.start}" title="Hiện từ giây" placeholder="từ" ${locked ? 'disabled' : ''}>
      <input class="ov-end" type="number" step="0.1" min="0" max="8" value="${o.end}" title="Ẩn ở giây" placeholder="đến" ${locked ? 'disabled' : ''}>
      <select class="ov-pos" ${locked ? 'disabled' : ''}>${[['top', 'Trên'], ['middle', 'Giữa'], ['bottom', 'Dưới']].map(([v, l]) => `<option value="${v}" ${o.position === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="small ov-del" title="Xoá" ${locked ? 'disabled' : ''}>✕</button>
    </div>`).join('');
  return `<div class="ov" data-ov="${i}">
    <div class="ov-head"><span>Chữ trên màn hình <small class="muted" style="display:inline">· chỉ chèn khi bật "Chèn chữ" lúc ghép</small></span>
      <button class="small ov-add" ${locked || (sc.overlays || []).length >= 6 ? 'disabled' : ''}>＋ Thêm chữ</button></div>
    ${rows || '<div class="muted" style="font-size:13px">Không có chữ.</div>'}
  </div>`;
}

async function saveOverlays(box) {
  const i = Number(box.dataset.ov);
  const overlays = [...box.querySelectorAll('.ov-row')].map((r) => ({
    text: r.querySelector('.ov-text').value,
    start: Number(r.querySelector('.ov-start').value),
    end: Number(r.querySelector('.ov-end').value),
    position: r.querySelector('.ov-pos').value,
  }));
  await api(`/api/jobs/${currentJob.id}/scenes/${i}`, { method: 'PATCH', body: { overlays } });
}

$('#view-job').addEventListener('click', async (e) => {
  const box = e.target.closest('[data-ov]');
  if (!box || !currentJob) return;
  const i = Number(box.dataset.ov);
  const sc = currentJob.scenes[i];
  try {
    if (e.target.closest('.ov-add')) {
      const last = sc.overlays?.[sc.overlays.length - 1];
      const start = last ? Math.min(7, last.end + 0.1) : 0.3;
      await api(`/api/jobs/${currentJob.id}/scenes/${i}`, { method: 'PATCH', body: { overlays: [...(sc.overlays || []), { text: 'Chữ mới', start, end: Math.min(8, start + 2.5), position: 'top' }] } });
      refresh(true);
    } else if (e.target.closest('.ov-del')) {
      e.target.closest('.ov-row').remove();
      await saveOverlays(box);
      refresh(true);
    }
  } catch (err) { toast(err.message); }
});
$('#view-job').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-ov]');
  if (!box || !e.target.closest('.ov-row')) return;
  try { await saveOverlays(box); toast('Đã lưu chữ', 1200); } catch (err) { toast(err.message); }
}, true);

// Cách Chrome Flow tạo cảnh này + nút tự tạo lại.
function sceneSteps(job, i) {
  const ready = i === 0 || job.scenes[i - 1]?.lastFrame;
  return `<div class="manual"><div>Tự động: ${job.voice === 'me' ? 'Thành phần + <b>@me</b>' : job.refImage && (job.consistency || 'identity') === 'identity' ? 'Thành phần (ảnh nhân vật' + (i ? ' + khung cuối cảnh trước' : '') + ')' : i ? 'Khung hình (khung cuối cảnh trước)' : 'chỉ prompt'}${job.voice && job.voice !== 'me' ? ` · giọng <b>${esc(job.voice)}</b>` : ''}</div>
    <div class="row"><button class="small" data-act="auto-run" data-i="${i}" ${currentJob?.busy || !ready ? 'disabled' : ''}>${job.scenes[i].clip ? '↻ Tự tạo lại cảnh này' : '▶ Tự tạo từ cảnh này'}</button>
    <button class="small" data-act="copy" data-i="${i}">Copy prompt</button></div></div>`;
}

const filePicker = Object.assign(document.createElement('input'), { type: 'file', accept: 'video/mp4,video/*' });
filePicker.addEventListener('change', () => {
  if (filePicker.files[0]) uploadClip(Number(filePicker.dataset.i), filePicker.files[0]);
  filePicker.value = '';
});

async function uploadClip(i, file, force = false) {
  if (!currentJob) return;
  const sc = currentJob.scenes[i];
  if (sc.clip && i < currentJob.scenes.length - 1 && currentJob.scenes.slice(i + 1).some((s) => s.clip)
      && !confirm(`Thay clip cảnh ${i + 1} sẽ làm các cảnh sau lệch nối. Tiếp tục?`)) return;
  const fd = new FormData();
  fd.append('clip', file);
  if (force) fd.append('force', '1');
  toast(`Đang tải clip cảnh ${i + 1} lên…`, 60000);
  try {
    await api(`/api/jobs/${currentJob.id}/scenes/${i}/clip`, { method: 'POST', body: fd });
    toast(`Đã nhận clip cảnh ${i + 1}`);
    refresh(true);
  } catch (e) {
    // Người dùng tự chọn file: cho phép gắn dù khung đầu lệch (vd. cố ý không nối).
    if (!force && e.message.includes('không khớp khung cuối') && confirm(`${e.message}\n\nVẫn gắn clip này vào cảnh ${i + 1}?`)) return uploadClip(i, file, true);
    toast(e.message);
  }
}

$('#view-job').addEventListener('dragover', (e) => {
  const d = e.target.closest('[data-drop]');
  if (!d) return;
  e.preventDefault();
  d.classList.add('over-drop');
});
$('#view-job').addEventListener('dragleave', (e) => e.target.closest('[data-drop]')?.classList.remove('over-drop'));
$('#view-job').addEventListener('drop', (e) => {
  const d = e.target.closest('[data-drop]');
  if (!d) return;
  e.preventDefault();
  d.classList.remove('over-drop');
  const f = e.dataTransfer.files[0];
  if (f) uploadClip(Number(d.dataset.drop), f);
});
$('#view-job').addEventListener('click', (e) => {
  const d = e.target.closest('.ph[data-drop].drop');
  if (d) { filePicker.dataset.i = d.dataset.drop; filePicker.click(); }
});

// Thanh tiến trình 4 bước: Kịch bản → Tạo cảnh → Ghép → Đăng.
function stepper(job) {
  const hasScript = Boolean(job.script);
  const nClips = job.scenes.filter((s) => s.clip).length;
  const allClips = job.scenes.length > 0 && nClips === job.scenes.length;
  const posted = ['posted', 'posted_draft', 'scheduled'].includes(job.stage);
  const steps = [
    ['Kịch bản', hasScript, job.scenes.length ? `${job.scenes.length} cảnh` : ''],
    ['Tạo cảnh', allClips, job.scenes.length ? `${nClips}/${job.scenes.length}` : ''],
    ['Ghép', Boolean(job.final), job.final ? `${job.final.duration.toFixed(0)}s` : ''],
    ['Đăng', posted, posted ? ({ posted: 'đã đăng', posted_draft: 'nháp', scheduled: 'hẹn giờ' }[job.stage]) : ''],
  ];
  const now = steps.findIndex(([, done]) => !done);
  return `<div class="stepper">${steps.map(([name, done, sub], k) => `
    <div class="step ${done ? 'done' : k === now ? 'now' : ''}"><span class="n">${done ? '✓' : k + 1}</span>
      <span>${name}${sub ? `<small class="muted" style="font-weight:500">${esc(sub)}</small>` : ''}</span></div>`).join('')}</div>`;
}

function logCard(job) {
  return `<div class="card"><details ${job.error ? 'open' : ''}><summary>Nhật ký</summary>
    <div class="log">${esc(job.log.join('\n'))}</div></details></div>`;
}

// ---------- Lịch đăng ----------
const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultWhen() {
  // Mặc định: sau hiện tại khoảng 30 phút để khớp với Meta Business Suite.
  const d = new Date(Date.now() + 31 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
}

// Link reel chỉ mở được khi bài đã đăng công khai; nháp/hẹn giờ chưa có trang trên Facebook → xem file đã gửi.
function postLinks(p) {
  if (p.state === 'deleted') return '';
  if (!p.id || String(p.id).startsWith('browser-')) { // đăng qua trình duyệt, chưa dò được video_id
    const local = p.jobId && p.file ? `<a href="/files/${encodeURIComponent(p.jobId)}/${encodeURIComponent(p.file)}" target="_blank" rel="noopener">Xem video</a> ` : '';
    return local + `<a href="https://business.facebook.com/latest/content_calendar" target="_blank" rel="noopener">Mở Business Suite</a>`;
  }
  if (p.state === 'published') return `<a href="https://www.facebook.com/reel/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Mở reel</a>`;
  const local = p.jobId && p.file ? `<a href="/files/${encodeURIComponent(p.jobId)}/${encodeURIComponent(p.file)}" target="_blank" rel="noopener">Xem video</a>` : '';
  const bs = p.state === 'scheduled' ? ' <a href="https://business.facebook.com/latest/content_calendar" target="_blank" rel="noopener">Mở Business Suite</a>' : '';
  return local + bs + `<span class="muted" style="font-size:12px;display:block">${p.state === 'scheduled' ? 'Chưa tới giờ đăng — link reel có sau khi đăng.' : 'Nháp chưa có link công khai trên Facebook.'}</span>`;
}

const POST_STATE = { scheduled: 'Hẹn giờ', published: 'Đã đăng', draft: 'Nháp', deleted: 'Đã huỷ' };

async function openPosts(sync = false) {
  currentId = null;
  stopPoll();
  loadList();
  show('posts');
  $('#posts-list').innerHTML = '<div class="card muted">Đang tải…</div>';
  try {
    const posts = sync ? await api('/api/posts/sync', { method: 'POST' }) : await api('/api/posts');
    renderPosts(posts);
  } catch (e) {
    $('#posts-list').innerHTML = `<div class="card error-box">${esc(e.message)}</div>`;
  }
}

function renderPosts(posts) {
  const hide = $('#posts-hide-done').checked;
  const list = posts.filter((p) => !hide || !['published', 'deleted'].includes(p.state))
    .sort((a, b) => {
      const rank = (p) => ({ scheduled: 0, draft: 1, published: 2, deleted: 3 }[p.state] ?? 4);
      return rank(a) - rank(b) || (a.scheduledAt || a.createdAt).localeCompare(b.scheduledAt || b.createdAt) * (a.state === 'scheduled' ? 1 : -1);
    });
  if (!list.length) {
    $('#posts-list').innerHTML = '<div class="card muted">Chưa có bài nào. Ghép video xong → chọn "Hẹn giờ đăng" ở cuối trang video.</div>';
    return;
  }
  $('#posts-list').innerHTML = list.map((p) => {
    const when = p.scheduledAt ? new Date(p.scheduledAt) : null;
    const editable = p.state === 'scheduled' || p.state === 'draft';
    return `<div class="card post" data-post="${esc(p.id)}">
      <div class="when">${when ? when.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}
        <small><br>${when ? when.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }) : 'chưa đặt giờ'}</small></div>
      <div>
        <div><span class="badge ${p.state}">${POST_STATE[p.state] || p.state}</span> <b>${esc(p.pageName || 'Page')}</b></div>
        <div style="margin:4px 0"><a href="#" data-open-job="${esc(p.jobId)}">${esc((p.topic || '').slice(0, 90))}</a></div>
        <div class="muted" style="font-size:13px">${esc((p.caption || '').slice(0, 140))}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">video_id ${esc(p.id)}${p.fbStatus ? ` · Facebook: ${esc(p.fbStatus)}${p.publishStatus ? ' / ' + esc(p.publishStatus) : ''}` : ''}${p.checkedAt ? ` · kiểm lúc ${new Date(p.checkedAt).toLocaleTimeString('vi-VN')}` : ''}</div>
        ${p.error ? `<div class="error-box">${esc(p.error)}</div>` : ''}
      </div>
      <div class="acts">
        ${editable ? `<input type="datetime-local" value="${when ? toLocalInput(when) : defaultWhen()}" data-when>
          <button class="small" data-post-act="reschedule">${p.state === 'draft' ? 'Hẹn giờ' : 'Đổi giờ'}</button>
          <button class="small" data-post-act="soon">Đăng sớm (sau ~30 phút)</button>
          <button class="small danger" data-post-act="cancel">Huỷ / xoá khỏi Facebook</button>` : ''}
        <button class="small" data-post-act="sync">Kiểm tra trạng thái</button>
        ${postLinks(p)}
      </div>
    </div>`;
  }).join('');
}

$('#tab-posts').addEventListener('click', () => openPosts(false));
function openAccounts() {
  currentId = null;
  stopPoll();
  loadList();
  show('accounts');
  loadClaude();
  loadAiAccounts();
  loadFb();
  loadChromeFlow();
  loadChromeBox('fb');
}
$('#tab-accounts').addEventListener('click', openAccounts);

// Trạng thái Chrome Flow / Chrome Facebook cho pill đầu trang và nút đăng.
let fbc = {};
function setFbc(st) {
  fbc = st || {};
  cfg.fbReady = Boolean(fbc.source && fbc.page);
  const pill = $('#pill-fb');
  if (pill) {
    pill.className = `pill ${cfg.fbReady ? 'ok' : 'bad'}`;
    pill.textContent = cfg.fbReady ? `Facebook: ${fbc.page.name}` : 'Facebook chưa sẵn sàng';
  }
}
function setFlowPill(st) {
  const pill = $('#pill-flow');
  if (!pill) return;
  const ok = Boolean(st?.loggedIn) && !st?.outOfCredit;
  pill.className = `pill ${ok ? 'ok' : 'bad'}`;
  const email = st?.activeEmail || st?.source?.email || st?.source?.name || 'đã đăng nhập';
  if (st?.loggedIn && st?.outOfCredit) {
    pill.textContent = `Flow: ${email} (⚠️ Hết credit: còn ${st.creditsLeft ?? '<5'})`;
  } else if (st?.loggedIn) {
    pill.textContent = `Flow: ${email}${st.creditsLeft != null ? ` (${st.creditsLeft} credit)` : ''}`;
  } else {
    pill.textContent = st?.source ? `Flow: chờ đăng nhập (${st.source.email || st.source.name})` : 'Flow chưa sẵn sàng';
  }
}
async function loadChromeStatus() {
  const [f, b] = await Promise.all([api('/api/flow/status').catch(() => null), api('/api/fbchrome/status').catch(() => null)]);
  setFlowPill(f);
  setFbc(b);
}

// Hộp quản lý "Chrome riêng" (chép profile, hiện/ẩn, kiểm tra đăng nhập) — dùng cho Chrome Flow và Chrome Facebook.
const CHROMES = {
  flow: { box: '#chromeflow-box', api: '/api/flow', name: 'Chrome Flow', site: 'Flow', checkLabel: 'Kiểm tra đăng nhập Flow',
    ok: (r) => r.outOfCredit
      ? `⚠️ Chrome Flow đã vào Google Flow bằng <b>${esc(r.email || 'tài khoản hiện tại')}</b> nhưng chỉ còn <b>${r.creditsLeft ?? 'dưới 5'} tín dụng</b> (không đủ tạo video). Hãy bấm <b>🔄 Đổi tài khoản Google khác</b> hoặc chọn profile khác ở trên!`
      : `✓ Chrome Flow đã vào được Google Flow${r.email ? ` bằng <b>${esc(r.email)}</b>` : ''}${r.creditsLeft != null ? ` (còn <b>${r.creditsLeft} tín dụng</b>)` : ''}. Sẵn sàng tự động tạo video!`,
    bad: (r) => `Cửa sổ <b>Chrome Flow</b> đã bật lên trên màn hình ở trang chọn/đăng nhập tài khoản Google${r?.switchingTo ? ` (<b>${esc(r.switchingTo)}</b>)` : ''} — hãy chọn tài khoản hoặc nhập mật khẩu trong cửa sổ đó rồi bấm lại <b>Kiểm tra đăng nhập Flow</b>.` },
  fb: { box: '#chromefb-box', api: '/api/fbchrome', name: 'Chrome Facebook', site: 'Facebook', checkLabel: 'Kiểm tra đăng nhập Facebook',
    ok: (r) => `✓ Chrome Facebook đã đăng nhập${r.name ? ` (<b>${esc(r.name)}</b>)` : ''}${r.page ? ` và mở được Business Suite của Page <b>${esc(r.page)}</b>` : ''}. Sẵn sàng đăng.`,
    bad: (r) => `${esc(r.reason || 'Chưa đăng nhập Facebook')}. Bấm <b>Hiện cửa sổ</b>, tự đăng nhập Facebook (tài khoản quản trị Page) trong cửa sổ Chrome Facebook, rồi kiểm tra lại.`,
    extra: (st) => !st.source ? '' : `
      <div class="field" style="margin-top:2px">
        <span class="field-label">Page để đăng</span>
        <div class="row" style="margin-top:0">
          <select data-cb="page" class="grow-sel">${st.pages.length || st.page ? '' : '<option value="">— bấm "Lấy danh sách Page" —</option>'}
            ${[...new Set([...(st.page ? [st.page.name] : []), ...st.pages])].map((n) => `<option ${n === st.page?.name ? 'selected' : ''}>${esc(n)}</option>`).join('')}
          </select>
          <button class="small" data-cb="pages">${st.pages.length ? 'Tải lại danh sách' : 'Lấy danh sách Page'}</button>
        </div>
        <small class="muted">Lấy từ Business Suite của tài khoản trong Chrome Facebook — không cần API.</small>
      </div>` },
};
async function loadChromeBox(kind, extra = '') {
  const c = CHROMES[kind];
  const box = $(c.box);
  if (!box) return;
  let st;
  try { st = await api(`${c.api}/status`); } catch (e) { box.textContent = e.message; return; }
  const src = st.source;
  const activeEmail = st.activeEmail || src?.email || '';
  const creditBadge = kind === 'flow' && st.loggedIn && st.creditsLeft != null
    ? ` · Tín dụng Flow: <b style="color:${st.outOfCredit ? '#dc2626' : '#047857'}">${st.creditsLeft} tín dụng${st.outOfCredit ? ' (⚠️ Không đủ tạo video)' : ''}</b>`
    : '';
  const statusLine = kind === 'flow'
    ? (st.loggedIn
      ? `<b style="color:${st.outOfCredit ? '#dc2626' : 'var(--ok)'}">${st.outOfCredit ? '⚠️ Đã đăng nhập nhưng HẾT TÍN DỤNG' : '✓ Đã đăng nhập Google Flow'}</b>`
      : st.up ? `<b style="color:#d97706">đang mở — chờ bạn chọn/đăng nhập Google trong cửa sổ Chrome Flow</b>` : `<b style="color:var(--muted)">chưa mở</b>`)
    : `<b style="color:${st.up ? 'var(--ok)' : 'var(--muted)'}">${st.up ? 'đang chạy' : 'chưa mở'}</b>`;
  const autoWarn = kind === 'flow' && st.up && !st.loggedIn && !extra
    ? `<div class="error-box" style="margin:0">Cửa sổ <b>Chrome Flow</b> riêng đã mở trên màn hình ở trang <b>Chọn / Đăng nhập Tài khoản Google</b>${src?.email ? ` (điền sẵn <b>${esc(src.email)}</b>)` : ''}. Hãy chọn tài khoản hoặc nhập mật khẩu trong cửa sổ đó rồi bấm <b>Kiểm tra đăng nhập Flow</b>.</div>`
    : (kind === 'flow' && st.loggedIn && st.outOfCredit && !extra
      ? `<div class="error-box" style="margin:0">⚠️ Tài khoản Google Flow <b>${esc(activeEmail)}</b> hiện chỉ còn <b>${st.creditsLeft ?? 'dưới 5'} tín dụng</b> (cần tối thiểu <b>5 tín dụng/cảnh</b> cho Veo 3.1 - Lite hoặc <b>10 tín dụng/cảnh</b> cho Veo 3.1 - Fast).<br>👉 Hãy chọn tài khoản khác ở danh sách bên dưới rồi bấm <b>Chọn & đổi tài khoản</b>, hoặc bấm <b>🔄 Đổi tài khoản Google khác</b> để đăng nhập Gmail khác còn credit!</div>`
      : '');
  box.innerHTML = `
    <div>Trạng thái: ${statusLine}${src ? ` · tài khoản đang dùng: <b>${esc(activeEmail || src.name)}</b>` : ' · chưa chọn tài khoản'}${creditBadge}</div>
    <div class="row" style="margin-top:0">
      <select data-cb="profile" style="width:auto;max-width:100%">${st.profiles.map((p) => `<option value="${esc(p.dir)}" ${(activeEmail && p.email === activeEmail) || (!activeEmail && src?.dir === p.dir) ? 'selected' : ''}>${esc(p.name)}${p.email ? ` — ${esc(p.email)}` : ''}</option>`).join('')}</select>
      <button class="small primary" data-cb="sync">${src ? 'Chọn & đổi tài khoản' : 'Chọn profile & mở'}</button>
      ${kind === 'flow' ? '<button class="small" data-cb="switch-account" title="Mở trang Chọn / Thêm tài khoản Google khác trong Chrome Flow">🔄 Đổi tài khoản Google khác</button>' : ''}
    </div>
    ${src ? `<div class="row" style="margin-top:0">
      <button class="small" data-cb="show">Hiện cửa sổ</button><button class="small" data-cb="hide">Ẩn sang mép</button>
      <button class="small" data-cb="check">${c.checkLabel}</button>${st.up ? '<button class="small danger" data-cb="close">Tắt</button>' : ''}</div>` : ''}
    ${c.extra ? c.extra(st) : ''}
    ${extra || autoWarn}`;
  if (kind === 'fb') setFbc(st); else setFlowPill(st);
}
const loadChromeFlow = (extra) => loadChromeBox('flow', extra);

for (const [kind, c] of Object.entries(CHROMES)) {
  $(c.box)?.addEventListener('change', async (e) => {
    if (e.target.dataset?.cb !== 'page' || !e.target.value) return;
    const sel = e.target;
    sel.disabled = true;
    toast(`Đang chọn Page "${sel.value}" trong Business Suite…`, 30000);
    try {
      const r = await api(`${c.api}/page`, { method: 'POST', body: { name: sel.value } });
      toast(`Sẽ đăng lên "${r.name}"`);
    } catch (err) { toast(err.message, 8000); }
    loadChromeBox(kind);
  });
  $(c.box)?.addEventListener('click', async (e) => {
    const act = e.target.dataset?.cb;
    if (!act || act === 'profile' || act === 'page') return;
    const box = $(c.box);
    const b = e.target;
    const label = b.textContent;
    b.disabled = true;
    try {
      if (act === 'sync') {
        b.textContent = 'Đang mở…';
        const r = await api(`${c.api}/sync`, { method: 'POST', body: { dir: box.querySelector('[data-cb=profile]').value } });
        const msg = r.login?.ok
          ? `<div class="${r.login.outOfCredit ? 'error-box' : 'dialogue'}" style="margin:0;${r.login.outOfCredit ? '' : 'color:#047857'}">${c.ok(r.login)}</div>`
          : `<div class="error-box" style="margin:0">${c.bad(r.login || { url: '' })}</div>`;
        return loadChromeBox(kind, msg);
      }
      if (act === 'switch-account') {
        b.textContent = 'Đang mở chọn tài khoản…';
        const selOpt = box.querySelector('[data-cb=profile]')?.selectedOptions?.[0]?.textContent || '';
        const emailMatch = selOpt.match(/—\s*([^\s]+@[^\s]+)/);
        await api(`${c.api}/switch-account`, { method: 'POST', body: { email: emailMatch ? emailMatch[1] : '' } });
        return loadChromeBox(kind, `<div class="error-box" style="margin:0">Cửa sổ <b>Chrome Flow</b> đã bật lên ở trang <b>Chọn / Thêm tài khoản Google</b>. Hãy chọn tài khoản Google còn tín dụng Flow (hoặc đăng nhập tài khoản mới), sau đó bấm <b>Kiểm tra đăng nhập Flow</b>!</div>`);
      }
      if (act === 'show' || act === 'hide') { await api(`${c.api}/show`, { method: 'POST', body: { show: act === 'show' } }); return loadChromeBox(kind); }
      if (act === 'close') { await api(`${c.api}/close`, { method: 'POST' }); return loadChromeBox(kind); }
      if (act === 'pages') {
        b.textContent = 'Đang lấy từ Business Suite…';
        const r = await api(`${c.api}/pages`, { method: 'POST' });
        return loadChromeBox(kind, `<div class="dialogue" style="margin:0">Tìm thấy ${r.pages.length} Page.</div>`);
      }
      if (act === 'check') {
        b.textContent = `Đang mở ${c.site}…`;
        const r = await api(`${c.api}/check`, { method: 'POST' });
        return loadChromeBox(kind, r.ok ? `<div class="${r.outOfCredit ? 'error-box' : 'dialogue'}" style="margin:0;${r.outOfCredit ? '' : 'color:#047857'}">${c.ok(r)}</div>` : `<div class="error-box" style="margin:0">${c.bad(r)}</div>`);
      }
    } catch (err) {
      toast(err.message, 8000);
    } finally {
      b.disabled = false;
      if (document.body.contains(b)) b.textContent = label;
    }
  });
}
$('#status-pills').addEventListener('click', (e) => { if (e.target.closest('.pill')) openAccounts(); });
$('#tab-videos').addEventListener('click', () => {
  const first = $('#job-list li[data-id]');
  if (first) openJob(first.dataset.id); else show('new');
});
$('#posts-sync').addEventListener('click', () => openPosts(true));
$('#posts-hide-done').addEventListener('change', async () => renderPosts(await api('/api/posts')));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-goto-posts]')) { e.preventDefault(); openPosts(true); }
  if (e.target.closest('[data-goto-accounts]')) { e.preventDefault(); openAccounts(); }
  const j = e.target.closest('[data-open-job]');
  if (j) { e.preventDefault(); openJob(j.dataset.openJob); }
});

$('#posts-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-post-act]');
  if (!b) return;
  const card = b.closest('[data-post]');
  const id = card.dataset.post;
  const act = b.dataset.postAct;
  try {
    b.disabled = true;
    if (act === 'reschedule' || act === 'soon') {
      const t = act === 'soon' ? new Date(Date.now() + 31 * 60 * 1000) : new Date(card.querySelector('[data-when]').value);
      if (Number.isNaN(t.getTime())) throw new Error('Chọn ngày giờ');
      if (!confirm(`${act === 'soon' ? 'Đăng sớm' : 'Hẹn đăng'} lúc ${t.toLocaleString('vi-VN')}? Tới giờ Facebook sẽ TỰ ĐĂNG công khai.`)) return;
      await api(`/api/posts/${id}/reschedule`, { method: 'POST', body: { at: Math.floor(t.getTime() / 1000) } });
      toast('Đã cập nhật giờ đăng');
    } else if (act === 'cancel') {
      if (!confirm('Huỷ bài này và XOÁ video khỏi Facebook? Không hoàn tác được.')) return;
      await api(`/api/posts/${id}/cancel`, { method: 'POST' });
      toast('Đã huỷ');
    } else {
      await api(`/api/posts/${id}/sync`, { method: 'POST' });
    }
    renderPosts(await api('/api/posts'));
  } catch (err) {
    toast(err.message, 7000);
    renderPosts(await api('/api/posts'));
  } finally {
    b.disabled = false;
  }
});

// ---------- Tài khoản Claude / ChatGPT / Gemini ----------
let clLogin = null; // phiên đăng nhập đang chờ dán mã
let aiStatusCache = null;

async function loadClaude() {
  const box = $('#cl-box');
  if (!box) return;
  let accs;
  try { accs = await api('/api/claude/accounts'); } catch (e) { box.textContent = e.message; return; }
  const act = accs.find((a) => a.active) || accs[0];
  const clInfo = aiStatusCache?.providers?.claude;
  const ready = Boolean(act?.loggedIn || clInfo?.hasApiKey);
  const pill = $('#pill-cl');
  if (pill) {
    pill.className = `pill ${ready ? 'ok' : 'bad'}`;
    pill.textContent = ready ? `✦ Claude: ${act?.email || (clInfo?.hasApiKey ? 'API Key' : 'sẵn sàng')}` : '✦ Claude: chưa đăng nhập';
  }
  const label = (a) => `${a.email || '(chưa đăng nhập)'}${a.plan ? ` · ${a.plan}` : ''}${a.builtin ? ' · mặc định' : ''}`;
  box.innerHTML = `
    <span>Đang dùng: <span class="who">${esc(act?.email || (clInfo?.hasApiKey ? `API Key (${clInfo.apiKeyMask})` : 'chưa đăng nhập'))}</span>${act?.plan ? ` <span class="badge">${esc(act.plan)}</span>` : ''}</span>
    ${accs.length > 1 ? `<select id="cl-active">${accs.map((a) => `<option value="${esc(a.id)}" ${a.active ? 'selected' : ''} ${a.loggedIn ? '' : 'disabled'}>${esc(label(a))}</option>`).join('')}</select>` : ''}
    ${clLogin ? `
      <div class="manual" style="margin-top:0">
        <b>Thêm tài khoản Claude</b>
        <ol class="howto" style="font-size:13px">
          <li><a href="${esc(clLogin.url)}" target="_blank" rel="noopener">Mở trang đăng nhập Claude</a> — đăng nhập đúng tài khoản muốn thêm (mở cửa sổ ẩn danh nếu trình duyệt đang đăng nhập tài khoản khác).</li>
          <li>Chép mã trang hiện ra, dán vào đây:</li>
        </ol>
        <input id="cl-code" placeholder="Dán mã vào đây" autocomplete="off">
        <div class="row" style="margin-top:6px"><button class="small primary" id="cl-submit">Xác nhận</button><button class="small" id="cl-cancel">Huỷ</button></div>
      </div>` : `
      <div class="row" style="margin-top:0">
        <button class="small" id="cl-add">＋ Thêm tài khoản</button>
        <button class="small" id="cl-test">⚡ Kiểm tra Claude</button>
        ${act && !act.builtin ? `<button class="small danger" id="cl-logout" data-id="${esc(act.id)}">Đăng xuất</button>` : ''}
      </div>`}`;
}

$('#cl-box').addEventListener('click', async (e) => {
  const id = e.target.id;
  try {
    if (id === 'cl-add') {
      e.target.disabled = true;
      e.target.textContent = 'Đang mở…';
      clLogin = await api('/api/claude/login/start', { method: 'POST' });
      await loadClaude();
      window.open(clLogin.url, '_blank', 'noopener');
    } else if (id === 'cl-test') {
      const orig = e.target.textContent;
      e.target.disabled = true;
      e.target.textContent = '⏳ Đang kiểm tra…';
      try {
        const r = await api('/api/ai/test', { method: 'POST', body: { aiModel: 'claude-sonnet-4-6' } });
        toast(`✓ Claude phản hồi tốt (${(r.elapsedMs / 1000).toFixed(1)}s): "${r.reply}"`, 5000);
      } finally {
        e.target.disabled = false;
        if (document.body.contains(e.target)) e.target.textContent = orig;
      }
    } else if (id === 'cl-submit') {
      e.target.disabled = true;
      e.target.textContent = 'Đang xác nhận…';
      const r = await api('/api/claude/login/code', { method: 'POST', body: { sessionId: clLogin.sessionId, code: $('#cl-code').value } });
      clLogin = null;
      toast(`Đã thêm và chuyển sang ${r.email}${r.plan ? ` (${r.plan})` : ''}`, 6000);
      await loadClaude();
    } else if (id === 'cl-cancel') {
      await api('/api/claude/login/cancel', { method: 'POST', body: { sessionId: clLogin?.sessionId } });
      clLogin = null;
      await loadClaude();
    } else if (id === 'cl-logout') {
      if (!confirm('Đăng xuất tài khoản Claude này khỏi web?')) return;
      await api('/api/claude/logout', { method: 'POST', body: { id: e.target.dataset.id } });
      toast('Đã đăng xuất, chuyển về tài khoản mặc định');
      await loadClaude();
    }
  } catch (err) {
    toast(err.message, 7000);
    if (id === 'cl-add') clLogin = null;
    await loadClaude();
  }
});
$('#cl-box').addEventListener('change', async (e) => {
  if (e.target.id !== 'cl-active') return;
  try {
    await api('/api/claude/active', { method: 'POST', body: { id: e.target.value } });
    toast('Đã đổi tài khoản Claude');
    await loadClaude();
  } catch (err) { toast(err.message); }
});

// ---------- Quản lý đa Model AI: ChatGPT & Gemini + Mặc định ----------
let gemLogin = null; // phiên đăng nhập OAuth Google Gemini đang chờ dán mã

async function loadAiAccounts() {
  let st;
  try { st = await api('/api/ai/status'); } catch (e) { return; }
  aiStatusCache = st;
  if (st.defaultAi) {
    cfg.defaultAi = st.defaultAi;
  }

  // Cập nhật các pill trên thanh header
  const gpt = st.providers?.chatgpt || {};
  const gem = st.providers?.gemini || {};
  const cl = st.providers?.claude || {};

  const pillGpt = $('#pill-gpt');
  if (pillGpt) {
    pillGpt.className = `pill ${gpt.ready ? 'ok' : 'bad'}`;
    pillGpt.textContent = gpt.ready
      ? `🟢 ChatGPT: ${gpt.email || (gpt.hasApiKey ? 'API Key' : 'sẵn sàng')}`
      : '🟢 ChatGPT: chưa kết nối';
  }
  const pillGem = $('#pill-gem');
  if (pillGem) {
    pillGem.className = `pill ${gem.ready ? 'ok' : 'bad'}`;
    pillGem.textContent = gem.ready
      ? `♊ Gemini: ${gem.email || (gem.hasApiKey ? 'API Key' : 'sẵn sàng')}`
      : '♊ Gemini: chưa kết nối';
  }
  const pillCl = $('#pill-cl');
  if (pillCl && cl.ready && pillCl.textContent.includes('…')) {
    pillCl.className = 'pill ok';
    pillCl.textContent = `✦ Claude: ${cl.email || 'sẵn sàng'}`;
  }

  // Ô chọn Model AI mặc định trong tab Tài khoản
  const defSel = $('#default-ai-select');
  if (defSel) {
    const curDef = st.defaultAi?.combined || st.defaultAi?.model || 'claude:claude-sonnet-4-5';
    defSel.innerHTML = aiModelOpts(curDef);
    defSel.value = curDef;
  }

  // Khung ChatGPT (#gpt-box)
  const gptBox = $('#gpt-box');
  if (gptBox) {
    const statusBadge = gpt.ready
      ? `<b style="color:var(--ok)">✓ Đã sẵn sàng</b> · Đang dùng: <span class="who">${esc(gpt.email || gpt.accountLabel || 'ChatGPT')}</span>${gpt.plan ? ` <span class="badge">${esc(gpt.plan)}</span>` : ''}`
      : `<b style="color:var(--bad)">Chưa kết nối</b>`;
    gptBox.innerHTML = `
      <div>Trạng thái: ${statusBadge}</div>
      ${gpt.cliInstalled ? `<div style="font-size:12.5px;color:var(--muted)">Đã tích hợp <b>ChatGPT CLI (Codex)</b> trên máy — nếu tài khoản hiện tại hết hạn mức, bấm <b>🔑 Đổi tài khoản ChatGPT</b> để đăng nhập tài khoản khác.</div>` : ''}
      <div class="row" style="margin-top:2px">
        <button type="button" class="small primary" data-ai-act="test" data-provider="chatgpt">⚡ Kiểm tra ChatGPT</button>
        ${gpt.cliInstalled ? `<button type="button" class="small" data-ai-act="gpt-login">🔑 Đăng nhập / Đổi tài khoản ChatGPT</button>` : ''}
        <button type="button" class="small" data-ai-act="toggle-key" data-target="gpt-key-form">${gpt.hasApiKey ? `🔐 Đổi OpenAI API Key (${esc(gpt.apiKeyMask)})` : '＋ Nhập OpenAI API Key (tuỳ chọn)'}</button>
      </div>
      <div id="gpt-key-form" class="manual" style="margin-top:4px" ${gpt.ready ? 'hidden' : ''}>
        <div style="font-size:12.5px;margin-bottom:4px"><b>OpenAI API Key</b> (tuỳ chọn — nếu đã đăng nhập ChatGPT CLI ở trên thì không bắt buộc):</div>
        <div class="row" style="margin-top:0">
          <input type="password" id="gpt-api-key-inp" placeholder="sk-proj-..." autocomplete="new-password" style="flex:1">
          <button type="button" class="small primary" data-ai-act="save-gpt-key">Lưu Key</button>
          ${gpt.hasApiKey ? `<button type="button" class="small danger" data-ai-act="clear-gpt-key">Xoá Key</button>` : ''}
        </div>
      </div>`;
  }

  // Khung Gemini (#gemini-box) — Hiển thị rõ tài khoản đang kết nối + đổi / thêm tài khoản khi hết dung lượng
  const gemBox = $('#gemini-box');
  if (gemBox) {
    const gemAccs = Array.isArray(gem.accounts) ? gem.accounts : [];
    const activeGem = gemAccs.find((a) => a.active) || gemAccs[0] || null;
    const whoText = activeGem?.email || gem.email || (gem.hasApiKey ? `API Key (${gem.apiKeyMask})` : (gem.ready ? 'Gemini CLI' : 'chưa đăng nhập'));
    const planText = activeGem?.plan || gem.plan || (gem.hasApiKey ? 'API Key' : '');
    const gemAccLabel = (a) => `${a.email || '(chưa đặt tên)'}${a.plan ? ` · ${a.plan}` : ''}${a.active ? ' (đang dùng)' : ''}`;

    gemBox.innerHTML = `
      <div>
        <span>Đang dùng: <span class="who">${esc(whoText)}</span>${planText ? ` <span class="badge">${esc(planText)}</span>` : ''}</span>
        ${gem.ready ? ` · <b style="color:var(--ok);font-size:12.5px">✓ Đã sẵn sàng</b>` : ` · <b style="color:var(--bad);font-size:12.5px">Chưa kết nối</b>`}
      </div>
      ${gemAccs.length > 0 ? `
        <div class="field" style="margin-top:2px">
          <span class="field-label" style="font-size:12px;color:var(--ink-2)">Chuyển đổi tài khoản Gemini (${gemAccs.length} tài khoản đã lưu — tự động đổi sang tài khoản tiếp theo nếu hết dung lượng):</span>
          <select id="gem-active" style="margin-top:3px">
            ${gemAccs.map((a) => `<option value="${esc(a.id)}" ${a.active ? 'selected' : ''}>${esc(gemAccLabel(a))}</option>`).join('')}
          </select>
        </div>` : ''}
      ${gemLogin ? `
        <div class="manual" style="margin-top:4px">
          <b>Thêm / Đổi tài khoản Google cho Gemini</b>
          <ol class="howto" style="font-size:13px">
            <li><a href="${esc(gemLogin.url)}" target="_blank" rel="noopener">Mở trang đăng nhập Google Gemini</a> — chọn tài khoản Google bạn muốn thêm hoặc đổi sang.</li>
            <li>Sau khi đồng ý cấp quyền, chép mã xác thực hiện ra trên màn hình và dán vào đây:</li>
          </ol>
          <input id="gem-code" placeholder="Dán mã xác thực từ Google vào đây" autocomplete="off">
          <div class="row" style="margin-top:6px">
            <button type="button" class="small primary" data-ai-act="gem-submit">Xác nhận & Chuyển tài khoản</button>
            <button type="button" class="small" data-ai-act="gem-cancel">Huỷ</button>
          </div>
        </div>` : `
        <div class="row" style="margin-top:2px">
          <button type="button" class="small primary" data-ai-act="gem-add">＋ Thêm / Đổi tài khoản Google</button>
          <button type="button" class="small" data-ai-act="test" data-provider="gemini">⚡ Kiểm tra Gemini</button>
          <button type="button" class="small" data-ai-act="toggle-key" data-target="gem-key-form">＋ Thêm API Key dự phòng</button>
          ${activeGem && gemAccs.length > 1 ? `<button type="button" class="small danger" data-ai-act="gem-logout" data-id="${esc(activeGem.id)}">Xoá tài khoản này</button>` : ''}
        </div>`}
      <div id="gem-key-form" class="manual" style="margin-top:4px" hidden>
        <div style="font-size:12.5px;margin-bottom:4px"><b>Thêm tài khoản Gemini bằng API Key</b> (dự phòng khi tài khoản Google CLI hết dung lượng — lấy tại <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>):</div>
        <div class="row" style="margin-top:0">
          <input type="text" id="gem-api-label-inp" placeholder="Tên gợi nhớ (VD: Key Gmail phụ 1)" style="flex:1;min-width:150px">
          <input type="password" id="gem-api-key-inp" placeholder="AIzaSy..." autocomplete="new-password" style="flex:1.4;min-width:180px">
          <button type="button" class="small primary" data-ai-act="save-gem-key">＋ Lưu vào danh sách</button>
        </div>
      </div>`;
  }
}

$('#default-ai-select')?.addEventListener('change', async (e) => {
  const aiModel = e.target.value;
  const chosenLabel = e.target.options[e.target.selectedIndex]?.text || aiModel;
  if (!aiModel) return;
  try {
    const r = await api('/api/ai/settings', { method: 'POST', body: { defaultAiModel: aiModel, aiSelection: aiModel } });
    cfg.defaultAi = r.defaultAi || r.defaultSelection || cfg.defaultAi;
    populateAiModelSelects(false);
    toast(`✓ Đã đặt Model AI mặc định: ${r.defaultAi ? `${r.defaultAi.providerIcon} ${r.defaultAi.modelName}` : chosenLabel}`);
  } catch (err) {
    toast(err.message);
  }
});

$('#gemini-box')?.addEventListener('change', async (e) => {
  if (e.target.id !== 'gem-active') return;
  const sel = e.target;
  sel.disabled = true;
  try {
    const r = await api('/api/gemini/active', { method: 'POST', body: { id: sel.value } });
    toast(`✓ Đã chuyển Gemini sang tài khoản: ${r.email || r.id}`, 4500);
    await loadAiAccounts();
  } catch (err) {
    toast(err.message, 6000);
    await loadAiAccounts();
  }
});

async function handleAiBoxClick(e) {
  const b = e.target.closest('[data-ai-act]');
  if (!b) return;
  const act = b.dataset.aiAct;
  try {
    if (act === 'toggle-key') {
      const target = document.getElementById(b.dataset.target);
      if (target) target.hidden = !target.hidden;
      return;
    }
    if (act === 'test') {
      const provider = b.dataset.provider;
      const orig = b.textContent;
      b.disabled = true;
      b.textContent = '⏳ Đang kiểm tra…';
      try {
        const r = await api('/api/ai/test', { method: 'POST', body: { aiModel: provider } });
        toast(`✓ ${r.providerName} (${r.modelName}) phản hồi tốt (${(r.elapsedMs / 1000).toFixed(1)}s): "${r.reply}"`, 6000);
      } finally {
        b.disabled = false;
        if (document.body.contains(b)) b.textContent = orig;
      }
      return;
    }
    if (act === 'gem-add') {
      b.disabled = true;
      b.textContent = 'Đang lấy link đăng nhập…';
      gemLogin = await api('/api/gemini/login/start', { method: 'POST' });
      await loadAiAccounts();
      window.open(gemLogin.url, '_blank', 'noopener');
      return;
    }
    if (act === 'gem-submit') {
      b.disabled = true;
      b.textContent = 'Đang xác nhận…';
      const code = ($('#gem-code')?.value || '').trim();
      const r = await api('/api/gemini/login/code', { method: 'POST', body: { sessionId: gemLogin?.sessionId, code } });
      gemLogin = null;
      toast(`✓ Đã kết nối và chuyển Gemini sang tài khoản ${r.email}!`, 6000);
      await loadAiAccounts();
      return;
    }
    if (act === 'gem-cancel') {
      await api('/api/gemini/login/cancel', { method: 'POST', body: { sessionId: gemLogin?.sessionId } });
      gemLogin = null;
      await loadAiAccounts();
      return;
    }
    if (act === 'gem-logout') {
      if (!confirm('Xoá tài khoản Gemini này khỏi danh sách chuyển đổi?')) return;
      await api('/api/gemini/logout', { method: 'POST', body: { id: b.dataset.id } });
      toast('Đã xoá tài khoản Gemini và chuyển sang tài khoản kế tiếp');
      await loadAiAccounts();
      return;
    }
    if (act === 'gpt-login') {
      b.disabled = true;
      b.textContent = 'Đang mở trình duyệt…';
      await api('/api/ai/chatgpt/login', { method: 'POST' });
      toast('Đã mở cửa sổ đăng nhập ChatGPT trên trình duyệt — sau khi đăng nhập xong hãy bấm "⚡ Kiểm tra ChatGPT"!', 7000);
      setTimeout(() => loadAiAccounts(), 4000);
      return;
    }
    if (act === 'save-gpt-key') {
      const key = ($('#gpt-api-key-inp')?.value || '').trim();
      if (!key) return toast('Hãy dán OpenAI API Key (sk-...)');
      await api('/api/ai/settings', { method: 'POST', body: { openaiApiKey: key } });
      toast('✓ Đã lưu OpenAI API Key');
      await loadAiAccounts();
      return;
    }
    if (act === 'clear-gpt-key') {
      await api('/api/ai/settings', { method: 'POST', body: { openaiApiKey: '' } });
      toast('Đã xoá OpenAI API Key');
      await loadAiAccounts();
      return;
    }
    if (act === 'save-gem-key') {
      const key = ($('#gem-api-key-inp')?.value || '').trim();
      const label = ($('#gem-api-label-inp')?.value || '').trim();
      if (!key) return toast('Hãy dán Gemini API Key (AIza...)');
      const r = await api('/api/gemini/apikey', { method: 'POST', body: { apiKey: key, label } });
      await api('/api/ai/settings', { method: 'POST', body: { geminiApiKey: key } });
      toast(`✓ Đã thêm & kích hoạt "${r.email || r.label}" trong danh sách tài khoản Gemini!`);
      await loadAiAccounts();
      return;
    }
    if (act === 'clear-gem-key') {
      await api('/api/ai/settings', { method: 'POST', body: { geminiApiKey: '' } });
      toast('Đã xoá Gemini API Key');
      await loadAiAccounts();
      return;
    }
  } catch (err) {
    toast(err.message, 7000);
    if (act === 'gem-add') gemLogin = null;
    await loadAiAccounts();
  }
}
$('#gpt-box')?.addEventListener('click', handleAiBoxClick);
$('#gemini-box')?.addEventListener('click', handleAiBoxClick);

// ---------- Facebook ----------
async function loadFb() {
  fb = await api('/api/fb/status').catch(() => ({ connected: false }));
  const box = $('#fb-box');
  const sel = fb.pages?.find((p) => p.id === fb.selectedPageId);
  const appForm = (editing) => `
    <div class="manual" style="margin-top:0">
      <b>${editing ? 'Đổi app Facebook' : 'Cài app Facebook (làm 1 lần)'}</b>
      <ol class="howto" style="font-size:13px">
        <li>Vào <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> → <b>Tạo ứng dụng</b> (loại Doanh nghiệp), thêm trường hợp sử dụng <b>Quản lý mọi thứ trên Trang</b> và <b>Đăng nhập bằng Facebook</b>.</li>
        <li>Facebook Login → Cài đặt → <b>URI chuyển hướng OAuth hợp lệ</b>, thêm:
          <div class="row" style="margin-top:4px"><code id="fb-redirect">${esc(fb.app?.redirectUri || '')}</code><button type="button" class="small" id="fb-copy">Copy</button></div></li>
        <li>Cài đặt ứng dụng → Thông tin cơ bản: chép <b>App ID</b> và <b>App Secret</b> vào đây.</li>
      </ol>
      <input id="fb-app-id" placeholder="App ID (dãy số)" value="${esc(fb.app?.appId || '')}" inputmode="numeric" autocomplete="off">
      <input id="fb-app-secret" type="password" placeholder="App Secret (32 ký tự)" autocomplete="new-password" style="margin-top:6px">
      <div class="row" style="margin-top:8px"><button class="small primary" id="fb-app-save">Kiểm tra & lưu</button>${editing ? '<button class="small" id="fb-app-cancel">Huỷ</button>' : ''}</div>
      <small class="muted">App Secret được mã hoá, chỉ lưu trên máy này (data/settings.json).</small>
    </div>`;
  const appLine = () => fb.app?.appId ? `<small class="muted">App: ${esc(fb.app.name || fb.app.appId)} · ${fb.app.source === 'env' ? 'từ .env' : `<a href="#" id="fb-app-edit">đổi app</a>`}</small>` : '';
  if (fbEditingApp || (!fb.oauthReady && !fb.envPage)) {
    box.innerHTML = appForm(fbEditingApp && fb.oauthReady);
  } else if (!fb.connected) {
    box.innerHTML = `<span>${fb.envPage ? 'Đang dùng Page khai trong .env.' : 'Chưa kết nối.'}</span>
      ${fb.oauthReady ? '<button class="btn-fb block" id="fb-login">Đăng nhập Facebook</button>' : ''}${appLine()}`;
  } else {
    const days = fb.expiresAt ? Math.round((new Date(fb.expiresAt) - Date.now()) / 86400000) : null;
    box.innerHTML = `<span>Đã kết nối: <span class="who">${esc(fb.user.name)}</span>${days != null ? ` · còn ${days} ngày` : ''}</span>
      <label style="font-weight:400">Page để đăng
        <select id="fb-page">${fb.pages.length ? '' : '<option value="">(không có Page nào)</option>'}
          ${fb.pages.map((p) => `<option value="${esc(p.id)}" ${p.id === fb.selectedPageId ? 'selected' : ''} ${p.hasToken ? '' : 'disabled'}>${esc(p.name)}${p.canPost ? '' : ' (không có quyền đăng)'}</option>`).join('')}
        </select></label>
      <div class="row" style="margin-top:0"><button class="small" id="fb-login">Đăng nhập lại</button><button class="small danger" id="fb-out">Ngắt</button></div>${appLine()}`;
  }
}

$('#fb-box').addEventListener('click', async (e) => {
  const id = e.target.id;
  if (id === 'fb-copy') { navigator.clipboard.writeText($('#fb-redirect').textContent); toast('Đã copy URI chuyển hướng'); return; }
  if (id === 'fb-app-edit') { e.preventDefault(); fbEditingApp = true; return loadFb(); }
  if (id === 'fb-app-cancel') { fbEditingApp = false; return loadFb(); }
  if (id === 'fb-app-save') {
    e.target.disabled = true;
    e.target.textContent = 'Đang kiểm tra với Facebook…';
    try {
      const r = await api('/api/fb/app', { method: 'POST', body: { appId: $('#fb-app-id').value, appSecret: $('#fb-app-secret').value } });
      fbEditingApp = false;
      toast(`Đã lưu app "${r.name || r.appId}" — giờ bấm Đăng nhập Facebook`, 6000);
      return loadFb();
    } catch (err) {
      // Giữ nguyên những gì đã nhập để sửa lại.
      toast(err.message, 8000);
      e.target.disabled = false;
      e.target.textContent = 'Kiểm tra & lưu';
      return;
    }
  }
  if (e.target.id === 'fb-login') {
    const w = 600, h = 720;
    window.open('/api/fb/start', 'fb-login', `width=${w},height=${h},left=${(screen.width - w) / 2},top=${(screen.height - h) / 2}`);
  }
  if (e.target.id === 'fb-out' && confirm('Ngắt kết nối Facebook? Token đã lưu sẽ bị xoá.')) {
    await api('/api/fb/disconnect', { method: 'POST' });
    await loadFb();
    if (currentJob) renderJob(currentJob);
  }
});
$('#fb-box').addEventListener('change', async (e) => {
  if (e.target.id !== 'fb-page') return;
  try {
    await api('/api/fb/page', { method: 'POST', body: { pageId: e.target.value } });
    await loadFb();
    toast('Đã chọn Page');
    if (currentJob) renderJob(currentJob);
  } catch (err) { toast(err.message); }
});
// Popup đăng nhập báo kết quả về đây (chỉ nhận từ chính origin của web).
window.addEventListener('message', async (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'fb-login') return;
  toast(e.data.ok ? `Đã kết nối ${e.data.user} · ${e.data.pages} Page` : `Đăng nhập Facebook lỗi: ${e.data.error}`, 6000);
  await loadFb();
  if (currentJob) renderJob(currentJob);
});

// ---------- thao tác ----------
$('#view-job').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !currentJob) return;
  const id = currentJob.id;
  const i = Number(b.dataset.i);
  const n = currentJob.scenes.length;
  try {
    switch (b.dataset.act) {
      case 'script':
        if (currentJob.scenes.some((s) => s.clip) && !confirm('Viết lại kịch bản sẽ bỏ hết video các cảnh đã tạo. Tiếp tục?')) return;
        await api(`/api/jobs/${id}/script`, { method: 'POST' });
        break;
      case 'auto-run': {
        const n = currentJob.scenes.slice(i).filter((x, k) => k === 0 || !x.clip).length;
        if (!confirm(`Chrome Flow sẽ TỰ ĐIỀN và TỰ BẤM TẠO ${n} cảnh (từ cảnh ${i + 1}) bằng ${currentJob.flowModel || 'Veo 3.1 - Fast'} — mỗi cảnh trừ credit Flow. Tiếp tục?`)) return;
        await api(`/api/jobs/${id}/auto`, { method: 'POST', body: { from: i } });
        toast('Đã bắt đầu — theo dõi ở nhật ký và từng cảnh', 5000);
        break;
      }
      case 'restore-prompt':
        if (!confirm(`Bỏ bản prompt đã tự viết lại, dùng lại prompt gốc của cảnh ${i + 1}?`)) return;
        await api(`/api/jobs/${id}/scenes/${i}`, { method: 'PATCH', body: { restorePrompt: true } });
        break;
      case 'copy':
        await navigator.clipboard.writeText(currentJob.scenes[i].prompt);
        toast(`Đã copy prompt cảnh ${i + 1} (${currentJob.scenes[i].prompt.length} ký tự)`);
        return;
      case 'pick':
        filePicker.dataset.i = i;
        filePicker.click();
        return;
      case 'unclip':
        if (!confirm(`Bỏ clip cảnh ${i + 1}? Các cảnh sau (nếu có) sẽ bị đánh dấu lệch nối.`)) return;
        await api(`/api/jobs/${id}/scenes/${i}/clip`, { method: 'DELETE' });
        break;
      case 'compress':
        await api(`/api/jobs/${id}/compress`, { method: 'POST', body: { i } });
        break;
      case 'cancel':
        await api(`/api/jobs/${id}/cancel`, { method: 'POST' });
        break;
      case 'stitch':
        await api(`/api/jobs/${id}/stitch`, { method: 'POST', body: { removeWatermark: $('#wm').checked } });
        break;
      case 'facebook': {
        const mode = $('#fb-mode').value;
        const page = fbc.page?.name || 'Page';
        let scheduledAt = null;
        if (mode === 'schedule') {
          const t = new Date($('#fb-when').value);
          if (Number.isNaN(t.getTime())) return toast('Chọn ngày giờ đăng');
          scheduledAt = Math.floor(t.getTime() / 1000);
        }
        const msg = {
          schedule: `Hẹn đăng Reel này lên "${page}" lúc ${new Date(scheduledAt * 1000).toLocaleString('vi-VN')}? Tới giờ Facebook sẽ TỰ ĐĂNG công khai.`,
          publish: `ĐĂNG CÔNG KHAI Reel này lên "${page}" ngay bây giờ?`,
          draft: `Lưu Reel này thành NHÁP trên "${page}"?`,
        }[mode];
        if (!confirm(`${msg}\n\nChrome Facebook sẽ mở Business Suite và tự đăng như người đăng tay.`)) return;
        await api(`/api/jobs/${id}/facebook`, { method: 'POST', body: { mode, scheduledAt } });
        break;
      }
      case 'fb-refresh':
        await api(`/api/jobs/${id}/facebook/refresh`, { method: 'POST' });
        break;
    }
    refresh(true);
  } catch (err) {
    toast(err.message);
  }
});

// Đếm ký tự prompt khi đang gõ.
$('#view-job').addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.field !== 'prompt') return;
  const c = $(`[data-count="${el.dataset.i}"]`);
  if (c) { c.textContent = `${el.value.length}/${LIMIT} ký tự`; c.classList.toggle('over', el.value.length > LIMIT); }
});

// Lưu khi rời ô nhập.
$('#view-job').addEventListener('change', async (e) => {
  const el = e.target;
  if (!currentJob) return;
  if (el.id === 'txt-on' || el.id === 'txt-style') {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { text: el.id === 'txt-on' ? { enabled: el.checked } : { style: el.value } } }).catch((err) => toast(err.message));
    if (currentJob.scenes.every((x) => x.clip)) toast('Đã đổi phần chữ — bấm "Ghép video" để áp dụng', 4000);
    return refresh(true);
  }
  if (el.id === 'job-voice') {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { voice: el.value || null } }).catch((err) => toast(err.message));
    toast(el.value ? `Các cảnh điền từ giờ sẽ dùng giọng ${el.value === 'me' ? '@me (giọng của bạn)' : el.value}` : 'Bỏ giọng cố định');
    return refresh(true);
  }
  if (el.id === 'job-consistency' || el.id === 'job-flow-model') {
    const key = { 'job-consistency': 'consistency', 'job-flow-model': 'flowModel' }[el.id];
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { [key]: el.value } }).catch((err) => toast(err.message));
    return refresh(true);
  }
  if (el.id === 'job-ai-model') {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { aiModel: el.value } }).catch((err) => toast(err.message));
    toast('Đã đổi Model AI — bấm "Viết lại kịch bản" để áp dụng model mới', 3500);
    loadList();
    return refresh(true);
  }
  if (el.id === 'job-videotype' || el.id === 'job-viral-format' || el.id === 'job-traffic-goal') {
    const key = { 'job-videotype': 'videoType', 'job-viral-format': 'viralFormat', 'job-traffic-goal': 'trafficGoal' }[el.id];
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { [key]: el.value } }).catch((err) => toast(err.message));
    toast('Đã cập nhật chế độ kịch bản — bấm "Viết lại kịch bản" để áp dụng', 3500);
    loadList();
    return refresh(true);
  }
  if (el.id === 'job-skill-add' && el.value) {
    const nextSkills = [...new Set([...(currentJob.input?.skills || []), el.value])];
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { skills: nextSkills } }).catch((err) => toast(err.message));
    toast('Đã gắn thêm Skill — bấm "Viết lại kịch bản" để áp dụng', 4000);
    return refresh(true);
  }
  const field = el.dataset.field;
  if (!field) return;
  try {
    if (field === 'caption') {
      await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { caption: el.value } });
    } else {
      await api(`/api/jobs/${currentJob.id}/scenes/${el.dataset.i}`, { method: 'PATCH', body: { [field]: el.value } });
    }
    toast('Đã lưu', 1200);
  } catch (err) {
    toast(err.message);
  }
});

$('#view-job').addEventListener('click', async (e) => {
  const rmBtn = e.target.closest('[data-job-rm-skill]');
  if (!rmBtn || !currentJob) return;
  const rmId = rmBtn.dataset.jobRmSkill;
  const nextSkills = (currentJob.input?.skills || []).filter((id) => id !== rmId);
  try {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { skills: nextSkills } });
    toast('Đã gỡ Skill khỏi video này', 2500);
    refresh(true);
  } catch (err) { toast(err.message); }
});

// ---------- Kho Skill AI & Đồng bộ từ Claude ----------
let skillsList = [];
let newSelectedSkills = [];
let askSelectedSkills = [];
let skillFilterCat = 'all';
let currentDetailSkill = null;
let currentDetailFile = 'SKILL.md';
let lastAskResult = null;

const skTitle = (sk) => sk?.title || sk?.name || sk?.id || '';

function skillCategory(sk) {
  if (sk.category && ['video', 'dna', 'content'].includes(sk.category)) return sk.category;
  const text = `${sk.id} ${sk.name} ${sk.title || ''} ${sk.description}`.toLowerCase();
  if (/veo3|veo|video|flow|animation|scene|kich-ban|kịch bản|reel|tiktok|storyboard|camera|prompt/.test(text)) return 'video';
  if (/dna|nhan-hieu|nhân hiệu|brand|taki|daothilan|lenhuquynh|profile|chan-dung|chân dung/.test(text)) return 'dna';
  return 'content';
}

function formatBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function syncNewSkillsInput() {
  const inp = $('#new-skills-input');
  if (inp) inp.value = JSON.stringify(newSelectedSkills);
  renderNewSkillTags();
}

function renderNewSkillTags() {
  const box = $('#new-skill-tags');
  if (!box) return;
  const pinned = skillsList.filter((s) => s.pinned && !s.builtin && !newSelectedSkills.includes(s.id));
  const selected = newSelectedSkills.map((id) => skillsList.find((s) => s.id === id) || { id, name: id });
  const html = [
    ...pinned.map((sk) => `<span class="skill-tag pinned" title="Skill đang ghim — tự động áp dụng cho mọi kịch bản">📌 ${esc(skTitle(sk))} <code>${esc(sk.id)}</code></span>`),
    ...selected.map((sk) => `<span class="skill-tag">${esc(skTitle(sk))} <code>${esc(sk.id)}</code><button type="button" data-rm-new-skill="${esc(sk.id)}" title="Bỏ chọn">✕</button></span>`),
  ];
  box.innerHTML = html.length ? html.join('') : '<span class="muted" style="font-size:12.5px">Chưa chọn Skill riêng (mặc định dùng quy tắc chuẩn Video AI). Chọn thêm Skill ở trên để AI đọc kiến thức & nhân vật từ Skill.</span>';
}

function renderAskSkillTags() {
  const box = $('#ask-skill-tags');
  if (!box) return;
  const pinned = skillsList.filter((s) => s.pinned && !s.builtin && !askSelectedSkills.includes(s.id));
  const selected = askSelectedSkills.map((id) => skillsList.find((s) => s.id === id) || { id, name: id });
  const html = [
    ...pinned.map((sk) => `<span class="skill-tag pinned">📌 ${esc(skTitle(sk))} <code>${esc(sk.id)}</code></span>`),
    ...selected.map((sk) => `<span class="skill-tag">${esc(skTitle(sk))} <code>${esc(sk.id)}</code><button type="button" data-rm-ask-skill="${esc(sk.id)}" title="Bỏ chọn">✕</button></span>`),
  ];
  box.innerHTML = html.length ? html.join('') : '<span class="muted" style="font-size:12.5px">Chưa chọn Skill nào — hãy chọn 1 hoặc nhiều Skill ở ô phía trên (hoặc bấm "✦ Chạy AI" ở thẻ Skill bên dưới).</span>';
}

function populateSkillSelects() {
  const groups = {
    video: skillsList.filter((s) => skillCategory(s) === 'video'),
    dna: skillsList.filter((s) => skillCategory(s) === 'dna'),
    content: skillsList.filter((s) => skillCategory(s) === 'content'),
  };
  const renderOpts = (excludeIds = []) => [
    ['🎬 Video / Veo3 / Kịch bản', groups.video],
    ['🧬 DNA / Nhân hiệu / Hồ sơ', groups.dna],
    ['✍️ Content / Marketing / Khác', groups.content],
  ].map(([label, arr]) => arr.length ? `<optgroup label="${esc(label)}">${arr.map((s) => `<option value="${esc(s.id)}" ${excludeIds.includes(s.id) ? 'disabled' : ''}>${s.pinned ? '📌 ' : ''}${esc(skTitle(s))} (${esc(s.id)}) — ${(s.description || '').slice(0, 55)}</option>`).join('')}</optgroup>` : '').join('');

  const selNew = $('#new-skill-select');
  if (selNew) selNew.innerHTML = `<option value="">＋ Chọn thêm Skill từ kho (${skillsList.length} Skill) để gắn vào kịch bản…</option>${renderOpts(newSelectedSkills)}`;
  const selAsk = $('#ask-skill-select');
  if (selAsk) selAsk.innerHTML = `<option value="">＋ Chọn thêm Skill (${skillsList.length} Skill) để nạp cho AI…</option>${renderOpts(askSelectedSkills)}`;
  renderNewSkillTags();
  renderAskSkillTags();
}

async function loadSkills(sync = false) {
  try {
    if (sync) {
      const btn = $('#btn-skill-sync');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang đồng bộ…'; }
      const r = await api('/api/skills/sync', { method: 'POST' });
      skillsList = r.skills || [];
      toast(`Đã đồng bộ từ Claude: thêm mới ${r.added ?? r.imported ?? 0} Skill, cập nhật ${r.updated ?? 0} Skill (tổng ${skillsList.length} Skill)`, 5000);
      if (btn) { btn.disabled = false; btn.textContent = '↻ Đồng bộ từ Claude'; }
    } else {
      skillsList = await api('/api/skills');
    }
    populateSkillSelects();
    renderSkillsGrid();
  } catch (err) {
    toast(err.message, 6000);
    const btn = $('#btn-skill-sync');
    if (btn) { btn.disabled = false; btn.textContent = '↻ Đồng bộ từ Claude'; }
  }
}

function renderSkillsGrid() {
  const grid = $('#skills-grid');
  if (!grid) return;
  const q = ($('#skill-search')?.value || '').trim().toLowerCase();
  const isClaudeSource = (sk) => sk.source === 'claude' || sk.source === 'claude-sync';
  const filtered = skillsList.filter((sk) => {
    if (skillFilterCat === 'pinned' && !sk.pinned) return false;
    if (skillFilterCat === 'upload' && (isClaudeSource(sk) || sk.builtin)) return false;
    if (['video', 'dna', 'content'].includes(skillFilterCat) && skillCategory(sk) !== skillFilterCat) return false;
    if (!q) return true;
    return `${sk.id} ${sk.name} ${sk.title || ''} ${sk.description}`.toLowerCase().includes(q);
  });

  const syncedCount = skillsList.filter(isClaudeSource).length;
  const customCount = skillsList.filter((s) => !isClaudeSource(s) && !s.builtin).length;
  const pinnedCount = skillsList.filter((s) => s.pinned).length;
  const stats = $('#skill-stats');
  if (stats) {
    stats.innerHTML = `Tổng cộng <b>${skillsList.length} Skill</b> (<b>${syncedCount}</b> đồng bộ từ Claude · <b>${customCount}</b> tải lên/tự tạo · <b>${pinnedCount}</b> đang ghim 📌) — Đang hiển thị <b>${filtered.length}</b> Skill.`;
  }

  if (!filtered.length) {
    grid.innerHTML = `<div class="card muted" style="grid-column:1/-1;text-align:center;padding:36px">Không tìm thấy Skill nào khớp bộ lọc. Bạn có thể bấm <b>↻ Đồng bộ từ Claude</b> hoặc <b>⬆ Đẩy file / .zip Skill lên</b>.</div>`;
    return;
  }

  const catBadge = (sk) => {
    const c = skillCategory(sk);
    if (c === 'video') return '<span class="badge running">🎬 Video / Veo3</span>';
    if (c === 'dna') return '<span class="badge scheduled">🧬 DNA / Nhân hiệu</span>';
    return '<span class="badge">✍️ Kiến thức / Content</span>';
  };

  grid.innerHTML = filtered.map((sk) => `
    <div class="card skill-card ${sk.pinned ? 'is-pinned' : ''}" data-skill-id="${esc(sk.id)}">
      <div>
        <div class="skill-card-head">
          <div>
            <h3 class="skill-card-title">${sk.pinned ? '📌 ' : ''}${esc(skTitle(sk))}</h3>
            <span class="skill-card-id">${esc(sk.id)}</span>
          </div>
          ${catBadge(sk)}
        </div>
        <p class="skill-card-desc" title="${esc(sk.description)}">${esc(sk.description || 'Chưa có mô tả ngắn.')}</p>
      </div>
      <div>
        <div class="skill-card-meta">
          <span>${sk.builtin ? '⚙ Mặc định hệ thống' : isClaudeSource(sk) ? '🔄 Đồng bộ Claude' : '⬆ Tải lên / Tự tạo'}</span>
          <span>· 📄 ${sk.fileCount} file (${formatBytes(sk.size ?? sk.totalBytes)})</span>
        </div>
        <div class="row" style="margin-top:10px;gap:6px">
          <button class="small primary" data-sk-act="use-video" title="Gắn Skill này vào Tạo video mới để viết kịch bản">🎬 Dùng viết kịch bản</button>
          <button class="small" data-sk-act="use-ask" title="Đưa Skill này lên khung Chạy AI phía trên">✦ Chạy AI</button>
          <button class="small" data-sk-act="detail">👁 Xem / File (${sk.fileCount})</button>
          ${!sk.builtin ? `<button class="small ${sk.pinned ? 'primary' : ''}" data-sk-act="pin" title="Ghim để tự động nạp vào mọi kịch bản">${sk.pinned ? '📌 Đã ghim' : '📌 Ghim'}</button>
          <button class="small danger" data-sk-act="delete" title="Xoá Skill này">🗑</button>` : ''}
        </div>
      </div>
    </div>`).join('');
}

function openSkillsView() {
  currentId = null;
  stopPoll();
  loadList();
  show('skills');
  loadSkills(false);
}

$('#tab-skills')?.addEventListener('click', openSkillsView);
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-goto-skills]')) {
    e.preventDefault();
    openSkillsView();
  }
});

$('#btn-skill-sync')?.addEventListener('click', () => loadSkills(true));
$('#skill-search')?.addEventListener('input', renderSkillsGrid);
$('#skill-filter-chips')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  skillFilterCat = b.dataset.cat;
  for (const x of document.querySelectorAll('#skill-filter-chips button')) x.classList.toggle('on', x.dataset.cat === skillFilterCat);
  renderSkillsGrid();
});

// Chọn / bỏ chọn Skill ở form Tạo video mới
$('#new-auto-skill')?.addEventListener('change', (e) => {
  const inp = $('#new-autoskill-input');
  if (inp) inp.value = e.target.checked ? 'true' : 'false';
  if (!e.target.checked) {
    const detBox = $('#new-agent-detected');
    if (detBox) detBox.hidden = true;
  } else {
    scheduleDetectNewSkills();
  }
});

function getNewFormInput() {
  const form = $('#form-new');
  if (!form) return {};
  return {
    topic: form.querySelector('[name=topic]')?.value?.trim() || $('#viral-niche-input')?.value?.trim() || '',
    character: form.querySelector('[name=character]')?.value?.trim() || '',
    audience: form.querySelector('[name=audience]')?.value?.trim() || '',
    mustSay: form.querySelector('[name=mustSay]')?.value?.trim() || '',
    tone: form.querySelector('[name=tone]')?.value?.trim() || '',
    cta: form.querySelector('[name=cta]')?.value?.trim() || '',
    videoType: currentVideoType,
    viralFormat: $('#viral-format-select')?.value || 'storytelling',
    trafficGoal: $('#traffic-goal-select')?.value || 'engage_comment',
  };
}

let detectNewTimer = null;
function scheduleDetectNewSkills() {
  clearTimeout(detectNewTimer);
  if ($('#new-auto-skill') && !$('#new-auto-skill').checked) return;
  detectNewTimer = setTimeout(async () => {
    const userInput = getNewFormInput();
    const combinedText = `${userInput.topic} ${userInput.character} ${userInput.audience} ${userInput.mustSay}`.trim();
    const box = $('#new-agent-detected');
    if (!box) return;
    if (combinedText.length < 3 && userInput.videoType !== 'viral') {
      box.hidden = true;
      return;
    }
    try {
      const r = await api('/api/skills/detect', {
        method: 'POST',
        body: { userInput, mode: 'fast', taskType: userInput.videoType === 'viral' ? 'viral' : 'video', excludeIds: newSelectedSkills },
      });
      const list = r.matchedSkills || [];
      if (!list.length) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      box.innerHTML = `
        <div class="agent-detected-head">
          <span>🤖 Agent tự nhận biết Skill tác vụ khớp với dữ liệu bạn nhập (sẽ tự động nạp khi Viết kịch bản):</span>
          <button type="button" class="small" data-agent-add-all-new>＋ Gắn cố định tất cả</button>
        </div>
        <div class="skill-tags" style="margin-top:4px">
          ${list.map((sk) => `
            <span class="skill-tag auto" title="${esc(sk.reason || '')}">
              🤖 ${esc(sk.title || sk.name)} <code>${esc(sk.id)}</code>
              <small class="muted" style="display:inline;font-weight:400">(${esc(sk.reason || 'Khớp ngữ cảnh')})</small>
              <button type="button" data-agent-pick-new="${esc(sk.id)}" title="Gắn cố định vào danh sách chọn" style="color:#065f46;font-weight:800">＋ Gắn</button>
            </span>`).join('')}
        </div>`;
    } catch { /* ignore */ }
  }, 350);
}

$('#form-new')?.addEventListener('input', (e) => {
  if (['topic', 'character', 'audience', 'mustSay', 'tone'].includes(e.target?.name) || e.target?.id === 'viral-niche-input') {
    scheduleDetectNewSkills();
  }
});

$('#new-agent-detected')?.addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-agent-pick-new]');
  if (pick) {
    const id = pick.dataset.agentPickNew;
    if (!newSelectedSkills.includes(id)) newSelectedSkills.push(id);
    syncNewSkillsInput();
    populateSkillSelects();
    scheduleDetectNewSkills();
    toast(`Đã gắn Skill "${id}"`);
    return;
  }
  if (e.target.closest('[data-agent-add-all-new]')) {
    const badges = [...document.querySelectorAll('#new-agent-detected [data-agent-pick-new]')];
    for (const b of badges) {
      const id = b.dataset.agentPickNew;
      if (id && !newSelectedSkills.includes(id)) newSelectedSkills.push(id);
    }
    syncNewSkillsInput();
    populateSkillSelects();
    scheduleDetectNewSkills();
    toast('Đã gắn các Skill do Agent nhận diện!');
  }
});

// Nút 🤖 Agent tự nhận diện Skill ở form Tạo video mới
$('#btn-agent-detect-new')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const userInput = getNewFormInput();
  const combined = `${userInput.topic} ${userInput.character} ${userInput.audience} ${userInput.mustSay}`.trim();
  if (!combined) {
    toast('Hãy nhập vài từ về Chủ đề, Sản phẩm hoặc Nhân vật vào ô bên dưới để Agent nhận diện Skill!');
    $('#form-new [name=topic]')?.focus();
    return;
  }
  const aiModel = $('#new-ai-model-select')?.value || currentNewAiProvider || 'claude';
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Agent đang phân tích…';
  try {
    const r = await api('/api/skills/detect', {
      method: 'POST',
      body: { userInput, mode: 'ai', taskType: 'video', excludeIds: newSelectedSkills, aiModel },
    });
    const list = r.matchedSkills || [];
    if (!list.length) {
      toast('Agent chưa tìm thấy Skill nào khớp sát với dữ liệu này — bạn có thể chọn thủ công ở danh sách.');
      return;
    }
    for (const sk of list) {
      if (!newSelectedSkills.includes(sk.id)) newSelectedSkills.push(sk.id);
    }
    syncNewSkillsInput();
    populateSkillSelects();
    scheduleDetectNewSkills();
    toast(`🤖 Agent đã tự nhận biết & gắn ${list.length} Skill: ${list.map((s) => s.title || s.name).join(', ')}`, 5000);
  } catch (err) {
    toast(err.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

$('#new-skill-select')?.addEventListener('change', (e) => {
  const val = e.target.value;
  if (!val) return;
  if (!newSelectedSkills.includes(val)) newSelectedSkills.push(val);
  e.target.value = '';
  syncNewSkillsInput();
  populateSkillSelects();
  scheduleDetectNewSkills();
});
$('#new-skill-tags')?.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm-new-skill]');
  if (!rm) return;
  newSelectedSkills = newSelectedSkills.filter((id) => id !== rm.dataset.rmNewSkill);
  syncNewSkillsInput();
  populateSkillSelects();
  scheduleDetectNewSkills();
});

// AI trích dữ liệu từ Skill vào form Tạo video mới (hỗ trợ cả khi chưa chọn Skill → Agent tự nhận biết theo dữ liệu đã nhập)
$('#btn-extract-skill')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const pinnedIds = skillsList.filter((s) => s.pinned && !s.builtin).map((s) => s.id);
  const ids = [...new Set([...newSelectedSkills, ...pinnedIds])];
  const userInput = getNewFormInput();
  const hasAnyText = Boolean(`${userInput.topic} ${userInput.character} ${userInput.audience} ${userInput.mustSay}`.trim());

  if (!ids.length && !hasAnyText) {
    toast('Hãy chọn 1 Skill ở ô bên dưới HOẶC nhập vài từ khóa vào ô Chủ đề / Nhân vật để Agent tự nhận diện Skill!');
    $('#form-new [name=topic]')?.focus();
    return;
  }
  const aiModel = $('#new-ai-model-select')?.value || currentNewAiProvider || 'claude';
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Agent đang nhận diện Skill & trích dữ liệu…';
  toast('Agent đang tự nhận biết Skill phù hợp và đọc kỹ nội dung SKILL.md + references để điền vào form…', 45000);
  try {
    const form = $('#form-new');
    const curTopic = form.querySelector('[name=topic]').value.trim();
    const res = await api('/api/skills/extract-brief', {
      method: 'POST',
      body: { skillIds: ids, topic: curTopic, userInput, autoDetect: true, aiModel },
    });
    if (Array.isArray(res.selectedIds) && res.selectedIds.length) {
      for (const sid of res.selectedIds) {
        if (!newSelectedSkills.includes(sid)) newSelectedSkills.push(sid);
      }
      syncNewSkillsInput();
      populateSkillSelects();
      scheduleDetectNewSkills();
    }
    if (res.topic && !curTopic) form.querySelector('[name=topic]').value = res.topic;
    if (res.audience) form.querySelector('[name=audience]').value = res.audience;
    if (res.character) form.querySelector('[name=character]').value = res.character;
    if (res.tone) form.querySelector('[name=tone]').value = res.tone;
    if (res.mustSay) form.querySelector('[name=mustSay]').value = res.mustSay;
    if (res.avoid) form.querySelector('[name=avoid]').value = res.avoid;
    if (res.cta) form.querySelector('[name=cta]').value = res.cta;

    const topicsBox = $('#new-skill-topics');
    if (topicsBox && Array.isArray(res.suggestedTopics) && res.suggestedTopics.length) {
      topicsBox.hidden = false;
      topicsBox.innerHTML = `
        <div class="skill-topics-title">💡 Gợi ý chủ đề từ Skill (bấm vào để điền nhanh vào ô Chủ đề):</div>
        <div class="chips">${res.suggestedTopics.map((t) => `<button type="button" data-pick-topic="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
    }
    const usedNames = (res.usedSkills || []).map((s) => (typeof s === 'string' ? s : s.title || s.name)).join(', ');
    toast(`✓ ${res.aiBadge || 'AI'} đã nhận diện & trích xuất dữ liệu từ Skill (${usedNames || 'Skill'}) vào form!`, 5000);
  } catch (err) {
    toast(err.message, 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});

$('#new-skill-topics')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick-topic]');
  if (!b) return;
  const topicEl = $('#form-new [name=topic]');
  if (topicEl) {
    topicEl.value = b.dataset.pickTopic;
    topicEl.focus();
    toast('Đã điền chủ đề gợi ý từ Skill', 2000);
  }
});

// Chọn / bỏ chọn & Tự động nhận diện Skill ở khung Chạy AI trong tab Skill AI
let detectAskTimer = null;
function scheduleDetectAskSkills() {
  clearTimeout(detectAskTimer);
  if ($('#ask-auto-skill') && !$('#ask-auto-skill').checked) {
    const box = $('#ask-agent-detected');
    if (box) box.hidden = true;
    return;
  }
  detectAskTimer = setTimeout(async () => {
    const prompt = ($('#ask-skill-prompt')?.value || '').trim();
    const box = $('#ask-agent-detected');
    if (!box) return;
    if (prompt.length < 3) {
      box.hidden = true;
      return;
    }
    try {
      const r = await api('/api/skills/detect', {
        method: 'POST',
        body: { userInput: { prompt }, mode: 'fast', taskType: 'any', excludeIds: askSelectedSkills },
      });
      const list = r.matchedSkills || [];
      if (!list.length) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      box.innerHTML = `
        <div class="agent-detected-head">
          <span>🤖 Agent tự nhận biết Skill phù hợp cho yêu cầu này (sẽ tự động nạp khi bấm Chạy AI):</span>
          <button type="button" class="small" data-agent-add-all-ask>＋ Gắn cố định tất cả</button>
        </div>
        <div class="skill-tags" style="margin-top:4px">
          ${list.map((sk) => `
            <span class="skill-tag auto" title="${esc(sk.reason || '')}">
              🤖 ${esc(sk.title || sk.name)} <code>${esc(sk.id)}</code>
              <small class="muted" style="display:inline;font-weight:400">(${esc(sk.reason || '')})</small>
              <button type="button" data-agent-pick-ask="${esc(sk.id)}" style="color:#065f46;font-weight:800">＋ Gắn</button>
            </span>`).join('')}
        </div>`;
    } catch { /* ignore */ }
  }, 350);
}

$('#ask-skill-prompt')?.addEventListener('input', scheduleDetectAskSkills);
$('#ask-auto-skill')?.addEventListener('change', scheduleDetectAskSkills);

$('#ask-agent-detected')?.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-agent-pick-ask]');
  if (pick) {
    const id = pick.dataset.agentPickAsk;
    if (!askSelectedSkills.includes(id)) askSelectedSkills.push(id);
    populateSkillSelects();
    scheduleDetectAskSkills();
    return;
  }
  if (e.target.closest('[data-agent-add-all-ask]')) {
    for (const b of document.querySelectorAll('#ask-agent-detected [data-agent-pick-ask]')) {
      const id = b.dataset.agentPickAsk;
      if (id && !askSelectedSkills.includes(id)) askSelectedSkills.push(id);
    }
    populateSkillSelects();
    scheduleDetectAskSkills();
  }
});

$('#btn-ask-detect-ai')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const prompt = ($('#ask-skill-prompt')?.value || '').trim();
  if (!prompt) {
    toast('Hãy nhập yêu cầu vào ô bên trên để Agent phân tích và chọn Skill!');
    $('#ask-skill-prompt')?.focus();
    return;
  }
  const aiModel = $('#ask-ai-model-select')?.value || cfg.defaultAi?.model || 'claude';
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Agent đang chọn Skill…';
  try {
    const r = await api('/api/skills/detect', {
      method: 'POST',
      body: { userInput: { prompt }, mode: 'ai', taskType: 'any', excludeIds: askSelectedSkills, aiModel },
    });
    const list = r.matchedSkills || [];
    if (!list.length) {
      toast('Agent chưa tìm thấy Skill khớp sát — bạn có thể chọn thủ công ở ô danh sách.');
      return;
    }
    for (const sk of list) {
      if (!askSelectedSkills.includes(sk.id)) askSelectedSkills.push(sk.id);
    }
    populateSkillSelects();
    scheduleDetectAskSkills();
    toast(`🤖 Agent đã chọn ${list.length} Skill: ${list.map((s) => s.title || s.name).join(', ')}`, 4500);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

$('#ask-skill-select')?.addEventListener('change', (e) => {
  const val = e.target.value;
  if (!val) return;
  if (!askSelectedSkills.includes(val)) askSelectedSkills.push(val);
  e.target.value = '';
  populateSkillSelects();
  scheduleDetectAskSkills();
});
$('#ask-skill-tags')?.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm-ask-skill]');
  if (!rm) return;
  askSelectedSkills = askSelectedSkills.filter((id) => id !== rm.dataset.rmAskSkill);
  populateSkillSelects();
  scheduleDetectAskSkills();
});
$('#ask-quick-prompts')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  const inp = $('#ask-skill-prompt');
  if (inp) { inp.value = b.dataset.q; inp.focus(); scheduleDetectAskSkills(); }
});

// Chạy Model AI với các Skill đã chọn (hoặc do Agent tự động nhận diện từ nội dung yêu cầu)
$('#btn-ask-skill')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const prompt = ($('#ask-skill-prompt')?.value || '').trim();
  if (!prompt) {
    toast('Hãy nhập yêu cầu hoặc bấm 1 gợi ý nhanh phía trên!');
    $('#ask-skill-prompt')?.focus();
    return;
  }
  const autoDetect = $('#ask-auto-skill')?.checked !== false;
  const pinnedIds = skillsList.filter((s) => s.pinned && !s.builtin).map((s) => s.id);
  const ids = [...new Set([...askSelectedSkills, ...pinnedIds])];
  if (!ids.length && !autoDetect) {
    toast('Hãy chọn ít nhất 1 Skill hoặc bật "🤖 Agent tự động nhận biết Skill"!');
    $('#ask-skill-select')?.focus();
    return;
  }
  const aiModel = $('#ask-ai-model-select')?.value || cfg.defaultAi?.model || 'claude';
  const st = $('#ask-skill-status');
  const out = $('#ask-skill-result');
  btn.disabled = true;
  if (st) st.innerHTML = `<span class="busy"><span class="spin"></span>${ids.length ? `AI (${esc(aiModel)}) đang đọc hiểu Skill & xử lý yêu cầu` : `🤖 Agent (${esc(aiModel)}) đang tự nhận biết Skill phù hợp & xử lý yêu cầu`} (khoảng 15–45 giây)…</span>`;
  try {
    const r = await api('/api/skills/ask', {
      method: 'POST',
      body: { skillIds: ids, prompt, autoDetect, aiModel },
    });
    const finalSkillIds = r.selectedIds?.length ? r.selectedIds : ids;
    lastAskResult = { ...r, skillIds: finalSkillIds };
    if (Array.isArray(r.selectedIds)) {
      for (const sid of r.selectedIds) {
        if (!askSelectedSkills.includes(sid)) askSelectedSkills.push(sid);
      }
      populateSkillSelects();
      scheduleDetectAskSkills();
    }
    const usedBadges = (r.usedSkills || []).map((s) => {
      if (typeof s === 'string') return `<b>${esc(s)}</b>`;
      return `<span class="skill-tag ${s.auto ? 'auto' : ''}" style="font-size:11.5px;padding:2px 8px">${s.auto ? '🤖 Agent tự chọn: ' : '📚 '}${esc(s.title || s.name)} (<code>${esc(s.id)}</code>)</span>`;
    }).join(' ');
    if (out) {
      out.hidden = false;
      out.innerHTML = `
        <div class="skill-answer-box">
          <div class="job-head" style="margin-bottom:8px">
            <div>
              <h3 style="font-size:16px">${esc(r.title || 'Kết quả từ AI')} ${r.aiBadge ? `<span class="badge" style="margin-left:6px">${esc(r.aiBadge)}</span>` : ''}</h3>
              <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                <small class="muted">Đã áp dụng Skill:</small> ${usedBadges}
              </div>
            </div>
            <div class="row" style="margin:0">
              <button type="button" class="small" id="btn-copy-ask-ans">📋 Copy kết quả</button>
              <button type="button" class="small primary" id="btn-ask-to-video">🎬 Đưa sang Tạo video mới & Viết kịch bản</button>
            </div>
          </div>
          <div class="skill-answer-body">${esc(r.answer || '')}</div>
        </div>`;
    }
    if (st) st.textContent = `✓ Hoàn tất (${r.aiBadge || aiModel})`;
  } catch (err) {
    if (st) st.textContent = '';
    toast(err.message, 7000);
  } finally {
    btn.disabled = false;
  }
});

$('#ask-skill-result')?.addEventListener('click', async (e) => {
  if (e.target.closest('#btn-copy-ask-ans') && lastAskResult) {
    await navigator.clipboard.writeText(lastAskResult.answer || '');
    toast('Đã copy nội dung phản hồi của AI');
  }
  if (e.target.closest('#btn-ask-to-video') && lastAskResult) {
    newSelectedSkills = [...new Set([...newSelectedSkills, ...(lastAskResult.skillIds || [])])];
    syncNewSkillsInput();
    populateSkillSelects();
    const form = $('#form-new');
    const vb = lastAskResult.videoBrief || {};
    form.querySelector('[name=topic]').value = vb.topic || `${lastAskResult.title || ''}\n${(lastAskResult.answer || '').slice(0, 600)}`.trim();
    if (vb.audience) form.querySelector('[name=audience]').value = vb.audience;
    if (vb.character) form.querySelector('[name=character]').value = vb.character;
    if (vb.tone) form.querySelector('[name=tone]').value = vb.tone;
    if (vb.mustSay) form.querySelector('[name=mustSay]').value = vb.mustSay;
    if (vb.avoid) form.querySelector('[name=avoid]').value = vb.avoid;
    if (vb.cta) form.querySelector('[name=cta]').value = vb.cta;
    show('new');
    toast('Đã chuyển thông tin & Skill sang form Tạo video mới!');
  }
});

// Modal tải lên .zip / file Skill hoặc Tạo Skill mới
$('#btn-skill-upload-open')?.addEventListener('click', () => {
  const box = $('#skill-modal-box');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `
    <div class="job-head">
      <h2>⬆ Đẩy Skill lên kho (.zip, SKILL.md, tài liệu references)</h2>
      <button type="button" class="small" data-close-skill-modal>Đóng ✕</button>
    </div>
    <p class="muted" style="margin-top:0;font-size:13.5px">
      Bạn có thể chọn:<br>
      • <b>1 hoặc nhiều file <code>.zip</code></b> (chứa thư mục Skill có <code>SKILL.md</code> và <code>references/</code> — hệ thống tự giải nén toàn bộ các Skill bên trong).<br>
      • Hoặc chọn <b>file <code>SKILL.md</code> kèm các file tài liệu</b> (<code>.md</code>, <code>.txt</code>, <code>.json</code>, <code>.csv</code>, <code>.pdf</code>, <code>.docx</code>…) để tạo mới hoặc bổ sung vào 1 Skill có sẵn.
    </p>
    <form id="form-skill-upload" class="grid-form">
      <label class="full">Chọn file tải lên (chọn được nhiều file cùng lúc) *
        <input type="file" name="files" multiple required accept=".zip,.md,.txt,.json,.csv,.tsv,.yaml,.yml,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp">
      </label>
      <label>Đẩy vào Skill nào?
        <select name="targetSkillId">
          <option value="">— Tự nhận diện từ file .zip / SKILL.md hoặc tạo mới —</option>
          ${skillsList.map((s) => `<option value="${esc(s.id)}">Bổ sung vào: ${esc(s.name)} (${esc(s.id)})</option>`).join('')}
        </select>
      </label>
      <label>Tên Skill (tuỳ chọn nếu tải lẻ file tài liệu)
        <input name="name" placeholder="VD: Kịch bản Trà An Nhiên Veo3">
      </label>
      <label class="full">Mô tả ngắn / Khi nào dùng Skill này (tuỳ chọn)
        <input name="description" placeholder="VD: Công thức viết kịch bản video AI và hồ sơ sản phẩm...">
      </label>
      <div class="full actions">
        <button type="submit" class="primary">⬆ Tải lên & Nạp vào kho Skill</button>
        <button type="button" data-close-skill-modal>Huỷ</button>
      </div>
    </form>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('#btn-skill-new-open')?.addEventListener('click', () => {
  const box = $('#skill-modal-box');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `
    <div class="job-head">
      <h2>＋ Tạo Skill kiến thức mới</h2>
      <button type="button" class="small" data-close-skill-modal>Đóng ✕</button>
    </div>
    <form id="form-skill-create" class="grid-form">
      <label>Tên Skill *
        <input name="name" required placeholder="VD: Kịch bản Mỹ phẩm Organic Veo3">
      </label>
      <label>Mã định danh (để trống tự tạo từ tên)
        <input name="id" placeholder="VD: my-pham-organic-veo3">
      </label>
      <label class="full">Mô tả ngắn (giúp AI hiểu khi nào và cách áp dụng Skill này) *
        <input name="description" required placeholder="VD: Hồ sơ nhân vật, thông tin sản phẩm, công thức Hook và quy tắc viết kịch bản...">
      </label>
      <label class="full">Nội dung kiến thức chính (<code>SKILL.md</code>) *
        <textarea name="content" rows="14" class="prompt" required placeholder="# Tên Skill&#10;&#10;## 1. Hồ sơ Nhân vật (Character DNA)&#10;- Ngoại hình, độ tuổi, trang phục cố định, giọng nói...&#10;&#10;## 2. Thông tin Sản phẩm / Dịch vụ & USP&#10;- Công dụng, giá bán, ưu đãi, nỗi đau khách hàng...&#10;&#10;## 3. Công thức Kịch bản & Quy tắc bắt buộc&#10;- Cấu trúc các cảnh, từ ngữ nên dùng và từ cấm..."></textarea>
      </label>
      <div class="full actions">
        <button type="submit" class="primary">💾 Lưu Skill mới</button>
        <button type="button" data-close-skill-modal>Huỷ</button>
      </div>
    </form>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('#skill-modal-box')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-skill-modal]')) {
    $('#skill-modal-box').hidden = true;
    $('#skill-modal-box').innerHTML = '';
  }
});

$('#skill-modal-box')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    if (form.id === 'form-skill-upload') {
      const fd = new FormData(form);
      const r = await api('/api/skills/upload', { method: 'POST', body: fd });
      toast(`✓ Đã nạp thành công ${r.imported?.length || r.importedIds?.length || 1} Skill vào kho!`, 5000);
    } else if (form.id === 'form-skill-create') {
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      await api('/api/skills', { method: 'POST', body });
      toast('✓ Đã tạo Skill mới thành công!', 4000);
    }
    $('#skill-modal-box').hidden = true;
    $('#skill-modal-box').innerHTML = '';
    await loadSkills(false);
  } catch (err) {
    toast(err.message, 7000);
  } finally {
    if (btn) btn.disabled = false;
  }
});

// Xem / Sửa chi tiết 1 Skill và các file references
async function openSkillDetail(skillId, filePath = 'SKILL.md') {
  const box = $('#skill-detail-box');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = '<div class="muted">Đang tải chi tiết Skill…</div>';
  try {
    const sk = await api(`/api/skills/${encodeURIComponent(skillId)}`);
    currentDetailSkill = sk;
    currentDetailFile = sk.files.some((f) => f.path === filePath) ? filePath : (sk.files[0]?.path || 'SKILL.md');
    const fData = await api(`/api/skills/${encodeURIComponent(skillId)}/file?path=${encodeURIComponent(currentDetailFile)}`);
    renderSkillDetailBox(sk, fData);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    box.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function renderSkillDetailBox(sk, fData) {
  const box = $('#skill-detail-box');
  if (!box) return;
  box.innerHTML = `
    <div class="job-head">
      <div class="grow">
        <h2>📂 Chi tiết Skill: ${esc(skTitle(sk))} <code>${esc(sk.id)}</code></h2>
        <div class="muted" style="font-size:13px">${esc(sk.description || '')}</div>
      </div>
      <div class="row" style="margin:0">
        <button type="button" class="small primary" data-detail-use-video="${esc(sk.id)}">🎬 Dùng viết kịch bản</button>
        <button type="button" class="small" data-detail-close>Đóng ✕</button>
      </div>
    </div>
    <div class="skill-detail-grid">
      <div>
        <div style="font-size:12.5px;font-weight:700;color:var(--ink-2);margin-bottom:6px">Các file trong Skill (${sk.files.length})</div>
        <ul class="skill-file-list">
          ${sk.files.map((f) => `
            <li data-detail-file="${esc(f.path)}" class="${f.path === currentDetailFile ? 'active' : ''}">
              <span>${f.path === 'SKILL.md' ? '📘 ' : '📄 '}${esc(f.path)}</span>
              <small class="muted">${formatBytes(f.size)}</small>
            </li>`).join('')}
        </ul>
        <div style="margin-top:10px;display:grid;gap:6px">
          <button type="button" class="small block" id="btn-detail-new-ref">＋ Tạo file references/.md mới</button>
          <label class="small" style="margin:0;cursor:pointer;text-align:center;border:1px dashed var(--accent);border-radius:8px;padding:6px;color:var(--accent);font-weight:600">
            ⬆ Tải thêm file vào Skill này
            <input type="file" id="inp-detail-upload" multiple hidden>
          </label>
        </div>
      </div>
      <div>
        <div class="row" style="margin:0 0 8px;justify-content:space-between;align-items:center">
          <div>
            <b>Đang xem: <code>${esc(fData.path)}</code></b>
            <span class="muted" style="font-size:12px;margin-left:8px">${formatBytes(fData.size)}</span>
          </div>
          <div class="row" style="margin:0">
            ${fData.isText ? `<button type="button" class="small primary" id="btn-detail-save-file">💾 Lưu nội dung file</button>` : ''}
            ${fData.path !== 'SKILL.md' ? `<button type="button" class="small danger" id="btn-detail-del-file">🗑 Xoá file này</button>` : ''}
          </div>
        </div>
        ${fData.isText
          ? `<textarea id="detail-file-content" class="prompt" rows="18">${esc(fData.content || '')}</textarea>`
          : `<div class="manual">File nhị phân / tài liệu (<code>${esc(fData.path)}</code> — ${formatBytes(fData.size)}). Khi chạy kịch bản hoặc hỏi AI, Model AI sẽ đọc trực tiếp nội dung để trích xuất dữ liệu từ file này.</div>`}
      </div>
    </div>`;
}

$('#skill-detail-box')?.addEventListener('click', async (e) => {
  if (e.target.closest('[data-detail-close]')) {
    $('#skill-detail-box').hidden = true;
    currentDetailSkill = null;
    return;
  }
  const useVid = e.target.closest('[data-detail-use-video]');
  if (useVid) {
    const id = useVid.dataset.detailUseVideo;
    if (!newSelectedSkills.includes(id)) newSelectedSkills.push(id);
    syncNewSkillsInput();
    populateSkillSelects();
    show('new');
    toast(`Đã gắn Skill "${id}" vào Tạo video mới!`);
    return;
  }
  const fileLi = e.target.closest('[data-detail-file]');
  if (fileLi && currentDetailSkill) {
    await openSkillDetail(currentDetailSkill.id, fileLi.dataset.detailFile);
    return;
  }
  if (e.target.closest('#btn-detail-save-file') && currentDetailSkill) {
    const btn = e.target.closest('#btn-detail-save-file');
    btn.disabled = true;
    try {
      const content = $('#detail-file-content').value;
      await api(`/api/skills/${encodeURIComponent(currentDetailSkill.id)}/file`, {
        method: 'PUT',
        body: { path: currentDetailFile, content },
      });
      toast(`✓ Đã lưu file ${currentDetailFile}`);
      await loadSkills(false);
      await openSkillDetail(currentDetailSkill.id, currentDetailFile);
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  }
  if (e.target.closest('#btn-detail-del-file') && currentDetailSkill) {
    if (!confirm(`Xoá file "${currentDetailFile}" khỏi Skill này?`)) return;
    try {
      await api(`/api/skills/${encodeURIComponent(currentDetailSkill.id)}/file?path=${encodeURIComponent(currentDetailFile)}`, { method: 'DELETE' });
      toast(`Đã xoá ${currentDetailFile}`);
      await loadSkills(false);
      await openSkillDetail(currentDetailSkill.id, 'SKILL.md');
    } catch (err) { toast(err.message); }
  }
  if (e.target.closest('#btn-detail-new-ref') && currentDetailSkill) {
    const name = prompt('Nhập tên file tài liệu mới (VD: bang-gia.md hoặc cau-hoi-thuong-gap.md):', 'tai-lieu-bo-sung.md');
    if (!name) return;
    const clean = name.includes('/') ? name : `references/${name.endsWith('.md') || name.includes('.') ? name : `${name}.md`}`;
    try {
      await api(`/api/skills/${encodeURIComponent(currentDetailSkill.id)}/file`, {
        method: 'PUT',
        body: { path: clean, content: `# ${name}\n\nNhập dữ liệu tham chiếu cho AI tại đây...\n` },
      });
      await loadSkills(false);
      await openSkillDetail(currentDetailSkill.id, clean);
    } catch (err) { toast(err.message); }
  }
});

$('#skill-detail-box')?.addEventListener('change', async (e) => {
  if (e.target.id === 'inp-detail-upload' && e.target.files?.length && currentDetailSkill) {
    const fd = new FormData();
    fd.append('targetSkillId', currentDetailSkill.id);
    for (const f of e.target.files) fd.append('files', f);
    toast('Đang tải file bổ sung vào Skill…');
    try {
      await api('/api/skills/upload', { method: 'POST', body: fd });
      toast('✓ Đã thêm file vào Skill!');
      await loadSkills(false);
      await openSkillDetail(currentDetailSkill.id, currentDetailFile);
    } catch (err) { toast(err.message); }
  }
});

// Thao tác trên từng thẻ Skill trong danh sách #skills-grid
$('#skills-grid')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sk-act]');
  if (!b) return;
  const card = b.closest('[data-skill-id]');
  if (!card) return;
  const id = card.dataset.skillId;
  const sk = skillsList.find((s) => s.id === id);
  const act = b.dataset.skAct;
  try {
    if (act === 'use-video') {
      if (!newSelectedSkills.includes(id)) newSelectedSkills.push(id);
      syncNewSkillsInput();
      populateSkillSelects();
      show('new');
      toast(`Đã gắn Skill "${sk?.name || id}" — bạn có thể bấm "✨ AI trích dữ liệu từ Skill vào form" hoặc nhập chủ đề để viết kịch bản!`, 5000);
    } else if (act === 'use-ask') {
      if (!askSelectedSkills.includes(id)) askSelectedSkills.push(id);
      populateSkillSelects();
      $('.skill-runner-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#ask-skill-prompt')?.focus();
      toast(`Đã nạp "${sk?.name || id}" vào khung Chạy AI!`);
    } else if (act === 'detail') {
      await openSkillDetail(id, 'SKILL.md');
    } else if (act === 'pin') {
      await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'PATCH', body: { pinned: !sk?.pinned } });
      toast(!sk?.pinned ? `📌 Đã ghim "${sk?.name || id}" — AI sẽ luôn đọc Skill này khi viết kịch bản` : `Đã bỏ ghim "${sk?.name || id}"`);
      await loadSkills(false);
    } else if (act === 'delete') {
      if (!confirm(`Xoá Skill "${sk?.name || id}" (${id}) khỏi kho?`)) return;
      await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
      newSelectedSkills = newSelectedSkills.filter((x) => x !== id);
      askSelectedSkills = askSelectedSkills.filter((x) => x !== id);
      if (currentDetailSkill?.id === id) $('#skill-detail-box').hidden = true;
      toast(`Đã xoá Skill "${id}"`);
      await loadSkills(false);
    }
  } catch (err) {
    toast(err.message);
  }
});

// ---------- khởi động ----------
(async () => {
  cfg = await api('/api/config');
  const voiceOpts = (sel) => (cfg.voices || []).map((v) => `<option value="${esc(v.name)}" ${v.name === sel ? 'selected' : ''}>${v.name === 'me' ? '@me — giọng của tôi' : `${esc(v.name)} — ${esc(v.gender)}, ${esc(v.desc)}`}</option>`).join('');
  window.voiceOpts = voiceOpts;
  $('#voice-select').insertAdjacentHTML('beforeend', voiceOpts('me'));
  $('#flow-model-select').innerHTML = (cfg.flowModels || []).map((m) => `<option>${esc(m)}</option>`).join('');
  if ($('#viral-format-select')) {
    $('#viral-format-select').innerHTML = (cfg.viralFormats || []).map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  }
  if ($('#traffic-goal-select')) {
    $('#traffic-goal-select').innerHTML = (cfg.trafficGoals || []).map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
  }
  populateAiModelSelects();
  setNewVideoMode('ads');
  $('#status-pills').innerHTML = `
    <span class="pill" id="pill-cl">✦ Claude…</span>
    <span class="pill" id="pill-gpt">🟢 ChatGPT…</span>
    <span class="pill" id="pill-gem">♊ Gemini…</span>
    <span class="pill" id="pill-flow">Flow…</span>
    <span class="pill" id="pill-fb">Facebook…</span>`;
  await Promise.all([loadFb(), loadChromeStatus(), loadSkills(false), loadAiAccounts()]);
  loadClaude(); // không chờ: kiểm tra tài khoản Claude mất vài giây
  durHint();
  await loadList();
  // Người dùng đã tự chuyển tab trong lúc trang đang tải → không tự mở video đầu tiên đè lên.
  if (!$('#view-posts').hidden || !$('#view-accounts').hidden || !$('#view-skills').hidden || currentId) return;
  const first = $('#job-list li[data-id]');
  if (first) openJob(first.dataset.id);
  else show('new');
})();

