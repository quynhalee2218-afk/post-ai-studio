import fs from 'node:fs';
import { config } from './config.js';
import { run, tail } from './proc.js';
import { envForActive, activeLabel } from './claude-accounts.js';
import { buildSkillPromptBlock, resolveSkillsForTask, buildSkillCatalogSummary, listSkills } from './skills.js';
import { AI_PROVIDERS, AI_MODELS, resolveAiSelection, callChatGPT, callGemini, getApiKeys } from './ai-providers.js';

export { AI_PROVIDERS, AI_MODELS, resolveAiSelection };

// Kịch bản trả về theo đúng format mục 14 của skill, nhưng dạng JSON để web xử lý.
export const PROMPT_LIMIT = 4000;
const PROMPT_TARGET = 3500;

export const VIRAL_FORMATS = [
  {
    id: 'storytelling',
    name: '🎭 Kể chuyện đời thường / Tình huống đồng cảm & Twist',
    desc: 'Mở đầu bằng tình huống ai cũng từng gặp → đẩy mâu thuẫn/tâm lý → cú bẻ lái (Twist) hoặc bài học chạm cảm xúc cuối video.',
  },
  {
    id: 'myth_busting',
    name: '💡 Khai sáng / Bóc sự thật / Phá vỡ hiểu lầm',
    desc: 'Chỉ ra điều 90% người xem đang hiểu sai hoặc làm ngược → giải thích sự thật ngắn gọn, thuyết phục khiến người xem "À thì ra vậy!".',
  },
  {
    id: 'mistakes',
    name: '⚠️ Cảnh báo sai lầm phổ biến (Kích thích xem hết)',
    desc: 'Điểm danh những lỗi sai ngầm khiến người xem mất tiền, mất sức hoặc mất thời gian mỗi ngày → giữ chân xem tới giây cuối.',
  },
  {
    id: 'tips_hacks',
    name: '⚡ Bí kíp nhanh / Mẹo thực chiến (Kích thích Lưu & Chia sẻ)',
    desc: 'Chia sẻ mẹo hữu ích, giải pháp thực tế dễ áp dụng ngay trong 3 bước → người xem muốn Lưu lại (Save) và tag bạn bè.',
  },
  {
    id: 'philosophy',
    name: '🌿 Góc nhìn sâu sắc / Tâm sự đời sống & kinh doanh',
    desc: 'Chiêm nghiệm thực tế về cuộc sống, gia đình, công việc, sức khỏe → câu chốt dạng Quote đắt giá kéo lượt Chia sẻ (Share) tự nhiên.',
  },
  {
    id: 'transformation',
    name: '🔄 Hành trình Trước – Sau / Thử thách thực tế',
    desc: 'Đối chiếu sự thay đổi rõ rệt Trước và Sau một biến cố hoặc thói quen → tạo sự tò mò lớn ngay từ 2 giây đầu.',
  },
];

