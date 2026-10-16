// Quản lý kho Skill AI (đồng bộ từ Claude ~/.claude/skills, tải lên .zip / .md / tài liệu tham chiếu, tạo/sửa trực tiếp)
// để model AI đọc hiểu kiến thức, trích xuất dữ liệu (nhân vật, sản phẩm, DNA, công thức) khi viết kịch bản và xử lý yêu cầu khác.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';

const skillsDir = () => path.join(config.dataDir, 'skills');
const metaFile = () => path.join(skillsDir(), '_meta.json');
const TEXT_EXT = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml', '.xml', '.html']);

function readMeta() {
  try { return JSON.parse(fs.readFileSync(metaFile(), 'utf8')); } catch { return {}; }
}
function writeMeta(m) {
  fs.mkdirSync(skillsDir(), { recursive: true });
  fs.writeFileSync(metaFile(), JSON.stringify(m, null, 2));
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `skill-${Date.now()}`;
}

/** Đọc frontmatter YAML (--- ... ---) và tiêu đề đầu tiên của SKILL.md. */
export function parseSkillMd(raw, fallbackId = '') {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  let name = fallbackId;
  let displayName = '';
  let description = '';
  let body = text;

  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fmMatch) {
    const fm = fmMatch[1];
    body = fmMatch[2];
    const lines = fm.split('\n');
    let curKey = null;
    let curVal = [];
    const commit = () => {
      if (!curKey) return;
      const v = curVal.join(' ').replace(/^['"]|['"]$/g, '').trim();
      if (curKey === 'name' && v) name = v;
      if ((curKey === 'display_name' || curKey === 'title') && v) displayName = v;
      if (curKey === 'description' && v) description = v;
    };
    for (const line of lines) {
      const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (m) {
        commit();
        curKey = m[1].toLowerCase();
        const rest = m[2].trim();
        curVal = (rest === '>' || rest === '>-' || rest === '|' || rest === '|-') ? [] : [rest];
      } else if (curKey && /^\s+\S/.test(line)) {
        curVal.push(line.trim());
      }
    }
    commit();
  }

  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
  const title = displayName || h1 || name || fallbackId;
  if (!description) {
    const firstPara = body
      .replace(/^#.*$/gm, '')
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .find((p) => p.length > 15 && !p.startsWith('---'));
    description = firstPara ? firstPara.slice(0, 300) : '';
  }

  const combined = `${fallbackId} ${name} ${title} ${description}`.toLowerCase();
  let category = 'other';
  if (/\b(veo3?|flow|video|reels?|tiktok|kịch bản|kich-ban|phân cảnh|scene|storyboard|animation)\b/i.test(combined)) {
    category = 'video';
  } else if (/\b(dna|nhân hiệu|nhan-hieu|brand|thương hiệu|chân dung|chan-dung|support|sale|telesales)\b/i.test(combined)) {
    category = 'dna';
  } else if (/\b(content|facebook|fb|social|post|copywriting|viral|seo|marketing|ads|quảng cáo|plan)\b/i.test(combined)) {
    category = 'content';
  }

  return { name, title, description, category, body };
}

/** Liệt kê toàn bộ file trong thư mục của 1 skill (SKILL.md, references/*, assets/*...). */
function listFilesInSkillDir(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listFilesInSkillDir(full, base));
    } else if (ent.isFile()) {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      const ext = path.extname(ent.name).toLowerCase();
      const st = fs.statSync(full);
      out.push({ path: rel, size: st.size, isText: TEXT_EXT.has(ext) });
    }
  }
  return out.sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)));
}

/** Danh sách toàn bộ Skill hiện có trong hệ thống (bao gồm skill gốc video-ai và các skill trong data/skills). */
export function listSkills() {
  fs.mkdirSync(skillsDir(), { recursive: true });
  const meta = readMeta();
  const out = [];

  // 1. Skill nền tảng mặc định (skill/SKILL.md)
  if (fs.existsSync(config.skillFile)) {
    const raw = fs.readFileSync(config.skillFile, 'utf8');
    const st = fs.statSync(config.skillFile);
    const parsed = parseSkillMd(raw, 'video-ai');
    out.push({
      id: 'video-ai',
      name: parsed.name || 'video-ai',
      title: parsed.title || 'Video AI (Chuẩn kỹ thuật Flow/Veo)',
      description: parsed.description,
      category: 'video',
      source: 'builtin',
      builtin: true,
      pinned: true,
      fileCount: 1,
      refCount: 0,
      size: st.size,
      updatedAt: st.mtime.toISOString(),
    });
  }

  // 2. Các skill trong data/skills/<id>
  for (const ent of fs.readdirSync(skillsDir(), { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name.startsWith('_')) continue;
    const id = ent.name;
    const dir = path.join(skillsDir(), id);
    const mdFile = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(mdFile)) continue;
    const raw = fs.readFileSync(mdFile, 'utf8');
    const st = fs.statSync(mdFile);
    const parsed = parseSkillMd(raw, id);
    const files = listFilesInSkillDir(dir);
    const m = meta[id] || {};
    out.push({
      id,
      name: parsed.name || id,
      title: parsed.title || id,
      description: parsed.description,
      category: m.category || parsed.category,
      source: m.source || 'upload',
      builtin: false,
      pinned: Boolean(m.pinned),
      fileCount: files.length,
      refCount: Math.max(0, files.length - 1),
      size: files.reduce((s, f) => s + f.size, 0),
      updatedAt: m.updatedAt || st.mtime.toISOString(),
      syncedAt: m.syncedAt || null,
    });
  }

  return out.sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const catRank = { video: 0, dna: 1, content: 2, other: 3 };
    if ((catRank[a.category] ?? 3) !== (catRank[b.category] ?? 3)) return (catRank[a.category] ?? 3) - (catRank[b.category] ?? 3);
    return a.title.localeCompare(b.title, 'vi');
  });
}

