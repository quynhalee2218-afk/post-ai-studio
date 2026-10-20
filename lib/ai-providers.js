// Quản lý đa Model AI cho Post AI Studio: Claude (Anthropic), ChatGPT (OpenAI / Codex CLI), Gemini (Google / Antigravity CLI).
// Hỗ trợ song song cả 2 chế độ cho từng hãng:
// 1. Đăng nhập tài khoản CLI trên máy (Claude CLI, ChatGPT Codex CLI, Gemini Antigravity CLI) — không tốn phí API lẻ.
// 2. Nhập API Key trực tiếp trên giao diện web (OpenAI API Key, Google Gemini API Key, Anthropic API Key) — lưu mã hoá trong data/settings.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config, readSettings, writeSettings, encrypt, decrypt } from './config.js';
import { run, tail } from './proc.js';
import * as CA from './claude-accounts.js';
import * as GA from './gemini-accounts.js';

export const AI_PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    shortName: 'Claude',
    icon: '✦',
    badge: 'Claude AI',
    desc: 'Mạnh về viết kịch bản chiều sâu, giữ đúng cấu trúc 15 mục Google Flow / Veo 3 và đọc tài liệu Skill.',
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Mặc định — Nhanh & Chuẩn xác)', provider: 'claude', default: true },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (Chuyên sâu & Sáng tạo cao)', provider: 'claude' },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT (OpenAI)',
    shortName: 'ChatGPT',
    icon: '🟢',
    badge: 'OpenAI GPT',
    desc: 'Sáng tạo câu thoại đời thường, bắt trend mạng xã hội, giật Hook Viral Reels & tối ưu chuyển đổi.',
    models: [
      { id: 'gpt-5.6-sol', name: 'ChatGPT GPT-5.6 Sol (Mặc định — Cân bằng & Sáng tạo)', provider: 'chatgpt', default: true },
      { id: 'gpt-6-astra', name: 'ChatGPT GPT-6 Astra (Flagship cao cấp nhất)', provider: 'chatgpt' },
      { id: 'gpt-5.6-terra', name: 'ChatGPT GPT-5.6 Terra (Tốc độ nhanh & Thực chiến)', provider: 'chatgpt' },
      { id: 'gpt-4o', name: 'ChatGPT GPT-4o (Dành cho OpenAI API Key)', provider: 'chatgpt' },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    shortName: 'Gemini',
    icon: '♊',
    badge: 'Google Gemini',
    desc: 'Tốc độ phản hồi cực nhanh, hiểu sâu hệ sinh thái Google Veo 3 / Flow và phân tích ngữ cảnh rộng.',
    models: [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High (Mặc định — Siêu tốc & Sắc bén)', provider: 'gemini', default: true },
      { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon High (Tư duy chiến lược & Chuyên sâu)', provider: 'gemini' },
      { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon Medium (Cân bằng tốc độ & chất lượng)', provider: 'gemini' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Dành cho Google API Key)', provider: 'gemini' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Dành cho Google API Key)', provider: 'gemini' },
    ],
  },
];

export const AI_MODELS = AI_PROVIDERS.flatMap((p) =>
  p.models.map((m) => ({
    ...m,
    providerName: p.name,
    providerShort: p.shortName,
    providerIcon: p.icon,
    value: `${p.id}:${m.id}`,
  })),
);

/**
 * Tự động tìm đường dẫn codex.exe (ChatGPT CLI) trên máy Windows / macOS / Linux.
 */
export function findCodexBin() {
  if (process.env.CODEX_BIN && fs.existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  const home = os.homedir();
  const extDirs = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.cursor', 'extensions'),
    path.join(home, '.antigravity', 'extensions'),
  ];
  const binName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const platFolder = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x86_64';

  for (const extRoot of extDirs) {
    try {
      if (!fs.existsSync(extRoot)) continue;
      const matches = fs.readdirSync(extRoot)
        .filter((d) => d.startsWith('openai.chatgpt-'))
        .sort()
        .reverse();
      for (const m of matches) {
        const p = path.join(extRoot, m, 'bin', platFolder, binName);
        if (fs.existsSync(p)) return p;
      }
    } catch { /* ignore */ }
  }
  return binName;
}

