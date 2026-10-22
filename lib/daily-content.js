// Module Tạo Content & Hình Ảnh Đăng Bài Hàng Ngày Cho Fanpage (Kéo Traffic Phễu TOFU - MOFU - BOFU)
// Mỗi lần thực hiện chuẩn ĐÚNG 3 BÀI theo 3 dạng đăng bài của Facebook (không làm 6 bài):
// - Dạng 1 (text_comment): Bài Text nền + Comment (Bài chính chỉ đúng 1 câu Hook chọn màu nền trên FB, KHÔNG viết nội dung đi kèm tiêu đề, KHÔNG ảnh; toàn bộ nội dung diễn giải ở 4 Comment).
// - Dạng 2 (text_cards): Text nền + Bộ ảnh theo tiêu đề (Phần chữ chỉ gồm 1 câu Hook có con số N + Bộ N ảnh vuông 1:1 giải thích cho câu Hook đó: nền kem + chữ Serif nâu đậm lớn + ảnh người đàn ông Việt 40-65 tuổi).
// - Dạng 3 (content_image): Content Text + 1 Ảnh minh họa (Content gồm Hook - Body - CTA đầy đủ + đi kèm 1 ảnh minh họa vuông 1:1).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { callLLM } from './llm.js';
import * as SK from './skills.js';
import * as FB from './facebook.js';
import * as FBB from './fb-browser.js';
import * as FBAuth from './fb-auth.js';
import * as P from './posts.js';

const campaignsRoot = () => path.join(config.dataDir, 'content-campaigns');
const campaignsFile = () => path.join(campaignsRoot(), 'campaigns.json');

export const POST_FORMATS = [
  {
    id: 'text_comment',
    name: 'Dạng 1: Bài Text nền + Comment (Chỉ 1 câu Hook trên nền màu FB — Diễn giải ở 4 Comment, không ảnh)',
    shortName: 'Text nền + cmt',
    desc: 'Đăng trạng thái Text nền chọn màu trên Facebook: Bài chính CHỈ GỒM 1 câu Hook (không viết nội dung đi kèm tiêu đề, không dùng ảnh); toàn bộ nội dung diễn giải câu Hook nằm ở 4 Comment bên dưới.',
  },
  {
    id: 'text_cards',
    name: 'Dạng 2: Text nền + Bộ ảnh theo tiêu đề (1 câu Hook + Bộ ảnh chia sẻ từng mục)',
    shortName: 'Text nền + bộ ảnh',
    desc: 'Phần nội dung gồm 1 câu Hook có con số (VD: "5 thứ âm thầm rút cạn sinh lực đàn ông mỗi ngày...") và bộ N ảnh vuông 1:1 giải thích từng mục đó (Nền kem + tiêu đề ngắn 3–6 chữ + ảnh người Việt 40–65 tuổi).',
  },
  {
    id: 'content_image',
    name: 'Dạng 3: Content Text + 1 Ảnh minh họa (Hook – Body – CTA kèm 1 ảnh)',
    shortName: 'Content text + ảnh',
    desc: 'Bài viết hoàn chỉnh gồm Hook (câu mở đầu trước Xem thêm) – Body (câu chuyện minh họa / giải thích sâu sắc) – CTA (Inbox Fanpage) và đăng cùng 1 ảnh minh họa vuông 1:1.',
  },
];

export const FUNNEL_STAGES = [
  {
    id: 'TOFU',
    name: 'TOFU — Nhận diện vấn đề & Kéo tương tác (180–350 chữ)',
    desc: 'Tập trung nhận diện triệu chứng/tình huống đời thường, đặt câu hỏi tương tác, KHÔNG bán hàng quá sớm.',
  },
  {
    id: 'MOFU',
    name: 'MOFU — Giải thích, Xây niềm tin & Kết nối tự nhiên (180–350 chữ)',
    desc: 'Giải thích nguyên nhân có căn cứ, hướng dẫn chăm sóc chủ động và kết nối sản phẩm một cách tự nhiên.',
  },
  {
    id: 'BOFU',
    name: 'BOFU — Nhu cầu, Giải pháp hỗ trợ & CTA (120–200 chữ)',
    desc: 'Đi thẳng vào nhu cầu, nêu công dụng hỗ trợ từ hồ sơ sản phẩm, kèm câu cảnh báo bắt buộc và CTA nhắn tin/bình luận.',
  },
];

const MANDATORY_DISCLAIMER = 'Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh.';

const FORBIDDEN_PATTERNS = [
  { re: /chữa\s+khỏi(\s+hoàn\s+toàn)?/gi, replace: 'hỗ trợ cải thiện' },
  { re: /điều\s+trị\s+khỏi(\s+hoàn\s+toàn)?/gi, replace: 'hỗ trợ chăm sóc' },
  { re: /hết\s+đau\s+hoàn\s+toàn/gi, replace: 'hỗ trợ giảm triệu chứng khó chịu' },
  { re: /cam\s+kết\s+khỏi(\s+bệnh)?/gi, replace: 'góp phần hỗ trợ sức khỏe' },
  { re: /trị\s+dứt\s+điểm/gi, replace: 'hỗ trợ cải thiện từ gốc' },
  { re: /khỏi\s+hoàn\s+toàn/gi, replace: 'hỗ trợ cải thiện bền vững' },
];

function ensureDir() {
  fs.mkdirSync(campaignsRoot(), { recursive: true });
}

function readCampaignsRaw() {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(campaignsFile(), 'utf8'));
  } catch {
    return [];
  }
}

function writeCampaignsRaw(list) {
  ensureDir();
  fs.writeFileSync(campaignsFile(), JSON.stringify(list, null, 2), 'utf8');
}

function countWords(text = '') {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function countEmojis(text = '') {
  const m = String(text || '').match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
  return m ? m.length : 0;
}

function limitEmojis(text = '', max = 15) {
  let count = 0;
  return String(text || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, (em) => {
    count++;
    return count <= max ? em : '';
  });
}

/**
 * Kiểm tra & chuẩn hóa bài viết theo đúng quy tắc 3 Dạng Bài & 15 Quy tắc Content:
 * - Dạng 1 (`text_comment`): Bài chính (`caption`) CHỈ ĐÚNG 1 câu Hook tiêu đề (không kèm nội dung dài), nội dung nằm ở 4 `comments`.
 * - Dạng 2 (`text_cards`): Bài chính (`caption`) CHỈ ĐÚNG 1 câu Hook tiêu đề, phần giải thích nằm ở bộ ảnh `cards`.
 * - Dạng 3 (`content_image`): Bài chính (`caption`) là bài viết đầy đủ gồm Hook (dòng đầu) - Body - CTA.
 */
export function enforceContentRules(post, campaign) {
  const title = String(post.title || '').trim();
  const productName = String(campaign?.productName || '').trim();
  const warnings = [];

  const sanitizeText = (txt) => {
    let out = String(txt || '').replace(/\r\n/g, '\n').trim();
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.re.test(out)) {
        warnings.push(`Đã tự động thay cụm từ cấm (${rule.re.source}) bằng "${rule.replace}"`);
        out = out.replace(rule.re, rule.replace);
      }
    }
    return out;
  };

  let caption = sanitizeText(post.caption || '');
  let comments = Array.isArray(post.comments) ? post.comments.map((c) => sanitizeText(c)).filter(Boolean) : [];

  if (post.postType === 'text_comment' || post.postType === 'text_cards') {
    // Dạng 1 & Dạng 2: Phần chữ bài đăng chính CHỈ GỒM 1 CÂU HOOK TIÊU ĐỀ, tuyệt đối không viết bài văn dài đi cùng tiêu đề!
    caption = title || caption.split('\n')[0] || '';
    if (post.postType === 'text_cards') {
      comments = [];
    }
  } else {
    // Dạng 3 (content_image): Câu mở đầu dùng đúng tiêu đề và nằm ở dòng đầu tiên trước nút "Xem thêm"
    comments = [];
    if (title) {
      const cleanCapStart = caption.slice(0, title.length + 25).toLowerCase();
      if (!cleanCapStart.includes(title.toLowerCase().slice(0, Math.min(28, title.length)))) {
        caption = `${title}\n\n${caption}`.trim();
      } else {
        const lines = caption.split('\n');
        if (lines.length > 1 && lines[1].trim() !== '') {
          caption = `${lines[0].trim()}\n\n${lines.slice(1).join('\n').trim()}`;
        }
      }
    }
  }

  // Quy tắc 12: Khi đề cập sản phẩm phải có câu "Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."
  const combinedAll = `${caption}\n${comments.join('\n')}`;
  const mentionsProduct = Boolean(
    (productName && productName.length >= 2 && new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(combinedAll)) ||
    /\b(bổ thận ft|viên nang|lọ 30 viên|thực phẩm bảo vệ sức khỏe)\b/i.test(combinedAll)
  );

  if (mentionsProduct && !combinedAll.includes(MANDATORY_DISCLAIMER)) {
    if (post.postType === 'text_comment' && comments.length > 0) {
      comments[comments.length - 1] = `${comments[comments.length - 1].trim()}\n\n${MANDATORY_DISCLAIMER}`;
    } else if (post.postType === 'content_image') {
      caption = `${caption.trim()}\n\n${MANDATORY_DISCLAIMER}`;
    }
  }

  // Quy tắc 6: Tối đa 15 emoji trong toàn bộ một bài (kể cả comment)
  let remainingEmojis = 15;
  const capEmojiCount = countEmojis(caption);
  if (capEmojiCount > remainingEmojis) {
    caption = limitEmojis(caption, remainingEmojis);
    remainingEmojis = 0;
  } else {
    remainingEmojis -= capEmojiCount;
  }
  comments = comments.map((c) => {
    const cCount = countEmojis(c);
    if (cCount > remainingEmojis) {
      const trimmed = limitEmojis(c, remainingEmojis);
      remainingEmojis = 0;
      return trimmed;
    }
    remainingEmojis -= cCount;
    return c;
  });

  const totalWords = post.postType === 'text_comment'
    ? countWords(comments.join(' '))
    : post.postType === 'text_cards'
      ? countWords([caption, ...(post.cards || []).map((c) => c.cardTitle || '')].join(' '))
      : countWords(caption);
  const totalEmojis = countEmojis(`${caption} ${comments.join(' ')}`);

  return {
    caption,
    comments,
    wordCount: totalWords,
    emojiCount: totalEmojis,
    mentionsProduct,
    complianceWarnings: warnings,
  };
}

/** Trích xuất con số mục cần minh họa trong tiêu đề (Quy tắc 7: "5 thứ" -> 5, "4 thói quen" -> 4, không nhầm với tuổi 40-65 hoặc %). */
export function detectItemCountFromTitle(title = '', fallback = 5) {
  const s = String(title || '');
  const m = s.match(/\b([2-8])\s+(thứ|dấu hiệu|thói quen|sai lầm|lầm tưởng|câu|nguyên tắc|cách|bước|mức|lý do|điểm|mẹo|thực phẩm|vị|nhóm|điều|bí quyết|việc)\b/i);
  if (m) return Math.min(7, Math.max(2, Number(m[1])));
  return fallback;
}