export const TRAFFIC_GOALS = [
  {
    id: 'engage_comment',
    name: '💬 Kéo Bình luận & Tranh luận tự nhiên (Tăng tương tác Fanpage)',
    defaultCta: 'Đặt một câu hỏi mở chạm đúng tâm lý ở cảnh cuối để kích thích người xem để lại ý kiến/trải nghiệm dưới phần bình luận.',
  },
  {
    id: 'share_save',
    name: '🔁 Kích thích Chia sẻ (Share) & Lưu video (Đẩy xu hướng Reels)',
    defaultCta: 'Khép lại bằng câu đúc kết đắt giá và nhắn nhẹ người xem lưu lại áp dụng hoặc gửi cho người thân/bạn bè đang cần.',
  },
  {
    id: 'follow_page',
    name: '➕ Thu hút người lạ bấm Theo dõi (Follow) Fanpage mỗi ngày',
    defaultCta: 'Gợi mở giá trị các tập tiếp theo và mời người xem bấm Theo dõi Fanpage để không bỏ lỡ nội dung hữu ích hằng ngày.',
  },
  {
    id: 'soft_lead',
    name: '🧲 Dẫn dắt khéo léo về Sản phẩm / Dịch vụ (Soft-sell không phản cảm)',
    defaultCta: 'Lồng ghép giải pháp/sản phẩm tự nhiên như một phần của câu chuyện đời thực và gợi ý xem thêm ở bình luận hoặc nhắn Fanpage.',
  },
];

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
  const isViral = input.videoType === 'viral';
  const viralFmt = VIRAL_FORMATS.find((f) => f.id === input.viralFormat) || VIRAL_FORMATS[0];
  const trafficGoal = TRAFFIC_GOALS.find((g) => g.id === input.trafficGoal) || TRAFFIC_GOALS[0];

  const lines = [
    isViral
      ? `LOẠI VIDEO: 🔥 VIDEO VIRAL ĐĂNG BÀI HÀNG NGÀY — KÉO TRAFFIC & TIẾP CẬN KHÁCH HÀNG TIỀM NĂNG CHO FANPAGE (${input.sceneCount} phân cảnh, mỗi cảnh 8 giây, dọc 9:16).`
      : `LOẠI VIDEO: 🛍️ VIDEO QUẢNG CÁO SẢN PHẨM / DỊCH VỤ (${input.sceneCount} phân cảnh, mỗi cảnh 8 giây, dọc 9:16).`,
    `${isViral ? 'Chủ đề / Ý tưởng Viral & Ngách Fanpage' : 'Chủ đề / sản phẩm'}: ${input.topic}`,
  ];
  if (isViral) {
    lines.push(
      `Công thức kịch bản Viral áp dụng: ${viralFmt.name} — ${viralFmt.desc}`,
      `Mục tiêu kéo Traffic Fanpage: ${trafficGoal.name}`,
    );
  }
  if (input.audience) lines.push(`Đối tượng người xem / Tệp khách hàng mục tiêu: ${input.audience}`);
  if (input.cta) {
    lines.push(`CTA / Câu kết mong muốn: ${input.cta}`);
  } else if (isViral) {
    lines.push(`Hướng kết bài & kéo tương tác (người dùng để trống ô CTA cụ thể): Áp dụng tự nhiên theo mục tiêu "${trafficGoal.name}" — ${trafficGoal.defaultCta} Tuyệt đối không hô hào mua hàng thô cứng.`);
  } else {
    lines.push('KHÔNG CÓ CTA (người dùng để trống): bỏ qua mọi yêu cầu CTA của skill. KHÔNG thêm lời kêu gọi hành động nào (comment, inbox, nhắn tin, đăng ký, follow, mua, bấm link, nhận ưu đãi…) vào lời thoại, chữ trên màn hình hay hành động (không chỉ tay xuống khu bình luận). Cảnh cuối khép lại tự nhiên bằng chính nội dung (một câu kết / suy ngẫm). Trường summary.cta ghi "(không có)".');
  }
  if (input.character) lines.push(`Nhân vật / character DNA: ${input.character}`);
  if (refImagePath) {
    lines.push(
      `Ảnh tham chiếu nhân vật nằm ở: ${refImagePath}`,
      'BẮT BUỘC dùng công cụ Read để xem ảnh này TRƯỚC khi viết. Viết CHARACTER LOCK tiếng Anh thật chi tiết theo đúng ảnh: giới tính, tuổi ước lượng, dáng mặt, kiểu tóc, màu tóc, kính (nếu có), râu, màu da, trang phục, phụ kiện (đồng hồ…). Dùng NGUYÊN VĂN cùng một CHARACTER LOCK cho mọi cảnh.',
    );
  }
  if (input.mustSay) lines.push(`${isViral ? 'Thông điệp cốt lõi / Điểm chạm thương hiệu cần lồng ghép khéo léo' : 'Thông tin bắt buộc phải nói'}: ${input.mustSay}`);
  else lines.push('Không có thông tin bắt buộc phải nói: chỉ nói những gì có trong chủ đề, KHÔNG tự thêm giá, thời lượng khoá học, lịch, khuyến mãi, số liệu hay lời hứa không có trong chủ đề.');
  if (input.avoid) lines.push(`Điều cấm / không muốn xuất hiện: ${input.avoid}`);
  if (input.tone) lines.push(`Tông giọng / phong cách: ${input.tone}`);
  else if (isViral) lines.push('Tông giọng / phong cách: Đời thường, tự nhiên, giàu cảm xúc, câu ngắn gọn súc tích, nói như tâm sự thực tế, tạo sự đồng cảm sâu sắc.');

  if (isViral) {
    lines.push(
      '',
      '🔥 QUY TẮC ĐẶC BIỆT CHO KỊCH BẢN VIDEO VIRAL KÉO TRAFFIC FANPAGE HÀNG NGÀY (BẮT BUỘC TUÂN THỦ):',
      '1. KHÔNG VIẾT NHƯ QUẢNG CÁO BÁN HÀNG LỘ LIỄU: Người lạ trên Facebook Reels sẽ lướt qua ngay nếu thấy mùi quảng cáo ở 3 giây đầu. Hãy kể câu chuyện đời thường, bóc tách tâm lý/sai lầm hoặc chia sẻ bí kíp thực tế khiến người xem thấy chính mình trong đó.',
      '2. HOOK 2 GIÂY ĐẦU (CẢNH 1) PHẢI CHẶN NGÓN TAY LƯỚT: Mở đầu ngay vào tình huống cao trào, câu nói gây giật mình, nghịch lý ("90% mọi người tưởng...", "Đừng bao giờ...") hoặc cảnh đời thực chạm đúng nỗi đau của tệp khách hàng. Không chào hỏi rườm rà.',
      `3. TRIỂN KHAI ĐÚNG CÔNG THỨC "${viralFmt.name}":`,
      '   - Giữa mỗi cảnh 8 giây phải có nút thắt mở (Open-Loop) để giữ chân người xem xem hết 100% thời lượng video (tối ưu thuật toán phân phối Reels).',
      '   - Lời thoại tiếng Việt tự nhiên 100% như văn nói đời thực, ngắn gọn, dứt khoát, không dùng từ ngữ sáo rỗng hay giọng điệu sách vở.',
      '   - Cảnh kế cuối hoặc cảnh cuối phải có 1 câu đúc kết đắt giá (Quote chạm cảm xúc / bài học sáng giá / cú Twist bất ngờ) để kích thích người xem Chia sẻ (Share) và Bình luận (Comment).',
      input.trafficGoal === 'soft_lead'
        ? '4. LỒNG GHÉP SẢN PHẨM / GIẢI PHÁP TINH TẾ (SOFT-SELL): Đưa sản phẩm/dịch vụ xuất hiện tự nhiên như một thói quen hoặc giải pháp cứu cánh trong câu chuyện, không đọc thông số quảng cáo khô khan.'
        : '4. THUẦN TRAO GIÁ TRỊ & ĐỒNG CẢM ĐỂ KÉO TRAFFIC TỰ NHIÊN: Tập trung 100% vào câu chuyện, cảm xúc và giá trị hữu ích cho người xem để thu hút lượt tiếp cận mới (Reach), Follow và tương tác cho Fanpage.',
    );
  }

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
    isViral
      ? `- Trường "caption": caption Facebook Reel tiếng Việt tối ưu kéo Traffic & SEO Social cho Fanpage (Dòng 1 giật Hook tạo đồng cảm/tò mò, 1–2 câu dẫn chuyện ngắn, ${input.cta ? `kết bằng CTA: ${input.cta}` : 'kết bằng 1 câu hỏi mở kích thích người xem bình luận chia sẻ góc nhìn'}, kèm 3–5 hashtag chuẩn ngách).`
      : `- Trường "caption": caption Facebook Reel tiếng Việt, ngắn, ${input.cta ? `kết bằng đúng CTA: ${input.cta}` : 'KHÔNG có lời kêu gọi hành động'}, tối đa 3 hashtag, không hứa hẹn quá mức.`,
    '- Trước khi trả kết quả, tự chạy 14 bước CONTINUITY CHECK ở mục 16 và sửa lỗi; không cần in ra checklist.',
  );
  if (input.skillBlock) lines.push(input.skillBlock);
  return lines.join('\n');
}