/**
 * Tự động tìm đường dẫn agy.exe / gemini CLI trên máy.
 */
export function findGeminiBin() {
  if (process.env.GEMINI_BIN && fs.existsSync(process.env.GEMINI_BIN)) return process.env.GEMINI_BIN;
  const home = os.homedir();
  const candidates = [
    path.join(home, '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy'),
    path.join(home, '.gemini', 'antigravity-cli', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'agy';
}

function getSecret(key) {
  const raw = readSettings()[key];
  if (!raw) return '';
  try { return decrypt(raw); } catch { return ''; }
}

export function getApiKeys() {
  return {
    openai: process.env.OPENAI_API_KEY || getSecret('openaiApiKey') || '',
    gemini: process.env.GEMINI_API_KEY || getSecret('geminiApiKey') || '',
    anthropic: process.env.ANTHROPIC_API_KEY || getSecret('anthropicApiKey') || '',
  };
}

/**
 * Lấy thông tin cấu hình AI mặc định đang chọn (provider + model).
 */
export function getDefaultAiSelection() {
  const s = readSettings();
  const provider = ['claude', 'chatgpt', 'gemini'].includes(s.aiProvider) ? s.aiProvider : 'claude';
  const provObj = AI_PROVIDERS.find((p) => p.id === provider) || AI_PROVIDERS[0];
  const validModel = provObj.models.find((m) => m.id === s.aiModel) || provObj.models.find((m) => m.default) || provObj.models[0];
  return {
    provider,
    model: validModel.id,
    combined: `${provider}:${validModel.id}`,
    providerName: provObj.name,
    providerShort: provObj.shortName,
    providerIcon: provObj.icon,
    modelName: validModel.name,
  };
}

/**
 * Phân giải lựa chọn provider + model từ tham số truyền vào (vd: "chatgpt:gpt-5.6-sol", hoặc { aiProvider, aiModel }).
 */
export function resolveAiSelection(input = {}) {
  const def = getDefaultAiSelection();
  let rawProvider = '';
  let rawModel = '';

  if (typeof input === 'string') {
    if (input.includes(':')) {
      [rawProvider, rawModel] = input.split(':', 2);
    } else if (['claude', 'chatgpt', 'gemini'].includes(input)) {
      rawProvider = input;
    } else {
      rawModel = input;
    }
  } else if (input && typeof input === 'object') {
    const spec = String(input.aiModel || input.aiProvider || '').trim();
    if (spec.includes(':')) {
      [rawProvider, rawModel] = spec.split(':', 2);
    } else {
      rawProvider = String(input.aiProvider || '').trim();
      rawModel = String(input.aiModel || '').trim();
    }
  }

  if (!rawProvider && rawModel) {
    const foundByModel = AI_MODELS.find((m) => m.id === rawModel);
    if (foundByModel) rawProvider = foundByModel.provider;
    else if (['claude', 'chatgpt', 'gemini'].includes(rawModel)) {
      rawProvider = rawModel;
      rawModel = '';
    }
  }

  const provider = ['claude', 'chatgpt', 'gemini'].includes(rawProvider) ? rawProvider : def.provider;
  const provObj = AI_PROVIDERS.find((p) => p.id === provider) || AI_PROVIDERS[0];
  const modelObj = provObj.models.find((m) => m.id === rawModel)
    || (provider === def.provider ? provObj.models.find((m) => m.id === def.model) : null)
    || provObj.models.find((m) => m.default)
    || provObj.models[0];

  return {
    provider,
    model: modelObj.id,
    combined: `${provider}:${modelObj.id}`,
    providerName: provObj.name,
    providerShort: provObj.shortName,
    providerIcon: provObj.icon,
    modelName: modelObj.name,
  };
}

/**
 * Lưu cài đặt AI mặc định hoặc API Key của từng hãng.
 */
export function saveAiSettings(patch = {}) {
  const toWrite = {};
  const rawSel = patch.defaultAiModel || patch.aiSelection || patch.aiModel || patch.aiProvider || '';
  if (rawSel) {
    const resolved = resolveAiSelection({
      aiProvider: patch.aiProvider || '',
      aiModel: String(rawSel).trim(),
    });
    toWrite.aiProvider = resolved.provider;
    toWrite.aiModel = resolved.model;
  }

  if ('openaiApiKey' in patch) {
    const k = String(patch.openaiApiKey || '').trim();
    toWrite.openaiApiKey = k ? encrypt(k) : null;
  }
  if ('geminiApiKey' in patch) {
    const k = String(patch.geminiApiKey || '').trim();
    toWrite.geminiApiKey = k ? encrypt(k) : null;
  }
  if ('anthropicApiKey' in patch) {
    const k = String(patch.anthropicApiKey || '').trim();
    toWrite.anthropicApiKey = k ? encrypt(k) : null;
  }
  writeSettings(toWrite);
  return getDefaultAiSelection();
}

/**
 * Đọc trạng thái đăng nhập ChatGPT (Codex CLI ~/.codex/auth.json + OpenAI API Key).
 */
export function getChatGptStatus() {
  const keys = getApiKeys();
  const hasApiKey = Boolean(keys.openai);
  const maskedKey = hasApiKey ? `${keys.openai.slice(0, 7)}…${keys.openai.slice(-4)}` : null;
  const bin = findCodexBin();
  const binExists = bin.includes(path.sep) ? fs.existsSync(bin) : false;

  let cliLoggedIn = false;
  let email = null;
  let plan = null;
  let authMode = null;

  const authFile = path.join(os.homedir(), '.codex', 'auth.json');
  if (fs.existsSync(authFile)) {
    try {
      const d = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      authMode = d.auth_mode || null;
      if (d.tokens?.id_token) {
        const parts = String(d.tokens.id_token).split('.');
        if (parts[1]) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          email = payload.email || null;
          plan = payload['https://api.openai.com/auth']?.chatgpt_plan_type || null;
        }
        cliLoggedIn = true;
      } else if (d.OPENAI_API_KEY) {
        cliLoggedIn = true;
        email = 'OpenAI API Key (CLI)';
      }
    } catch { /* ignore */ }
  }

  const label = cliLoggedIn
    ? `${email || 'Đã đăng nhập ChatGPT'}${plan ? ` (${plan})` : ''}`
    : hasApiKey
    ? `API Key (${maskedKey})`
    : 'Chưa kết nối';
  return {
    provider: 'chatgpt',
    ready: cliLoggedIn || hasApiKey,
    cliInstalled: binExists,
    cliLoggedIn,
    email,
    plan,
    authMode,
    hasApiKey,
    maskedKey,
    apiKeyMask: maskedKey,
    mode: cliLoggedIn ? 'cli' : hasApiKey ? 'api' : 'none',
    label,
    accountLabel: label,
  };
}

/**
 * Đọc trạng thái đăng nhập Gemini (Antigravity CLI ~/.gemini + Google Gemini API Key + danh sách tài khoản).
 */
export function getGeminiStatus(geminiAccounts = null) {
  const keys = getApiKeys();
  const hasApiKey = Boolean(keys.gemini);
  const maskedKey = hasApiKey ? `${keys.gemini.slice(0, 6)}…${keys.gemini.slice(-4)}` : null;
  const bin = findGeminiBin();
  const binExists = bin.includes(path.sep) ? fs.existsSync(bin) : false;
  const stateFile = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'installation_id');
  const activeAcc = Array.isArray(geminiAccounts)
    ? (geminiAccounts.find((a) => a.active) || geminiAccounts[0] || null)
    : GA.getActiveAccount();
  const cliLoggedIn = binExists && (Boolean(activeAcc) || fs.existsSync(stateFile) || fs.existsSync(path.join(os.homedir(), '.gemini', 'config', 'config.json')));
  const email = activeAcc?.email || (hasApiKey ? `Gemini API Key (${maskedKey})` : null);
  const plan = activeAcc?.plan || (activeAcc ? 'Google Account' : null);

  const label = email
    ? `${email}${plan && !email.includes(plan) ? ` (${plan})` : ''}`
    : cliLoggedIn
    ? `Gemini CLI sẵn sàng${hasApiKey ? ` + API Key` : ''}`
    : hasApiKey
    ? `Gemini API Key (${maskedKey})`
    : 'Chưa kết nối';
  return {
    provider: 'gemini',
    ready: Boolean(activeAcc?.loggedIn || cliLoggedIn || hasApiKey),
    cliInstalled: binExists,
    cliLoggedIn,
    email,
    plan,
    hasApiKey,
    maskedKey,
    apiKeyMask: maskedKey,
    accounts: Array.isArray(geminiAccounts) ? geminiAccounts : [],
    mode: activeAcc?.type === 'apikey' ? 'api' : cliLoggedIn ? 'cli' : hasApiKey ? 'api' : 'none',
    label,
    accountLabel: label,
  };
}