/** Chi tiết 1 skill kèm nội dung SKILL.md và danh sách các file đính kèm (references, assets...). */
export function getSkill(id) {
  if (id === 'video-ai') {
    if (!fs.existsSync(config.skillFile)) throw new Error('Không thấy file skill/SKILL.md');
    const content = fs.readFileSync(config.skillFile, 'utf8');
    const parsed = parseSkillMd(content, 'video-ai');
    return {
      id: 'video-ai',
      name: parsed.name,
      title: parsed.title,
      description: parsed.description,
      category: 'video',
      source: 'builtin',
      builtin: true,
      pinned: true,
      content,
      files: [{ path: 'SKILL.md', size: Buffer.byteLength(content, 'utf8'), isText: true }],
    };
  }
  const dir = path.join(skillsDir(), path.basename(id));
  const mdFile = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(mdFile)) throw new Error(`Không tìm thấy skill "${id}"`);
  const content = fs.readFileSync(mdFile, 'utf8');
  const parsed = parseSkillMd(content, id);
  const meta = readMeta()[id] || {};
  const files = listFilesInSkillDir(dir);
  return {
    id,
    name: parsed.name || id,
    title: parsed.title || id,
    description: parsed.description,
    category: meta.category || parsed.category,
    source: meta.source || 'upload',
    builtin: false,
    pinned: Boolean(meta.pinned),
    content,
    files,
    dir,
  };
}

/** Đọc 1 file con (vd. references/character-library.md) trong skill. */
export function readSkillFile(id, relPath) {
  if (id === 'video-ai') {
    if (relPath !== 'SKILL.md') throw new Error('Skill mặc định chỉ có SKILL.md');
    const content = fs.readFileSync(config.skillFile, 'utf8');
    return { path: 'SKILL.md', size: Buffer.byteLength(content, 'utf8'), isText: true, content };
  }
  const dir = path.resolve(skillsDir(), path.basename(id));
  const target = path.resolve(dir, String(relPath || 'SKILL.md'));
  if (!target.startsWith(dir + path.sep) && target !== path.join(dir, 'SKILL.md')) throw new Error('Đường dẫn file không hợp lệ');
  if (!fs.existsSync(target)) throw new Error('Không tìm thấy file này trong skill');
  const st = fs.statSync(target);
  const ext = path.extname(target).toLowerCase();
  if (!TEXT_EXT.has(ext)) {
    return { path: relPath, size: st.size, isText: false, content: '' };
  }
  return { path: relPath, size: st.size, isText: true, content: fs.readFileSync(target, 'utf8') };
}

/** Lưu / cập nhật nội dung file trong skill. */
export function writeSkillFile(id, relPath, content) {
  if (id === 'video-ai') {
    if (relPath !== 'SKILL.md') throw new Error('Skill mặc định chỉ sửa được SKILL.md');
    fs.writeFileSync(config.skillFile, String(content ?? ''), 'utf8');
    return getSkill('video-ai');
  }
  const safeId = path.basename(id);
  const dir = path.resolve(skillsDir(), safeId);
  const cleanRel = String(relPath || 'SKILL.md').replace(/^[/\\]+/, '');
  const target = path.resolve(dir, cleanRel);
  if (!target.startsWith(dir + path.sep)) throw new Error('Đường dẫn file không hợp lệ');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(content ?? ''), 'utf8');
  const meta = readMeta();
  meta[safeId] = { ...(meta[safeId] || {}), updatedAt: new Date().toISOString() };
  writeMeta(meta);
  return getSkill(safeId);
}

/** Xoá 1 file phụ trong skill (không xoá SKILL.md). */
export function deleteSkillFile(id, relPath) {
  const safeId = path.basename(id);
  const dir = path.resolve(skillsDir(), safeId);
  const cleanRel = String(relPath || '').replace(/^[/\\]+/, '');
  if (!cleanRel || cleanRel === 'SKILL.md') throw new Error('Không thể xoá file SKILL.md chính');
  const target = path.resolve(dir, cleanRel);
  if (!target.startsWith(dir + path.sep)) throw new Error('Đường dẫn file không hợp lệ');
  fs.rmSync(target, { force: true });
  return getSkill(safeId);
}

/** Tạo mới hoặc cập nhật thông tin/nội dung của 1 skill. */
export function saveSkill({ id, name, description = '', content = '', pinned = undefined, source = 'upload' }) {
  if (id === 'video-ai') {
    if (content) fs.writeFileSync(config.skillFile, String(content), 'utf8');
    return getSkill('video-ai');
  }
  const slug = slugify(id || name);
  const dir = path.join(skillsDir(), slug);
  fs.mkdirSync(dir, { recursive: true });
  const mdFile = path.join(dir, 'SKILL.md');

  let finalContent = String(content || '').trim();
  if (!finalContent && fs.existsSync(mdFile)) {
    finalContent = fs.readFileSync(mdFile, 'utf8');
  }
  if (!finalContent.startsWith('---')) {
    const title = name || slug;
    finalContent = `---\nname: ${slug}\ndisplay_name: ${title}\ndescription: >-\n  ${(description || title).replace(/\n+/g, ' ')}\n---\n\n${finalContent || `# ${title}\n\n${description}\n`}`;
  }
  fs.writeFileSync(mdFile, finalContent, 'utf8');

  const meta = readMeta();
  const prev = meta[slug] || {};
  meta[slug] = {
    ...prev,
    source: prev.source || source,
    pinned: pinned !== undefined ? Boolean(pinned) : Boolean(prev.pinned),
    updatedAt: new Date().toISOString(),
  };
  writeMeta(meta);
  return getSkill(slug);
}

