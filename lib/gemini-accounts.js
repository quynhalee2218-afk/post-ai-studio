// Quản lý nhiều tài khoản Google Gemini (Antigravity / Gemini CLI OAuth + Gemini API Keys).
// Cho phép:
// 1. Hiển thị chính xác email Google đang kết nối với Gemini CLI (đọc từ Windows Credential Manager `gemini:antigravity`
//    hoặc `AGY_CLI_CDE_AUTH_ACTION=check`).
// 2. Lưu trữ nhiều tài khoản Google OAuth (backup credential blob của từng email trong `data/gemini-accounts.json`)
//    và nhiều Gemini API Key để chuyển đổi 1 chạm khi 1 tài khoản hết hạn mức / dung lượng sử dụng.
// 3. Thêm / đổi tài khoản Google mới ngay trên giao diện web (lấy link OAuth → chọn tài khoản Google → dán mã xác thực).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { run, tail } from './proc.js';

const storeFile = () => path.join(config.dataDir, 'gemini-accounts.json');
const credHelperScript = () => path.join(config.dataDir, 'gemini-cred-helper.ps1');

const CRED_PS1 = `
param(
  [string]$Action = "read",
  [string]$Base64 = ""
)
$code = @'
using System;
using System.Runtime.InteropServices;
public class AgyCred {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite([In] ref CREDENTIAL userCredential, [In] uint flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr cred);

    public static byte[] Read(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) return null;
        try {
            CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            byte[] b = new byte[c.CredentialBlobSize];
            Marshal.Copy(c.CredentialBlob, b, 0, (int)c.CredentialBlobSize);
            return b;
        } finally {
            CredFree(ptr);
        }
    }

    public static bool Write(string target, string userName, byte[] bytes) {
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            CREDENTIAL c = new CREDENTIAL();
            c.Flags = 0;
            c.Type = 1;
            c.TargetName = target;
            c.UserName = userName;
            c.CredentialBlobSize = (uint)bytes.Length;
            c.CredentialBlob = blob;
            c.Persist = 2;
            return CredWrite(ref c, 0);
        } finally {
            Marshal.FreeHGlobal(blob);
        }
    }
}
'@
Add-Type -TypeDefinition $code
if ($Action -eq "read") {
    $b = [AgyCred]::Read("gemini:antigravity")
    if ($b) { Write-Output ([Convert]::ToBase64String($b)) }
} elseif ($Action -eq "write") {
    $b = [Convert]::FromBase64String($Base64)
    $ok = [AgyCred]::Write("gemini:antigravity", "antigravity", $b)
    if ($ok) { Write-Output "OK" } else { exit 1 }
} elseif ($Action -eq "delete") {
    [AgyCred]::CredDelete("gemini:antigravity", 1, 0) | Out-Null
    Write-Output "OK"
}
`.trim();

function ensureHelperScript() {
  const f = credHelperScript();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, CRED_PS1, 'utf8');
  }
  return f;
}

export function findGeminiBin() {
  if (process.env.GEMINI_BIN && fs.existsSync(process.env.GEMINI_BIN)) return process.env.GEMINI_BIN;
  const agyBin = path.join(os.homedir(), '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy');
  if (fs.existsSync(agyBin)) return agyBin;
  const localAgy = path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe');
  if (localAgy && fs.existsSync(localAgy)) return localAgy;
  return 'agy';
}

function readStore() {
  try {
    const d = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return {
      active: d.active || null,
      accounts: Array.isArray(d.accounts) ? d.accounts : [],
    };
  } catch {
    return { active: null, accounts: [] };
  }
}

function writeStore(d) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(d, null, 2), { mode: 0o600 });
}

/** Giải mã email từ JWT id_token trong credential blob của Gemini CLI. */
export function parseCredentialInfo(rawJson) {
  if (!rawJson) return null;
  try {
    const obj = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    let email = null;
    if (obj.id_token && typeof obj.id_token === 'string') {
      const parts = obj.id_token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        email = payload.email || null;
      }
    }
    return {
      email,
      authMethod: obj.auth_method || 'consumer',
      hasRefreshToken: Boolean(obj.token?.refresh_token),
      rawJson: typeof rawJson === 'string' ? rawJson : JSON.stringify(obj),
    };
  } catch {
    return null;
  }
}