/** Danh sách 3 bài mẫu chuẩn theo đúng 3 ví dụ người dùng đưa ra. */
export function buildStandardSamplePosts(todayStr = new Date().toISOString().slice(0, 10)) {
  return [
    {
      id: 'dp-sample-1',
      date: todayStr,
      scheduledTime: '08:00',
      pillarId: 'P1',
      pillarName: 'P1 · Đêm không yên',
      funnel: 'TOFU',
      postType: 'text_comment',
      title: 'Có 1 thói quen mỗi tối đang âm thầm phá giấc ngủ đàn ông tuổi 40, nó là gì',
      cardCount: 0,
      includeProduct: false,
      imageSpec: '',
      selected: true,
      status: 'content_ready',
      caption: 'Có 1 thói quen mỗi tối đang âm thầm phá giấc ngủ đàn ông tuổi 40, nó là gì',
      comments: [
        '🌙 Tối nay, anh thử dành khoảng một giờ trước khi ngủ để chậm lại:\n• Đặt điện thoại xa tầm tay, tắt thông báo không cần thiết.\n• Giảm ánh sáng trong phòng.\n• Đọc vài trang sách giấy hoặc nghe nhạc nhẹ.\n• Duy trì giờ ngủ và thức dậy tương đối đều đặn.\nBắt đầu bằng một thay đổi nhỏ, phù hợp với sinh hoạt của anh.',
        'Ánh sáng từ màn hình vào buổi tối có thể khiến cơ thể nhận tín hiệu tiếp tục thức. Còn việc mải xem điện thoại dễ đẩy giờ ngủ muộn hơn dự định.\nThói quen này có thể góp phần khiến anh khó vào giấc, nhưng không phải nguyên nhân duy nhất gây mất ngủ, cũng không chỉ xảy ra ở tuổi 40.',
        '📱 Đó là lên giường rồi vẫn cầm điện thoại, tự nhủ: “Xem thêm một chút rồi ngủ.”\nMột video, vài tin nhắn, thêm ít tin tức… Đến khi nhìn lại đồng hồ, giờ ngủ đã trôi qua từ lúc nào.\nAnh đã nằm xuống nghỉ, nhưng vẫn chưa cho mình khoảng thời gian thật sự yên tĩnh.',
        'Chăm sóc bản thân đôi khi bắt đầu từ việc đặt chiếc điện thoại xuống sớm hơn mỗi tối.\nNếu khó ngủ kéo dài hoặc ảnh hưởng sinh hoạt ban ngày, anh nên đi khám để tìm nguyên nhân.\n💬 Anh thường cất điện thoại lúc mấy giờ? Muốn nhận bảng nhắc thói quen trước giờ ngủ, anh có thể nhắn tin riêng cho trang nhé.',
      ],
      cards: [],
      imagePoints: [],
      images: [],
      wordCount: 228,
      emojiCount: 3,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'dp-sample-2',
      date: todayStr,
      scheduledTime: '12:30',
      pillarId: 'P3',
      pillarName: 'P3 · Chăm phong độ mỗi ngày',
      funnel: 'TOFU',
      postType: 'text_cards',
      title: '5 thứ âm thầm rút cạn sinh lực đàn ông mỗi ngày mà không ai nghĩ tới',
      cardCount: 5,
      includeProduct: false,
      imageSpec: 'Bộ 5 ảnh vuông 1:1 (1080×1080) chia sẻ 5 thứ rút cạn sinh lực: Nền kem ấm phía trên kèm tiêu đề ngắn 3–6 chữ font Times New Roman đậm màu nâu + ảnh chân thực người đàn ông Việt 40–65 tuổi đúng tình huống ở dưới.',
      selected: true,
      status: 'content_ready',
      caption: '5 thứ âm thầm rút cạn sinh lực đàn ông mỗi ngày mà không ai nghĩ tới',
      comments: [],
      cards: [
        {
          badge: '01',
          cardTitle: 'Uống nhiều rượu bia',
          sceneKey: 'alcohol',
          sceneHint: 'Người đàn ông Việt trung niên ngồi bàn nhậu cầm ly bia vẻ mặt trầm ngâm',
          points: [],
        },
        {
          badge: '02',
          cardTitle: 'Căng thẳng kéo dài',
          sceneKey: 'stress',
          sceneHint: 'Người đàn ông Việt trung niên ngồi bàn làm việc cầm tài liệu, tay đỡ trán căng thẳng',
          points: [],
        },
        {
          badge: '03',
          cardTitle: 'Hút thuốc mỗi ngày',
          sceneKey: 'smoking',
          sceneHint: 'Người đàn ông Việt trung niên ngồi ngoài ban công cùng ly cà phê và gạt tàn thuốc lá',
          points: [],
        },
        {
          badge: '04',
          cardTitle: 'Ngồi quá lâu, ít vận động',
          sceneKey: 'sedentary',
          sceneHint: 'Người đàn ông Việt trung niên ngồi ghế văn phòng trước máy tính, hai tay xoa mỏi cổ vai gáy',
          points: [],
        },
        {
          badge: '05',
          cardTitle: 'Thiếu ngủ mỗi đêm',
          sceneKey: 'insomnia',
          sceneHint: 'Người đàn ông Việt trung niên mặc đồ ngủ ngồi bên mép giường lúc đêm khuya cạnh đèn ngủ và đồng hồ',
          points: [],
        },
      ],
      imagePoints: [],
      images: [],
      wordCount: 34,
      emojiCount: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'dp-sample-3',
      date: todayStr,
      scheduledTime: '19:30',
      pillarId: 'P1',
      pillarName: 'P1 · Đêm không yên',
      funnel: 'MOFU',
      postType: 'content_image',
      title: 'Anh tài xế 49 tuổi đếm số đêm ngủ trọn giấc trong tháng, con số khiến anh lặng người',
      cardCount: 1,
      includeProduct: false,
      imageHeadline: 'Đếm số đêm ngủ trọn giấc',
      imageSpec: '1 ảnh minh họa vuông 1:1 (1080×1080): Phần trên nền kem chữ Serif nâu đậm "Đếm số đêm ngủ trọn giấc", phần dưới ảnh chân thực anh tài xế 49 tuổi ngồi bên cuốn sổ nhỏ ghi lịch chạy xe dưới ánh đèn vàng buổi tối.',
      selected: true,
      status: 'content_ready',
      caption: 'Anh tài xế 49 tuổi đếm số đêm ngủ trọn giấc trong tháng, con số khiến anh lặng người\n\n📌 Câu chuyện minh họa, không phải phản hồi khách hàng thực tế.\n\nCuối tháng, anh mở cuốn sổ nhỏ vẫn dùng để ghi lịch chạy xe. Lần này, anh thử đánh dấu những đêm mình ngủ liền mạch, sáng dậy thấy được nghỉ ngơi.\nĐếm xong, anh ngồi im. Những dấu đánh ấy thưa hơn anh tưởng.\n\n🚛 Trước đây, anh chỉ nhớ hôm nào có chuyến sớm, hôm nào phải về muộn. Còn những đêm trằn trọc, tỉnh giấc rồi chờ ngủ lại, anh đều gạt đi: “Nghề này thì chịu thôi.”\nCó hôm vừa tỉnh, anh cầm điện thoại xem lịch xe. Đặt máy xuống, đầu óc lại tính giờ xuất phát, đường đi và công việc ngày mai.\nAnh nhận ra mình ghi rất kỹ từng chuyến hàng, nhưng chưa từng ghi lại giấc ngủ của bản thân.\n\n🌙 Từ đó, anh bắt đầu theo dõi giờ ngủ, những lần thức giấc và cảm giác vào ban ngày. Anh cũng sắp xếp thời gian nghỉ và trao đổi với vợ về những thay đổi gần đây.\nNgủ chập chờn không đủ để kết luận là “thận yếu”. Nếu tình trạng kéo dài, ảnh hưởng sinh hoạt, anh nên thăm khám để tìm nguyên nhân. Khi buồn ngủ lúc lái xe, cần dừng ở nơi an toàn để nghỉ.\n\n📩 Inbox Fanpage nếu anh muốn trao đổi riêng tư về chủ đề chăm sóc giấc ngủ ở tuổi trung niên.',
      comments: [],
      cards: [],
      imagePoints: [],
      images: [],
      wordCount: 245,
      emojiCount: 4,
      createdAt: new Date().toISOString(),
    },
  ];
}

