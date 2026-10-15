// Một "Chrome riêng" do server điều khiển (thư mục dữ liệu riêng + cổng DevTools), đăng nhập bằng cách CHÉP profile
// Chrome người dùng chọn một lần; Chrome hằng ngày không bị đụng tới. Mở như Chrome thường (không cờ tự động hoá),
// KHÔNG có mẹo che giấu nào. Dùng cho Chrome Flow (tạo video) và Chrome Facebook (đăng Reel).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { config } from './config.js';

// Thư mục dữ liệu Chrome (chứa "Local State" + các profile) khác nhau theo hệ điều hành.
function defaultChromeHome() {
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(os.homedir(), '.config', 'google-chrome');
}
function defaultChromeBin() {
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return '/usr/bin/google-chrome';
}
const CHROME_HOME = process.env.CHROME_HOME || defaultChromeHome();
const CHROME_BIN = process.env.CHROME_BIN || defaultChromeBin();
// Bộ nhớ đệm, extension, phiên tab, lịch sử không cần (và làm chép chậm).
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Extensions', 'Sessions',
  'History', 'History-journal', 'Service Worker', 'optimization_guide_model_store', 'IndexedDB', 'File System']);

/** Các profile Chrome trên máy (tên + email) để chọn profile chép sang. */
export function listProfiles() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(CHROME_HOME, 'Local State'), 'utf8'));
    return Object.entries(st.profile?.info_cache || {}).map(([dir, v]) => ({ dir, name: v.name || dir, email: v.user_name || null }))
      .sort((a, b) => (a.email || '~').localeCompare(b.email || '~'));
  } catch { return []; }
}

