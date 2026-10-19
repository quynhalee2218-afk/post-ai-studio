import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { pageCredentials } from './fb-auth.js';

const graph = () => `https://graph.facebook.com/${config.fbGraphVersion}`;

// Facebook có lúc trả HTTP 200 kèm khối error → luôn kiểm json.error trước, không tin res.ok.
async function call(url, { method = 'GET', params = {}, headers, body, token } = {}) {
  let res;
  if (method === 'GET') {
    const q = new URLSearchParams({ ...params, access_token: token });
    res = await fetch(`${url}?${q}`);
  } else {
    res = await fetch(url, {
      method,
      headers: headers || { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body ?? new URLSearchParams({ ...params, access_token: token }),
    });
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (json.error || !res.ok) {
    const e = json.error || {};
    const msg = e.error_user_msg || e.message || text.slice(0, 300);
    throw new Error(`Facebook lỗi${e.code ? ` ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''}` : ''}: ${msg}`);
  }
  return json;
}

export function fbConfigured() {
  return Boolean(pageCredentials());
}

function creds(pageId = null) {
  if (pageId) return pageCredentials(pageId);
  const c = pageCredentials();
  if (!c) throw new Error('Chưa chọn Page — vào tab "Tài khoản" đăng nhập Facebook và chọn Page (hoặc khai FB_PAGE_ID/FB_PAGE_TOKEN trong .env)');
  return c;
}

export async function checkPage() {
  const c = creds();
  return call(`${graph()}/${c.pageId}`, { params: { fields: 'id,name' }, token: c.token });
}

export async function videoStatus(videoId, pageId = null) {
  return call(`${graph()}/${videoId}`, { params: { fields: 'status,permalink_url,published' }, token: creds(pageId).token });
}

export async function fbVideo(pageId, videoId) {
  return call(`${graph()}/${videoId}`, {
    params: { fields: 'status,published,scheduled_publish_time,permalink_url,created_time' }, token: creds(pageId).token,
  });
}

// Đổi giờ đăng của video đang hẹn/nháp. Tài liệu Reels không mô tả bước này — dùng cập nhật Video node chung của Graph API.
export async function rescheduleVideo(pageId, videoId, ts) {
  const r = await call(`${graph()}/${videoId}`, {
    method: 'POST', params: { scheduled_publish_time: String(ts), published: 'false' }, token: creds(pageId).token,
  });
  if (r.success === false) throw new Error('Facebook không cho đổi giờ — sửa trực tiếp trong Business Suite');
  return r;
}

export async function deleteVideo(pageId, videoId) {
  const r = await call(`${graph()}/${videoId}`, { method: 'DELETE', params: {}, token: creds(pageId).token });
  if (r.success === false) throw new Error('Facebook không cho xoá video này');
  return r;
}

/** Tìm video vừa đăng bằng trình duyệt (để đưa vào sổ Lịch đăng): mới tạo sau sinceSec, mô tả khớp đầu caption. */
export async function findRecentVideo(pageId, sinceSec, caption = '') {
  const token = creds(pageId).token;
  const head = caption.replace(/\s+/g, ' ').trim().slice(0, 40);
  const fields = 'id,description,created_time,published,scheduled_publish_time,permalink_url';
  for (const edge of ['videos', 'video_reels']) {
    const r = await call(`${graph()}/${pageId}/${edge}`, { params: { fields, limit: '15' }, token }).catch(() => null);
    const hit = (r?.data || []).find((v) => Date.parse(v.created_time) / 1000 >= sinceSec - 120
      && (!head || (v.description || '').replace(/\s+/g, ' ').trim().startsWith(head)));
    if (hit) return hit;
  }
  return null;
}

/**
 * Đăng hoặc hẹn giờ bài viết kèm 1 hoặc nhiều ảnh lên Fanpage qua Facebook Graph API,
 * đồng thời hỗ trợ tự động thả chuỗi comment (dành cho dạng bài Text nền + thả comment).
 */
export async function postFeedPhotosViaGraph({ pageId = null, files = [], caption = '', comments = [], mode = 'publish', scheduledAt = null }) {
  const c = creds(pageId);
  const mediaIds = [];

  for (const filePath of files) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    const fd = new FormData();
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    fd.append('source', new Blob([buf], { type: mime }), path.basename(filePath));
    fd.append('published', 'false');
    fd.append('access_token', c.token);
    const res = await fetch(`${graph()}/${c.pageId}/photos`, { method: 'POST', body: fd });
    const json = await res.json().catch(() => ({}));
    if (json.error || !res.ok || !json.id) {
      throw new Error(`Lỗi tải ảnh lên Facebook Graph API: ${json.error?.message || res.statusText}`);
    }
    mediaIds.push(json.id);
  }

  const params = { message: caption };
  if (mediaIds.length) {
    params.attached_media = JSON.stringify(mediaIds.map((id) => ({ media_fbid: id })));
  }
  if (mode === 'publish') {
    params.published = 'true';
  } else if (mode === 'schedule') {
    params.published = 'false';
    params.scheduled_publish_time = String(scheduledAt);
    params.unpublished_content_type = 'SCHEDULED';
  } else {
    params.published = 'false';
    params.unpublished_content_type = 'DRAFT';
  }

  const postRes = await call(`${graph()}/${c.pageId}/feed`, {
    method: 'POST',
    params,
    token: c.token,
  });

  const postId = postRes.id;
  const postedComments = [];
  if (mode === 'publish' && postId && Array.isArray(comments) && comments.length) {
    for (const cmt of comments) {
      const msg = String(cmt || '').trim();
      if (!msg) continue;
      try {
        const cr = await call(`${graph()}/${postId}/comments`, {
          method: 'POST',
          params: { message: msg },
          token: c.token,
        });
        postedComments.push(cr.id);
      } catch { /* ignore comment error if post succeeded */ }
    }
  }

  return {
    ok: true,
    postId,
    pageId: c.pageId,
    pageName: c.pageName || null,
    postedComments,
    permalink: postId ? `https://www.facebook.com/${postId}` : null,
  };
}

