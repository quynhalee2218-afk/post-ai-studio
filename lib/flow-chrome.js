// "Chrome Flow" — Chrome riêng để server tự tạo video trên Google Flow, làm theo taki-agentic-ai
// (packages/orchestrator/src/flow-browser.ts). Phần mở/chép profile dùng chung ở chrome-box.js.
import { makeChrome } from './chrome-box.js';

const FLOW_HOME = 'https://flow.google.com/?hl=vi';
const box = makeChrome({ label: 'Chrome Flow', dirName: 'flow-chrome', port: Number(process.env.FLOW_CDP_PORT || 9334), startUrl: FLOW_HOME }); // 9333 là của taki-agentic-ai
export const { CDP_PORT, source, listProfiles, isUp, connect, close, syncProfile, ensure, setWindow } = box;

let cachedCreditInfo = {
  email: null,
  creditsLeft: null,
  outOfCredit: false,
  updatedAt: 0,
};

export function setCachedCreditStatus(info = {}) {
  cachedCreditInfo = {
    ...cachedCreditInfo,
    ...info,
    updatedAt: Date.now(),
  };
}

/** URL đăng nhập / chuyển đổi tài khoản Google điền sẵn email đã chọn, đăng nhập xong tự chuyển thẳng vào Google Flow. */
export function loginUrl(continueUrl = FLOW_HOME, overrideEmail = null) {
  const email = overrideEmail || source()?.email;
  const u = new URL('https://accounts.google.com/AccountChooser');
  u.searchParams.set('hl', 'vi');
  if (email) u.searchParams.set('Email', email);
  u.searchParams.set('continue', continueUrl);
  return u.toString();
}

/** Mở thẳng trang Chuyển đổi / Thêm tài khoản Google trong Chrome Flow để đổi tài khoản khi hết tín dụng. */
export async function switchAccount(targetEmail = '') {
  await ensure({ show: true });
  const b = await connect();
  try {
    const ctx = b.contexts()[0];
    const pages = ctx.pages().filter((p) => !p.url().startsWith('chrome://') || p.url().startsWith('chrome://newtab'));
    const page = pages.find((p) => p.url().includes('flow.google.com') || p.url().includes('accounts.google.com'))
      || pages[0]
      || (await ctx.newPage());
    const targetUrl = loginUrl(FLOW_HOME, targetEmail || null);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    cachedCreditInfo = { email: null, creditsLeft: null, outOfCredit: false, updatedAt: Date.now() };
    await setWindow('normal').catch(() => {});
    return { ok: true, url: page.url(), targetEmail: targetEmail || source()?.email || null };
  } finally {
    await b.close().catch(() => {});
  }
}

/** Đọc email và số tín dụng Google Flow còn lại trên tab Flow đang mở. */
async function inspectFlowPageAccount(page, { clickMenuIfNeeded = false } = {}) {
  return page.evaluate(async (allowClick) => {
    const email = [...document.querySelectorAll('[aria-label]')]
      .map((e) => e.getAttribute('aria-label'))
      .find((t) => t && t.includes('@'))?.match(/\(([^)]+@[^)]+)\)/)?.[1] || null;
    const warnBtn = document.querySelector('button[aria-label="Cảnh báo về việc không đủ tín dụng"], button.prompt-warning-button');
    const hasWarn = Boolean(warnBtn && warnBtn.offsetParent !== null);
    let creditsLeft = null;
    const matchCredits = (txt) => {
      const m = String(txt || '').match(/(\d[\d.,]*)\s*tín dụng Google Flow/i) || String(txt || '').match(/(\d[\d.,]*)\s*Google Flow credit/i);
      return m ? Number(m[1].replace(/[.,]/g, '')) : null;
    };
    creditsLeft = matchCredits(document.body?.innerText || '');
    if (creditsLeft === null && allowClick && !document.querySelector('[role="menu"], [role="dialog"]')) {
      const accDiv = document.querySelector('[aria-label="Thông tin về tài khoản"]');
      if (accDiv) {
        accDiv.click();
        await new Promise((r) => setTimeout(r, 500));
        creditsLeft = matchCredits(document.querySelector('.cdk-overlay-container')?.innerText || document.body?.innerText || '');
        const closeAcc = document.querySelector('button[aria-label="Đóng bảng điều khiển tài khoản"]');
        if (closeAcc) closeAcc.click();
        const bd = document.querySelector('.cdk-overlay-backdrop-showing');
        if (bd) bd.click();
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return {
      email,
      creditsLeft,
      outOfCredit: hasWarn || (creditsLeft !== null && creditsLeft < 5),
    };
  }, clickMenuIfNeeded).catch(() => ({ email: null, creditsLeft: null, outOfCredit: false }));
}

/** Kiểm tra Chrome Flow đã vào được Flow chưa (không phải trang giới thiệu / trang đăng nhập Google). */
export async function checkLogin({ switchToSourceEmail = false } = {}) {
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
    const info = await inspectFlowPageAccount(page, { clickMenuIfNeeded: true });
    const email = info.email;
    const targetEmail = source()?.email;

    // Nếu người dùng vừa bấm "Chọn & mở" một profile có email khác với tài khoản đang đăng nhập trong Chrome Flow,
    // tự động chuyển sang trang chọn/đăng nhập tài khoản Google mới đó.
    if (switchToSourceEmail && targetEmail && email && email.toLowerCase() !== targetEmail.toLowerCase()) {
      await page.goto(loginUrl(FLOW_HOME, targetEmail), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await setWindow('normal').catch(() => {});
      cachedCreditInfo = { email: null, creditsLeft: null, outOfCredit: false, updatedAt: Date.now() };
      return { ok: false, url: page.url(), email: null, switchingTo: targetEmail };
    }

    const ok = /flow\.google\.com\/?($|project|\?)/.test(url) && !url.includes('/about') && !url.includes('accounts.google');
    if (!ok) {
      if (url.includes('/about')) {
        await page.goto(loginUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      await setWindow('normal').catch(() => {});
    } else {
      cachedCreditInfo = {
        email: email || cachedCreditInfo.email,
        creditsLeft: info.creditsLeft,
        outOfCredit: info.outOfCredit,
        updatedAt: Date.now(),
      };
    }
    return { ok, url: page.url(), email, creditsLeft: info.creditsLeft, outOfCredit: info.outOfCredit };
  } finally {
    await b.close().catch(() => {});
  }
}

/** Trạng thái nhanh của Chrome Flow (chỉ dùng HTTP /json/list, tuyệt đối không mở/đóng kết nối CDP phụ để tránh làm ngắt phiên Playwright khi đang render video). */
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
  const src = source();
  return {
    up,
    loggedIn,
    pageUrl,
    source: src,
    activeEmail: cachedCreditInfo.email || src?.email || null,
    creditsLeft: cachedCreditInfo.creditsLeft,
    outOfCredit: cachedCreditInfo.outOfCredit,
    profiles: listProfiles(),
    port: CDP_PORT,
  };
}