/**
 * Trạng thái tổng hợp của cả 3 Model AI (Claude, ChatGPT, Gemini).
 */
export async function getAllAiStatus() {
  const def = getDefaultAiSelection();
  const [claudeAccounts, geminiAccounts] = await Promise.all([
    CA.list().catch(() => []),
    GA.list().catch(() => []),
  ]);
  const activeClaude = claudeAccounts.find((a) => a.active) || claudeAccounts[0] || { loggedIn: false };
  const keys = getApiKeys();
  const hasAnthropicKey = Boolean(keys.anthropic);
  const clMask = hasAnthropicKey ? `${keys.anthropic.slice(0, 7)}…${keys.anthropic.slice(-4)}` : null;
  const clLabel = activeClaude?.loggedIn
    ? `${activeClaude.email || 'Đã đăng nhập'}${activeClaude.plan ? ` (${activeClaude.plan})` : ''}`
    : hasAnthropicKey
    ? 'Anthropic API Key'
    : 'Chưa đăng nhập';

  const claude = {
    provider: 'claude',
    ready: Boolean(activeClaude?.loggedIn || hasAnthropicKey),
    loggedIn: Boolean(activeClaude?.loggedIn),
    email: activeClaude?.email || (hasAnthropicKey ? 'Anthropic API Key' : null),
    plan: activeClaude?.plan || null,
    hasApiKey: hasAnthropicKey,
    maskedKey: clMask,
    apiKeyMask: clMask,
    accounts: claudeAccounts,
    label: clLabel,
    accountLabel: clLabel,
  };

  const chatgpt = getChatGptStatus();
  const gemini = getGeminiStatus(geminiAccounts);

  return {
    defaultAi: def,
    defaultSelection: def,
    providers: { claude, chatgpt, gemini },
    providerList: AI_PROVIDERS,
    models: AI_MODELS,
    status: { claude, chatgpt, gemini },
  };
}

