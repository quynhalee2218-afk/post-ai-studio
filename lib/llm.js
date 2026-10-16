import { config } from './config.js';
import { run, tail } from './proc.js';
import { envForActive, activeLabel } from './claude-accounts.js';
import { buildSkillPromptBlock, resolveSkillsForTask, buildSkillCatalogSummary, listSkills } from './skills.js';

// Kịch bản trả về theo đúng format mục 14 của skill, nhưng dạng JSON để web xử lý.
export const PROMPT_LIMIT = 4000;
const PROMPT_TARGET = 3500;

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        hook: { type: 'string' },
        corePromise: { type: 'string' },
        transformation: { type: 'string' },
        climax: { type: 'string' },
        cta: { type: 'string' },
      },
      required: ['hook', 'corePromise', 'transformation', 'climax', 'cta'],
    },
    continuityMap: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'integer' },
          startsFrom: { type: 'string' },
          endsWith: { type: 'string' },
        },
        required: ['scene', 'startsFrom', 'endsWith'],
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'integer' },
          title: { type: 'string', description: 'Tên ngắn tiếng Việt, ví dụ "Hook"' },
          dialogue: { type: 'string', description: 'Lời thoại tiếng Việt, đọc đúng một lần' },
          onScreenText: { type: 'string', description: 'Tóm tắt chữ trên màn hình (ghép các textOverlays)' },
          textOverlays: {
            type: 'array',
            description: 'Chữ hiển thị do web vẽ lúc hậu kỳ — tiếng Việt CÓ DẤU',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                start: { type: 'number', description: 'giây bắt đầu trong cảnh, 0–8' },
                end: { type: 'number', description: 'giây kết thúc trong cảnh, 0–8' },
                position: { type: 'string', enum: ['top', 'middle', 'bottom'] },
              },
              required: ['text', 'start', 'end', 'position'],
            },
          },
          prompt: { type: 'string', description: 'Prompt Flow hoàn chỉnh tiếng Anh theo template mục 15' },
        },
        required: ['scene', 'title', 'dialogue', 'onScreenText', 'textOverlays', 'prompt'],
      },
    },
    caption: { type: 'string', description: 'Caption tiếng Việt cho bài đăng Facebook Reel' },
  },
  required: ['summary', 'continuityMap', 'scenes', 'caption'],
};