/** Khởi tạo chiến dịch mẫu từ Skill CONTENT FT EVERYDAY (ft-daily-content) nếu có. */
export function ensureDefaultFtCampaign(inputList = null) {
  const list = Array.isArray(inputList) ? inputList : readCampaignsRaw();
  if (list.some((c) => c.id === 'ft-daily-campaign')) return list;
  const ftDir = path.join(config.dataDir, 'skills', 'ft-daily-content');
  if (!fs.existsSync(ftDir)) return list;

  const productImg = path.join(ftDir, 'assets', 'ft-original-product.jpg');
  const excelMd = path.join(ftDir, 'references', 'campaign-october-2026.xlsx.md');
  const pdfMd = path.join(ftDir, 'references', 'ft-product-source.pdf.md');
  const voicesMd = path.join(ftDir, 'references', 'product-and-voices.md');

  let productSourceText = '';
  try {
    if (fs.existsSync(voicesMd)) productSourceText += fs.readFileSync(voicesMd, 'utf8') + '\n\n';
    if (fs.existsSync(pdfMd)) productSourceText += fs.readFileSync(pdfMd, 'utf8') + '\n\n';
  } catch { /* ignore */ }

  let scheduleSourceText = '';
  try {
    if (fs.existsSync(excelMd)) scheduleSourceText = fs.readFileSync(excelMd, 'utf8');
  } catch { /* ignore */ }

  const campDir = path.join(campaignsRoot(), 'ft-daily-campaign');
  fs.mkdirSync(campDir, { recursive: true });
  let localProductImg = '';
  if (fs.existsSync(productImg)) {
    localProductImg = path.join(campDir, 'ft-original-product.jpg');
    fs.writeFileSync(localProductImg, fs.readFileSync(productImg));
    const cutoutSrc = path.join(ftDir, 'assets', 'ft-cutout-box-bottle.png');
    if (fs.existsSync(cutoutSrc)) {
      fs.writeFileSync(path.join(campDir, 'ft-cutout-box-bottle.png'), fs.readFileSync(cutoutSrc));
    }
  }

  const defaultCampaign = {
    id: 'ft-daily-campaign',
    name: 'Chiến dịch Content Hàng Ngày — Bổ Thận FT',
    productName: 'Bổ Thận FT',
    brandName: 'FOOD TECH',
    skillId: 'ft-daily-content',
    targetAudience: 'Nam giới Việt Nam 38–65 tuổi (và góc nhìn người vợ chăm chồng), quan tâm giấc ngủ, tiểu đêm, sinh lực và phong độ bền vững.',
    brandVoice: 'Chuyên nghiệp, điềm đạm, tôn trọng, cảm thông; xưng anh/anh em (kênh PHONG ĐỘ) hoặc góc nhìn người vợ/gia đình (kênh PHỤC HỒI).',
    productInfo: productSourceText.trim() || 'Thực phẩm bảo vệ sức khỏe Bổ Thận FT — Lọ 30 viên nang. Công thức gồm 11 dược liệu: Thục địa, Hoài sơn, Sơn thù du, Bạch linh, Trạch tả, Mẫu đơn bì; Nhục thung dung, Ba kích, Thỏ ty tử, Dâm dương hoắc; Sâm Ngọc Linh. Sản xuất chuẩn GMP, hợp tác nghiên cứu cùng Viện Y học Cổ truyền. Hỗ trợ bổ thận, tráng dương, tăng cường sinh lực và hỗ trợ cải thiện sinh lý nam giới.',
    scheduleText: scheduleSourceText,
    productImagePath: localProductImg,
    productImageUrl: localProductImg ? '/content-files/ft-daily-campaign/ft-original-product.jpg' : '',
    logoPath: '',
    logoUrl: '',
    logoText: 'FOOD TECH',
    logoCorner: 'top-right',
    postsPerDay: 3,
    pillars: [
      {
        id: 'P1',
        name: 'P1 · Đêm không yên',
        funnel: 'TOFU',
        ratio: '25%',
        desc: 'Nhận diện các trăn trở ban đêm ở tuổi trung niên: trằn trọc khó ngủ, thức giấc lúc 2–3h sáng, tiểu đêm nhiều lần làm sáng dậy uể oải.',
        sampleHooks: [
          'Có 1 thói quen mỗi tối đang âm thầm phá giấc ngủ đàn ông tuổi 40, nó là gì',
          'Anh tài xế 49 tuổi đếm số đêm ngủ trọn giấc trong tháng, con số khiến anh lặng người',
        ],
      },
      {
        id: 'P2',
        name: 'P2 · Hiểu đúng về thận',
        funnel: 'MOFU',
        ratio: '20%',
        desc: 'Giải mã góc nhìn khoa học & Đông y chính thống: phân biệt thận Đông y và thận Tây y, tránh tự ý kết luận hay dùng sai cách.',
        sampleHooks: [
          'Tiểu đêm không đồng nghĩa với thận yếu, đừng vội kết luận',
          '4 lầm tưởng phổ biến khiến đàn ông tuổi 40+ càng bồi bổ càng mệt mỏi',
        ],
      },
      {
        id: 'P3',
        name: 'P3 · Chăm phong độ mỗi ngày',
        funnel: 'TOFU',
        ratio: '20%',
        desc: 'Thói quen sinh hoạt, ăn uống, vận động nhẹ và giấc ngủ giúp giữ gìn nền tảng sức khỏe bền vững tuổi trung niên.',
        sampleHooks: [
          '5 thứ âm thầm rút cạn sinh lực đàn ông mỗi ngày mà không ai nghĩ tới',
          'Sau tuổi 40, giữ phong độ không nằm ở những thứ cấp tốc mà ở nhịp sinh hoạt mỗi tối',
        ],
      },
      {
        id: 'P4',
        name: 'P4 · Hiểu rõ Bổ Thận FT',
        funnel: 'BOFU',
        ratio: '20%',
        desc: 'Giới thiệu minh bạch 11 dược liệu trong Bổ Thận FT (6 vị Lục vị + 4 thảo dược bổ trợ + Sâm Ngọc Linh), chuẩn GMP, cách dùng & lưu ý an toàn.',
        sampleHooks: [
          'Bổ Thận FT là sản phẩm gì, tóm tắt trong 60 giây cho người mới tìm hiểu',
          'Vì sao công thức Bổ Thận FT kết hợp 11 dược liệu cùng Sâm Ngọc Linh theo hướng bồi bổ từ gốc?',
        ],
      },
      {
        id: 'P5',
        name: 'P5 · Chuyện vợ chồng',
        funnel: 'TOFU',
        ratio: '15%',
        desc: 'Sự thấu hiểu, sẻ chia tinh tế giữa hai vợ chồng tuổi trung niên khi sức khỏe và nhịp sinh học thay đổi.',
        sampleHooks: [
          'Câu "anh mệt" nói bao nhiêu lần thì người phụ nữ bên cạnh bắt đầu lặng im?',
          'Phụ nữ tuổi 40 thương chồng không hỏi câu nặng lời, chỉ nhìn cách anh trở mình mỗi đêm',
        ],
      },
    ],
    productSummary: {
      ingredients: '11 dược liệu: 6 vị bài Lục vị (Thục địa, Hoài sơn, Sơn thù du, Bạch linh, Trạch tả, Mẫu đơn bì) + 4 thảo dược bổ trợ (Nhục thung dung, Ba kích, Thỏ ty tử, Dâm dương hoắc) + Sâm Ngọc Linh.',
      approvedBenefits: 'Hỗ trợ bổ thận, tráng dương, góp phần tăng cường sinh lực và hỗ trợ chăm sóc sức khỏe sinh lý nam giới tuổi trung niên.',
      contraindications: 'Không dùng cho người dưới 18 tuổi, người mẫn cảm với bất kỳ thành phần nào; người có bệnh lý nền nặng nên tham khảo ý kiến chuyên gia y tế.',
    },
    posts: buildStandardSamplePosts(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  list.unshift(defaultCampaign);
  writeCampaignsRaw(list);
  return list;
}

/**
 * Tóm tắt ngắn gọn thông tin sản phẩm & nguyên tắc tuân thủ (không chứa đường dẫn file trên ổ đĩa để tránh CLI chạy lệnh đọc file gây lỗi 429).
 */
function buildCompactProductContext(camp) {
  const sum = camp?.productSummary || {};
  const lines = [
    `- Sản phẩm: ${camp?.productName || 'Thực phẩm bảo vệ sức khỏe Bổ Thận FT'} (${camp?.brandName || 'FOOD TECH'})`,
    `- Đối tượng: ${camp?.targetAudience || 'Nam giới Việt Nam 38–65 tuổi và gia đình'}`,
    `- Giọng văn: ${camp?.brandVoice || 'Chuyên nghiệp, điềm đạm, tôn trọng, cảm thông, xưng anh'}`,
    `- Thành phần chuẩn trong hồ sơ: ${sum.ingredients || '11 dược liệu dạng cao chiết theo cấu trúc 6 + 4 + 1: 6 vị nền Lục Vị Địa Hoàng (Thục địa 320mg, Hoài sơn 160mg, Sơn thù du 160mg, Bạch linh 120mg, Trạch tả 120mg, Mẫu đơn bì 120mg) + 4 vị tráng dương tăng sinh lực (Nhục thung dung 200mg, Ba kích 160mg, Thỏ ty tử 160mg, Dâm dương hoắc 50mg) + Sâm Ngọc Linh 20mg.'}`,
    `- Công dụng hỗ trợ được phép nêu: ${sum.approvedBenefits || 'Hỗ trợ bổ thận, tráng dương, góp phần tăng cường sinh lực và hỗ trợ cải thiện sinh lý nam giới; hỗ trợ giảm tiểu đêm, tiểu nhiều lần, đau lưng, mỏi gối.'}`,
    `- Lưu ý đối tượng: ${sum.contraindications || 'Không dùng cho người dưới 18 tuổi, người huyết áp cao, bệnh tim mạch, người mẫn cảm với thành phần; người có bệnh nền đang dùng thuốc cần hỏi ý kiến thầy thuốc.'}`,
    `- Quy tắc bắt buộc: Chỉ dùng các từ "hỗ trợ, góp phần, giúp chăm sóc, hỗ trợ giảm triệu chứng". Tuyệt đối KHÔNG dùng "chữa khỏi, điều trị khỏi, hết đau hoàn toàn, cam kết khỏi". Không đánh đồng thận Đông y với bệnh thận thực thể Tây y. Khi có nhắc tên sản phẩm phải kèm nguyên văn: "${MANDATORY_DISCLAIMER}"`,
  ];
  return lines.join('\n');
}

/**
 * Tạo cụm tiêu đề ngắn (3–6 chữ) cho phần nền kem trên ảnh minh họa Dạng 3 từ tiêu đề bài viết.
 */
function deriveShortImageHeadline(title = '') {
  const s = String(title || '').trim();
  if (!s) return 'Chăm sóc sức khỏe tuổi trung niên';
  if (/đếm số đêm ngủ trọn giấc/i.test(s)) return 'Đếm số đêm ngủ trọn giấc';
  if (/thận.*tiểu đêm|tiểu đêm.*thận/i.test(s)) return 'Hiểu đúng thận và tiểu đêm';
  if (/đông y.*تây y|tây y.*đông y/i.test(s)) return 'Thận Đông y và Tây y';
  if (/nóng trong/i.test(s)) return 'Vì sao bổ mà không nóng';
  if (/tài xế|lái xe/i.test(s)) return 'Giấc ngủ người chạy xe đường dài';
  if (/vợ chồng|người vợ/i.test(s)) return 'Sự thấu hiểu tuổi trung niên';
  if (/cà phê|mất ngủ|giấc ngủ/i.test(s)) return 'Giữ nhịp giấc ngủ trọn vẹn';
  if (/11 dược liệu|lục vị|công thức/i.test(s)) return 'Công thức 11 vị dược liệu';
  const firstClause = s.split(/[,:;–—?!]/)[0].trim();
  const words = firstClause.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return firstClause;
  return words.slice(0, 6).join(' ');
}

/**
 * Bộ tạo nội dung chuẩn Hook - Body - CTA (cho Dạng 3), 4 Comment (cho Dạng 1), và Bộ thẻ ảnh (cho Dạng 2)
 * vừa dùng để điền ngay khi khởi tạo đề xuất, vừa làm dự phòng thông minh nếu kết nối AI bị quá tải (429).
 */
export function buildFallbackContentForPost(post, camp) {
  const title = String(post.title || '').trim();
  const productName = camp?.productName || 'Bổ Thận FT';

  if (post.postType === 'text_comment') {
    return {
      caption: title,
      comments: [
        `🌙 Tối nay, anh thử dành một khoảng thời gian ngắn để rà soát lại nhịp sinh hoạt của mình:\n• Duy trì giờ đi ngủ và thức dậy tương đối cố định.\n• Hạn chế uống nhiều nước, trà đặc hoặc bia rượu sát giờ nằm nghỉ.\n• Giữ phòng ngủ yên tĩnh, ánh sáng dịu nhẹ.\n• Ghi nhận lại những thay đổi của cơ thể trong khoảng 1–2 tuần.\nBắt đầu từ những điều chỉnh nhỏ, phù hợp với lịch sinh hoạt hằng ngày của anh.`,
        `Cơ thể bước qua tuổi 40 thường nhạy cảm hơn với áp lực công việc, thức khuya và thói quen ăn uống thất thường.\nNhững biểu hiện như ngủ không sâu giấc, dậy đêm hay mệt mỏi ban ngày có thể liên quan đến nhiều yếu tố sinh hoạt, không nên vội quy kết cho một nguyên nhân duy nhất.`,
        `📌 Nhiều anh thường chủ quan cho rằng “lớn tuổi thì ai cũng vậy” nên cứ âm thầm chịu đựng qua từng tháng.\nChỉ đến khi sáng thức dậy thấy uể oải, khó tập trung làm việc mới nhận ra cơ thể đã thiếu những khoảng nghỉ ngơi trọn vẹn từ lúc nào.`,
        `Chăm sóc sức khỏe ở tuổi trung niên luôn bắt đầu từ việc lắng nghe cơ thể và điều chỉnh thói quen mỗi ngày.\nNếu các biểu hiện kéo dài hoặc ảnh hưởng rõ tới sinh hoạt, anh nên chủ động đi khám để được kiểm tra chính xác.\n💬 Hiện tại anh đang quan tâm nhất đến giấc ngủ hay sức bền ban ngày? Nhắn tin riêng cho trang nếu anh cần bảng theo dõi sinh hoạt tại nhà nhé.`,
      ],
      imageHeadline: '',
      cards: [],
    };
  }

  if (post.postType === 'text_cards') {
    const count = detectItemCountFromTitle(title, post.cardCount || 5);
    const defaultCards = [
      { badge: '01', cardTitle: 'Uống nhiều rượu bia', sceneKey: 'alcohol', sceneHint: 'Người đàn ông Việt trung niên ngồi bàn nhậu cầm ly bia trầm ngâm', points: [] },
      { badge: '02', cardTitle: 'Căng thẳng kéo dài', sceneKey: 'stress', sceneHint: 'Người đàn ông Việt trung niên ngồi bàn làm việc xem giấy tờ, tay đỡ trán căng thẳng', points: [] },
      { badge: '03', cardTitle: 'Hút thuốc mỗi ngày', sceneKey: 'smoking', sceneHint: 'Người đàn ông Việt trung niên ngồi ban công cùng ly cà phê và gạt tàn thuốc lá', points: [] },
      { badge: '04', cardTitle: 'Ngồi quá lâu, ít vận động', sceneKey: 'sedentary', sceneHint: 'Người đàn ông Việt trung niên ngồi ghế văn phòng xoa mỏi cổ vai gáy', points: [] },
      { badge: '05', cardTitle: 'Thiếu ngủ mỗi đêm', sceneKey: 'insomnia', sceneHint: 'Người đàn ông Việt trung niên mặc đồ ngủ ngồi bên mép giường lúc đêm khuya cạnh đèn ngủ và đồng hồ', points: [] },
    ];
    return {
      caption: title,
      comments: [],
      imageHeadline: '',
      cards: Array.from({ length: count }, (_, i) => ({
        ...defaultCards[i % defaultCards.length],
        badge: `0${i + 1}`,
      })),
    };
  }

  // Dạng 3: Content text + 1 Ảnh minh họa (Bắt buộc đầy đủ Hook – Body – CTA)
  const isTraditionalTopic = /đông y|tiểu đêm|thận|lục vị|dược liệu|nóng trong/i.test(title);
  let bodyParagraphs = [];

  if (isTraditionalTopic) {
    bodyParagraphs = [
      '📌 Góc nhìn tham khảo kết hợp kiến thức chăm sóc sức khỏe, không thay thế chẩn đoán y khoa.',
      'Nhiều anh bước qua tuổi 40 thường bắt đầu trăn trở khi đêm đang ngủ lại tỉnh giấc dậy đi tiểu 2–3 lần. Sáng hôm sau thức dậy người uể oải, lưng gối mỏi nhừ, làm việc gì cũng nhanh xuống sức hơn trước.',
      '🌿 Trong quan niệm của Y học cổ truyền, “thận tàng tinh, chủ thủy dịch, chủ cốt tủy”. Khi cơ thể lao lực kéo dài, thức khuya hoặc sinh hoạt thất thường, sự điều hòa thủy dịch và khả năng cố nhiếp (giữ nước) suy giảm, góp phần khiến nhịp tiểu tiện ban đêm bị xáo trộn.',
      '🌙 Tuy nhiên, khái niệm “thận” trong Đông y là một hệ chức năng rộng, không đồng nhất hoàn toàn với quả thận giải phẫu trong Tây y. Vì vậy, thức giấc đi tiểu ban đêm có thể liên quan đến thói quen uống nước muộn, giấc ngủ nông hoặc các vấn đề tiết niệu khác — không đủ để tự kết luận là “thận yếu” hay bệnh thận thực thể.',
      'Thay vì tự ý mua các loại đồ ngâm truyền miệng chưa rõ thành phần, anh nên điều chỉnh lượng nước uống sau 20 giờ, giữ ấm vùng lưng bàn chân và đi thăm khám bác sĩ nếu tình trạng tiểu đêm kéo dài.',
    ];
  } else {
    bodyParagraphs = [
      '📌 Câu chuyện minh họa đời sống trung niên, không phải phản hồi khách hàng thực tế.',
      'Bước qua tuổi 40, nhiều anh vẫn giữ guồng quay công việc dày đặc từ sáng sớm tới tối muộn. Những đêm trằn trọc, tỉnh giấc giữa chừng rồi nằm chờ sáng thường bị gạt đi bằng câu nói quen thuộc: “Chắc tại dạo này nhiều việc quá.”',
      '🚛 Chỉ đến khi ngồi nhìn lại cả một tháng dài, số đêm thực sự ngủ liền mạch từ tối tới sáng lại đếm trên đầu ngón tay. Ban ngày vẫn cố gắng giữ vẻ tỉnh táo, nhưng chiều về là lưng mỏi, người hụt hơi và chẳng còn mấy năng lượng cho gia đình.',
      '🌙 Từ lúc nhận ra sức bền không còn tự nhiên như thời đôi mươi, nhiều anh bắt đầu học cách chậm lại: sắp xếp giờ nghỉ trước 23 giờ, bớt những buổi tụ tập muộn, vận động nhẹ nhàng 20–30 phút mỗi ngày và cởi mở chia sẻ cùng người bạn đời.',
      'Mệt mỏi hay ngủ chập chờn không đủ để tự quy kết là “thận yếu”. Nếu tình trạng kéo dài hoặc ảnh hưởng rõ đến sinh hoạt hằng ngày, anh nên chủ động thăm khám chuyên khoa để tìm đúng nguyên nhân.',
    ];
  }

  if (post.includeProduct || post.funnel === 'BOFU') {
    bodyParagraphs.push(
      `Với những anh muốn tìm hiểu hướng chăm sóc từ thảo dược chuẩn hóa, ${productName} kết hợp 11 dược liệu (nhóm 6 vị nền Lục Vị Địa Hoàng, 4 thảo dược bổ trợ và Sâm Ngọc Linh) giúp hỗ trợ bổ thận, tráng dương và góp phần tăng cường sinh lực.\n${MANDATORY_DISCLAIMER}`
    );
  }

  const cta = '📩 Inbox Fanpage nếu anh muốn trao đổi riêng tư về cách chăm sóc giấc ngủ và giữ gìn phong độ bền vững ở tuổi trung niên.';
  const fullCaption = [title, ...bodyParagraphs, cta].filter(Boolean).join('\n\n');

  return {
    caption: fullCaption,
    comments: [],
    imageHeadline: deriveShortImageHeadline(title),
    cards: [],
  };
}

export function listCampaigns() {
  const list = ensureDefaultFtCampaign(readCampaignsRaw());
  let dirty = false;
  for (const camp of list) {
    if (camp.postsPerDay !== 3) {
      camp.postsPerDay = 3;
      dirty = true;
    }
    for (const p of camp.posts || []) {
      if (p.postType === 'text_comment' && Array.isArray(p.images) && p.images.length > 0) {
        p.images = [];
        p.imageSpec = '';
        p.includeProduct = false;
        if (p.status === 'images_ready') p.status = p.caption ? 'content_ready' : 'proposed';
        dirty = true;
      }
      if ((p.postType === 'text_comment' || p.postType === 'text_cards') && p.caption && p.caption.includes('\n')) {
        p.caption = p.title || p.caption.split('\n')[0].trim();
        dirty = true;
      }
      // Tự động hoàn thiện đầy đủ Hook - Body - CTA cho bài Dạng 3 (content_image) nếu trước đó mới chỉ có câu Hook
      if (p.postType === 'content_image' && (!p.caption || countWords(p.caption) < 45)) {
        const fb = buildFallbackContentForPost(p, camp);
        p.caption = fb.caption;
        if (!p.imageHeadline || p.imageHeadline === p.title) {
          p.imageHeadline = fb.imageHeadline;
        }
        const enf = enforceContentRules(p, camp);
        p.caption = enf.caption;
        p.wordCount = enf.wordCount;
        p.emojiCount = enf.emojiCount;
        if (p.status === 'proposed') p.status = 'content_ready';
        dirty = true;
      }
    }
  }
  if (dirty) writeCampaignsRaw(list);
  return list;
}

export async function resetCampaignSamplePosts(campaignId) {
  const camp = getCampaign(campaignId);
  camp.postsPerDay = 3;
  camp.posts = buildStandardSamplePosts();
  saveCampaignObj(camp);
  await renderPostImagesForItem(camp.id, 'dp-sample-2');
  await renderPostImagesForItem(camp.id, 'dp-sample-3');
  return { campaign: getCampaign(camp.id) };
}

export function getCampaign(id) {
  const list = listCampaigns();
  const c = list.find((x) => x.id === id);
  if (!c) throw new Error(`Không tìm thấy chiến dịch "${id}"`);
  return c;
}

function saveCampaignObj(camp) {
  const list = readCampaignsRaw();
  const idx = list.findIndex((x) => x.id === camp.id);
  camp.updatedAt = new Date().toISOString();
  if (idx >= 0) list[idx] = camp;
  else list.unshift(camp);
  writeCampaignsRaw(list);
  return camp;
}

export function deleteCampaign(id) {
  const list = readCampaignsRaw().filter((x) => x.id !== id);
  writeCampaignsRaw(list);
  return { ok: true };
}

/**
 * Tạo mới hoặc cập nhật thông tin sản phẩm / tài liệu nguồn / ảnh bao bì / logo của chiến dịch.
 */
export async function upsertCampaign({
  id = '',
  name = '',
  productName = '',
  brandName = '',
  skillId = '',
  targetAudience = '',
  brandVoice = '',
  productInfo = '',
  logoText = '',
  logoCorner = 'top-right',
  postsPerDay = 3,
  files = {},
}) {
  const list = listCampaigns();
  const campId = id || `camp-${Date.now()}`;
  const existing = list.find((x) => x.id === campId) || {
    id: campId,
    pillars: [],
    posts: [],
    createdAt: new Date().toISOString(),
  };

  const campDir = path.join(campaignsRoot(), campId);
  fs.mkdirSync(campDir, { recursive: true });

  let mergedProductInfo = String(productInfo ?? existing.productInfo ?? '').trim();
  let mergedScheduleText = String(existing.scheduleText || '').trim();

  const chosenSkillId = skillId !== undefined ? skillId : (existing.skillId || '');
  if (chosenSkillId && !mergedProductInfo) {
    try {
      const sk = SK.getSkill(chosenSkillId);
      const parts = [sk.content];
      for (const f of sk.files) {
        if (f.path !== 'SKILL.md' && f.isText) {
          const rf = SK.readSkillFile(chosenSkillId, f.path);
          if (rf.content) parts.push(`--- ${f.path} ---\n${rf.content}`);
        }
      }
      mergedProductInfo = parts.join('\n\n').slice(0, 45000);
    } catch { /* ignore */ }
  }

  if (files.productDoc?.[0]) {
    const f = files.productDoc[0];
    const origExt = path.extname(f.originalname || '').toLowerCase() || '.txt';
    const savedDoc = path.join(campDir, `product-source${origExt}`);
    fs.writeFileSync(savedDoc, fs.readFileSync(f.path));
    fs.rmSync(f.path, { force: true });
    const extracted = await extractSingleDocText(savedDoc);
    if (extracted) {
      mergedProductInfo = `${mergedProductInfo}\n\n--- NỘI DUNG TRÍCH XUẤT TỪ FILE HỒ SƠ SẢN PHẨM (${f.originalname}) ---\n${extracted}`.trim();
    }
  }

  if (files.scheduleDoc?.[0]) {
    const f = files.scheduleDoc[0];
    const origExt = path.extname(f.originalname || '').toLowerCase() || '.xlsx';
    const savedSched = path.join(campDir, `schedule-source${origExt}`);
    fs.writeFileSync(savedSched, fs.readFileSync(f.path));
    fs.rmSync(f.path, { force: true });
    const extracted = await extractSingleDocText(savedSched);
    if (extracted) mergedScheduleText = extracted;
  }

  let productImagePath = existing.productImagePath || '';
  let productImageUrl = existing.productImageUrl || '';
  if (files.productImage?.[0]) {
    const f = files.productImage[0];
    const ext = path.extname(f.originalname || '').toLowerCase() || '.jpg';
    const dest = path.join(campDir, `product-ref${ext}`);
    fs.writeFileSync(dest, fs.readFileSync(f.path));
    fs.rmSync(f.path, { force: true });
    productImagePath = dest;
    productImageUrl = `/content-files/${campId}/product-ref${ext}?t=${Date.now()}`;
  }

  let logoPath = existing.logoPath || '';
  let logoUrl = existing.logoUrl || '';
  if (files.logoImage?.[0]) {
    const f = files.logoImage[0];
    const ext = path.extname(f.originalname || '').toLowerCase() || '.png';
    const dest = path.join(campDir, `logo-ref${ext}`);
    fs.writeFileSync(dest, fs.readFileSync(f.path));
    fs.rmSync(f.path, { force: true });
    logoPath = dest;
    logoUrl = `/content-files/${campId}/logo-ref${ext}?t=${Date.now()}`;
  }

  const updated = {
    ...existing,
    id: campId,
    name: String(name || productName || existing.name || 'Chiến dịch Content Fanpage').trim(),
    productName: String(productName || existing.productName || name || 'Sản phẩm').trim(),
    brandName: String(brandName ?? existing.brandName ?? '').trim(),
    skillId: chosenSkillId,
    targetAudience: String(targetAudience ?? existing.targetAudience ?? 'Người Việt 40–65 tuổi').trim(),
    brandVoice: String(brandVoice ?? existing.brandVoice ?? 'Chuyên nghiệp, đáng tin cậy, gần gũi với người Việt 40–65 tuổi').trim(),
    productInfo: mergedProductInfo,
    scheduleText: mergedScheduleText,
    productImagePath,
    productImageUrl,
    logoPath,
    logoUrl,
    logoText: String(logoText ?? existing.logoText ?? brandName ?? '').trim(),
    logoCorner: logoCorner || existing.logoCorner || 'top-right',
    postsPerDay: 3, // Mặc định chuẩn 3 bài theo 3 dạng
  };

  return saveCampaignObj(updated);
}

function extractSingleDocText(filePath) {
  return new Promise((resolve) => {
    const ext = path.extname(filePath).toLowerCase();
    if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
      try { return resolve(fs.readFileSync(filePath, 'utf8')); } catch { return resolve(''); }
    }
    const py = `
import sys, zipfile, xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')
fp = sys.argv[1]
ext = sys.argv[2]
try:
    if ext == '.pdf':
        import pypdf
        r = pypdf.PdfReader(fp)
        print('\\n\\n'.join(f'### Trang {i+1}\\n' + (p.extract_text() or '') for i, p in enumerate(r.pages)))
    elif ext == '.docx':
        with zipfile.ZipFile(fp) as z:
            root = ET.fromstring(z.read('word/document.xml'))
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            print('\\n\\n'.join(''.join(t.text or '' for t in p.findall('.//w:t', ns)).strip() for p in root.findall('.//w:p', ns)))
    elif ext == '.xlsx':
        with zipfile.ZipFile(fp) as z:
            ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            shared = []
            if 'xl/sharedStrings.xml' in z.namelist():
                sroot = ET.fromstring(z.read('xl/sharedStrings.xml'))
                for si in sroot.findall('m:si', ns):
                    shared.append(''.join(t.text or '' for t in si.findall('.//m:t', ns)))
            wb = ET.fromstring(z.read('xl/workbook.xml'))
            for idx, sh in enumerate(wb.findall('.//m:sheet', ns), 1):
                print('## Sheet:', sh.attrib.get('name', f'Sheet {idx}'))
                sp = f'xl/worksheets/sheet{idx}.xml'
                if sp not in z.namelist(): continue
                sr = ET.fromstring(z.read(sp))
                for row in sr.findall('.//m:row', ns):
                    vals = []
                    for c in row.findall('m:c', ns):
                        ct = c.attrib.get('t', '')
                        v = c.find('m:v', ns)
                        isel = c.find('m:is', ns)
                        txt = ''
                        if ct == 's' and v is not None and v.text:
                            txt = shared[int(v.text)] if int(v.text) < len(shared) else v.text
                        elif isel is not None:
                            txt = ''.join(t.text or '' for t in isel.findall('.//m:t', ns))
                        elif v is not None and v.text:
                            txt = v.text
                        vals.append(txt.strip().replace('\\n', ' '))
                    if any(vals): print(' | '.join(x for x in vals if x))
except Exception as e:
    pass
`;
    const p = spawn('python', ['-c', py, filePath, ext], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString('utf8'); });
    p.on('close', () => resolve(out.trim()));
    p.on('error', () => resolve(''));
  });
}