/** Bật/tắt ghim mặc định hoặc đổi phân loại skill. */
export function patchSkillMeta(id, patch = {}) {
  if (id === 'video-ai') return getSkill('video-ai');
  const safeId = path.basename(id);
  const dir = path.join(skillsDir(), safeId);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error('Không tìm thấy skill');
  const meta = readMeta();
  const cur = meta[safeId] || {};
  if (patch.pinned !== undefined) cur.pinned = Boolean(patch.pinned);
  if (patch.category) cur.category = patch.category;
  cur.updatedAt = new Date().toISOString();
  meta[safeId] = cur;
  writeMeta(meta);
  return getSkill(safeId);
}

export function deleteSkill(id) {
  if (id === 'video-ai') throw new Error('Không thể xoá skill nền tảng mặc định của hệ thống');
  const safeId = path.basename(id);
  const dir = path.join(skillsDir(), safeId);
  fs.rmSync(dir, { recursive: true, force: true });
  const meta = readMeta();
  delete meta[safeId];
  writeMeta(meta);
  return { ok: true };
}

// ---------- Đồng bộ từ Claude (~/.claude/skills, ~/.claude/plugins, data/claude/*) ----------

/** Tìm mọi thư mục chứa SKILL.md trong các thư mục cấu hình của Claude trên máy. */
function discoverClaudeSkillDirs() {
  const roots = [
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(os.homedir(), '.claude', 'plugins', 'synced'),
  ];
  if (process.env.CLAUDE_CONFIG_DIR) {
    roots.push(path.join(process.env.CLAUDE_CONFIG_DIR, 'skills'));
  }
  const webClaudeDir = path.join(config.dataDir, 'claude');
  if (fs.existsSync(webClaudeDir)) {
    for (const d of fs.readdirSync(webClaudeDir, { withFileTypes: true })) {
      if (d.isDirectory()) {
        roots.push(path.join(webClaudeDir, d.name, 'skills'));
        roots.push(path.join(webClaudeDir, d.name, 'plugins', 'synced'));
      }
    }
  }

  const found = new Map(); // slug -> { dir, mtimeMs, origin }
  const walk = (dir, depth = 0) => {
    if (depth > 4 || !fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const hasSkillMd = entries.some((e) => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      const slug = slugify(path.basename(dir));
      if (slug && slug !== 'video-ai') {
        const st = fs.statSync(path.join(dir, 'SKILL.md'));
        const prev = found.get(slug);
        if (!prev || st.mtimeMs >= prev.mtimeMs) {
          found.set(slug, { slug, dir, mtimeMs: st.mtimeMs });
        }
      }
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue; // bỏ qua .trash, .staging
      walk(path.join(dir, e.name), depth + 1);
    }
  };

  for (const r of roots) walk(r, 0);
  return [...found.values()];
}

/** Đồng bộ toàn bộ skill từ Claude sang data/skills/. */
export function syncFromClaude() {
  fs.mkdirSync(skillsDir(), { recursive: true });
  const discovered = discoverClaudeSkillDirs();
  const meta = readMeta();
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  for (const item of discovered) {
    const dest = path.join(skillsDir(), item.slug);
    const existed = fs.existsSync(path.join(dest, 'SKILL.md'));
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(item.dir, dest, {
      recursive: true,
      force: true,
      filter: (src) => !path.basename(src).startsWith('.'),
    });
    const prev = meta[item.slug] || {};
    meta[item.slug] = {
      ...prev,
      source: 'claude',
      pinned: Boolean(prev.pinned),
      syncedAt: now,
      updatedAt: new Date(item.mtimeMs).toISOString(),
    };
    if (existed) updated++;
    else added++;
  }
  writeMeta(meta);
  return { total: discovered.length, added, updated, skills: listSkills() };
}

/** Khởi tạo kho skill khi bật server: nếu chưa có skill nào trong data/skills thì tự đồng bộ từ Claude 1 lần. */
export function initSkills() {
  try {
    fs.mkdirSync(skillsDir(), { recursive: true });
    const hasAny = fs.readdirSync(skillsDir(), { withFileTypes: true }).some((e) => e.isDirectory() && !e.name.startsWith('.'));
    if (!hasAny) syncFromClaude();
  } catch { /* bỏ qua nếu chưa có ~/.claude */ }
}

// ---------- Giải nén .zip hoặc nhận nhiều file tải lên ----------

function extractZip(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    const p = process.platform === 'win32'
      ? spawn('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`], { stdio: 'ignore', windowsHide: true })
      : spawn('unzip', ['-oq', zipPath, '-d', outDir], { stdio: 'ignore' });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Không giải nén được file .zip'))));
    p.on('error', reject);
  });
}