function buildBrief(input, refImagePath = null) {
  const identity = input.consistency === 'identity' && input.hasRefImage;
  const lines = [
    `Video AI: làm video ${input.sceneCount} phân cảnh, mỗi cảnh 8 giây, dọc 9:16.`,
    `Chủ đề / sản phẩm: ${input.topic}`,
  ];
  if (input.audience) lines.push(`Đối tượng xem: ${input.audience}`);
  if (input.cta) lines.push(`CTA mong muốn: ${input.cta}`);
  else lines.push('KHÔNG CÓ CTA (người dùng để trống): bỏ qua mọi yêu cầu CTA của skill. KHÔNG thêm lời kêu gọi hành động nào (comment, inbox, nhắn tin, đăng ký, follow, mua, bấm link, nhận ưu đãi…) vào lời thoại, chữ trên màn hình hay hành động (không chỉ tay xuống khu bình luận). Cảnh cuối khép lại tự nhiên bằng chính nội dung (một câu kết / suy ngẫm). Trường summary.cta ghi "(không có)".');
  if (input.character) lines.push(`Nhân vật / character DNA: ${input.character}`);
  if (refImagePath) {
    lines.push(
      `Ảnh tham chiếu nhân vật nằm ở: ${refImagePath}`,
      'BẮT BUỘC dùng công cụ Read để xem ảnh này TRƯỚC khi viết. Viết CHARACTER LOCK tiếng Anh thật chi tiết theo đúng ảnh: giới tính, tuổi ước lượng, dáng mặt, kiểu tóc, màu tóc, kính (nếu có), râu, màu da, trang phục, phụ kiện (đồng hồ…). Dùng NGUYÊN VĂN cùng một CHARACTER LOCK cho mọi cảnh.',
    );
  }
  if (input.mustSay) lines.push(`Thông tin bắt buộc phải nói: ${input.mustSay}`);
  else lines.push('Không có thông tin bắt buộc phải nói: chỉ nói những gì có trong chủ đề, KHÔNG tự thêm giá, thời lượng khoá học, lịch, khuyến mãi, số liệu hay lời hứa không có trong chủ đề.');
  if (input.avoid) lines.push(`Điều cấm / không muốn xuất hiện: ${input.avoid}`);
  if (input.tone) lines.push(`Tông giọng / phong cách: ${input.tone}`);
  if (input.voice === 'me') lines.push(
    'NHÂN VẬT CHÍNH LÀ CHỦ TÀI KHOẢN: mọi cảnh được gắn hình đại diện "Tôi" (@me) của Flow — vừa khóa khuôn mặt vừa khóa giọng. KHÔNG có ảnh nhân vật, KHÔNG có khung đầu từ cảnh trước (Flow chặn ảnh mặt người thật).',
    '- CHARACTER LOCK mọi cảnh ghi nguyên văn: "The presenter is the attached @me avatar (Tôi), the same presenter in every scene." rồi chỉ mô tả TRANG PHỤC/phụ kiện cố định (giống hệt nhau ở mọi cảnh). KHÔNG mô tả khuôn mặt, KHÔNG dùng các từ "likeness", "exact face", "real person", "lookalike", "resemble" — các từ này làm Flow nghi dựng lại người thật và chặn "người nổi tiếng".',
    '- VOICE mọi cảnh ghi nguyên văn: "Use the voice of the attached @me avatar (Tôi) for all dialogue; same speaker in every scene, natural Vietnamese."',
    '- KHUNG HÌNH: KHÔNG quay cận mặt nhìn thẳng ống kính (không close-up / medium close-up, không punch-in vào mặt) — mặt to rõ làm bộ lọc "người nổi tiếng" của Flow chặn liên tục. Dùng trung cảnh từ eo trở lên (waist-up, người chiếm khoảng nửa chiều cao khung), hơi nghiêng 3/4; cận cảnh chỉ dành cho tay, đồ vật, màn hình.',
    '- Vì không có khung đầu, mỗi chỗ nối là MATCH CUT: START FRAME của cảnh N mô tả lại rõ bối cảnh, ánh sáng, trang phục, tư thế, hướng camera nối tiếp END FRAME cảnh N-1.',
    '- Không nhắc tên người nổi tiếng, không yêu cầu giống người thật nào khác.',
  );
  else if (input.voice) lines.push(`Giọng đọc: mọi cảnh được gắn cùng một giọng tham chiếu "${input.voice}" của Flow. Mục VOICE trong mọi prompt ghi nguyên văn giống nhau: "Use the attached voice reference (${input.voice}) for all dialogue; same speaker, same timbre, natural Vietnamese." — không mô tả thêm chất giọng khác để tránh lệch.`);
  lines.push(
    '',
    'BỐI CẢNH KỸ THUẬT (bắt buộc tuân theo khi viết prompt):',
    '- Mỗi cảnh Veo render đúng 8 giây; viết thoại và timing cho 8 giây.',
    input.voice === 'me'
      ? '- Cảnh 1 được tạo bằng reference-to-video với hình đại diện @me (khuôn mặt + giọng của chủ tài khoản).'
      : input.hasRefImage
      ? '- Cảnh 1 được tạo bằng reference-to-video với ảnh tham chiếu nhân vật (chỉ để khóa danh tính).'
      : '- Cảnh 1 được tạo bằng text-to-video, không có ảnh tham chiếu; CHARACTER LOCK phải mô tả nhân vật thật chi tiết.',
    input.voice === 'me'
      ? '- Mọi cảnh tạo bằng reference-to-video với hình đại diện @me (xem mục NHÂN VẬT CHÍNH LÀ CHỦ TÀI KHOẢN).'
      : identity
      ? '- Từ cảnh 2 trở đi, mỗi cảnh được tạo bằng reference-to-video với HAI ảnh tham chiếu: (1) ảnh nhân vật gốc để khóa khuôn mặt, (2) khung hình cuối của cảnh trước để giữ bối cảnh, trang phục, ánh sáng, tư thế. KHÔNG có khung hình đầu cố định, nên mỗi chỗ nối là một MATCH CUT: START FRAME của cảnh N mô tả lại rõ bối cảnh + tư thế + hướng camera tiếp nối END FRAME của cảnh N-1. Mọi prompt phải ghi rõ "The person must look exactly like the reference photo of the character" và dùng cùng một CHARACTER LOCK y hệt nhau.'
      : '- Từ cảnh 2 trở đi, hệ thống tự lấy KHUNG HÌNH CUỐI của cảnh trước làm khung hình đầu (image-to-video). Vì vậy START FRAME của cảnh N phải mô tả đúng END FRAME của cảnh N-1, và END FRAME phải là một trạng thái nối được.',
    '- CHỮ TRÊN MÀN HÌNH do web tự vẽ ở hậu kỳ (Veo vẽ chữ sai). Đưa toàn bộ chữ hiển thị vào trường "textOverlays": tiếng Việt CÓ DẤU, 2–6 từ mỗi mục, tối đa 3 mục mỗi cảnh, mốc thời gian 0–8 giây khớp lời thoại, position "top" (mặc định) hoặc "middle"/"bottom"; không dùng emoji hay ký hiệu mũi tên. Text không được lặp nguyên văn lời thoại.',
    '- TRONG PROMPT gửi Veo TUYỆT ĐỐI KHÔNG yêu cầu chữ: mục ON-SCREEN TEXT ghi đúng "None — added in post-production." và cuối mỗi prompt thêm câu: "Do NOT render any on-screen text, letters, numbers, captions, subtitles, signs with readable text, logos or watermarks anywhere in the frame." Màn hình điện thoại/laptop trong cảnh chỉ hiện giao diện mờ, không chữ đọc được.',
    '- Mỗi prompt phải tự đứng độc lập, copy-paste được, viết bằng tiếng Anh theo template mục 15; lời thoại trong prompt giữ nguyên tiếng Việt.',
    `- GIỚI HẠN CỨNG: mỗi prompt TỐI ĐA ${PROMPT_TARGET} ký tự (Flow cắt bỏ mọi thứ sau 4000 ký tự). Giữ đủ các mục của template nhưng viết cô đọng: mỗi mục 1–3 câu, không lặp lại cùng một luật ở nhiều mục, gộp NO-LEAD-IN / NO-TAIL / AUDIO-TO-CUT thành câu ngắn. Ưu tiên giữ nguyên: dialogue, START FRAME, END FRAME, SPEECH TIMING LOCK.`,
    '- Trường "dialogue" và "onScreenText" là bản tóm tắt tiếng Việt để người dùng duyệt, phải khớp với nội dung trong prompt.',
    `- Trường "caption": caption Facebook Reel tiếng Việt, ngắn, ${input.cta ? `kết bằng đúng CTA: ${input.cta}` : 'KHÔNG có lời kêu gọi hành động'}, tối đa 3 hashtag, không hứa hẹn quá mức.`,
    '- Trước khi trả kết quả, tự chạy 14 bước CONTINUITY CHECK ở mục 16 và sửa lỗi; không cần in ra checklist.',
  );
  if (input.skillBlock) lines.push(input.skillBlock);
  return lines.join('\n');
}

