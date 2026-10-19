import fs from 'node:fs/promises';
import { config } from './config.js';
import path from 'node:path';
import { run, tail } from './proc.js';
import { renderPngs } from './overlays.js';

async function ff(args, { onLine } = {}) {
  const res = await run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { onLine });
  if (res.code !== 0) throw new Error(`ffmpeg lỗi: ${tail(res.stderr, 800)}`);
}

export async function probe(file) {
  const res = await run(config.ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', file,
  ]);
  if (res.code !== 0) throw new Error(`ffprobe lỗi: ${tail(res.stderr, 400)}`);
  const j = JSON.parse(res.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const rawDur = Number(j.format?.duration) || Number(v?.duration) || 8;
  return {
    duration: Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 8,
    width: v?.width || 720,
    height: v?.height || 1280,
    hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

// Flow trả HTTP 502 nếu ảnh ref là PNG còn metadata → luôn đổi sang JPG sạch.
export async function toCleanJpg(input, output) {
  await ff(['-i', input, '-vf', "scale='min(1536,iw)':-2", '-q:v', '2', '-map_metadata', '-1', output]);
}

// Khung hình cuối của clip, dùng làm khung đầu cảnh sau.
// Có clip tua -0.1s rơi qua khung giải mã được cuối cùng (ffmpeg thoát 0 mà không ghi ảnh) → lùi 1s, ghi đè đến khung cuối.
export async function lastFrame(clip, output) {
  await fs.rm(output, { force: true });
  await ff(['-sseof', '-0.1', '-i', clip, '-frames:v', '1', '-q:v', '2', '-map_metadata', '-1', output]).catch(() => {});
  if (!(await fs.access(output).then(() => true, () => false))) {
    await ff(['-sseof', '-1', '-i', clip, '-update', '1', '-q:v', '2', '-map_metadata', '-1', output]);
  }
  await fs.access(output);
}

// Watermark "Veo" nằm góc dưới phải; toạ độ đo trên clip 720x1280, quy ra tỉ lệ để dùng cho mọi độ phân giải.
function delogoFor(w, h) {
  const W = Math.max(64, Number(w) || 720);
  const H = Math.max(64, Number(h) || 1280);
  const x = Math.min(W - 6, Math.max(2, Math.round(W * 0.9333)));
  const y = Math.min(H - 6, Math.max(2, Math.round(H * 0.9703)));
  const dw = Math.max(2, Math.min(Math.round(W * 0.0611), W - x - 2));
  const dh = Math.max(2, Math.min(Math.round(H * 0.0234), H - y - 2));
  return `delogo=x=${x}:y=${y}:w=${dw}:h=${dh}`;
}

// Ghép các cảnh thành 1 video Reel: cắt đầu/cuối theo từng cảnh, xoá watermark, 1080x1920, 30fps, AAC 48kHz.
export async function stitch(scenes, output, { removeWatermark = true, textStyle = 'brand', overlayDir = null, onProgress = null } = {}) {
  const inputs = [];
  const filters = [];
  const pairs = [];
  let nInputs = 0;
  let total = 0;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const info = await probe(s.clip);
    const dur = Number.isFinite(info.duration) && info.duration > 0 ? info.duration : 8;
    const start = Math.min(Math.max(0, Number(s.trimStart) || 0), Math.max(0, dur - 0.5));
    const end = Math.max(start + 0.5, dur - Math.max(0, Number(s.trimEnd) || 0));
    total += end - start;

    const vIdx = nInputs++;
    inputs.push('-i', s.clip);
    let aIdx = vIdx;
    if (!info.hasAudio) {
      aIdx = nInputs++;
      inputs.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=48000:cl=stereo');
    }
    const vChain = [
      `trim=start=${start}:end=${end}`, 'setpts=PTS-STARTPTS',
      ...(removeWatermark ? [delogoFor(info.width, info.height)] : []),
      'scale=1080:1920:force_original_aspect_ratio=decrease:flags=bicubic',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2', 'setsar=1', 'fps=30',
    ];
    filters.push(`[${vIdx}:v]${vChain.join(',')}[v${i}b0]`);

    // Chữ do web vẽ: mỗi mục là 1 PNG trong suốt, hiện/ẩn dần 0.2s, thời gian tính lại theo phần đã cắt đầu.
    const segDur = end - start;
    const ovs = (s.overlays || []).map((o) => ({ ...o, a: Math.max(0, o.start - start), b: Math.min(segDur, o.end - start) }))
      .filter((o) => o.text && o.b - o.a >= 0.3);
    if (ovs.length && overlayDir) {
      const pngs = ovs.map((o, k) => ({ text: o.text, position: o.position, style: textStyle, out: path.join(overlayDir, `s${i + 1}-${k + 1}.png`) }));
      await renderPngs(pngs);
      let cur = `v${i}b0`;
      ovs.forEach((o, k) => {
        const oIdx = nInputs++;
        inputs.push('-loop', '1', '-framerate', '30', '-t', segDur.toFixed(3), '-i', pngs[k].out);
        const fadeOut = Math.max(o.a, o.b - 0.2).toFixed(3);
        filters.push(`[${oIdx}:v]format=rgba,fade=t=in:st=${o.a.toFixed(3)}:d=0.2:alpha=1,fade=t=out:st=${fadeOut}:d=0.2:alpha=1[o${i}_${k}]`);
        const next = `v${i}b${k + 1}`;
        filters.push(`[${cur}][o${i}_${k}]overlay=0:0:enable='between(t,${o.a.toFixed(3)},${o.b.toFixed(3)})'[${next}]`);
        cur = next;
      });
      filters.push(`[${cur}]null[v${i}]`);
    } else {
      filters.push(`[v${i}b0]null[v${i}]`);
    }
    filters.push(
      `[${aIdx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${i}]`,
    );
    pairs.push(`[v${i}][a${i}]`);
  }
  filters.push(`${pairs.join('')}concat=n=${scenes.length}:v=1:a=1[v][a]`);

  let lastPct = -1;
  await ff([
    '-stats', '-stats_period', '0.5',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    output,
  ], {
    onLine: (line) => {
      if (!onProgress || total <= 0) return;
      const m = String(line).match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return;
      const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const pct = Math.min(99, Math.max(1, Math.round((sec / total) * 100)));
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress(pct);
      }
    },
  });
  return { duration: total };
}

// Ảnh xám 36x64 của khung đầu (video) hoặc của ảnh — dùng so khớp nối cảnh.
async function grayThumb(file) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const p = spawn(config.ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=36:64,format=gray', '-f', 'rawvideo', '-']);
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('ffmpeg không đọc được khung hình'))));
  });
}

// Độ lệch trung bình (0–255) giữa khung đầu của clip và một ảnh. Đo thực tế: clip nối đúng ≈ 1, clip nhầm ≈ 58–72.
export async function startFrameDiff(clip, image) {
  const [a, b] = await Promise.all([grayThumb(clip), grayThumb(image)]);
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let k = 0; k < n; k++) sum += Math.abs(a[k] - b[k]);
  return n ? sum / n : 255;
}