/**
 * BƯỚC 1: Gọi AI đọc thông tin sản phẩm (File 1 / Skill) & Đề xuất 5 Tuyến nội dung Phễu kéo Traffic cho Fanpage (TOFU - MOFU - BOFU).
 */
export async function analyzeProductAndProposePillars(campaignId, { aiModel = '' } = {}) {
  const camp = getCampaign(campaignId);

  const prompt = `Bạn là Giám đốc Chiến lược Nội dung Fanpage & Phễu Marketing Dược/Chăm sóc sức khỏe chuẩn mực dành cho người Việt 40–65 tuổi.

NHIỆM VỤ:
Đọc kỹ HỒ SƠ SẢN PHẨM (File 1) dưới đây, sau đó:
1. Trích xuất chuẩn xác thông tin cốt lõi của sản phẩm (TUYỆT ĐỐI chỉ lấy thông tin có thật trong nguồn: tên sản phẩm, thành phần, công dụng hỗ trợ được phép nêu, đối tượng sử dụng, lưu ý/cảnh báo; KHÔNG tự bịa giá bán, ưu đãi, chứng nhận hay số liệu nghiên cứu ngoài nguồn).
2. Đề xuất 5 TUYẾN NỘI DUNG PHỄU (Content Pillars P1 -> P5) để đăng bài hàng ngày kéo Traffic tự nhiên cho Fanpage và chuyển đổi khách hàng theo mô hình TOFU – MOFU – BOFU:
   - P1 (TOFU): Nhận diện nỗi đau / triệu chứng đời thường / trăn trở tuổi trung niên (kéo đồng cảm & bình luận, không bán hàng).
   - P2 (TOFU/MOFU): Giải mã kiến thức đúng / bóc tách sai lầm phổ biến (xây dựng uy tín chuyên gia).
   - P3 (MOFU): Thói quen chăm sóc chủ động mỗi ngày (giữ chân người theo dõi & chia sẻ cao).
   - P4 (BOFU/MOFU): Hiểu rõ sản phẩm & cơ chế hỗ trợ từ thành phần trong hồ sơ gốc (chuyển đổi & dẫn về inbox).
   - P5 (TOFU/MOFU): Chuyện đời sống / gia đình / vợ chồng tuổi 40–65 (chạm cảm xúc sâu sắc, tăng chia sẻ tự nhiên).

THÔNG TIN ĐẦU VÀO:
- Tên chiến dịch: ${camp.name}
- Tên sản phẩm: ${camp.productName}
- Đối tượng mục tiêu: ${camp.targetAudience}
- Giọng văn kênh: ${camp.brandVoice}
- Hồ sơ sản phẩm (File 1):
${(camp.productInfo || '').slice(0, 14000)}

Trả về ĐÚNG 1 khối JSON hợp lệ theo cấu trúc yêu cầu.`;

  const ANALYZE_SCHEMA = {
    type: 'object',
    properties: {
      productName: { type: 'string' },
      brandName: { type: 'string' },
      targetAudience: { type: 'string' },
      brandVoice: { type: 'string' },
      productSummary: {
        type: 'object',
        properties: {
          ingredients: { type: 'string' },
          approvedBenefits: { type: 'string' },
          contraindications: { type: 'string' },
          strictRules: { type: 'string' },
        },
        required: ['ingredients', 'approvedBenefits', 'contraindications', 'strictRules'],
      },
      pillars: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            funnel: { type: 'string' },
            ratio: { type: 'string' },
            desc: { type: 'string' },
            sampleHooks: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'name', 'funnel', 'ratio', 'desc', 'sampleHooks'],
        },
      },
    },
    required: ['productName', 'brandName', 'targetAudience', 'brandVoice', 'productSummary', 'pillars'],
  };

  const res = await callLLM({
    aiModel,
    systemPrompt: 'Bạn là Giám đốc Chiến lược Nội dung Fanpage & Phễu Marketing Dược/Chăm sóc sức khỏe chuẩn mực dành cho người Việt 40–65 tuổi.',
    schema: ANALYZE_SCHEMA,
    input: prompt,
  });

  const parsed = res.data || {};
  camp.productName = parsed.productName || camp.productName;
  camp.brandName = parsed.brandName || camp.brandName;
  camp.targetAudience = parsed.targetAudience || camp.targetAudience;
  camp.brandVoice = parsed.brandVoice || camp.brandVoice;
  camp.productSummary = parsed.productSummary || camp.productSummary || {};
  if (Array.isArray(parsed.pillars) && parsed.pillars.length) {
    camp.pillars = parsed.pillars;
  }
  saveCampaignObj(camp);
  return {
    campaign: camp,
    aiBadge: `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`,
  };
}