async function callClaude({ systemPromptFile, systemPrompt, schema, input, tools = [] }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--no-session-persistence',
    '--tools', tools.join(','),
    ...(tools.length ? ['--allowedTools', tools.join(',')] : []),
    '--strict-mcp-config',
    ...(systemPromptFile ? ['--system-prompt-file', systemPromptFile] : ['--system-prompt', systemPrompt]),
    '--json-schema', JSON.stringify(schema),
  ];
  if (config.claudeModel) args.push('--model', config.claudeModel);

  const res = await run(config.claudeBin, args, {
    input,
    cwd: config.dataDir,
    env: envForActive(), // tài khoản Claude đang chọn trên web
    timeoutMs: 15 * 60 * 1000,
  });
  let out;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    throw new Error(`Claude không trả JSON (exit ${res.code}): ${tail(res.stderr || res.stdout, 600)}`);
  }
  if (out.is_error || !out.structured_output) {
    const msg = tail(out.result || res.stderr, 600);
    const hint = /limit|rate|quota|hạn mức/i.test(msg) ? ' → Tài khoản này hết hạn mức: đổi tài khoản Claude ở tab "Tài khoản".' : '';
    throw new Error(`Claude (${activeLabel()}) lỗi: ${msg}${hint}`);
  }
  return { data: out.structured_output, costUsd: out.total_cost_usd ?? 0 };
}