/** label: tên hiện trong lỗi; dirName: thư mục trong data/; port: cổng DevTools; lang: ngôn ngữ giao diện; startUrl: trang mở sẵn. */
export function makeChrome({ label, dirName, port, lang = 'vi', startUrl = 'about:blank' }) {
  const CDP_PORT = port;
  const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
  const DIR = () => path.join(config.dataDir, dirName);
  const SOURCE = () => path.join(DIR(), '.post-ai-source.json');

  function source() {
    try { return JSON.parse(fs.readFileSync(SOURCE(), 'utf8')); } catch { return null; }
  }

  async function isUp() {
    try { return (await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
  }

  async function connect() {
    return chromium.connectOverCDP(CDP_URL, { timeout: 15000 });
  }

  async function close() {
    if (!(await isUp())) return;
    const b = await connect().catch(() => null);
    if (b) {
      const s = await b.newBrowserCDPSession().catch(() => null);
      await s?.send('Browser.close').catch(() => {});
      await b.close().catch(() => {});
    }
    for (let i = 0; i < 20 && (await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
  }

  /** Chuẩn bị profile cho Chrome riêng. Trên Windows giữ nguyên toàn bộ dữ liệu/cookie trong thư mục riêng để không bao giờ mất phiên đăng nhập. */
  async function syncProfile(dir) {
    const prof = listProfiles().find((p) => p.dir === dir);
    if (!prof) throw new Error('Không thấy profile Chrome này');
    const defDir = path.join(DIR(), 'Default');
    if (process.platform === 'win32') {
      fs.mkdirSync(defDir, { recursive: true });
    } else {
      await close();
      fs.rmSync(DIR(), { recursive: true, force: true });
      fs.mkdirSync(DIR(), { recursive: true });
      const src = path.join(CHROME_HOME, dir);
      try {
        fs.cpSync(src, defDir, {
          recursive: true,
          filter: (p) => p === src || !SKIP.has(p.slice(src.length + 1).split(path.sep)[0]),
        });
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
          throw new Error(`Chrome đang mở profile "${prof.name}" nên không chép được (file đang khoá) — đóng hết cửa sổ Chrome đang dùng profile này rồi bấm lại.`);
        }
        throw e;
      }
      const st = JSON.parse(fs.readFileSync(path.join(CHROME_HOME, 'Local State'), 'utf8'));
      const entry = st.profile?.info_cache?.[dir] || {};
      st.profile = { ...st.profile, info_cache: { Default: { ...entry, name: `Post AI — ${label}` } }, last_used: 'Default', last_active_profiles: ['Default'] };
      fs.writeFileSync(path.join(DIR(), 'Local State'), JSON.stringify(st));
    }
    const s = { dir, name: prof.name, email: prof.email, syncedAt: new Date().toISOString() };
    fs.writeFileSync(SOURCE(), JSON.stringify(s, null, 2));
    return s;
  }

  /** Khởi chạy Chrome trên desktop tương tác thực của Windows (WinSta0\Default) qua Task Scheduler để không bị ẩn khi server chạy trong nền. */
  function spawnChromeProcess(args, show) {
    if (process.platform === 'win32') {
      try {
        const vbsPath = path.join(os.tmpdir(), `post-ai-chrome-${CDP_PORT}.vbs`);
        const vbsQuote = (s) => `"${String(s).replace(/"/g, '""')}"`;
        const cmdStr = [CHROME_BIN, ...args].map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
        const winStyle = show === false ? 7 : 1; // 1 = SW_SHOWNORMAL, 7 = SW_SHOWMINNOACTIVE
        const vbs = `\uFEFFCreateObject("WScript.Shell").Run ${vbsQuote(cmdStr)}, ${winStyle}, False\r\n`;
        fs.writeFileSync(vbsPath, vbs, 'utf16le');
        const tn = `PostAI_Chrome_${CDP_PORT}`;
        const runSync = (c, a) => new Promise((res) => {
          const pr = spawn(c, a, { stdio: 'ignore', windowsHide: true });
          pr.on('close', (code) => res(code === 0));
          pr.on('error', () => res(false));
        });
        return (async () => {
          const created = await runSync('schtasks', ['/Create', '/TN', tn, '/TR', `wscript.exe //B "${vbsPath}"`, '/SC', 'ONCE', '/ST', '00:00', '/IT', '/F']);
          const ran = created && await runSync('schtasks', ['/Run', '/TN', tn]);
          await runSync('schtasks', ['/Delete', '/TN', tn, '/F']).catch(() => {});
          if (!ran) {
            const p = spawn(CHROME_BIN, args, { detached: true, stdio: 'ignore' });
            p.unref();
          }
        })();
      } catch { /* fallback bên dưới */ }
    }
    const p = spawn(CHROME_BIN, args, { detached: true, stdio: 'ignore' });
    p.unref();
    return Promise.resolve();
  }

  /** Mở Chrome riêng nếu chưa chạy. Mặc định giữ nguyên vị trí cửa sổ đang mở để người dùng theo dõi/đăng nhập. */
  async function ensure({ show = null } = {}) {
    const wasUp = await isUp();
    if (!wasUp) {
      const defDir = path.join(DIR(), 'Default');
      if (!fs.existsSync(defDir)) {
        if (process.platform === 'win32') {
          fs.mkdirSync(defDir, { recursive: true });
        } else {
          throw new Error(`Chưa chuẩn bị ${label} — vào tab Tài khoản → ${label} → chọn profile và bấm "Chép profile & mở"`);
        }
      }
      if (!fs.existsSync(CHROME_BIN)) throw new Error(`Không thấy Google Chrome (${CHROME_BIN})`);
      await spawnChromeProcess([
        `--user-data-dir=${DIR()}`, `--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=127.0.0.1',
        '--no-first-run', '--no-default-browser-check', '--disable-extensions', `--lang=${lang}`, '--window-size=1440,1000',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
        startUrl,
      ], show);
      let up = false;
      for (let i = 0; i < 40 && !(up = await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
      if (!up) throw new Error(`${label} không khởi động được`);
      await setWindow(show === false ? 'parked' : 'normal').catch(() => {});
    } else if (show !== null) {
      await setWindow(show ? 'normal' : 'parked').catch(() => {});
    }
  }

  async function setWindow(state) {
    const b = await connect();
    try {
      const ctx = b.contexts()[0];
      const pages = ctx.pages().filter((p) => !p.url().startsWith('chrome://') || p.url().startsWith('chrome://newtab'));
      const page = pages.find((p) => p.url().startsWith('http')) || pages[0] || (await ctx.newPage());
      if (state === 'normal' && startUrl !== 'about:blank' && (page.url() === 'about:blank' || page.url().startsWith('chrome://newtab'))) {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }
      const s = await ctx.newCDPSession(page);
      const { windowId } = await s.send('Browser.getWindowForTarget');
      if (state === 'normal') {
        // Trên Windows, cửa sổ đang ở nền phải thu nhỏ rồi khôi phục (SW_RESTORE) thì hệ điều hành mới đẩy lên trước cửa sổ khác.
        await s.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
      }
      await s.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      const scr = await page.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight, l: screen.availLeft || 0, t: screen.availTop || 0 }));
      const bounds = state === 'parked'
        ? { left: scr.l + scr.w - 24, top: scr.t, width: 1440, height: Math.max(800, scr.h) }
        : { left: scr.l + 60, top: scr.t + 30, width: Math.min(1360, scr.w - 120), height: Math.max(700, scr.h - 60) };
      await s.send('Browser.setWindowBounds', { windowId, bounds });
      if (state === 'normal') await page.bringToFront();
    } finally {
      await b.close().catch(() => {});
    }
  }

  return { CDP_PORT, CDP_URL, source, listProfiles, isUp, connect, close, syncProfile, ensure, setWindow };
}