async function callClaude({ model = '', systemPromptFile, systemPrompt, schema, input, tools = [] }) {
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
  const chosenModel = model || config.claudeModel || '';
  if (chosenModel && chosenModel !== 'claude') args.push('--model', chosenModel);

  const keys = getApiKeys();
  const extraEnv = { ...envForActive() };
  if (keys.anthropic && !extraEnv.ANTHROPIC_API_KEY) {
    extraEnv.ANTHROPIC_API_KEY = keys.anthropic;
  }

  const res = await run(config.claudeBin, args, {
    input,
    cwd: config.dataDir,
    env: extraEnv, // tài khoản Claude đang chọn trên web
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
    const hint = /limit|rate|quota|hạn mức/i.test(msg)
      ? ' → Tài khoản này hết hạn mức: bạn có thể đổi sang ChatGPT / Gemini hoặc đổi tài khoản Claude ở tab "Tài khoản".'
      : '';
    throw new Error(`Claude (${activeLabel()}) lỗi: ${msg}${hint}`);
  }
  return { data: out.structured_output, costUsd: out.total_cost_usd ?? 0, provider: 'claude', model: chosenModel || 'claude-sonnet-4-5' };
}

/**
 * Điều phối gọi Model AI đa nền tảng: Claude (Anthropic) · ChatGPT (OpenAI) · Gemini (Google).
 * Tự động chuyển đổi dự phòng (Failover) sang Model AI khác đang kết nối trên máy nếu model đang chọn bị quá tải (429 Too Many Requests) hoặc lỗi kết nối.
 */
export async function callLLM({ aiModel = '', aiProvider = '', systemPromptFile, systemPrompt, schema, input, tools = [], refImagePath = null, allowFailover = true }) {
  const primarySel = resolveAiSelection({ aiProvider, aiModel });
  const sysText = systemPromptFile ? fs.readFileSync(systemPromptFile, 'utf8') : String(systemPrompt || '');

  const runWithSelection = async (sel) => {
    if (sel.provider === 'chatgpt') {
      const r = await callChatGPT({
        model: sel.model,
        systemPrompt: sysText,
        input,
        schema,
        refImagePath,
      });
      return { ...r, aiSelection: sel };
    }
    if (sel.provider === 'gemini') {
      const r = await callGemini({
        model: sel.model,
        systemPrompt: sysText,
        input,
        schema,
        refImagePath,
      });
      return { ...r, aiSelection: sel };
    }
    const r = await callClaude({
      model: sel.model,
      systemPromptFile,
      systemPrompt: sysText,
      schema,
      input,
      tools,
    });
    return { ...r, aiSelection: sel };
  };

  try {
    return await runWithSelection(primarySel);
  } catch (primaryErr) {
    if (!allowFailover) throw primaryErr;
    const fallbackOrder = ['claude:claude-sonnet-4-5', 'gemini:gemini-3.8-flash-high', 'chatgpt:gpt-5.6-terra']
      .map((spec) => resolveAiSelection(spec))
      .filter((s) => s.provider !== primarySel.provider);

    for (const altSel of fallbackOrder) {
      try {
        return await runWithSelection(altSel);
      } catch {
        // Thử tiếp provider dự phòng kế tiếp
      }
    }
    throw primaryErr;
  }
}

const TEST_AI_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
  },
  required: ['reply'],
};