const AGENT_ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    matchedSkills: {
      type: 'array',
      description: 'Danh sách tối đa 3 Skill phù hợp nhất với dữ liệu/yêu cầu của người dùng',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Mã id chính xác của Skill trong danh mục' },
          reason: { type: 'string', description: 'Lý do ngắn gọn vì sao Agent chọn Skill này cho dữ liệu người dùng' },
        },
        required: ['id', 'reason'],
      },
    },
  },
  required: ['matchedSkills'],
};

/**
 * Agent ngữ nghĩa: đọc danh mục toàn bộ Skill trong kho và chọn 1–3 Skill tác vụ khớp nhất với dữ liệu người dùng.
 */
export async function agentDetectSkillsLLM(userInput = {}, { maxSkills = 2, excludeIds = [] } = {}) {
  const rawInput = typeof userInput === 'string'
    ? userInput
    : [userInput.topic, userInput.character, userInput.audience, userInput.mustSay, userInput.tone, userInput.cta, userInput.prompt].filter(Boolean).join('\n');
  if (!rawInput.trim()) return { matchedSkills: [], costUsd: 0 };

  const allMap = new Map(listSkills().filter((s) => !s.builtin).map((s) => [s.id, s]));
  const exclude = new Set(excludeIds || []);
  const catalog = buildSkillCatalogSummary();
  if (!catalog) return { matchedSkills: [], costUsd: 0 };

  const r = await callClaude({
    systemPrompt:
      'Bạn là Agent điều phối Skill (Skill Router) của Post AI Studio. Dựa trên dữ liệu/yêu cầu người dùng nhập vào và danh mục Skill hiện có, hãy chọn ra tối đa ' +
      `${maxSkills} Skill tác vụ phù hợp nhất (ví dụ: khớp sản phẩm, khớp nhân vật/series, khớp thương hiệu/DNA, hoặc khớp đúng thể loại kịch bản/tác vụ mà người dùng cần). ` +
      'Nếu có 1 Skill về DNA/nhân hiệu và 1 Skill về công thức kịch bản video cùng phù hợp thì chọn cả hai. Chỉ chọn những Skill thực sự liên quan, giữ nguyên mã `id` chính xác trong danh mục.',
    schema: AGENT_ROUTE_SCHEMA,
    input: `DỮ LIỆU / YÊU CẦU CỦA NGƯỜI DÙNG:\n${rawInput}\n\nDANH MỤC SKILL TRONG KHO:\n${catalog}`,
  });

  const matched = [];
  for (const item of r.data?.matchedSkills || []) {
    if (!item?.id || exclude.has(item.id) || !allMap.has(item.id)) continue;
    const sk = allMap.get(item.id);
    matched.push({
      id: sk.id,
      name: sk.name,
      title: sk.title,
      description: sk.description,
      category: sk.category,
      fileCount: sk.fileCount,
      auto: true,
      reason: item.reason || 'Agent AI phân tích ngữ nghĩa & chọn tự động',
    });
    if (matched.length >= maxSkills) break;
  }
  return { matchedSkills: matched, costUsd: r.costUsd || 0 };
}

/**
 * Tự động nhận diện Skill phù hợp (kết hợp bộ chấm điểm nhanh + Agent LLM khi dữ liệu trừu tượng).
 */