/** Đọc credential `gemini:antigravity` hiện tại từ Windows Credential Manager. */
export async function readKeychainCredential() {
  if (process.platform !== 'win32') return null;
  const script = ensureHelperScript();
  const res = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'read'], {
    timeoutMs: 10000,
  }).catch(() => ({ code: 1, stdout: '' }));
  const b64 = (res.stdout || '').trim();
  if (!b64) return null;
  try {
    const rawJson = Buffer.from(b64, 'base64').toString('utf8');
    return parseCredentialInfo(rawJson);
  } catch {
    return null;
  }
}

/** Ghi credential `gemini:antigravity` vào Windows Credential Manager. */
export async function writeKeychainCredential(rawJson) {
  if (process.platform !== 'win32' || !rawJson) return false;
  const script = ensureHelperScript();
  const b64 = Buffer.from(rawJson, 'utf8').toString('base64');
  const res = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'write', '-Base64', b64], {
    timeoutMs: 10000,
  }).catch(() => ({ code: 1, stdout: '' }));
  return (res.stdout || '').includes('OK');
}

/** Xoá credential `gemini:antigravity` khỏi Windows Credential Manager. */
export async function deleteKeychainCredential() {
  if (process.platform !== 'win32') return;
  const script = ensureHelperScript();
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'delete'], {
    timeoutMs: 10000,
  }).catch(() => {});
}

/** Kiểm tra nhanh email đang đăng nhập qua `AGY_CLI_CDE_AUTH_ACTION=check`. */
export async function checkCliAuthEmail() {
  const bin = findGeminiBin();
  if (bin.includes(path.sep) && !fs.existsSync(bin)) return null;
  const res = await run(bin, [], {
    env: { AGY_CLI_CDE_AUTH_ACTION: 'check' },
    timeoutMs: 10000,
  }).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  const text = `${res.stdout || ''}\n${res.stderr || ''}`;
  const m = text.match(/Already authenticated as\s+([^\s.]+\@[^\s.]+(?:\.[^\s.]+)+)/i);
  return m ? m[1].replace(/\.$/, '') : null;
}

/**
 * Đồng bộ tài khoản đang đăng nhập trong Keychain vào `data/gemini-accounts.json`
 * và trả về danh sách tất cả tài khoản Gemini (cả Google OAuth & API Key).
 */
export async function list() {
  const d = readStore();
  const kc = await readKeychainCredential();
  let kcEmail = kc?.email || null;
  if (!kcEmail && kc?.rawJson) {
    kcEmail = await checkCliAuthEmail();
  }

  // Nếu trong Keychain đang có tài khoản hợp lệ → tự lưu / cập nhật credential vào kho tài khoản
  if (kc?.rawJson && kcEmail) {
    let existing = d.accounts.find((a) => a.type === 'oauth' && a.email?.toLowerCase() === kcEmail.toLowerCase());
    if (!existing) {
      existing = {
        id: `gem-${crypto.randomBytes(4).toString('hex')}`,
        type: 'oauth',
        email: kcEmail,
        plan: kc.authMethod === 'consumer' ? 'Google Account' : kc.authMethod,
        credentialBlob: kc.rawJson,
        addedAt: new Date().toISOString(),
      };
      d.accounts.unshift(existing);
    } else {
      existing.credentialBlob = kc.rawJson;
      existing.email = kcEmail;
    }
    if (!d.active || !d.accounts.some((a) => a.id === d.active)) {
      d.active = existing.id;
    }
    writeStore(d);
  }

  // Nếu chưa có active hợp lệ mà có tài khoản trong kho → chọn tài khoản đầu tiên
  if (d.accounts.length && (!d.active || !d.accounts.some((a) => a.id === d.active))) {
    d.active = d.accounts[0].id;
    writeStore(d);
  }

  return d.accounts.map((a) => {
    const isApiKey = a.type === 'apikey';
    const mask = isApiKey && a.apiKey ? `${a.apiKey.slice(0, 6)}…${a.apiKey.slice(-4)}` : null;
    return {
      id: a.id,
      type: a.type || 'oauth',
      email: isApiKey ? (a.label || `API Key (${mask})`) : a.email,
      plan: isApiKey ? 'API Key' : (a.plan || 'Google OAuth'),
      maskedKey: mask,
      loggedIn: isApiKey ? Boolean(a.apiKey) : Boolean(a.credentialBlob),
      active: a.id === d.active,
      addedAt: a.addedAt,
    };
  });
}