/**
 * Mở tiến trình đăng nhập ChatGPT trên trình duyệt qua `codex.exe login`.
 */
export async function startChatGptBrowserLogin() {
  const bin = findCodexBin();
  const proc = spawn(bin, ['login'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });

  return new Promise((resolve) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      const m = out.match(/https:\/\/auth\.openai\.com\S+|https:\/\/\S+authorize\S+|http:\/\/localhost:\d+\S*/i);
      if (m || Date.now() - t0 > 6000) {
        clearInterval(timer);
        resolve({
          ok: true,
          url: m ? m[0] : null,
          message: 'Đã mở cửa sổ đăng nhập ChatGPT trên trình duyệt. Sau khi đăng nhập xong, bấm "Kiểm tra kết nối" để cập nhật.',
        });
      }
    }, 250);
    setTimeout(() => { try { proc.kill(); } catch {} }, 10 * 60 * 1000).unref();
  });
}

/**
 * Chuẩn hoá JSON Schema cho OpenAI / ChatGPT Structured Outputs:
 * Mọi object đều phải có `additionalProperties: false` và tất cả keys nằm trong `required`.
 */
export function normalizeSchemaForOpenAI(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normalizeSchemaForOpenAI);
  const copy = { ...schema };
  if (copy.type === 'object' && copy.properties && typeof copy.properties === 'object') {
    const newProps = {};
    for (const [k, v] of Object.entries(copy.properties)) {
      newProps[k] = normalizeSchemaForOpenAI(v);
    }
    copy.properties = newProps;
    copy.required = Object.keys(newProps);
    copy.additionalProperties = false;
  }
  if (copy.type === 'array' && copy.items) {
    copy.items = normalizeSchemaForOpenAI(copy.items);
  }
  return copy;
}

/**
 * Chuẩn hoá JSON Schema cho Google Gemini API (`responseSchema` không nhận `additionalProperties`).
 */