export async function resolveAgentSkills({ skillIds = [], userInput = {}, autoDetect = true, taskType = 'any', maxAuto = 2 } = {}) {
  const resolved = resolveSkillsForTask({ skillIds, userInput, autoDetect, taskType, maxAuto });
  let costUsd = 0;
  let autoDetected = resolved.autoDetected;

  // Nếu bật autoDetect mà bộ khớp từ khóa chưa tìm ra Skill nào đủ điểm (và người dùng chưa chọn tay), gọi Agent LLM phân tích ngữ nghĩa
  const hasInput = typeof userInput === 'string'
    ? userInput.trim().length > 3
    : Boolean((userInput.topic || userInput.character || userInput.mustSay || userInput.prompt || '').trim());

  if (autoDetect && resolved.manualIds.length === 0 && autoDetected.length === 0 && hasInput) {
    try {
      const llmRoute = await agentDetectSkillsLLM(userInput, { maxSkills: maxAuto, excludeIds: resolved.manualIds });
      costUsd += llmRoute.costUsd || 0;
      if (llmRoute.matchedSkills.length) {
        autoDetected = llmRoute.matchedSkills;
      } else if (resolved.candidates.length) {
        autoDetected = resolved.candidates.slice(0, 1);
      }
    } catch {
      if (resolved.candidates.length) autoDetected = resolved.candidates.slice(0, 1);
    }
  }

  const combinedIds = [...new Set([...resolved.manualIds, ...autoDetected.map((d) => d.id)])];
  return { combinedIds, manualIds: resolved.manualIds, autoDetected, candidates: resolved.candidates, costUsd };
}

export async function generateScript(input, { refImagePath = null } = {}) {
  const autoDetect = input.autoSkill !== false;
  const route = await resolveAgentSkills({
    skillIds: input.skills || [],
    userInput: input,
    autoDetect,
    taskType: 'video',
    maxAuto: 2,
  });
  const sk = buildSkillPromptBlock(route.combinedIds, { includePinned: true, autoDetected: route.autoDetected });
  const tools = (refImagePath || sk.needsReadTool) ? ['Read'] : [];
  const { data: script, costUsd } = await callClaude({
    systemPromptFile: config.skillFile,
    schema: SCRIPT_SCHEMA,
    input: buildBrief({ ...input, skillBlock: sk.block }, refImagePath),
    // Có ảnh nhân vật hoặc file tài liệu bổ sung trong skill → cho Claude đọc bằng Read.
    tools,
  });
  script.scenes.sort((a, b) => a.scene - b.scene);
  let cost = (route.costUsd || 0) + costUsd;
  const long = script.scenes.filter((s) => s.prompt.length > PROMPT_TARGET + 300);
  if (long.length) {
    const r = await compressPrompts(long.map((s) => ({ scene: s.scene, prompt: s.prompt })));
    cost += r.costUsd;
    for (const c of r.prompts) {
      const s = script.scenes.find((x) => x.scene === c.scene);
      if (s && c.prompt.length < s.prompt.length) s.prompt = c.prompt;
    }
  }
  return {
    script,
    costUsd: cost,
    compressed: long.map((s) => s.scene),
    usedSkills: sk.usedSkillObjects,
    skillTitles: sk.skillTitles,
    autoDetectedSkills: route.autoDetected,
    selectedIds: sk.selectedIds,
  };
}

const COMPRESS_SCHEMA = {
  type: 'object',
  properties: {
    prompts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { scene: { type: 'integer' }, prompt: { type: 'string' } },
        required: ['scene', 'prompt'],
      },
    },
  },
  required: ['prompts'],
};