/**
 * BƯỚC 2: Đề xuất ĐÚNG 3 BÀI theo 3 Dạng chuẩn mỗi lần làm (Không làm 6 bài):
 * - Bài 1: Dạng 1 (`text_comment` — Bài Text nền + 4 Comment)
 * - Bài 2: Dạng 2 (`text_cards` — Câu Hook có con số N + Bộ N ảnh chia sẻ từng mục)
 * - Bài 3: Dạng 3 (`content_image` — Content Text Hook-Body-CTA đầy đủ + 1 Ảnh minh họa)
 */
export async function proposeTitles(campaignId, {
  startDate = '',
  selectedPillarIds = [],
  sheetName = '',
  customInstruction = '',
  appendMode = false,
  aiModel = '',
} = {}) {
  const camp = getCampaign(campaignId);
  camp.postsPerDay = 3;

  const targetDate = startDate || new Date().toISOString().slice(0, 10);
  const activePillars = (camp.pillars || []).filter((p) => !selectedPillarIds?.length || selectedPillarIds.includes(p.id));
  const existingTitles = (camp.posts || []).map((p) => p.title).filter(Boolean).slice(-20);

  const defaultSlots = ['08:00', '12:30', '19:30'];
  const requiredFormats = ['text_comment', 'text_cards', 'content_image'];
  const compactContext = buildCompactProductContext(camp);

  const prompt = `Bạn là Trưởng phòng Kế hoạch Nội dung Fanpage cho sản phẩm "${camp.productName}".

NHIỆM VỤ QUAN TRỌNG:
Mỗi lần thực hiện CHỈ ĐỀ XUẤT ĐÚNG 3 BÀI tương ứng với 3 dạng đăng bài chuẩn dưới đây cho ngày ${targetDate} (TUYỆT ĐỐI KHÔNG đề xuất 6 bài):
${sheetName ? `- Ưu tiên lấy ý tưởng từ Sheet/Kênh "${sheetName}" nếu khớp ngày ${targetDate}.` : '- Ưu tiên giọng kênh PHONG ĐỘ (nói trực tiếp với anh/anh em 38–65 tuổi).'}
${customInstruction ? `- Yêu cầu chủ đề từ người dùng: ${customInstruction}` : ''}

THÔNG TIN SẢN PHẨM & QUY TẮC:
${compactContext}

ĐÚNG 3 BÀI THEO 3 DẠNG CẦN TRẢ VỀ TRONG MẢNG "proposals":
1. Bài số 1 — postType = "text_comment" (Dạng 1: Bài Text nền + Comment):
   - "title": Câu Hook ngắn gọn gây tò mò để đăng kèm chọn màu nền trên Facebook (VD: "Có 1 thói quen mỗi tối đang âm thầm phá giấc ngủ đàn ông tuổi 40, nó là gì").
   - "comments": Mảng 4 comment giải thích cho câu Hook đó (Comment 1 gợi ý thói quen/cách làm, Comment 2 giải thích cơ chế, Comment 3 điểm chạm thực tế, Comment 4 lời khuyên & câu hỏi tương tác 💬).
   - "fullCaption": Giữ bằng đúng "title", "imageHeadline": "", "cards": [].
2. Bài số 2 — postType = "text_cards" (Dạng 2: Text nền + Bộ ảnh theo tiêu đề):
   - "title": Câu Hook có chứa con số cụ thể từ 4 đến 5 mục (VD: "5 thứ âm thầm rút cạn sinh lực đàn ông mỗi ngày mà không ai nghĩ tới").
   - "cardCount": Đúng con số trong câu Hook (4 hoặc 5).
   - "cards": Mảng gồm đúng N phần tử tương ứng N bức ảnh giải thích câu Hook. Mỗi phần tử gồm: "badge" ("01".."05"), "cardTitle" (cụm tiêu đề 3–6 chữ viết hoa chữ đầu tự nhiên in trên nền kem của ảnh), "sceneKey" (1 trong ["alcohol", "stress", "smoking", "sedentary", "insomnia", "driver", "sleep", "morning", "couple", "herbal", "consult"]), "sceneHint" (mô tả cảnh người đàn ông Việt 40-65 tuổi).
   - "fullCaption": Giữ bằng đúng "title", "comments": [], "imageHeadline": "".
3. Bài số 3 — postType = "content_image" (Dạng 3: Content text Hook–Body–CTA + 1 Ảnh minh họa):
   - "title": Tiêu đề mở đầu hấp dẫn (VD: "Anh tài xế 49 tuổi đếm số đêm ngủ trọn giấc trong tháng, con số khiến anh lặng người" hoặc tiêu đề giải thích sâu sắc).
   - "fullCaption": BẮT BUỘC viết hoàn chỉnh đầy đủ cả 3 phần HOOK – BODY – CTA (dài khoảng 180–280 chữ, chia 4–6 đoạn ngắn 2–4 dòng, có dòng 📌 ghi chú minh họa, 2–3 emoji như 🚛/🌙/🌿, lưu ý thăm khám y khoa chuẩn mực và kết bằng "📩 Inbox Fanpage..."). TUYỆT ĐỐI KHÔNG chỉ ghi mỗi câu tiêu đề!
   - "imageHeadline": Cụm tiêu đề ngắn 3–6 chữ (VD: "Đếm số đêm ngủ trọn giấc") để in lên phần nền kem của tấm ảnh minh họa 1:1.
   - "comments": [], "cards": [].

CÁC TUYẾN NỘI DUNG PHỄU ĐANG ÁP DỤNG:
${JSON.stringify(activePillars.map((p) => ({ id: p.id, name: p.name, funnel: p.funnel })), null, 2)}
- Không lặp lại các tiêu đề đã làm trước đó: ${existingTitles.slice(-8).join(' | ') || '(chưa có)'}.
${camp.scheduleText ? `\nTRÍCH ĐOẠN LỊCH THAM KHẢO:\n${camp.scheduleText.slice(0, 4500)}` : ''}

Trả về ĐÚNG 1 khối JSON hợp lệ có đúng 3 phần tử trong "proposals".`;

  const PROPOSE_SCHEMA = {
    type: 'object',
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            scheduledTime: { type: 'string' },
            pillarId: { type: 'string' },
            pillarName: { type: 'string' },
            funnel: { type: 'string' },
            postType: { type: 'string' },
            title: { type: 'string' },
            cardCount: { type: 'integer' },
            includeProduct: { type: 'boolean' },
            imageSpec: { type: 'string' },
            fullCaption: { type: 'string' },
            imageHeadline: { type: 'string' },
            comments: { type: 'array', items: { type: 'string' } },
            cards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  badge: { type: 'string' },
                  cardTitle: { type: 'string' },
                  sceneKey: { type: 'string' },
                  sceneHint: { type: 'string' },
                },
                required: ['badge', 'cardTitle', 'sceneKey', 'sceneHint'],
              },
            },
          },
          required: [
            'date', 'scheduledTime', 'pillarId', 'pillarName', 'funnel', 'postType',
            'title', 'cardCount', 'includeProduct', 'imageSpec',
            'fullCaption', 'imageHeadline', 'comments', 'cards',
          ],
        },
      },
    },
    required: ['proposals'],
  };

  const res = await callLLM({
    aiModel,
    systemPrompt: `Bạn là Trưởng phòng Kế hoạch Nội dung Fanpage cho sản phẩm "${camp.productName}". Mỗi lần chỉ đề xuất ĐÚNG 3 bài hoàn chỉnh theo 3 dạng chuẩn: text_comment (kèm 4 comment), text_cards (kèm bộ thẻ ảnh), content_image (kèm bài viết đầy đủ Hook-Body-CTA).`,
    schema: PROPOSE_SCHEMA,
    input: prompt,
  });

  const parsed = res.data || {};
  const rawProposals = Array.isArray(parsed.proposals) ? parsed.proposals.slice(0, 3) : [];

  const newPosts = requiredFormats.map((forcedType, idx) => {
    const item = rawProposals.find((x) => x.postType === forcedType) || rawProposals[idx] || {};
    const pType = forcedType;
    const funnel = ['TOFU', 'MOFU', 'BOFU'].includes(String(item.funnel || '').toUpperCase())
      ? String(item.funnel).toUpperCase()
      : (idx === 0 ? 'TOFU' : idx === 1 ? 'TOFU' : 'MOFU');
    const title = String(item.title || '').trim();
    const detectedCount = pType === 'text_cards'
      ? detectItemCountFromTitle(title, Number(item.cardCount) || 5)
      : pType === 'text_comment'
        ? 0
        : 1;
    const includeProduct = pType === 'text_comment' || pType === 'text_cards' || funnel === 'TOFU'
      ? false
      : Boolean(item.includeProduct ?? (funnel === 'BOFU' || /bổ thận ft|11 dược liệu|sản phẩm/i.test(title)));

    const draftPost = {
      id: `dp-${Date.now()}-${idx + 1}`,
      date: item.date || targetDate,
      scheduledTime: defaultSlots[idx] || '08:00',
      pillarId: item.pillarId || (idx === 0 ? 'P1' : idx === 1 ? 'P3' : 'P2'),
      pillarName: item.pillarName || (idx === 0 ? 'P1 · Đêm không yên' : idx === 1 ? 'P3 · Chăm phong độ mỗi ngày' : 'P2 · Hiểu đúng về thận'),
      funnel,
      postType: pType,
      title,
      cardCount: detectedCount,
      includeProduct,
      imageSpec: pType === 'text_comment'
        ? ''
        : pType === 'text_cards'
          ? `Bộ ${detectedCount} ảnh vuông 1:1 (1080×1080) chia sẻ ${detectedCount} mục trong câu Hook: nền kem chữ Serif nâu đậm cỡ lớn + ảnh người đàn ông Việt 40–65 tuổi đúng tình huống.`
          : (String(item.imageSpec || '').trim() || `1 ảnh minh họa vuông 1:1 (1080×1080): nền kem chữ Serif nâu đậm + ảnh người đàn ông Việt 40–65 tuổi đúng bối cảnh bài viết.`),
      selected: true,
      status: 'content_ready',
      caption: pType === 'content_image' ? String(item.fullCaption || '').trim() : title,
      comments: pType === 'text_comment' && Array.isArray(item.comments) ? item.comments.filter(Boolean) : [],
      cards: pType === 'text_cards' && Array.isArray(item.cards)
        ? item.cards.map((c, cIdx) => ({
            badge: c.badge || `0${cIdx + 1}`,
            cardTitle: c.cardTitle || `Mục số ${cIdx + 1}`,
            sceneKey: c.sceneKey || '',
            sceneHint: c.sceneHint || '',
            points: [],
          }))
        : [],
      imageHeadline: pType === 'content_image'
        ? (String(item.imageHeadline || '').trim() || deriveShortImageHeadline(title))
        : '',
      imagePoints: [],
      images: [],
      wordCount: 0,
      emojiCount: 0,
      createdAt: new Date().toISOString(),
      aiBadge: `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`,
    };

    // Đảm bảo cả 3 dạng đều có đầy đủ nội dung chuẩn ngay lập tức (đặc biệt Dạng 3 luôn có đủ Hook - Body - CTA)
    const fallback = buildFallbackContentForPost(draftPost, camp);
    if (pType === 'text_comment' && draftPost.comments.length < 4) {
      draftPost.comments = fallback.comments;
    } else if (pType === 'text_cards' && !draftPost.cards.length) {
      draftPost.cards = fallback.cards;
    } else if (pType === 'content_image' && countWords(draftPost.caption) < 60) {
      draftPost.caption = fallback.caption;
      if (!draftPost.imageHeadline || draftPost.imageHeadline === draftPost.title) {
        draftPost.imageHeadline = fallback.imageHeadline;
      }
    }

    const enforced = enforceContentRules(draftPost, camp);
    draftPost.caption = enforced.caption;
    draftPost.comments = enforced.comments;
    draftPost.wordCount = enforced.wordCount;
    draftPost.emojiCount = enforced.emojiCount;
    draftPost.complianceWarnings = enforced.complianceWarnings;
    return draftPost;
  });

  if (appendMode) {
    camp.posts = [...newPosts, ...(camp.posts || [])];
  } else {
    const publishedOrScheduled = (camp.posts || []).filter((p) => ['published', 'scheduled'].includes(p.status));
    camp.posts = [...newPosts, ...publishedOrScheduled];
  }
  saveCampaignObj(camp);

  return {
    added: newPosts,
    campaign: camp,
    aiBadge: `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`,
  };
}