/** Nhận các file người dùng tải lên (.zip chứa 1 hoặc nhiều skill, hoặc các file .md/.txt/.pdf/.csv/.json...). */
export async function importUploadedFiles({ files = [], targetSkillId = '', name = '', description = '' }) {
  if (!files.length) throw new Error('Chưa chọn file để tải lên');
  const meta = readMeta();
  const imported = [];

  try {
    // Trường hợp 1: Gắn thêm file tham chiếu vào 1 skill đã có
    if (targetSkillId) {
      const safeId = slugify(targetSkillId);
      const destDir = path.join(skillsDir(), safeId);
      if (!fs.existsSync(destDir)) throw new Error(`Không tìm thấy skill "${safeId}"`);
      for (const f of files) {
        const orig = Buffer.from(f.originalname, 'latin1').toString('utf8');
        if (/\.zip$/i.test(orig)) {
          const tmp = path.join(config.dataDir, 'uploads', `unzip-${Date.now()}`);
          fs.mkdirSync(tmp, { recursive: true });
          await extractZip(f.path, tmp);
          fs.cpSync(tmp, destDir, { recursive: true, force: true });
          fs.rmSync(tmp, { recursive: true, force: true });
        } else if (orig.toUpperCase() === 'SKILL.MD') {
          fs.copyFileSync(f.path, path.join(destDir, 'SKILL.md'));
        } else {
          const refDir = path.join(destDir, 'references');
          fs.mkdirSync(refDir, { recursive: true });
          fs.copyFileSync(f.path, path.join(refDir, path.basename(orig)));
        }
      }
      meta[safeId] = { ...(meta[safeId] || {}), updatedAt: new Date().toISOString() };
      writeMeta(meta);
      return { imported: [safeId], skill: getSkill(safeId) };
    }

    // Trường hợp 2: Có file .zip → giải nén và tìm mọi thư mục có SKILL.md bên trong
    const zips = files.filter((f) => /\.zip$/i.test(f.originalname));
    const others = files.filter((f) => !/\.zip$/i.test(f.originalname));

    for (const z of zips) {
      const tmp = path.join(config.dataDir, 'uploads', `unzip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      fs.mkdirSync(tmp, { recursive: true });
      try {
        await extractZip(z.path, tmp);
        const foundDirs = [];
        const scan = (d, depth = 0) => {
          if (depth > 4) return;
          const ents = fs.readdirSync(d, { withFileTypes: true });
          if (ents.some((e) => e.isFile() && e.name.toUpperCase() === 'SKILL.MD')) {
            foundDirs.push(d);
            return;
          }
          for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX') scan(path.join(d, e.name), depth + 1);
        };
        scan(tmp, 0);

        if (foundDirs.length) {
          for (const sd of foundDirs) {
            const rawMd = fs.readFileSync(path.join(sd, 'SKILL.md'), 'utf8');
            const parsed = parseSkillMd(rawMd, path.basename(sd) === path.basename(tmp) ? (name || path.basename(z.originalname, '.zip')) : path.basename(sd));
            const slug = slugify(parsed.name || path.basename(sd));
            const dest = path.join(skillsDir(), slug);
            fs.mkdirSync(dest, { recursive: true });
            fs.cpSync(sd, dest, { recursive: true, force: true });
            meta[slug] = { ...(meta[slug] || {}), source: 'upload', updatedAt: new Date().toISOString() };
            imported.push(slug);
          }
        } else {
          // Zip không có SKILL.md → tạo skill từ tên zip và đưa các file vào references/
          const slug = slugify(name || path.basename(z.originalname, '.zip'));
          const dest = path.join(skillsDir(), slug);
          const refDir = path.join(dest, 'references');
          fs.mkdirSync(refDir, { recursive: true });
          fs.cpSync(tmp, refDir, { recursive: true, force: true });
          saveSkill({ id: slug, name: name || slug, description: description || `Tài liệu tải lên từ ${z.originalname}` });
          imported.push(slug);
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }

    // Trường hợp 3: Tải lên 1 hoặc nhiều file lẻ (.md, .txt, .pdf, .csv...)
    if (others.length) {
      const mdIdx = others.findIndex((f) => f.originalname.toUpperCase() === 'SKILL.MD') >= 0
        ? others.findIndex((f) => f.originalname.toUpperCase() === 'SKILL.MD')
        : others.findIndex((f) => /\.md$/i.test(f.originalname));
      const mainFile = mdIdx >= 0 ? others[mdIdx] : null;
      const mainRaw = mainFile ? fs.readFileSync(mainFile.path, 'utf8') : '';
      const fallbackTitle = name || (mainFile ? path.basename(Buffer.from(mainFile.originalname, 'latin1').toString('utf8'), path.extname(mainFile.originalname)) : 'skill-moi');
      const parsed = parseSkillMd(mainRaw, fallbackTitle);
      const slug = slugify(name || parsed.name || fallbackTitle);
      const dest = path.join(skillsDir(), slug);
      fs.mkdirSync(dest, { recursive: true });

      if (mainFile) {
        saveSkill({ id: slug, name: name || parsed.title || slug, description: description || parsed.description, content: mainRaw, source: 'upload' });
      } else {
        saveSkill({ id: slug, name: name || slug, description: description || 'Skill tạo từ tài liệu tải lên', source: 'upload' });
      }

      for (let i = 0; i < others.length; i++) {
        if (i === mdIdx) continue;
        const orig = path.basename(Buffer.from(others[i].originalname, 'latin1').toString('utf8'));
        const refDir = path.join(dest, 'references');
        fs.mkdirSync(refDir, { recursive: true });
        fs.copyFileSync(others[i].path, path.join(refDir, orig));
      }
      meta[slug] = { ...(meta[slug] || {}), source: 'upload', updatedAt: new Date().toISOString() };
      imported.push(slug);
    }

    writeMeta(meta);
    return { imported, skills: listSkills() };
  } finally {
    for (const f of files) fs.rmSync(f.path, { force: true });
  }
}

// ---------- Agent tự động nhận biết & chọn Skill tác vụ theo dữ liệu người dùng ----------

const STOPWORDS_FOLD = new Set([
  'toi', 'muon', 'lam', 'viet', 'cho', 'mot', 'cac', 'cua', 'va', 'la', 've', 'co', 'nhung', 'trong', 'theo', 'voi',
  'nay', 'khi', 'de', 'hay', 'giup', 'tao', 'noi', 'dung', 'chu', 'de', 'san', 'pham', 'dich', 'vu', 'nguoi', 'xem',
  'khach', 'hang', 'video', 'kich', 'ban', 'canh', 'phan', 'flow', 'veo', 'veo3', 'ai', 'skill', 'prompt', 'google',
  'claude', ' reel', 'reels', 'tiktok', 'facebook', 'bai', 'dang', 'post', 'anh', 'chi', 'em', 'ban', 'minh', 'chung',
  'ta', 'nhu', 'the', 'nao', 'sao', 'gi', 'dau', 'day', 'do', 'kia', 'nhe', 'nha', 'luon', 'ngay', 'rat', 'hon', 'nhat',
  'duoc', 'khong', 'chua', 'da', 'dang', 'se', 'can', 'phai', 'nen', 'tu', 'den', 'tren', 'duoi', 'qua', 'lai', 'ra',
  'vao', 'len', 'xuong', 'cung', 'nhieu', 'it', 'moi', 'cu', 'tot', 'hay', 'dep', 'chuan', 'chi', 'tiet', 'day', 'du',
  'use', 'when', 'user', 'asks', 'for', 'the', 'and', 'with', 'from', 'this', 'that', 'create', 'make', 'build', 'guide',
]);

function foldText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normVi(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"'`~@#$%^&*+=<>|\\/\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trích các cụm từ khóa đặc trưng (nhân vật, thương hiệu, trigger trong ngoặc kép, tiêu đề) từ 1 skill. */
function extractSkillTriggers(sk, rawContent = '') {
  const phrases = new Set();
  const titleClean = sk.title.replace(/\([^)]*\)/g, '').trim();
  if (titleClean.length >= 4) phrases.add(foldText(titleClean));

  // Các cụm nằm trong ngoặc đơn của tiêu đề, vd: (Series Chị Giang)
  for (const m of sk.title.matchAll(/\(([^)]+)\)/g)) {
    const p = foldText(m[1].replace(/^(series|kịch bản|skill|nhân vật)\s+/i, ''));
    if (p.length >= 4) phrases.add(p);
  }

  // Cụm từ nằm trong dấu ngoặc kép "..." của description hoặc 1500 ký tự đầu SKILL.md
  const sample = `${sk.description}\n${rawContent.slice(0, 1800)}`;
  for (const m of sample.matchAll(/["“”'‘’]([^"“”'‘’\n]{3,45})["“”'‘’]/g)) {
    const p = foldText(m[1]);
    if (p.length >= 4 && p.split(' ').length <= 6 && !STOPWORDS_FOLD.has(p)) {
      phrases.add(p);
    }
  }

  // Cụm từ có nghĩa từ slug id (bỏ các hậu tố chung như veo3, skill, ai, video, script)
  const slugParts = sk.id.split('-').filter((w) => w.length >= 2 && !['veo3', 'veo', 'skill', 'ai', 'video', 'script', 'generator', 'writer', 'planner', 'pro', 'v2'].includes(w));
  if (slugParts.length >= 2) phrases.add(slugParts.join(' '));

  return [...phrases].filter((p) => p.length >= 3);
}

/**
 * Tự động phân tích dữ liệu đầu vào của người dùng (chủ đề, nhân vật, đối tượng, lời dặn, hoặc yêu cầu tự do)
 * và chấm điểm mức độ phù hợp với từng Skill trong kho.
 */
export function detectSkillsForInput(userInput = {}, { limit = 5, taskType = 'any', excludeIds = [] } = {}) {
  const isViralMode = taskType === 'viral' || (typeof userInput === 'object' && userInput?.videoType === 'viral');
  const viralFormat = typeof userInput === 'object' ? (userInput?.viralFormat || '') : '';
  const rawInput = typeof userInput === 'string'
    ? userInput
    : [
        userInput.topic,
        userInput.character,
        userInput.audience,
        userInput.mustSay,
        userInput.tone,
        userInput.cta,
        userInput.prompt,
      ].filter(Boolean).join(' \n ');

  const textVi = normVi(rawInput);
  const textFold = foldText(rawInput);
  if (textFold.length < 2 && !isViralMode) return [];

  const userTokens = textFold.split(' ').filter((w) => w.length >= 2 && !STOPWORDS_FOLD.has(w));
  const userTokenSet = new Set(userTokens);

  // Tạo tập 2-gram và 3-gram từ dữ liệu người dùng để bắt cụm từ chính xác (vd: "tra an nhien", "yen mach", "tho trang", "dao thi lan")
  const userBigrams = new Set();
  const userTrigrams = new Set();
  const allWords = textFold.split(' ').filter(Boolean);
  for (let i = 0; i < allWords.length - 1; i++) {
    const bg = `${allWords[i]} ${allWords[i + 1]}`;
    if (!STOPWORDS_FOLD.has(allWords[i]) || !STOPWORDS_FOLD.has(allWords[i + 1])) userBigrams.add(bg);
    if (i < allWords.length - 2) userTrigrams.add(`${allWords[i]} ${allWords[i + 1]} ${allWords[i + 2]}`);
  }

  // Nhận diện ý định tác vụ từ câu lệnh người dùng
  const wantsViral = isViralMode || /\b(viral|keo traffic|traffic|xu huong|trieu view|tang tuong tac|tiep can khach|xay kenh)\b/.test(textFold);
  const wantsVideo = taskType === 'video' || isViralMode || /\b(veo3?|flow|video|canh|phan canh|kich ban|reel|tiktok|quay|hoat hinh|animation|3d|storyboard)\b/.test(textFold);
  const wantsDna = /\b(dna|nhan hieu|thuong hieu|chan dung|ho so|phong cach ca nhan|giong van)\b/.test(textFold);
  const wantsScore = /\b(cham diem|danh gia|score|audit|kiem tra bai)\b/.test(textFold);
  const wantsPlan = /\b(ke hoach|lich dang|content plan|chien luoc|lap ke hoach)\b/.test(textFold);
  const wantsSales = /\b(sale|telesale|chot don|tu van|tin nhan|kich ban goi|khach hang)\b/.test(textFold);

  const VIRAL_CORE_SKILLS = {
    'facebook-viral-script-factory': { bonus: 34, label: 'Công thức kịch bản Viral Facebook & giữ chân người xem' },
    'fb-reels-topic-generator': { bonus: 28, label: '5 nhóm chủ đề & Hook Viral Facebook Reels kéo tương tác' },
    'traffic-content-planner': { bonus: 27, label: 'Chiến lược nội dung kéo Traffic tự nhiên & SEO Social' },
    'viral-ai-script': { bonus: 26, label: 'Cấu trúc kịch bản Video AI Viral giữ chân 100% thời lượng' },
    'hook-3-kenh-ai': { bonus: 25, label: 'Công thức Hook 3 giây đầu chặn ngón tay lướt' },
    'kich-ban-dao-ly-veo3': { bonus: viralFormat === 'philosophy' ? 42 : 24, label: 'Kịch bản góc nhìn / đạo lý đời sống chạm cảm xúc chia sẻ cao' },
  };

  const exclude = new Set(['video-ai', ...(Array.isArray(excludeIds) ? excludeIds : [])]);
  const all = listSkills().filter((s) => !exclude.has(s.id) && !s.builtin);
  const scored = [];

  for (const sk of all) {
    let rawMd = '';
    try {
      rawMd = fs.readFileSync(path.join(skillsDir(), sk.id, 'SKILL.md'), 'utf8').slice(0, 2000);
    } catch { /* ignore */ }

    const idFold = sk.id.replace(/-/g, ' ');
    const titleFold = foldText(sk.title);
    const descFold = foldText(sk.description);
    const bodyFold = foldText(rawMd.replace(/^---[\s\S]*?---/, '').slice(0, 1200));

    let score = 0;
    const matchedReasons = [];

    // 1. Khớp trực tiếp mã skill hoặc cụm tên skill trong câu người dùng
    if (idFold.length >= 4 && textFold.includes(idFold)) {
      score += 65;
      matchedReasons.push(`mã "${sk.id}"`);
    }

    // 2. Khớp các cụm từ khóa đặc trưng (triggers / tên nhân vật / tên series / thương hiệu)
    const triggers = extractSkillTriggers(sk, rawMd);
    for (const trig of triggers) {
      if (trig.length >= 4 && textFold.includes(trig)) {
        const wordsCount = trig.split(' ').length;
        score += wordsCount >= 2 ? 48 : 28;
        if (matchedReasons.length < 3) matchedReasons.push(`"${trig}"`);
      }
    }

    // 3. Khớp cụm 3 từ (trigram) và 2 từ (bigram) giữa dữ liệu người dùng và Tiêu đề / Mô tả Skill
    for (const tg of userTrigrams) {
      if (tg.length < 7) continue;
      if (titleFold.includes(tg) || idFold.includes(tg)) {
        score += 36;
        if (matchedReasons.length < 3 && !matchedReasons.some((r) => r.includes(tg))) matchedReasons.push(`"${tg}"`);
      } else if (descFold.includes(tg)) {
        score += 22;
        if (matchedReasons.length < 3 && !matchedReasons.some((r) => r.includes(tg))) matchedReasons.push(`"${tg}"`);
      } else if (bodyFold.includes(tg)) {
        score += 12;
      }
    }

    for (const bg of userBigrams) {
      if (bg.length < 5) continue;
      const [w1, w2] = bg.split(' ');
      if (STOPWORDS_FOLD.has(w1) && STOPWORDS_FOLD.has(w2)) continue;
      if (titleFold.includes(bg) || idFold.includes(bg)) {
        score += 24;
        if (matchedReasons.length < 3 && !matchedReasons.some((r) => r.includes(bg))) matchedReasons.push(`"${bg}"`);
      } else if (descFold.includes(bg)) {
        score += 14;
        if (matchedReasons.length < 3 && !matchedReasons.some((r) => r.includes(bg))) matchedReasons.push(`"${bg}"`);
      } else if (bodyFold.includes(bg)) {
        score += 6;
      }
    }

    // 4. Khớp từng từ khóa đơn đặc trưng (tokens)
    const titleTokens = new Set(`${idFold} ${titleFold}`.split(' ').filter((w) => w.length >= 3 && !STOPWORDS_FOLD.has(w)));
    const descTokens = new Set(descFold.split(' ').filter((w) => w.length >= 3 && !STOPWORDS_FOLD.has(w)));
    const bodyTokens = new Set(bodyFold.split(' ').filter((w) => w.length >= 3 && !STOPWORDS_FOLD.has(w)));

    let tokenHits = 0;
    for (const tok of userTokenSet) {
      if (tok.length < 3) continue;
      if (titleTokens.has(tok)) {
        score += 11;
        tokenHits++;
        if (matchedReasons.length < 3 && !matchedReasons.some((r) => r.includes(tok))) matchedReasons.push(`từ khóa "${tok}"`);
      } else if (descTokens.has(tok)) {
        score += 5;
        tokenHits++;
      } else if (bodyTokens.has(tok)) {
        score += 2;
      }
    }

    // 5. Cộng điểm thưởng nếu đúng nhóm tác vụ người dùng đang làm
    if (score >= 10) {
      if (wantsVideo && sk.category === 'video') score += 10;
      if (wantsDna && sk.category === 'dna') score += 10;
      if (wantsScore && /scorer|audit|cham-diem/.test(sk.id)) score += 18;
      if (wantsPlan && /plan|planner|lich|calendar/.test(sk.id)) score += 15;
      if (wantsSales && /sale|sales|agent|closer|tu-van/.test(sk.id)) score += 15;
      if (tokenHits >= 3) score += 8;
    }

    // 6. Chế độ Video Viral Kéo Traffic Fanpage: ưu tiên kết hợp Skill Viral/Traffic + Skill ngành/nhân vật
    if (wantsViral && VIRAL_CORE_SKILLS[sk.id]) {
      score += VIRAL_CORE_SKILLS[sk.id].bonus;
      if (!matchedReasons.length) matchedReasons.push(VIRAL_CORE_SKILLS[sk.id].label);
    }

    if (score >= 22) {
      scored.push({
        id: sk.id,
        name: sk.name,
        title: sk.title,
        description: sk.description,
        category: sk.category,
        fileCount: sk.fileCount,
        score,
        reason: matchedReasons.length
          ? `Khớp dữ liệu: ${matchedReasons.slice(0, 3).join(', ')}`
          : 'Khớp ngữ cảnh chủ đề & tác vụ',
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0]?.score || 0;
  const filtered = scored.filter((item, idx) => idx === 0 || item.score >= Math.max(25, topScore * 0.32));
  return filtered.slice(0, limit);
}

/** Bản tóm tắt danh mục toàn bộ Skill trong kho để AI Agent đọc và chọn Skill khi dữ liệu mang tính ngữ nghĩa phức tạp. */
export function buildSkillCatalogSummary() {
  const all = listSkills().filter((s) => !s.builtin);
  return all.map((s) => `- id: "${s.id}" | tên: "${s.title}" | nhóm: ${s.category} | mô tả: ${(s.description || '').slice(0, 180)}`).join('\n');
}

/**
 * Tự động kết hợp Skill do người dùng chọn thủ công + Skill ghim + Skill do Agent tự động nhận diện từ dữ liệu.
 * Nếu người dùng bật autoDetect (mặc định = true), Agent sẽ tự động chọn tối đa maxAuto Skill phù hợp nhất.
 */
export function resolveSkillsForTask({ skillIds = [], userInput = {}, autoDetect = true, taskType = 'any', maxAuto = 2 } = {}) {
  const manualIds = (Array.isArray(skillIds) ? skillIds : [skillIds]).filter((x) => x && x !== 'video-ai');
  const detected = autoDetect
    ? detectSkillsForInput(userInput, { limit: 4, taskType, excludeIds: manualIds })
    : [];

  // Nếu người dùng chưa chọn skill nào → lấy tối đa maxAuto skill có điểm >= 24.
  // Nếu người dùng đã chọn 1 skill (vd: chỉ mới chọn DNA hoặc chỉ mới chọn 1 skill), vẫn cho phép Agent bổ sung 1 skill có độ khớp rất cao (>= 45).
  const autoPicked = [];
  for (const d of detected) {
    const threshold = manualIds.length === 0 ? 24 : 45;
    if (d.score >= threshold && autoPicked.length < maxAuto) {
      autoPicked.push(d);
    }
  }

  const combinedIds = [...new Set([...manualIds, ...autoPicked.map((d) => d.id)])];
  return {
    combinedIds,
    manualIds,
    autoDetected: autoPicked,
    candidates: detected,
  };
}

// ---------- Xây dựng ngữ cảnh Skill cho Model AI (đọc hiểu SKILL.md + references/*) ----------

const MAX_INLINE_PER_SKILL = 55000; // ~14k token mỗi skill, nạp thẳng để AI hiểu tức thì cả SKILL.md lẫn references/

/**
 * Chuẩn bị khối kiến thức đầy đủ từ các skill được chọn (kèm các skill đang ghim mặc định nếu includePinned = true).
 * Trả về { block, selectedIds, skillTitles, usedSkillObjects, needsReadTool }.
 */
export function buildSkillPromptBlock(skillIds = [], { includePinned = true, autoDetected = [] } = {}) {
  const all = listSkills();
  const autoMap = new Map((autoDetected || []).map((d) => [d.id, d]));
  const wanted = new Set((Array.isArray(skillIds) ? skillIds : [skillIds]).filter((x) => x && x !== 'video-ai'));
  for (const d of autoDetected || []) if (d?.id && d.id !== 'video-ai') wanted.add(d.id);
  if (includePinned) {
    for (const s of all) if (s.pinned && !s.builtin) wanted.add(s.id);
  }
  if (!wanted.size) return { block: '', selectedIds: [], skillTitles: [], usedSkillObjects: [], needsReadTool: false };

  const sections = [];
  const selectedIds = [];
  const skillTitles = [];
  const usedSkillObjects = [];
  let needsReadTool = false;

  for (const id of wanted) {
    let sk;
    try { sk = getSkill(id); } catch { continue; }
    const autoInfo = autoMap.get(sk.id);
    selectedIds.push(sk.id);
    skillTitles.push(sk.title);
    usedSkillObjects.push({
      id: sk.id,
      name: sk.title,
      title: sk.title,
      auto: Boolean(autoInfo),
      reason: autoInfo?.reason || (sk.pinned ? 'Skill đã ghim mặc định' : 'Người dùng chọn'),
    });

    let usedChars = 0;
    const parts = [
      `### SKILL: ${sk.title} (id: ${sk.id})${autoInfo ? ` — [Agent tự động nhận diện: ${autoInfo.reason}]` : ''}`,
      `Thư mục gốc của skill: ${sk.dir}`,
      `--- NỘI DUNG SKILL.md ---`,
      sk.content.slice(0, MAX_INLINE_PER_SKILL),
    ];
    usedChars += sk.content.length;

    const extraFiles = sk.files.filter((f) => f.path !== 'SKILL.md');
    const binaryOrTruncated = [];
    for (const f of extraFiles) {
      const fullPath = path.join(sk.dir, f.path);
      if (f.isText && usedChars < MAX_INLINE_PER_SKILL) {
        try {
          const txt = fs.readFileSync(fullPath, 'utf8');
          const remain = MAX_INLINE_PER_SKILL - usedChars;
          if (txt.length <= remain) {
            parts.push(`\n--- TÀI LIỆU THAM CHIẾU ĐÍNH KÈM (${f.path}) ---\n${txt}`);
            usedChars += txt.length;
          } else {
            parts.push(`\n--- TÀI LIỆU THAM CHIẾU ĐÍNH KÈM (${f.path} — trích ${remain} ký tự đầu, đọc đầy đủ tại: ${fullPath}) ---\n${txt.slice(0, remain)}`);
            usedChars = MAX_INLINE_PER_SKILL;
            needsReadTool = true;
          }
        } catch {
          binaryOrTruncated.push(fullPath);
        }
      } else {
        binaryOrTruncated.push(fullPath);
        needsReadTool = true;
      }
    }
    if (binaryOrTruncated.length) {
      parts.push(`\nCác file dữ liệu/tài liệu bổ sung của skill (dùng công cụ Read để đọc khi cần trích xuất chi tiết):\n` + binaryOrTruncated.map((p) => `- ${p}`).join('\n'));
    }
    sections.push(parts.join('\n'));
  }

  if (!sections.length) return { block: '', selectedIds: [], skillTitles: [], usedSkillObjects: [], needsReadTool: false };

  const block = [
    '',
    '================================================================================',
    `BỘ SKILL KIẾN THỨC & TÁC VỤ ĐƯỢC AGENT ÁP DỤNG (${skillTitles.join(' + ')}):`,
    'BẮT BUỘC đọc hiểu và trích xuất dữ liệu từ (các) Skill dưới đây làm nguồn kiến thức chính:',
    '1. Trích xuất đúng Nhân vật cố định (Character DNA, ngoại hình, trang phục, bối cảnh), Tông giọng, Đối tượng người xem, Công thức Hook / Cấu trúc kịch bản, và Dữ liệu sản phẩm / thương hiệu / chính sách trong Skill + các file references.',
    '2. Nếu người dùng chưa điền chi tiết Nhân vật / Tông giọng / Thông tin bắt buộc trên form, hãy TỰ ĐỘNG lấy theo chuẩn của Skill.',
    '3. Lưu ý kỹ thuật khi xuất kịch bản video cho Post AI Studio: Dù Skill gốc có thể hướng dẫn xuất văn bản tự do hoặc nhiều kịch bản nháp, ở đây bạn PHẢI chuyển hoá toàn bộ tinh hoa nội dung của Skill thành ĐÚNG 1 kịch bản hoàn chỉnh theo JSON Schema của hệ thống (gồm summary, continuityMap, scenes 8 giây/cảnh kèm prompt tiếng Anh cho Google Flow/Veo và dialogue tiếng Việt, caption).',
    '================================================================================',
    '',
    sections.join('\n\n--------------------------------------------------------------------------------\n\n'),
    '================================================================================',
  ].join('\n');

  return { block, selectedIds, skillTitles, usedSkillObjects, needsReadTool };
}