// Rút gọn prompt vượt giới hạn của Flow mà không đổi nội dung.
// Model hay "rút" chưa tới đích → lặp tối đa 3 vòng, mỗi vòng ép mục tiêu chặt hơn.
// Flow chặn "người nổi tiếng" (bộ lọc không cho biết lý do) → tự viết lại prompt của cảnh, mỗi bậc né mạnh hơn.
// Lời thoại giữ nguyên từng chữ; cảnh vẫn gắn @me nên giọng/nhân vật không đổi.
const POLICY_LEVELS = [
  'Level 1: keep the same story beat, but reframe it: presenter waist-up at most (about half the frame height or smaller), 3/4 or side angle, '
    + 'looking at objects/hands more than at the lens, never a face close-up. Replace identity wording with exactly: '
    + '"The presenter is the attached @me avatar (Tôi)." Remove words like likeness, exact face, real person, lookalike, resemble, celebrity, famous.',
  'Level 2: make the presenter clearly smaller and less face-centric: medium-wide or wide shot (presenter about one third of the frame height), '
    + 'mostly profile or over-the-shoulder, much of the shot on hands, props, screens and the environment; the presenter speaks while working. '
    + 'Change the setting details and props a little (still consistent with the story). Same identity sentence as level 1.',
  'Level 3: rewrite as a SHORT, simple prompt (max 1500 characters): one plain paragraph describing the setting, the presenter (attached @me avatar, '
    + 'outfit only) doing one simple action in a medium-wide shot, the camera move, and the dialogue line in quotes to be spoken once in Vietnamese. '
    + 'No section headings, no editing jargon, no mention of faces, no on-screen text.',
];
const REWRITE_SCHEMA = { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] };

export async function rewriteForPolicy({ prompt, dialogue, level, failText = '' }) {
  const r = await callClaude({
    systemPrompt:
      'You rewrite Google Flow / Veo 3 video prompts that were BLOCKED by Flow\'s policy filter ' +
      '("may violate our policy on generating videos of celebrities / famous people"). The presenter is the user\'s OWN Flow avatar ' +
      '(@me, "Tôi"), attached as an ingredient — it is not a celebrity; the filter misfires on face-centric prompts. ' +
      'Rewrite the prompt so it is far less likely to trip the filter while keeping the same scene purpose. ' +
      'HARD RULES: keep the Vietnamese dialogue EXACTLY character-for-character and still spoken once; keep vertical 9:16, 8 seconds; ' +
      'keep "Do NOT render any on-screen text"; never name or describe any real or famous person; never describe facial features; ' +
      'ALWAYS keep the sentence "Use the voice of the attached @me avatar (Tôi) for all dialogue." so the voice stays the same as other scenes. ' +
      `Output at most ${PROMPT_TARGET} characters. ${POLICY_LEVELS[Math.min(level, POLICY_LEVELS.length) - 1]}`,
    schema: REWRITE_SCHEMA,
    input: JSON.stringify({ blocked_prompt: prompt, dialogue_verbatim: dialogue, flow_message: failText.slice(0, 300) }),
  });
  let out = String(r.data.prompt || '').trim();
  if (!out) throw new Error('Claude không trả prompt viết lại');
  if (dialogue && !out.includes(dialogue)) out += `\n\nDIALOGUE — speak EXACTLY ONCE, in Vietnamese: "${dialogue}"`;
  if (!/voice of the attached @me avatar/i.test(out)) out = `Use the voice of the attached @me avatar (Tôi) for all dialogue.\n${out}`;
  let costUsd = r.costUsd || 0;
  if (out.length > PROMPT_TARGET + 150) { // quá dài → rút gọn (vẫn giữ lời thoại), tránh Flow cắt mất phần cuối
    const c = await compressPrompts([{ scene: 1, prompt: out }]);
    costUsd += c.costUsd || 0;
    const shorter = c.prompts[0]?.prompt;
    if (shorter && (!dialogue || shorter.includes(dialogue))) out = shorter;
  }
  return { prompt: out.slice(0, PROMPT_LIMIT - 20), costUsd };
}