/**
 * BƯỚC 3: Viết Content chi tiết cho 1 bài đăng theo đúng 3 Dạng Bài & Ví Dụ Mẫu của người dùng.
 * Tách riêng Schema cho từng dạng bài để Dạng 3 (`content_image`) LUÔN LUÔN trả về đầy đủ 3 phần: Hook – Body – CTA.
 */
export async function generatePostContent(campaignId, postId, { aiModel = '' } = {}) {
  const camp = getCampaign(campaignId);
  const post = (camp.posts || []).find((p) => p.id === postId);
  if (!post) throw new Error('Không tìm thấy mục bài đăng này');

  const compactContext = buildCompactProductContext(camp);
  const targetCardCount = post.postType === 'text_cards'
    ? detectItemCountFromTitle(post.title, post.cardCount || 5)
    : 1;

  try {
    if (post.postType === 'text_comment') {
      const SCHEMA_DANG_1 = {
        type: 'object',
        properties: {
          hook: { type: 'string', description: 'Giữ nguyên văn câu Hook tiêu đề của bài đăng' },
          comments: {
            type: 'array',
            description: 'Đúng 4 comment riêng biệt giải thích cho câu Hook (tổng khoảng 180-280 chữ)',
            items: { type: 'string' },
          },
        },
        required: ['hook', 'comments'],
      };

      const promptDang1 = `Bạn là Chuyên gia Copywriting Fanpage cao cấp cho chiến dịch "${camp.name}".

NHIỆM VỤ — VIẾT BÀI DẠNG 1 ("text_comment" — BÀI TEXT NỀN + 4 COMMENT):
- Câu Hook bài chính (giữ nguyên văn): "${post.title}"
- Tuyến nội dung: ${post.pillarName} (${post.funnel})
- Bản chất: Bài chính trên Facebook chỉ là 1 câu Hook chọn màu nền, toàn bộ nội dung diễn giải nằm ở 4 Comment bên dưới.

THÔNG TIN SẢN PHẨM & QUY TẮC Y KHOA:
${compactContext}

VÍ DỤ MẪU CHUẨN DẠNG 1:
- Hook: "Có 1 thói quen mỗi tối đang âm thầm phá giấc ngủ đàn ông tuổi 40, nó là gì"
- Comment 1: "🌙 Tối nay, anh thử dành khoảng một giờ trước khi ngủ để chậm lại:\n• Đặt điện thoại xa tầm tay, tắt thông báo không cần thiết.\n• Giảm ánh sáng trong phòng.\n• Đọc vài trang sách giấy hoặc nghe nhạc nhẹ.\n• Duy trì giờ ngủ và thức dậy tương đối đều đặn.\nBắt đầu bằng một thay đổi nhỏ, phù hợp với sinh hoạt của anh."
- Comment 2: "Ánh sáng từ màn hình vào buổi tối có thể khiến cơ thể nhận tín hiệu tiếp tục thức. Còn việc mải xem điện thoại dễ đẩy giờ ngủ muộn hơn dự định.\nThói quen này có thể góp phần khiến anh khó vào giấc, nhưng không phải nguyên nhân duy nhất gây mất ngủ, cũng không chỉ xảy ra ở tuổi 40."
- Comment 3: "📱 Đó là lên giường rồi vẫn cầm điện thoại, tự nhủ: “Xem thêm một chút rồi ngủ.”\nMột video, vài tin nhắn, thêm ít tin tức… Đến khi nhìn lại đồng hồ, giờ ngủ đã trôi qua từ lúc nào.\nAnh đã nằm xuống nghỉ, nhưng vẫn chưa cho mình khoảng thời gian thật sự yên tĩnh."
- Comment 4: "Chăm sóc bản thân đôi khi bắt đầu từ việc đặt chiếc điện thoại xuống sớm hơn mỗi tối.\nNếu khó ngủ kéo dài hoặc ảnh hưởng sinh hoạt ban ngày, anh nên đi khám để tìm nguyên nhân.\n💬 Anh thường cất điện thoại lúc mấy giờ? Muốn nhận bảng nhắc thói quen trước giờ ngủ, anh có thể nhắn tin riêng cho trang nhé."

Hãy trả về JSON gồm "hook" và mảng "comments" (đúng 4 phần tử) diễn giải sâu sắc cho câu Hook "${post.title}".`;

      const res = await callLLM({
        aiModel,
        systemPrompt: 'Bạn là Chuyên gia Copywriting Fanpage cho người Việt 40–65 tuổi. Trả về đúng JSON theo schema.',
        schema: SCHEMA_DANG_1,
        input: promptDang1,
      });

      const parsed = res.data || {};
      post.caption = post.title;
      post.comments = Array.isArray(parsed.comments) && parsed.comments.length >= 4
        ? parsed.comments.slice(0, 4)
        : buildFallbackContentForPost(post, camp).comments;
      post.cards = [];
      post.aiBadge = `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`;
    } else if (post.postType === 'text_cards') {
      const SCHEMA_DANG_2 = {
        type: 'object',
        properties: {
          hook: { type: 'string', description: 'Giữ nguyên văn câu Hook tiêu đề' },
          cards: {
            type: 'array',
            description: `Đúng ${targetCardCount} phần tử tương ứng với ${targetCardCount} bức ảnh giải thích câu Hook`,
            items: {
              type: 'object',
              properties: {
                badge: { type: 'string' },
                cardTitle: { type: 'string', description: 'Cụm tiêu đề ngắn 3-6 chữ viết hoa chữ đầu tự nhiên in trên nền kem của ảnh' },
                sceneKey: { type: 'string', description: 'Chọn 1 từ khóa trong: alcohol, stress, smoking, sedentary, insomnia, driver, sleep, morning, couple, herbal, consult' },
                sceneHint: { type: 'string', description: 'Mô tả cảnh chụp người đàn ông Việt 40-65 tuổi' },
              },
              required: ['badge', 'cardTitle', 'sceneKey', 'sceneHint'],
            },
          },
        },
        required: ['hook', 'cards'],
      };

      const promptDang2 = `Bạn là Chuyên gia Nội dung & Thiết kế Bộ Ảnh Fanpage cho chiến dịch "${camp.name}".

NHIỆM VỤ — LÀM BÀI DẠNG 2 ("text_cards" — TEXT NỀN + BỘ ${targetCardCount} ẢNH THEO TIÊU ĐỀ):
- Câu Hook (giữ nguyên văn): "${post.title}"
- Phần chữ bài đăng CHỈ GỒM 1 câu Hook trên, đi kèm bộ ${targetCardCount} bức ảnh vuông 1:1 giải thích từng mục.
- Mỗi phần tử trong "cards" cần:
  + "badge": "01", "02"...
  + "cardTitle": Cụm tiêu đề cực ngắn gọn (3–6 chữ, viết hoa chữ cái đầu tự nhiên, ví dụ: "Uống nhiều rượu bia", "Căng thẳng kéo dài", "Hút thuốc mỗi ngày", "Ngồi quá lâu, ít vận động", "Thiếu ngủ mỗi đêm").
  + "sceneKey": Chọn trong ["alcohol", "stress", "smoking", "sedentary", "insomnia", "driver", "sleep", "morning", "couple", "herbal", "consult"] (mỗi ảnh 1 sceneKey khác nhau).
  + "sceneHint": Mô tả cảnh chụp chân thực người đàn ông Việt 40–65 tuổi tương ứng.

THÔNG TIN SẢN PHẨM & QUY TẮC:
${compactContext}`;

      const res = await callLLM({
        aiModel,
        systemPrompt: 'Bạn là Chuyên gia Nội dung & Thiết kế Bộ Ảnh Fanpage cho người Việt 40–65 tuổi. Trả về đúng JSON theo schema.',
        schema: SCHEMA_DANG_2,
        input: promptDang2,
      });

      const parsed = res.data || {};
      post.caption = post.title;
      post.comments = [];
      post.cards = Array.isArray(parsed.cards) && parsed.cards.length
        ? parsed.cards.map((c, idx) => ({
            badge: c.badge || `0${idx + 1}`,
            cardTitle: c.cardTitle || `Mục số ${idx + 1}`,
            sceneKey: c.sceneKey || '',
            sceneHint: c.sceneHint || '',
            points: [],
          }))
        : buildFallbackContentForPost(post, camp).cards;
      post.cardCount = post.cards.length;
      post.aiBadge = `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`;
    } else {
      // Dạng 3 (content_image): BẮT BUỘC viết đầy đủ 3 phần HOOK – BODY – CTA
      const SCHEMA_DANG_3 = {
        type: 'object',
        properties: {
          hook: {
            type: 'string',
            description: 'Dòng đầu tiên (Hook): giữ nguyên văn câu tiêu đề bài đăng trước nút Xem thêm',
          },
          disclaimerLine: {
            type: 'string',
            description: 'Dòng ghi chú minh bạch ngay dưới tiêu đề (ví dụ: "📌 Câu chuyện minh họa, không phải phản hồi khách hàng thực tế." hoặc "📌 Góc nhìn tham khảo chăm sóc sức khỏe tuổi trung niên.")',
          },
          bodyParagraphs: {
            type: 'array',
            description: 'Mảng gồm 4 đến 5 đoạn văn ngắn (mỗi đoạn 2-4 dòng, tổng độ dài toàn bài 180-320 chữ) triển khai phần Thân bài (Body): kể câu chuyện đời thực hoặc giải thích sâu sắc góc nhìn Đông y / Tây y, có 2-3 emoji đầu đoạn (như 🚛, 🌙, 🌿), hướng dẫn chăm sóc chủ động và lưu ý thăm khám y khoa chuẩn mực',
            items: { type: 'string' },
          },
          cta: {
            type: 'string',
            description: 'Đoạn kết kêu gọi hành động (CTA) ở cuối bài, bắt đầu bằng "📩 Inbox Fanpage..."',
          },
          imageHeadline: {
            type: 'string',
            description: 'Cụm tiêu đề ngắn 3-6 chữ (viết hoa chữ cái đầu tự nhiên, ví dụ: "Đếm số đêm ngủ trọn giấc", "Hiểu đúng thận và tiểu đêm") để in lên phần nền kem của tấm ảnh minh họa 1:1',
          },
        },
        required: ['hook', 'disclaimerLine', 'bodyParagraphs', 'cta', 'imageHeadline'],
      };

      const promptDang3 = `Bạn là Chuyên gia Copywriting Fanpage cao cấp cho chiến dịch "${camp.name}" (Sản phẩm: "${camp.productName}").

NHIỆM VỤ — VIẾT BÀI DẠNG 3 ("content_image" — CONTENT TEXT ĐẦY ĐỦ HOOK – BODY – CTA + 1 ẢNH MINH HỌA):
- Tiêu đề / Câu Hook đã chọn (BẮT BUỘC giữ nguyên văn ở "hook"): "${post.title}"
- Tuyến nội dung: ${post.pillarName} (${post.pillarId}) | Tầng phễu: ${post.funnel}
- Có lồng ghép sản phẩm hay không: ${post.includeProduct || post.funnel === 'BOFU' ? `CÓ (nhắc tự nhiên đến ${camp.productName} với từ "hỗ trợ / góp phần" và bắt buộc kèm câu: "${MANDATORY_DISCLAIMER}")` : 'KHÔNG (tập trung 100% vào câu chuyện đời sống / giải thích kiến thức đúng & kéo tương tác)'}

THÔNG TIN SẢN PHẨM & QUY TẮC TUÂN THỦ:
${compactContext}

CẤU TRÚC BẮT BUỘC GỒM ĐỦ 3 PHẦN (HOOK – BODY – CTA):
1. "hook": Nguyên văn câu tiêu đề "${post.title}".
2. "disclaimerLine": Dòng ghi chú mở đầu, ví dụ: "📌 Câu chuyện minh họa, không phải phản hồi khách hàng thực tế." (nếu là bài kể chuyện) hoặc "📌 Góc nhìn tham khảo chăm sóc sức khỏe, không thay thế chẩn đoán y khoa." (nếu là bài giải thích kiến thức).
3. "bodyParagraphs": Mảng 4–5 đoạn văn ngắn (mỗi đoạn 2–4 dòng, tổng toàn bài 180–320 chữ). Triển khai mạch lạc, giàu cảm xúc hoặc giải thích rõ ràng cơ chế Đông y / sinh hoạt, có 2–3 emoji đầu đoạn (như 🚛, 🌙, 🌿), kèm lời khuyên thăm khám chuẩn mực (ví dụ: tiểu đêm hay ngủ chập chờn không đủ để tự kết luận là "thận yếu", nếu kéo dài nên đi khám).
4. "cta": Câu kêu gọi hành động cuối bài bắt đầu bằng "📩 Inbox Fanpage nếu anh muốn trao đổi riêng tư về chủ đề...".
5. "imageHeadline": Cụm tiêu đề ngắn 3–6 chữ (viết hoa chữ cái đầu tự nhiên) để in lên phần nền kem phía trên của tấm ảnh minh họa.

VÍ DỤ MẪU CHUẨN DẠNG 3:
Anh tài xế 49 tuổi đếm số đêm ngủ trọn giấc trong tháng, con số khiến anh lặng người
📌 Câu chuyện minh họa, không phải phản hồi khách hàng thực tế.
Cuối tháng, anh mở cuốn sổ nhỏ vẫn dùng để ghi lịch chạy xe. Lần này, anh thử đánh dấu những đêm mình ngủ liền mạch, sáng dậy thấy được nghỉ ngơi.
Đếm xong, anh ngồi im. Những dấu đánh ấy thưa hơn anh tưởng.
🚛 Trước đây, anh chỉ nhớ hôm nào có chuyến sớm, hôm nào phải về muộn. Còn những đêm trằn trọc, tỉnh giấc rồi chờ ngủ lại, anh đều gạt đi: “Nghề này thì chịu thôi.”
Có hôm vừa tỉnh, anh cầm điện thoại xem lịch xe. Đặt máy xuống, đầu óc lại tính giờ xuất phát, đường đi và công việc ngày mai.
Anh nhận ra mình ghi rất kỹ từng chuyến hàng, nhưng chưa từng ghi lại giấc ngủ của bản thân.
🌙 Từ đó, anh bắt đầu theo dõi giờ ngủ, những lần thức giấc và cảm giác vào ban ngày. Anh cũng sắp xếp thời gian nghỉ và trao đổi với vợ về những thay đổi gần đây.
Ngủ chập chờn không đủ để kết luận là “thận yếu”. Nếu tình trạng kéo dài, ảnh hưởng sinh hoạt, anh nên thăm khám để tìm nguyên nhân. Khi buồn ngủ lúc lái xe, cần dừng ở nơi an toàn để nghỉ.
📩 Inbox Fanpage nếu anh muốn trao đổi riêng tư về chủ đề chăm sóc giấc ngủ ở tuổi trung niên.`;

      const res = await callLLM({
        aiModel,
        systemPrompt: 'Bạn là Chuyên gia Copywriting Fanpage cao cấp cho người Việt 40–65 tuổi. Luôn viết đầy đủ 3 phần Hook – Body – CTA theo đúng schema JSON.',
        schema: SCHEMA_DANG_3,
        input: promptDang3,
      });

      const parsed = res.data || {};
      const bodyParas = Array.isArray(parsed.bodyParagraphs) ? parsed.bodyParagraphs.map((p) => String(p || '').trim()).filter(Boolean) : [];
      const assembledCaption = [
        post.title || parsed.hook,
        String(parsed.disclaimerLine || '').trim(),
        ...bodyParas,
        String(parsed.cta || '').trim(),
      ].filter(Boolean).join('\n\n');

      if (countWords(assembledCaption) >= 60) {
        post.caption = assembledCaption;
      } else {
        post.caption = buildFallbackContentForPost(post, camp).caption;
      }
      post.imageHeadline = String(parsed.imageHeadline || '').trim() || deriveShortImageHeadline(post.title);
      post.comments = [];
      post.cards = [];
      post.aiBadge = `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`;
    }
  } catch (err) {
    // Nếu tất cả Model AI đều đang chạm giới hạn tần suất (429 Too Many Requests), tự động dựng bài hoàn chỉnh Hook - Body - CTA chuẩn quy tắc để người dùng không bị gián đoạn
    const fb = buildFallbackContentForPost(post, camp);
    post.caption = fb.caption;
    post.comments = fb.comments;
    post.cards = fb.cards;
    if (fb.imageHeadline) post.imageHeadline = fb.imageHeadline;
    post.aiBadge = '✦ AI Content Engine (Chuẩn Skill FT)';
  }

  const enforced = enforceContentRules(post, camp);
  post.caption = enforced.caption;
  post.comments = enforced.comments;
  post.wordCount = enforced.wordCount;
  post.emojiCount = enforced.emojiCount;
  post.complianceWarnings = enforced.complianceWarnings;
  if (post.postType === 'text_comment') {
    post.images = [];
    post.status = 'content_ready';
  } else {
    post.status = post.images?.length ? 'images_ready' : 'content_ready';
  }

  saveCampaignObj(camp);
  return { post, campaign: camp };
}