/**
 * Kiểm tra nhanh kết nối Model AI (Claude / ChatGPT / Gemini).
 */
export async function testAiModel(aiModelInput = '') {
  const sel = resolveAiSelection(aiModelInput);
  const t0 = Date.now();
  const r = await callLLM({
    aiModel: sel.combined,
    systemPrompt: 'Bạn là trợ lý AI của Post AI Studio. Hãy trả lời ngắn gọn 1 câu tiếng Việt xác nhận model đang hoạt động tốt.',
    schema: TEST_AI_SCHEMA,
    input: `Xác nhận kết nối từ ${sel.providerName} (${sel.model}).`,
  });
  return {
    ok: true,
    provider: sel.provider,
    providerName: sel.providerName,
    model: sel.model,
    modelName: sel.modelName,
    combined: sel.combined,
    reply: r.data?.reply || 'Kết nối thành công!',
    ms: Date.now() - t0,
  };
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
export async function agentDetectSkillsLLM(userInput = {}, { maxSkills = 2, excludeIds = [], aiModel = '' } = {}) {
  const rawInput = typeof userInput === 'string'
    ? userInput
    : [userInput.topic, userInput.character, userInput.audience, userInput.mustSay, userInput.tone, userInput.cta, userInput.prompt].filter(Boolean).join('\n');
  if (!rawInput.trim()) return { matchedSkills: [], costUsd: 0 };

  const allMap = new Map(listSkills().filter((s) => !s.builtin).map((s) => [s.id, s]));
  const exclude = new Set(excludeIds || []);
  const catalog = buildSkillCatalogSummary();
  if (!catalog) return { matchedSkills: [], costUsd: 0 };

  const r = await callLLM({
    aiModel: aiModel || userInput?.aiModel || '',
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
export async function resolveAgentSkills({ skillIds = [], userInput = {}, autoDetect = true, taskType = 'any', maxAuto = 2, aiModel = '' } = {}) {
  const resolved = resolveSkillsForTask({ skillIds, userInput, autoDetect, taskType, maxAuto });
  let costUsd = 0;
  let autoDetected = resolved.autoDetected;

  // Nếu bật autoDetect mà bộ khớp từ khóa chưa tìm ra Skill nào đủ điểm (và người dùng chưa chọn tay), gọi Agent LLM phân tích ngữ nghĩa
  const hasInput = typeof userInput === 'string'
    ? userInput.trim().length > 3
    : Boolean((userInput.topic || userInput.character || userInput.mustSay || userInput.prompt || '').trim());

  if (autoDetect && resolved.manualIds.length === 0 && autoDetected.length === 0 && hasInput) {
    try {
      const llmRoute = await agentDetectSkillsLLM(userInput, { maxSkills: maxAuto, excludeIds: resolved.manualIds, aiModel });
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
  const isViral = input.videoType === 'viral';
  const aiModel = input.aiModel || input.aiProvider || '';
  const route = await resolveAgentSkills({
    skillIds: input.skills || [],
    userInput: input,
    autoDetect,
    taskType: isViral ? 'viral' : 'video',
    maxAuto: 2,
    aiModel,
  });
  const sk = buildSkillPromptBlock(route.combinedIds, { includePinned: true, autoDetected: route.autoDetected });
  const tools = (refImagePath || sk.needsReadTool) ? ['Read'] : [];
  const { data: script, costUsd, aiSelection } = await callLLM({
    aiModel,
    systemPromptFile: config.skillFile,
    schema: SCRIPT_SCHEMA,
    input: buildBrief({ ...input, skillBlock: sk.block }, refImagePath),
    // Có ảnh nhân vật hoặc file tài liệu bổ sung trong skill → cho AI đọc.
    tools,
    refImagePath,
  });
  script.scenes.sort((a, b) => a.scene - b.scene);
  let cost = (route.costUsd || 0) + costUsd;
  const long = script.scenes.filter((s) => s.prompt.length > PROMPT_TARGET + 300);
  if (long.length) {
    const r = await compressPrompts(long.map((s) => ({ scene: s.scene, prompt: s.prompt })), { aiModel });
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
    aiSelection,
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

export async function rewriteForPolicy({ prompt, dialogue, level, failText = '', aiModel = '' }) {
  const r = await callLLM({
    aiModel,
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
  if (!out) throw new Error('Model AI không trả prompt viết lại');
  if (dialogue && !out.includes(dialogue)) out += `\n\nDIALOGUE — speak EXACTLY ONCE, in Vietnamese: "${dialogue}"`;
  if (!/voice of the attached @me avatar/i.test(out)) out = `Use the voice of the attached @me avatar (Tôi) for all dialogue.\n${out}`;
  let costUsd = r.costUsd || 0;
  if (out.length > PROMPT_TARGET + 150) { // quá dài → rút gọn (vẫn giữ lời thoại), tránh Flow cắt mất phần cuối
    const c = await compressPrompts([{ scene: 1, prompt: out }], { aiModel });
    costUsd += c.costUsd || 0;
    const shorter = c.prompts[0]?.prompt;
    if (shorter && (!dialogue || shorter.includes(dialogue))) out = shorter;
  }
  return { prompt: out.slice(0, PROMPT_LIMIT - 20), costUsd };
}

export async function compressPrompts(items, { aiModel = '' } = {}) {
  let pending = items.map((x) => ({ ...x }));
  const result = new Map();
  let costUsd = 0;
  for (const target of [PROMPT_TARGET, 3000, 2600]) {
    const r = await callLLM({
      aiModel,
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
export async function extractBriefFromSkills({ skillIds = [], topic = '', userInput = {}, autoDetect = true, aiModel = '' }) {
  const mergedInput = { ...userInput, topic: topic || userInput.topic || '' };
  const chosenAi = aiModel || userInput?.aiModel || '';
  const route = await resolveAgentSkills({
    skillIds,
    userInput: mergedInput,
    autoDetect,
    taskType: mergedInput.videoType === 'viral' ? 'viral' : 'video',
    maxAuto: 2,
    aiModel: chosenAi,
  });
  const sk = buildSkillPromptBlock(route.combinedIds, { includePinned: true, autoDetected: route.autoDetected });
  if (!sk.block) throw new Error('Hãy chọn ít nhất 1 Skill hoặc nhập vài từ khóa về chủ đề/nhân vật để Agent tự động nhận diện Skill phù hợp!');
  const r = await callLLM({
    aiModel: chosenAi,
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
    aiSelection: r.aiSelection,
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
export async function askWithSkills({ skillIds = [], prompt = '', autoDetect = true, aiModel = '' }) {
  if (!String(prompt || '').trim()) throw new Error('Hãy nhập yêu cầu cho AI');
  const route = await resolveAgentSkills({
    skillIds,
    userInput: { prompt },
    autoDetect,
    taskType: 'any',
    maxAuto: 2,
    aiModel,
  });
  const sk = buildSkillPromptBlock(route.combinedIds, { includePinned: true, autoDetected: route.autoDetected });
  if (!sk.block) throw new Error('Agent chưa tìm thấy Skill khớp với yêu cầu này — hãy chọn 1 Skill ở ô phía trên hoặc mô tả rõ hơn chủ đề/nhân vật!');
  const r = await callLLM({
    aiModel,
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
    aiSelection: r.aiSelection,
    costUsd: (route.costUsd || 0) + (r.costUsd || 0),
  };
}

const VIRAL_TOPICS_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      description: 'Danh sách 8 chủ đề Video Viral đăng bài hàng ngày kéo Traffic và tiếp cận khách hàng tiềm năng cho Fanpage',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Tên chủ đề ngắn gọn, giật tít hấp dẫn' },
          viralFormat: {
            type: 'string',
            enum: ['storytelling', 'myth_busting', 'mistakes', 'tips_hacks', 'philosophy', 'transformation'],
            description: 'Mã định dạng kịch bản viral phù hợp nhất',
          },
          groupLabel: { type: 'string', description: 'Tên nhóm chủ đề tiếng Việt (vd: Kể chuyện & Twist, Bóc sự thật, Cảnh báo sai lầm, Bí kíp nhanh, Góc nhìn đời sống, Trước - Sau)' },
          hook: { type: 'string', description: 'Câu thoại Hook 3 giây đầu (tiếng Việt) chặn đứng ngón tay lướt của người lạ' },
          angle: { type: 'string', description: 'Tóm tắt mạch triển khai câu chuyện / tình huống đời thường → cao trào / twist (2-3 câu)' },
          trafficReason: { type: 'string', description: 'Lý do chủ đề này dễ nổ view, kích thích bình luận/chia sẻ và kéo đúng tệp khách hàng về Fanpage' },
          suggestedCta: { type: 'string', description: 'Câu kết / câu hỏi mở tương tác hoặc dẫn dắt khéo léo cuối video' },
          characterHint: { type: 'string', description: 'Gợi ý nhân vật / bối cảnh xuất hiện (nếu có trong Skill thì lấy đúng nhân vật của Skill)' },
        },
        required: ['title', 'viralFormat', 'groupLabel', 'hook', 'angle', 'trafficReason', 'suggestedCta', 'characterHint'],
      },
    },
  },
  required: ['topics'],
};

/**
 * AI Gợi ý bộ Chủ đề Video Viral đăng bài hàng ngày kéo Traffic & tiếp cận khách hàng cho Fanpage.
 * Kết hợp dữ liệu ngách/tệp khách hàng của người dùng + kiến thức từ các Skill (nhân vật/thương hiệu + công thức Viral Reels).
 */
export async function generateViralTopics({ niche = '', audience = '', character = '', viralFormat = 'storytelling', trafficGoal = 'engage_comment', skillIds = [], autoDetect = true, aiModel = '' } = {}) {
  const userInput = {
    topic: niche,
    audience,
    character,
    videoType: 'viral',
    viralFormat,
    trafficGoal,
  };
  const route = await resolveAgentSkills({
    skillIds,
    userInput,
    autoDetect,
    taskType: 'viral',
    maxAuto: 2,
    aiModel,
  });
  const sk = buildSkillPromptBlock(route.combinedIds, { includePinned: true, autoDetected: route.autoDetected });
  const fmtObj = VIRAL_FORMATS.find((f) => f.id === viralFormat) || VIRAL_FORMATS[0];
  const goalObj = TRAFFIC_GOALS.find((g) => g.id === trafficGoal) || TRAFFIC_GOALS[0];

  const promptParts = [
    `Ngách Fanpage / Lĩnh vực / Chủ đề người dùng quan tâm: ${niche.trim() || '(Chưa nhập cụ thể — hãy lấy theo ngành hàng/nhân vật trong Skill hoặc gợi ý các chủ đề đời sống - sức khỏe - kinh doanh phổ quát dễ nổ view nhất)'}`,
    audience ? `Tệp khách hàng tiềm năng cần tiếp cận: ${audience.trim()}` : '',
    character ? `Nhân vật kênh: ${character.trim()}` : '',
    `Định dạng ưu tiên: ${fmtObj.name} (nhưng hãy đa dạng hóa cả 6 nhóm công thức viral để người dùng dễ chọn đăng bài cả tuần).`,
    `Mục tiêu kéo Traffic chính: ${goalObj.name} — ${goalObj.defaultCta}`,
    sk.block || '',
  ].filter(Boolean).join('\n\n');

  const r = await callLLM({
    aiModel,
    systemPrompt:
      'Bạn là Giám đốc Chiến lược Nội dung Viral Facebook Reels & Tăng trưởng Traffic Fanpage của Post AI Studio. ' +
      'Nhiệm vụ của bạn là tạo ra 8 ý tưởng kịch bản Video Viral đăng bài hàng ngày giúp Fanpage tiếp cận hàng chục ngàn khách hàng mới một cách tự nhiên (Organic Reach), kích thích bình luận/chia sẻ/lưu video mà KHÔNG mang mùi quảng cáo bán hàng khô khan. ' +
      'Mỗi ý tưởng phải có: (1) Hook 3 giây đầu cực sắc bén gây nhận diện ngay lập tức, (2) Tình huống đời thường gần gũi hoặc sự thật gây bất ngờ kèm cú Twist/bài học đắt giá, (3) Câu hỏi mở hoặc lời dẫn dắt khéo léo để kéo tương tác cho Fanpage. ' +
      'Nếu có Skill về nhân vật/thương hiệu được nạp, hãy giữ đúng nhân vật và tinh thần của Skill đó.',
    schema: VIRAL_TOPICS_SCHEMA,
    input: promptParts,
    tools: sk.needsReadTool ? ['Read'] : [],
  });

  return {
    topics: r.data?.topics || [],
    usedSkills: sk.usedSkillObjects,
    selectedIds: sk.selectedIds,
    autoDetectedSkills: route.autoDetected,
    aiSelection: r.aiSelection,
    costUsd: (route.costUsd || 0) + (r.costUsd || 0),
  };
}