export async function compressPrompts(items) {
  let pending = items.map((x) => ({ ...x }));
  const result = new Map();
  let costUsd = 0;
  for (const target of [PROMPT_TARGET, 3000, 2600]) {
    const r = await callClaude({
      systemPrompt:
        'You compress Google Flow / Veo video prompts. Keep every section heading and every concrete instruction, ' +
        'but remove repetition and verbose wording. NEVER change the Vietnamese dialogue (keep it character-for-character), ' +
        'START FRAME, END FRAME, NEXT-SCENE HANDOFF, camera direction, character identity, or timing numbers. ' +
        `HARD LIMIT: each output prompt MUST be at most ${target} characters including spaces and newlines. Count carefully; shorter is fine.`,
      schema: COMPRESS_SCHEMA,
      input: JSON.stringify({ prompts: pending }),
    });
    costUsd += r.costUsd;
    for (const c of r.data.prompts) {
      const orig = pending.find((x) => x.scene === c.scene);
      if (orig && c.prompt.length < orig.prompt.length) {
        orig.prompt = c.prompt;
        result.set(c.scene, c.prompt);
      }
    }
    pending = pending.filter((x) => x.prompt.length > PROMPT_LIMIT - 100);
    if (!pending.length) break;
  }
  return { prompts: [...result].map(([scene, prompt]) => ({ scene, prompt })), costUsd };
}

const EXTRACT_BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    suggestedTopics: {
      type: 'array',
      description: 'Danh sách 5 chủ đề / ý tưởng kịch bản cụ thể, hấp dẫn trích từ kiến thức của Skill',
      items: { type: 'string' },
    },
    topic: { type: 'string', description: 'Chủ đề video cụ thể (hoàn thiện từ ý tưởng của người dùng hoặc chọn chủ đề hay nhất từ Skill)' },
    audience: { type: 'string', description: 'Đối tượng người xem mục tiêu theo Skill' },
    character: { type: 'string', description: 'Mô tả nhân vật cố định / Character DNA (tuổi, giới tính, ngoại hình, trang phục, bối cảnh, phong cách hình ảnh) trích từ Skill' },
    tone: { type: 'string', description: 'Tông giọng và phong cách nói chuyện trích từ Skill' },
    mustSay: { type: 'string', description: 'Thông tin sản phẩm, thương hiệu, chính sách hoặc thông điệp cốt lõi bắt buộc theo Skill' },
    avoid: { type: 'string', description: 'Các từ cấm, điều cấm kỵ hoặc phong cách cần tránh theo Skill' },
    cta: { type: 'string', description: 'Lời kêu gọi hành động (CTA) chuẩn theo Skill (để trống nếu Skill cấm CTA)' },
  },
  required: ['suggestedTopics', 'topic', 'audience', 'character', 'tone', 'mustSay', 'avoid', 'cta'],
};

/**
 * Đọc hiểu Skill và trích xuất tự động dữ liệu (Chủ đề, Nhân vật, Tông giọng, Thông tin sản phẩm, Điều cấm, CTA) để điền vào form Tạo video.
 * Nếu người dùng chưa chọn Skill thủ công, Agent sẽ tự động nhận biết Skill phù hợp nhất dựa trên dữ liệu đã nhập trong form.
 */
export async function extractBriefFromSkills({ skillIds = [], topic = '', userInput = {}, autoDetect = true }) {
  const mergedInput = { ...userInput, topic: topic || userInput.topic || '' };
  const route = await resolveAgentSkills({
    skillIds,
    userInput: mergedInput,
    autoDetect,
    taskType: 'video',
    maxAuto: 2,
  });
  const sk = buildSkillPromptBlock(route.combinedIds, { includePinned: true, autoDetected: route.autoDetected });
  if (!sk.block) throw new Error('Hãy chọn ít nhất 1 Skill hoặc nhập vài từ khóa về chủ đề/nhân vật để Agent tự động nhận diện Skill phù hợp!');
  const r = await callClaude({
    systemPrompt:
      'Bạn là trợ lý đạo diễn và biên kịch AI của Post AI Studio. Nhiệm vụ của bạn là đọc hiểu thật kỹ toàn bộ nội dung SKILL và các tài liệu tham chiếu (references) được cung cấp, sau đó trích xuất chính xác các trường dữ liệu để điền vào form tạo kịch bản video AI (Google Flow / Veo 3). Viết bằng tiếng Việt rõ ràng, súc tích, bám sát 100% quy tắc trong Skill (không tự bịa thông tin trái với Skill).',
    schema: EXTRACT_BRIEF_SCHEMA,
    input: [
      mergedInput.topic ? `Ý tưởng / chủ đề người dùng đang nhập: "${mergedInput.topic}" (hãy phát triển chủ đề này theo đúng công thức của Skill).` : 'Người dùng chưa nhập chủ đề — hãy chọn 1 chủ đề hấp dẫn nhất từ Skill làm `topic` và gợi ý thêm 5 chủ đề trong `suggestedTopics`.',
      sk.block,
    ].join('\n\n'),
    tools: sk.needsReadTool ? ['Read'] : [],
  });
  return {
    ...r.data,
    usedSkills: sk.usedSkillObjects,
    skillTitles: sk.skillTitles,
    selectedIds: sk.selectedIds,
    autoDetectedSkills: route.autoDetected,
    costUsd: (route.costUsd || 0) + (r.costUsd || 0),
  };
}