/** Lấy thông tin tài khoản Gemini đang chọn (để biết dùng CLI OAuth hay API Key). */
export function getActiveAccount() {
  const d = readStore();
  return d.accounts.find((a) => a.id === d.active) || d.accounts[0] || null;
}

/**
 * Chuyển sang tài khoản Gemini khác (nếu là tài khoản OAuth thì nạp credentialBlob của tài khoản đó vào Keychain).
 */
export async function setActive(id) {
  const d = readStore();
  const acc = d.accounts.find((a) => a.id === id);
  if (!acc) throw new Error('Không tìm thấy tài khoản Gemini này');
  if (acc.type !== 'apikey' && acc.credentialBlob) {
    const ok = await writeKeychainCredential(acc.credentialBlob);
    if (!ok) throw new Error('Không nạp được thông tin xác thực của tài khoản vào Gemini CLI');
  }
  d.active = acc.id;
  writeStore(d);
  return {
    id: acc.id,
    type: acc.type || 'oauth',
    email: acc.type === 'apikey' ? acc.label : acc.email,
    plan: acc.plan,
  };
}

/** Thêm 1 tài khoản Gemini bằng API Key (Google AI Studio) để dự phòng khi tài khoản OAuth hết dung lượng. */
export function addApiKeyAccount({ apiKey, label = '' }) {
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) throw new Error('Hãy nhập Gemini API Key (bắt đầu bằng AIza...)');
  const d = readStore();
  const mask = `${cleanKey.slice(0, 6)}…${cleanKey.slice(-4)}`;
  const cleanLabel = String(label || '').trim() || `Gemini API Key (${mask})`;
  let existing = d.accounts.find((a) => a.type === 'apikey' && a.apiKey === cleanKey);
  if (existing) {
    existing.label = cleanLabel;
    d.active = existing.id;
  } else {
    existing = {
      id: `gemkey-${crypto.randomBytes(4).toString('hex')}`,
      type: 'apikey',
      label: cleanLabel,
      email: cleanLabel,
      plan: 'API Key',
      apiKey: cleanKey,
      addedAt: new Date().toISOString(),
    };
    d.accounts.push(existing);
    d.active = existing.id;
  }
  writeStore(d);
  return existing;
}

// ---------- Đăng nhập OAuth tài khoản Google mới cho Gemini CLI ----------
const sessions = new Map(); // sid -> { id, proc, out, url, backupCred, done, exitCode }