/**
 * BƯỚC 4: Tạo bộ Ảnh Minh Họa cho bài đăng:
 * - Dạng 1 (`text_comment`): KHÔNG tạo ảnh.
 * - Dạng 2 (`text_cards`): Tạo bộ N ảnh vuông 1:1 (1080×1080) giải thích cho câu Hook (mỗi ảnh: nền kem phía trên + tiêu đề ngắn 3–6 chữ font Serif nâu đậm + ảnh chụp chân thực người đàn ông Việt 40–65 tuổi ở dưới).
 * - Dạng 3 (`content_image`): Tạo 1 ảnh minh họa vuông 1:1 (1080×1080) đi kèm bài viết Hook - Body - CTA.
 */
export async function renderPostImagesForItem(campaignId, postId, {
  aspectRatio = '1:1',
  theme = 'ft_editorial',
} = {}) {
  const camp = getCampaign(campaignId);
  const post = (camp.posts || []).find((p) => p.id === postId);
  if (!post) throw new Error('Không tìm thấy mục bài đăng này');

  if (post.postType === 'text_comment') {
    post.images = [];
    post.imageSpec = '';
    post.status = post.caption ? 'content_ready' : 'proposed';
    saveCampaignObj(camp);
    return {
      post,
      campaign: camp,
      skipped: true,
      message: 'Dạng 1 (Text nền + Comment) là trạng thái văn bản chọn màu nền trên Facebook, không sử dụng ảnh đính kèm.',
    };
  }

  const postDir = path.join(campaignsRoot(), camp.id, post.id);
  fs.mkdirSync(postDir, { recursive: true });

  const itemsSpec = [];
  const stamp = Date.now();
  const w = 1080;
  const h = aspectRatio === '4:5' ? 1350 : 1080;

  const ftAssetsDir = path.join(config.dataDir, 'skills', 'ft-daily-content', 'assets');
  const cutoutFile = path.join(ftAssetsDir, 'ft-cutout-box-bottle.png');
  const scenesDir = path.join(ftAssetsDir, 'scenes');

  if (post.postType === 'text_cards') {
    const expectedCount = detectItemCountFromTitle(post.title, post.cardCount || 5);
    let cards = Array.isArray(post.cards) && post.cards.length ? post.cards : [];
    if (!cards.length) {
      const defaultCards = [
        { badge: '01', cardTitle: 'Uống nhiều rượu bia', sceneKey: 'alcohol' },
        { badge: '02', cardTitle: 'Căng thẳng kéo dài', sceneKey: 'stress' },
        { badge: '03', cardTitle: 'Hút thuốc mỗi ngày', sceneKey: 'smoking' },
        { badge: '04', cardTitle: 'Ngồi quá lâu, ít vận động', sceneKey: 'sedentary' },
        { badge: '05', cardTitle: 'Thiếu ngủ mỗi đêm', sceneKey: 'insomnia' },
      ];
      cards = Array.from({ length: expectedCount }, (_, i) => defaultCards[i % defaultCards.length]);
      post.cards = cards;
    }

    cards.forEach((c, idx) => {
      const outFile = path.join(postDir, `card-${idx + 1}-${stamp}.jpg`);
      const cleanBadge = String(c.badge || `0${idx + 1}`).replace(/^#/, '');
      itemsSpec.push({
        kind: 'card_item',
        width: w,
        height: h,
        theme: theme || 'ft_editorial',
        index: idx + 1,
        total: cards.length,
        badge: cleanBadge,
        pillarId: post.pillarId || 'P3',
        pillar: post.pillarName || '',
        funnel: post.funnel || 'TOFU',
        postTitle: post.title || '',
        imageSpec: post.imageSpec || '',
        cardTitle: c.cardTitle || `Điểm lưu ý số ${idx + 1}`,
        sceneKey: c.sceneKey || '',
        sceneHint: c.sceneHint || '',
        points: Array.isArray(c.points) ? c.points : [],
        includeProduct: Boolean(post.includeProduct && post.funnel !== 'TOFU' && idx === cards.length - 1),
        productPath: fs.existsSync(cutoutFile) ? cutoutFile : (camp.productImagePath || ''),
        scenesDir,
        logoPath: camp.logoPath || '',
        logoCorner: camp.logoCorner || 'top-right',
        productName: camp.productName || 'Bổ Thận FT',
        out: outFile,
      });
    });
  } else {
    const outFile = path.join(postDir, `illust-${stamp}.jpg`);
    itemsSpec.push({
      kind: 'content_image',
      width: w,
      height: h,
      theme: theme || 'ft_editorial',
      pillarId: post.pillarId || 'P1',
      pillar: post.pillarName || '',
      funnel: post.funnel || 'MOFU',
      postTitle: post.title || '',
      imageSpec: post.imageSpec || '',
      imageHeadline: post.imageHeadline || post.title,
      points: Array.isArray(post.imagePoints) ? post.imagePoints : [],
      includeProduct: Boolean(post.includeProduct && post.funnel !== 'TOFU'),
      productPath: fs.existsSync(cutoutFile) ? cutoutFile : (camp.productImagePath || ''),
      scenesDir,
      logoPath: camp.logoPath || '',
      logoCorner: camp.logoCorner || 'top-right',
      productName: camp.productName || 'Bổ Thận FT',
      out: outFile,
    });
  }

  await runPythonImageRenderer(itemsSpec);

  post.images = itemsSpec.map((it) => ({
    file: path.basename(it.out),
    path: it.out,
    url: `/content-files/${camp.id}/${post.id}/${path.basename(it.out)}`,
    width: it.width,
    height: it.height,
  }));
  post.status = 'images_ready';
  saveCampaignObj(camp);
  return { post, campaign: camp };
}

function runPythonImageRenderer(items) {
  return new Promise((resolve, reject) => {
    const pyScript = path.join(config.root, 'lib', 'render_post_images.py');
    const p = spawn('python', [pyScript], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { err += d.toString('utf8'); });
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`Lỗi tạo ảnh minh họa: ${err || out || `exit ${code}`}`));
    });
    p.on('error', reject);
    p.stdin.write(JSON.stringify({ items, fallbackFont: config.fontFile }));
    p.stdin.end();
  });
}