const ASK_SKILL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Tiêu đề ngắn gọn của kết quả' },
    answer: { type: 'string', description: 'Nội dung trả lời chi tiết, trình bày rõ ràng (dùng Markdown nếu cần), trích xuất đúng kiến thức và dữ liệu từ Skill' },
    videoBrief: {
      type: 'object',
      description: 'Nếu kết quả có thể dùng để tạo video, trích xuất sẵn các trường gợi ý cho form tạo video',
      properties: {
        topic: { type: 'string' },
        audience: { type: 'string' },
        character: { type: 'string' },
        tone: { type: 'string' },
        mustSay: { type: 'string' },
        avoid: { type: 'string' },
        cta: { type: 'string' },
      },
      required: ['topic', 'audience', 'character', 'tone', 'mustSay', 'avoid', 'cta'],
    },
  },
  required: ['title', 'answer', 'videoBrief'],
};

/**
 * Chạy yêu cầu bất kỳ của người dùng (viết kịch bản, lên kế hoạch nội dung, trích dữ liệu, soạn bài đăng/tin nhắn...).
 * Nếu người dùng không chọn trước Skill (hoặc bật autoDetect), Agent tự động nhận diện và nạp Skill tác vụ phù hợp nhất từ dữ liệu yêu cầu.
 */
export async function askWithSkills({ skillIds = [], prompt = '', autoDetect = true }) {
  if (!String(prompt || '').trim()) throw new Error('Hãy nhập yêu cầu cho AI');
  const route = await resolveAgentSkills({
    skillIds,
    userInput: { prompt },
    autoDetect,
    taskType: 'any',
    maxAuto: 2,
  });
  const sk = buildSkillPromptBlock(route.combinedIds, { includePinned: true, autoDetected: route.autoDetected });
  if (!sk.block) throw new Error('Agent chưa tìm thấy Skill khớp với yêu cầu này — hãy chọn 1 Skill ở ô phía trên hoặc mô tả rõ hơn chủ đề/nhân vật!');
  const r = await callClaude({
    systemPrompt:
      'Bạn là chuyên gia AI thực thi theo đúng bộ Skill kiến thức được nạp. Hãy đọc kỹ SKILL.md và toàn bộ tài liệu tham chiếu (references/assets) của Skill để giải quyết yêu cầu của người dùng một cách xuất sắc, chính xác tuyệt đối theo dữ liệu, công thức, giọng văn và quy tắc trong Skill. Đồng thời trích xuất sẵn `videoBrief` để nếu người dùng muốn chuyển kết quả này sang tạo video trên Google Flow thì có thể bấm 1 nút là điền xong.',
    schema: ASK_SKILL_SCHEMA,
    input: `YÊU CẦU CỦA NGƯỜI DÙNG:\n${prompt.trim()}\n\n${sk.block}`,
    tools: ['Read'],
  });
  return {
    ...r.data,
    usedSkills: sk.usedSkillObjects,
    skillTitles: sk.skillTitles,
    selectedIds: sk.selectedIds,
    autoDetectedSkills: route.autoDetected,
    costUsd: (route.costUsd || 0) + (r.costUsd || 0),
  };
}


