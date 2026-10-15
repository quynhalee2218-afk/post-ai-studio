// "Chrome Flow" — Chrome riêng để server tự tạo video trên Google Flow, làm theo taki-agentic-ai
// (packages/orchestrator/src/flow-browser.ts). Phần mở/chép profile dùng chung ở chrome-box.js.
import { makeChrome } from './chrome-box.js';

const FLOW_HOME = 'https://flow.google.com/?hl=vi';
const box = makeChrome({ label: 'Chrome Flow', dirName: 'flow-chrome', port: Number(process.env.FLOW_CDP_PORT || 9334), startUrl: FLOW_HOME }); // 9333 là của taki-agentic-ai
export const { CDP_PORT, source, listProfiles, isUp, connect, close, syncProfile, ensure, setWindow } = box;

/** URL đăng nhập Google điền sẵn email đã chọn, đăng nhập xong tự chuyển thẳng vào Google Flow. */
export function loginUrl(continueUrl = FLOW_HOME) {
  const email = source()?.email;
  const u = new URL('https://accounts.google.com/ServiceLogin');
  u.searchParams.set('hl', 'vi');
  if (email) u.searchParams.set('Email', email);
  u.searchParams.set('continue', continueUrl);
  return u.toString();
}

/** Kiểm tra Chrome Flow đã vào được Flow chưa (không phải trang giới thiệu / trang đăng nhập Google). */
export async function checkLogin() {
  await ensure();
  const b = await connect();
  try {
    const ctx = b.contexts()[0];
    const pages = ctx.pages().filter((p) => !p.url().startsWith('chrome://') || p.url().startsWith('chrome://newtab'));
    const page = pages.find((p) => p.url().includes('flow.google.com'))
      || pages.find((p) => p.url().includes('accounts.google.com'))
      || pages[0]
      || (await ctx.newPage());
    for (const p of pages) {
      if (p !== page && (p.url() === 'about:blank' || p.url().startsWith('chrome://newtab'))) await p.close().catch(() => {});
    }
    const cur = page.url();
    if (cur.includes('accounts.google.com')) {
      await setWindow('normal').catch(() => {});
      return { ok: false, url: cur, email: null };
    }
    if (!cur.includes('flow.google.com') || cur.includes('/about')) {
      await page.goto(FLOW_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);
    }
    const url = page.url();
    const email = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))
      .find((t) => t && t.includes('@'))?.match(/\(([^)]+@[^)]+)\)/)?.[1] || null).catch(() => null);
    const ok = /flow\.google\.com\/?($|project|\?)/.test(url) && !url.includes('/about') && !url.includes('accounts.google');
    if (!ok) {
      if (url.includes('/about')) {
        await page.goto(loginUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      await setWindow('normal').catch(() => {});
    }
    return { ok, url: page.url(), email };
  } finally {
    await b.close().catch(() => {});
  }
}

/** Trạng thái nhanh của Chrome Flow (kiểm tra cả tab đang mở xem đã thực sự vào được Flow hay còn ở trang đăng nhập). */
export async function status() {
  const up = await isUp();
  let loggedIn = false;
  let pageUrl = null;
  if (up) {
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json());
      const pages = list.filter((x) => x.type === 'page' && !x.url?.startsWith('chrome://'));
      const pg = pages.find((x) => x.url?.includes('flow.google.com')) || pages[0];
      pageUrl = pg?.url || null;
      loggedIn = Boolean(pageUrl && /flow\.google\.com\/?($|project|\?)/.test(pageUrl) && !pageUrl.includes('/about') && !pageUrl.includes('accounts.google'));
    } catch { loggedIn = false; }
  }
  return { up, loggedIn, pageUrl, source: source(), profiles: listProfiles(), port: CDP_PORT };
}