export async function startLogin() {
  for (const [sid, s] of sessions) {
    if (s.done) sessions.delete(sid);
    else {
      try { s.proc.kill(); } catch {}
      sessions.delete(sid);
    }
  }

  // Bước 1: Đồng bộ & sao lưu tài khoản hiện tại trong Keychain trước khi xoá tạm để lấy link đăng nhập mới
  await list().catch(() => {});
  const backup = await readKeychainCredential();
  await deleteKeychainCredential();

  const id = crypto.randomBytes(4).toString('hex');
  const bin = findGeminiBin();
  const proc = spawn(bin, [], {
    env: {
      ...process.env,
      AGY_CLI_CDE_AUTH_ACTION: 'login',
      BROWSER: 'echo',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const s = {
    id,
    proc,
    out: '',
    url: null,
    backupCred: backup?.rawJson || null,
    done: false,
    exitCode: null,
  };

  const onData = (chunk) => {
    s.out += chunk.toString('utf8');
    const m = s.out.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/\S+/);
    if (m && !s.url) {
      // Thêm select_account để Google luôn hỏi chọn tài khoản muốn đăng nhập
      s.url = m[0].replace('prompt=consent', 'prompt=select_account+consent');
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', (code) => {
    s.done = true;
    s.exitCode = code;
  });

  // Tự động khôi phục credential cũ nếu sau 15 phút người dùng không hoàn tất đăng nhập
  setTimeout(async () => {
    if (!s.done) {
      try { proc.kill(); } catch {}
      if (s.backupCred) {
        const cur = await readKeychainCredential();
        if (!cur?.rawJson) await writeKeychainCredential(s.backupCred);
      }
    }
  }, 15 * 60 * 1000).unref();

  sessions.set(id, s);

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      if (s.url) return resolve({ sessionId: id, url: s.url });
      if (s.done || Date.now() - t0 > 20000) {
        try { proc.kill(); } catch {}
        if (s.backupCred) await writeKeychainCredential(s.backupCred);
        return reject(new Error(`Không lấy được link đăng nhập Google Gemini: ${tail(s.out, 300)}`));
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

export async function submitCode(sessionId, code) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error('Phiên đăng nhập Gemini đã hết hạn — hãy bấm "＋ Thêm / Đổi tài khoản Google" lại');
  if (s.done) throw new Error('Phiên đăng nhập Gemini đã kết thúc — hãy bấm "＋ Thêm / Đổi tài khoản Google" lại');
  const clean = String(code || '').trim();
  if (!clean) throw new Error('Hãy dán mã xác thực từ Google');

  s.proc.stdin.write(clean + '\n');
  const t0 = Date.now();
  while (!s.done && Date.now() - t0 < 60000) {
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!s.done) {
    try { s.proc.kill(); } catch {}
    if (s.backupCred) await writeKeychainCredential(s.backupCred);
    throw new Error('Quá thời gian chờ xác thực từ Google Gemini');
  }

  const kc = await readKeychainCredential();
  let email = kc?.email || null;
  if (!email && kc?.rawJson) {
    email = await checkCliAuthEmail();
  }
  if (!kc?.rawJson || !email) {
    sessions.delete(sessionId);
    if (s.backupCred) await writeKeychainCredential(s.backupCred);
    throw new Error(`Đăng nhập Gemini không thành công (mã sai hoặc đã hết hạn): ${tail(s.out, 250)}`);
  }

  const d = readStore();
  let acc = d.accounts.find((a) => a.type === 'oauth' && a.email?.toLowerCase() === email.toLowerCase());
  if (acc) {
    acc.credentialBlob = kc.rawJson;
    acc.email = email;
    acc.addedAt = new Date().toISOString();
  } else {
    acc = {
      id: `gem-${crypto.randomBytes(4).toString('hex')}`,
      type: 'oauth',
      email,
      plan: 'Google Account',
      credentialBlob: kc.rawJson,
      addedAt: new Date().toISOString(),
    };
    d.accounts.push(acc);
  }
  d.active = acc.id;
  writeStore(d);
  sessions.delete(sessionId);
  return { id: acc.id, email: acc.email, plan: acc.plan };
}

export async function cancelLogin(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (!s.done) {
    try { s.proc.kill(); } catch {}
  }
  if (s.backupCred) {
    const cur = await readKeychainCredential();
    if (!cur?.rawJson) {
      await writeKeychainCredential(s.backupCred);
    }
  }
  sessions.delete(sessionId);
}

export async function removeAccount(id) {
  const d = readStore();
  const idx = d.accounts.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('Không tìm thấy tài khoản này');
  const removed = d.accounts[idx];
  d.accounts.splice(idx, 1);

  if (d.active === id) {
    const next = d.accounts[0] || null;
    d.active = next ? next.id : null;
    if (next && next.type !== 'apikey' && next.credentialBlob) {
      await writeKeychainCredential(next.credentialBlob);
    } else if (!next && removed.type !== 'apikey') {
      await deleteKeychainCredential();
    }
  }
  writeStore(d);
  return { ok: true, active: d.active };
}