export function normalizeSchemaForGeminiApi(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normalizeSchemaForGeminiApi);
  const copy = { ...schema };
  delete copy.additionalProperties;
  if (copy.properties && typeof copy.properties === 'object') {
    const newProps = {};
    for (const [k, v] of Object.entries(copy.properties)) {
      newProps[k] = normalizeSchemaForGeminiApi(v);
    }
    copy.properties = newProps;
  }
  if (copy.items) {
    copy.items = normalizeSchemaForGeminiApi(copy.items);
  }
  return copy;
}

/**
 * Gọi OpenAI REST API trực tiếp bằng API Key (khi người dùng nhập OpenAI API Key hoặc chọn model API).
 */
export async function callOpenAiApi({ apiKey, model = 'gpt-4o', systemPrompt, input, schema, refImagePath = null }) {
  const apiModel = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'].includes(model) ? model : 'gpt-4o';
  const strictSchema = normalizeSchemaForOpenAI(schema);

  const userContent = [];
  userContent.push({ type: 'text', text: input });
  if (refImagePath && fs.existsSync(refImagePath)) {
    const b64 = fs.readFileSync(refImagePath).toString('base64');
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    });
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: apiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'post_ai_studio_response',
          strict: true,
          schema: strictSchema,
        },
      },
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`ChatGPT API lỗi (${resp.status}): ${json.error?.message || JSON.stringify(json).slice(0, 300)}`);
  }
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('ChatGPT API không trả về dữ liệu.');
  return {
    data: JSON.parse(content),
    costUsd: 0,
    provider: 'chatgpt',
    model: apiModel,
  };
}

/**
 * Gọi ChatGPT qua Codex CLI (đã đăng nhập tài khoản ChatGPT trên máy) hoặc fallback sang OpenAI API Key.
 */
export async function callChatGPT({ model = 'gpt-5.6-sol', systemPrompt, input, schema, refImagePath = null }) {
  const st = getChatGptStatus();
  const keys = getApiKeys();

  // Nếu chọn rõ model gpt-4o kèm có API Key, hoặc chưa đăng nhập CLI mà có API Key → gọi thẳng REST API
  if ((model === 'gpt-4o' && keys.openai) || (!st.cliLoggedIn && keys.openai)) {
    return callOpenAiApi({ apiKey: keys.openai, model, systemPrompt, input, schema, refImagePath });
  }
  if (!st.cliLoggedIn && !keys.openai) {
    throw new Error('Chưa kết nối ChatGPT: hãy vào tab "Tài khoản" → khung ChatGPT để bấm Đăng nhập hoặc nhập OpenAI API Key.');
  }

  const bin = findCodexBin();
  const strictSchema = normalizeSchemaForOpenAI(schema);

  const fullPrompt = [
    'SYSTEM INSTRUCTIONS (BẮT BUỘC TUÂN THỦ 100%):',
    systemPrompt,
    '',
    '========================================',
    'USER REQUEST & DATA:',
    input,
    '',
    'IMPORTANT: All necessary data is already provided inline above. Do NOT run any shell commands, do NOT inspect any files on disk, and return ONLY valid JSON matching the output schema immediately in a single response.',
  ].join('\n');

  const cliModels = ['gpt-5.6-sol', 'gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-luna'];
  const primaryModel = cliModels.includes(model) ? model : 'gpt-5.6-sol';
  const fallbackModels = [primaryModel, ...cliModels.filter((m) => m !== primaryModel && m !== 'gpt-6-astra')].slice(0, 2);

  let lastErr = null;
  for (const chosenModel of fallbackModels) {
    const tmpId = crypto.randomBytes(6).toString('hex');
    const schemaFile = path.join(os.tmpdir(), `postai-codex-schema-${tmpId}.json`);
    const outFile = path.join(os.tmpdir(), `postai-codex-out-${tmpId}.json`);
    fs.writeFileSync(schemaFile, JSON.stringify(strictSchema), 'utf8');

    const args = [
      'exec',
      '-',
      '-m', chosenModel,
      '-s', 'read-only',
      '-c', 'model_reasoning_effort="low"',
      '--output-schema', schemaFile,
      '-o', outFile,
      '--ephemeral',
      '--skip-git-repo-check',
    ];
    if (refImagePath && fs.existsSync(refImagePath)) {
      args.push('-i', refImagePath);
    }

    try {
      const res = await run(bin, args, {
        input: fullPrompt,
        cwd: os.tmpdir(),
        env: keys.openai && !st.cliLoggedIn ? { OPENAI_API_KEY: keys.openai } : {},
        timeoutMs: 10 * 60 * 1000,
      });

      if (!fs.existsSync(outFile)) {
        throw new Error(`ChatGPT (${chosenModel}) không trả kết quả (exit ${res.code}): ${tail(res.stderr || res.stdout, 500)}`);
      }
      const rawOut = fs.readFileSync(outFile, 'utf8').trim();
      const parsed = JSON.parse(rawOut);
      return {
        data: parsed,
        costUsd: 0,
        provider: 'chatgpt',
        model: chosenModel,
      };
    } catch (err) {
      lastErr = err;
      if (!/429|Too Many Requests|retry limit|rate.?limit/i.test(String(err?.message || ''))) {
        break;
      }
    } finally {
      try { fs.rmSync(schemaFile, { force: true }); } catch {}
      try { fs.rmSync(outFile, { force: true }); } catch {}
    }
  }
  throw lastErr || new Error('ChatGPT không trả kết quả.');
}