/** Cập nhật thủ công nội dung/tiêu đề/trạng thái chọn của 1 bài đăng. */
export function updateDailyPost(campaignId, postId, patch = {}) {
  const camp = getCampaign(campaignId);
  const post = (camp.posts || []).find((p) => p.id === postId);
  if (!post) throw new Error('Không tìm thấy bài đăng');

  for (const k of ['title', 'date', 'scheduledTime', 'pillarId', 'pillarName', 'funnel', 'postType', 'imageSpec', 'imageHeadline', 'selected', 'includeProduct', 'cardCount']) {
    if (patch[k] !== undefined) post[k] = patch[k];
  }
  if (post.postType === 'text_comment') {
    post.images = [];
    post.imageSpec = '';
    post.includeProduct = false;
    if (post.status === 'images_ready') post.status = post.caption ? 'content_ready' : 'proposed';
  }
  if (patch.caption !== undefined) post.caption = String(patch.caption);
  if (Array.isArray(patch.comments)) post.comments = patch.comments.map((x) => String(x || '').trim()).filter(Boolean);
  if (Array.isArray(patch.imagePoints)) post.imagePoints = patch.imagePoints.map((x) => String(x || '').trim()).filter(Boolean);
  if (Array.isArray(patch.cards)) post.cards = patch.cards;

  if (patch.caption !== undefined || patch.comments !== undefined || patch.title !== undefined || patch.postType !== undefined) {
    const enforced = enforceContentRules(post, camp);
    post.caption = enforced.caption;
    post.comments = enforced.comments;
    post.wordCount = enforced.wordCount;
    post.emojiCount = enforced.emojiCount;
    post.complianceWarnings = enforced.complianceWarnings;
  }

  saveCampaignObj(camp);
  return { post, campaign: camp };
}

export function deleteDailyPost(campaignId, postId) {
  const camp = getCampaign(campaignId);
  camp.posts = (camp.posts || []).filter((p) => p.id !== postId);
  saveCampaignObj(camp);
  return { campaign: camp };
}

/**
 * BƯỚC 5: Đăng ngay hoặc Lên lịch đăng bài (Text + Ảnh + Comment) lên Fanpage.
 */
export async function publishOrScheduleDailyPost(campaignId, postId, {
  mode = 'schedule',
  scheduledAt = null,
} = {}) {
  const camp = getCampaign(campaignId);
  const post = (camp.posts || []).find((p) => p.id === postId);
  if (!post) throw new Error('Không tìm thấy bài đăng');

  if (!post.caption && !post.title) {
    throw new Error('Bài đăng chưa có nội dung — hãy bấm "Viết Content" trước khi đăng/lên lịch');
  }

  if (post.postType !== 'text_comment' && !post.images?.length) {
    await renderPostImagesForItem(campaignId, postId);
  }

  const imageFiles = post.postType === 'text_comment'
    ? []
    : (post.images || []).map((im) => im.path).filter((fp) => fp && fs.existsSync(fp));
  const captionToPost = (post.postType === 'text_comment' || post.postType === 'text_cards')
    ? (post.title || post.caption)
    : (post.caption || post.title);
  const commentsToPost = post.postType === 'text_comment' ? (post.comments || []) : [];

  let unixTs = Number(scheduledAt) || null;
  const minTs = Math.floor(Date.now() / 1000) + 30 * 60;
  if (mode === 'schedule' && !unixTs) {
    const timePart = post.scheduledTime || '08:00';
    const dtStr = `${post.date || new Date().toISOString().slice(0, 10)}T${timePart}:00+07:00`;
    const parsedMs = Date.parse(dtStr);
    if (!Number.isNaN(parsedMs)) unixTs = Math.floor(parsedMs / 1000);

    // Nếu ngày trong bài đã qua (ví dụ ngày hôm qua), tự động dời sang hôm nay hoặc ngày mai đúng khung giờ đã chọn
    if (!unixTs || unixTs < minTs) {
      const todayIso = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      const todayTs = Math.floor(Date.parse(`${todayIso}T${timePart}:00+07:00`) / 1000);
      if (todayTs >= minTs) {
        unixTs = todayTs;
        post.date = todayIso;
      } else {
        const tomorrowIso = new Date(Date.now() + 31 * 3600 * 1000).toISOString().slice(0, 10);
        const tomorrowTs = Math.floor(Date.parse(`${tomorrowIso}T${timePart}:00+07:00`) / 1000);
        if (tomorrowTs >= minTs) {
          unixTs = tomorrowTs;
          post.date = tomorrowIso;
        } else {
          unixTs = minTs;
        }
      }
    }
  }
  if (mode === 'schedule' && (!unixTs || unixTs < minTs)) {
    unixTs = minTs;
  }

  let fbResult = null;
  const browserPage = FBB.browserPage();
  const graphReady = FB.fbConfigured();

  if (graphReady && post.postType !== 'text_cards' && post.postType !== 'text_comment') {
    fbResult = await FB.postFeedPhotosViaGraph({
      files: imageFiles,
      caption: captionToPost,
      comments: commentsToPost,
      mode,
      scheduledAt: unixTs,
    });
  } else if (browserPage?.id) {
    const r = await FBB.postFeedPost({
      pageId: browserPage.id,
      files: imageFiles,
      caption: captionToPost,
      comments: commentsToPost,
      postType: post.postType,
      useBackground: post.postType === 'text_comment' || post.postType === 'text_cards',
      mode,
      scheduledAt: unixTs,
    });
    fbResult = {
      ok: true,
      postId: `browser-post-${Date.now()}`,
      pageId: browserPage.id,
      pageName: browserPage.name || browserPage.id,
      permalink: r.url || null,
      scheduledAt: r.scheduledAt || unixTs,
    };
  } else {
    throw new Error('Chưa kết nối Fanpage Facebook — hãy vào tab "Tài khoản" chọn Page trong Chrome Facebook hoặc đăng nhập Facebook API.');
  }

  post.status = mode === 'publish' ? 'published' : mode === 'schedule' ? 'scheduled' : 'draft';
  post.fbPostId = fbResult.postId;
  post.fbPermalink = fbResult.permalink || null;
  post.scheduledAtIso = mode === 'schedule' && unixTs ? new Date(unixTs * 1000).toISOString() : null;

  P.addPost({
    id: fbResult.postId || `daily-${post.id}`,
    jobId: null,
    campaignId: camp.id,
    dailyPostId: post.id,
    postKind: 'feed_post',
    postType: post.postType,
    topic: `[${post.funnel} · ${post.pillarId}] ${post.title}`,
    pageId: fbResult.pageId,
    pageName: fbResult.pageName || FBAuth.status().pages?.find((p) => p.id === fbResult.pageId)?.name || browserPage?.name || null,
    state: mode === 'publish' ? 'published' : mode === 'schedule' ? 'scheduled' : 'draft',
    scheduledAt: post.scheduledAtIso,
    permalink: fbResult.permalink || null,
    caption: captionToPost.slice(0, 250),
  });

  saveCampaignObj(camp);
  return {
    ok: true,
    post,
    fbResult,
    campaign: camp,
  };
}