/**
 * Gọi Google Gemini REST API trực tiếp bằng Gemini API Key.
 */
export async function callGeminiApi({ apiKey, model = 'gemini-2.5-flash', systemPrompt, input, schema, refImagePath = null }) {
  const apiModel = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'].includes(model) ? model : 'gemini-2.5-flash';
  const cleanSchema = normalizeSchemaForGeminiApi(schema);

  const parts = [{ text: input }];
  if (refImagePath && fs.existsSync(refImagePath)) {
    const b64 = fs.readFileSync(refImagePath).toString('base64');
    parts.push({
      inlineData: { mimeType: 'image/jpeg', data: b64 },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: cleanSchema,
      },
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Gemini API lỗi (${resp.status}): ${json.error?.message || JSON.stringify(json).slice(0, 300)}`);
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini API không trả về nội dung JSON.');
  return {
    data: JSON.parse(text),
    costUsd: 0,
    provider: 'gemini',
    model: apiModel,
  };
}

/**
 * Gọi Google Gemini qua Antigravity / Gemini CLI (`agy.exe`) hoặc Gemini API Key.
 * Tự động dùng tài khoản Gemini đang chọn và tự động chuyển sang tài khoản dự phòng nếu tài khoản hiện tại hết dung lượng.
 */
export async function callGemini({ model = 'gemini-3.8-flash-high', systemPrompt, input, schema, refImagePath = null, _triedAccountIds = [] }) {
  const st = getGeminiStatus();
  const keys = getApiKeys();
  const activeAcc = GA.getActiveAccount();

  // Nếu người dùng đang chọn 1 tài khoản loại API Key trong danh sách tài khoản Gemini
  if (activeAcc?.type === 'apikey' && activeAcc.apiKey) {
    return callGeminiApi({ apiKey: activeAcc.apiKey, model, systemPrompt, input, schema, refImagePath });
  }

  if ((model.startsWith('gemini-2.5-') && keys.gemini) || (!st.cliLoggedIn && keys.gemini)) {
    return callGeminiApi({ apiKey: keys.gemini, model, systemPrompt, input, schema, refImagePath });
  }
  if (!st.cliLoggedIn && !keys.gemini) {
    throw new Error('Chưa kết nối Gemini: hãy vào tab "Tài khoản" → khung Gemini để đăng nhập Google hoặc nhập Gemini API Key.');
  }

  const bin = findGeminiBin();
  const tmpId = crypto.randomBytes(6).toString('hex');
  const schemaFile = path.join(os.tmpdir(), `postai-gemini-schema-${tmpId}.json`);
  let promptFile = null;

  const strictSchema = normalizeSchemaForOpenAI(schema);
  fs.writeFileSync(schemaFile, JSON.stringify(strictSchema), 'utf8');

  const cliModels = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-4-argon-high', 'gemini-4-argon-medium', 'gemini-4-argon-low'];
  const chosenModel = cliModels.includes(model) ? model : 'gemini-3.8-flash-high';

  const fullPrompt = [
    'SYSTEM INSTRUCTIONS (BẮT BUỘC TUÂN THỦ 100%):',
    systemPrompt,
    '',
    '========================================',
    'USER REQUEST & DATA:',
    input,
  ].join('\n');

  try {
    let promptArg;
    const extraDirs = [config.dataDir];
    if (fullPrompt.length <= 12000 && !refImagePath) {
      promptArg = fullPrompt;
    } else {
      const upDir = path.join(config.dataDir, 'uploads');
      fs.mkdirSync(upDir, { recursive: true });
      promptFile = path.join(upDir, `gemini-prompt-${tmpId}.txt`);
      fs.writeFileSync(promptFile, fullPrompt, 'utf8');
      promptArg = `Read the UTF-8 instruction file at "${promptFile}"${refImagePath ? ` and view the reference image at "${refImagePath}"` : ''}, then follow every rule inside the file and return the structured JSON output immediately. Do not inspect any other files.`;
    }

    const args = [
      '-p', promptArg,
      '--model', chosenModel,
      '--output-format', 'json',
      '--json-schema', schemaFile,
      '--dangerously-skip-permissions',
      '--disable-slash-commands',
      ...extraDirs.flatMap((d) => ['--add-dir', d]),
    ];

    const res = await run(bin, args, {
      input: '',
      cwd: config.dataDir,
      timeoutMs: 15 * 60 * 1000,
    });

    let out;
    try {
      out = JSON.parse(res.stdout);
    } catch {
      const rawErr = tail(res.stderr || res.stdout, 500);
      if (/INSUFFICIENT_G1_CREDITS_BALANCE|RESOURCE_EXHAUSTED|quota|rate.?limit|429/i.test(rawErr)) {
        const nextRes = await tryFailoverGeminiAccount({ activeAcc, _triedAccountIds, model, systemPrompt, input, schema, refImagePath });
        if (nextRes) return nextRes;
        throw new Error(`Tài khoản Gemini (${activeAcc?.email || 'hiện tại'}) đã hết dung lượng / hạn mức sử dụng. Hãy vào tab "Tài khoản" → khung Gemini để đổi sang tài khoản Google khác hoặc thêm API Key!`);
      }
      throw new Error(`Gemini (${chosenModel}) không trả JSON (exit ${res.code}): ${rawErr}`);
    }
    const structured = out.structured_output || (typeof out.response === 'string' ? JSON.parse(out.response) : null);
    if (!structured) {
      const rawErr = tail(out.error || res.stderr || res.stdout, 500);
      if (/INSUFFICIENT_G1_CREDITS_BALANCE|RESOURCE_EXHAUSTED|quota|rate.?limit|429/i.test(rawErr)) {
        const nextRes = await tryFailoverGeminiAccount({ activeAcc, _triedAccountIds, model, systemPrompt, input, schema, refImagePath });
        if (nextRes) return nextRes;
        throw new Error(`Tài khoản Gemini (${activeAcc?.email || 'hiện tại'}) đã hết dung lượng / hạn mức sử dụng. Hãy vào tab "Tài khoản" → khung Gemini để đổi sang tài khoản Google khác hoặc thêm API Key!`);
      }
      throw new Error(`Gemini (${chosenModel}) lỗi: ${rawErr}`);
    }
    return {
      data: structured,
      costUsd: 0,
      provider: 'gemini',
      model: chosenModel,
    };
  } finally {
    try { fs.rmSync(schemaFile, { force: true }); } catch {}
    if (promptFile) {
      try { fs.rmSync(promptFile, { force: true }); } catch {}
    }
  }
}

async function tryFailoverGeminiAccount({ activeAcc, _triedAccountIds, model, systemPrompt, input, schema, refImagePath }) {
  const tried = [..._triedAccountIds, activeAcc?.id].filter(Boolean);
  const all = await GA.list().catch(() => []);
  const next = all.find((a) => a.loggedIn && !tried.includes(a.id));
  if (!next) return null;
  await GA.setActive(next.id);
  return callGemini({ model, systemPrompt, input, schema, refImagePath, _triedAccountIds: tried });
}
