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
  let skillContext = '';
  if (camp.skillId) {
    try {
      const sb = SK.buildSkillPromptBlock([camp.skillId], { includePinned: false });
      skillContext = sb.block || '';
    } catch { /* ignore */ }
  }

  const prompt = `Bạn là Giám đốc Chiến lược Nội dung Fanpage & Phễu Marketing Dược/Chăm sóc sức khỏe chuẩn mực dành cho người Việt 40–65 tuổi.

NHIỆM VỤ:
Đọc kỹ HỒ SƠ SẢN PHẨM (File 1) và tài liệu chiến dịch dưới đây, sau đó:
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
${(camp.productInfo || '').slice(0, 28000)}
${skillContext ? `\n${skillContext.slice(0, 22000)}` : ''}

Trả về ĐÚNG 1 khối JSON hợp lệ theo cấu trúc sau (không kèm giải thích ngoài JSON):
{
  "productName": "Tên chuẩn của sản phẩm",
  "brandName": "Tên thương hiệu / đơn vị (nếu có)",
  "targetAudience": "Mô tả chân dung khách hàng mục tiêu (ưu tiên người Việt 40-65 tuổi)",
  "brandVoice": "Giọng văn chuẩn của Fanpage",
  "productSummary": {
    "ingredients": "Danh sách thành phần chuẩn xác theo hồ sơ nguồn",
    "approvedBenefits": "Các công dụng hỗ trợ được phép nêu (dùng từ: hỗ trợ, góp phần, giúp chăm sóc)",
    "contraindications": "Đối tượng lưu ý / thận trọng (nếu có trong hồ sơ)",
    "strictRules": "Các điểm không được nhầm lẫn hoặc bịa đặt ngoài hồ sơ"
  },
  "pillars": [
    {
      "id": "P1",
      "name": "P1 · Tên tuyến nội dung ngắn gọn",
      "funnel": "TOFU",
      "ratio": "25%",
      "desc": "Mô tả mục tiêu tuyến nội dung và cách tiếp cận khách hàng",
      "sampleHooks": [
        "Câu tiêu đề mẫu gây tò mò số 1",
        "Câu tiêu đề mẫu số 2"
      ]
    }
  ]
}`;

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
 * - Bài 3: Dạng 3 (`content_image` — Content Text Hook-Body-CTA + 1 Ảnh minh họa)
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

  let skillContext = '';
  if (camp.skillId) {
    try {
      const sb = SK.buildSkillPromptBlock([camp.skillId], { includePinned: false });
      skillContext = sb.block || '';
    } catch { /* ignore */ }
  }

  const defaultSlots = ['08:00', '12:30', '19:30'];
  const requiredFormats = ['text_comment', 'text_cards', 'content_image'];

  const prompt = `Bạn là Trưởng phòng Kế hoạch Nội dung Fanpage cho sản phẩm "${camp.productName}".

NHIỆM VỤ QUAN TRỌNG:
Mỗi lần thực hiện CHỈ ĐỀ XUẤT ĐÚNG 3 BÀI tương ứng với 3 dạng đăng bài chuẩn dưới đây cho ngày ${targetDate} (TUYỆT ĐỐI KHÔNG đề xuất 6 bài):
${sheetName ? `- Ưu tiên lấy đúng dữ liệu lịch từ Sheet/Kênh "${sheetName}" trong tài liệu lịch đính kèm nếu khớp ngày ${targetDate} (nếu không chỉ định sheet, ưu tiên lấy 3 bài từ sheet PHONG ĐỘ).` : '- Nếu ngày nằm trong lịch Excel đính kèm, ưu tiên lấy đúng 3 bài của sheet PHONG ĐỘ (mỗi bài 1 dạng).'}
${customInstruction ? `- Yêu cầu chủ đề từ người dùng: ${customInstruction}` : ''}

ĐÚNG 3 BÀI THEO 3 DẠNG CẦN TRẢ VỀ TRONG MẢNG "proposals":
1. Bài số 1 — postType = "text_comment" (Dạng 1: Bài Text nền + Comment):
   - Là câu Hook ngắn gọn gây tò mò để đăng kèm chọn màu nền trên Facebook, sau đó nội dung diễn giải ở 4 comment (VD: "Có 1 thói quen mỗi tối đang âm thầm phá giấc ngủ đàn ông tuổi 40, nó là gì").
   - cardCount = 0, imageSpec = "".
2. Bài số 2 — postType = "text_cards" (Dạng 2: Text nền + Bộ ảnh theo tiêu đề):
   - Là câu Hook có chứa con số cụ thể từ 3 đến 5 mục (VD: "5 thứ âm thầm rút cạn sinh lực đàn ông mỗi ngày mà không ai nghĩ tới", "4 thói quen buổi tối khiến đàn ông tuổi 45 khó ngủ sâu giấc") để đi kèm bộ N ảnh vuông 1:1 giải thích từng mục đó.
   - cardCount = đúng con số trong câu Hook (3, 4 hoặc 5).
3. Bài số 3 — postType = "content_image" (Dạng 3: Content text + 1 Ảnh minh họa):
   - Là tiêu đề mở đầu cho bài viết kể chuyện minh họa / giải thích sâu sắc gồm Hook – Body – CTA kèm 1 ảnh minh họa (VD: "Anh tài xế 49 tuổi đếm số đêm ngủ trọn giấc trong tháng, con số khiến anh lặng người").
   - cardCount = 1.

CÁC TUYẾN NỘI DUNG PHỄU ĐANG ÁP DỤNG:
${JSON.stringify(activePillars, null, 2)}

QUY TẮC BẮT BUỘC:
- Chỉ trả về ĐÚNG 3 phần tử trong mảng "proposals" theo thứ tự: [Dạng 1 "text_comment", Dạng 2 "text_cards", Dạng 3 "content_image"].
- Tuyệt đối KHÔNG dùng từ cấm: "chữa khỏi", "điều trị khỏi", "hết đau hoàn toàn", "cam kết khỏi".
- Không lặp lại các tiêu đề đã làm trước đó: ${existingTitles.join(' | ') || '(chưa có)'}.
${camp.scheduleText ? `\nDỮ LIỆU LỊCH EXCEL ĐÍNH KÈM:\n${camp.scheduleText.slice(0, 16000)}` : ''}
${skillContext ? `\n${skillContext.slice(0, 12000)}` : ''}

Trả về ĐÚNG 1 khối JSON hợp lệ có đúng 3 phần tử trong "proposals":
{
  "proposals": [
    {
      "date": "${targetDate}",
      "scheduledTime": "08:00",
      "pillarId": "P1",
      "pillarName": "P1 · Đêm không yên",
      "funnel": "TOFU",
      "postType": "text_comment",
      "title": "Câu Hook cho bài Dạng 1 (Text nền + 4 Comment)",
      "cardCount": 0,
      "includeProduct": false,
      "imageSpec": ""
    },
    {
      "date": "${targetDate}",
      "scheduledTime": "12:30",
      "pillarId": "P3",
      "pillarName": "P3 · Chăm phong độ mỗi ngày",
      "funnel": "TOFU",
      "postType": "text_cards",
      "title": "Câu Hook có con số N cho bài Dạng 2 (Text nền + Bộ N ảnh)",
      "cardCount": 5,
      "includeProduct": false,
      "imageSpec": "Bộ ảnh vuông 1:1 chia sẻ từng mục tương ứng câu Hook (nền kem chữ Serif nâu đậm + ảnh người đàn ông Việt 40-65 tuổi)"
    },
    {
      "date": "${targetDate}",
      "scheduledTime": "19:30",
      "pillarId": "P2",
      "pillarName": "P2 · Hiểu đúng về thận",
      "funnel": "MOFU",
      "postType": "content_image",
      "title": "Tiêu đề bài Dạng 3 (Content Hook-Body-CTA + 1 Ảnh minh họa)",
      "cardCount": 1,
      "includeProduct": false,
      "imageSpec": "1 ảnh minh họa vuông 1:1 (nền kem chữ Serif nâu đậm + ảnh người đàn ông Việt 40-65 tuổi đúng bối cảnh nội dung)"
    }
  ]
}`;

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
          },
          required: ['date', 'scheduledTime', 'pillarId', 'pillarName', 'funnel', 'postType', 'title', 'cardCount', 'includeProduct', 'imageSpec'],
        },
      },
    },
    required: ['proposals'],
  };

  const res = await callLLM({
    aiModel,
    systemPrompt: `Bạn là Trưởng phòng Kế hoạch Nội dung Fanpage cho sản phẩm "${camp.productName}". Mỗi lần chỉ đề xuất ĐÚNG 3 bài theo 3 dạng chuẩn: text_comment, text_cards, content_image.`,
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

    return {
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
      status: 'proposed',
      caption: pType === 'text_comment' || pType === 'text_cards' ? title : '',
      comments: [],
      cards: [],
      imageHeadline: '',
      imagePoints: [],
      images: [],
      wordCount: 0,
      emojiCount: 0,
      createdAt: new Date().toISOString(),
    };
  });

  if (appendMode) {
    camp.posts = [...newPosts, ...(camp.posts || [])];
  } else {
    // Giữ lại các bài đã thực sự đăng/hẹn giờ trên Fanpage (nếu có), còn lại thay bằng đúng 3 bài mới để không bị dồn thành 6 bài gây rối
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
 */
export async function generatePostContent(campaignId, postId, { aiModel = '' } = {}) {
  const camp = getCampaign(campaignId);
  const post = (camp.posts || []).find((p) => p.id === postId);
  if (!post) throw new Error('Không tìm thấy mục bài đăng này');

  const previousSnippets = (camp.posts || [])
    .filter((p) => p.id !== post.id && p.caption)
    .slice(0, 6)
    .map((p) => `- [${p.date}] ${p.title}`)
    .join('\n');

  let skillContext = '';
  if (camp.skillId) {
    try {
      const sb = SK.buildSkillPromptBlock([camp.skillId], { includePinned: false });
      skillContext = sb.block || '';
    } catch { /* ignore */ }
  }

  const targetCardCount = post.postType === 'text_cards'
    ? detectItemCountFromTitle(post.title, post.cardCount || 5)
    : 1;

  let formatSpecificInstruction = '';
  if (post.postType === 'text_comment') {
    formatSpecificInstruction = `
BẠN ĐANG LÀM BÀI DẠNG 1 ("text_comment" — BÀI TEXT NỀN + COMMENT):
- Bản chất: Text nền là dạng đăng bài text kèm chọn màu nền ở trên Facebook, sau đó toàn bộ nội dung diễn giải câu hook ở phần Comment. TUYỆT ĐỐI KHÔNG viết nội dung content đi cùng với tiêu đề ở phần bài chính!
- "caption": CHỈ ĐƯỢC PHÉP LÀ ĐÚNG 1 CÂU HOOK "${post.title}" (không thêm bất kỳ đoạn văn nào dưới tiêu đề).
- "comments": Mảng gồm ĐÚNG 4 comment riêng biệt diễn giải cho câu hook (tổng độ dài 4 comment khoảng 180–300 chữ), học theo ĐÚNG cấu trúc và giọng điệu của VÍ DỤ MẪU dưới đây:

[VÍ DỤ MẪU CHUẨN DẠNG 1]:
Câu hook (caption): "Có 1 thói quen mỗi tối đang âm thầm phá giấc ngủ đàn ông tuổi 40, nó là gì"
- Comment 1:
"🌙 Tối nay, anh thử dành khoảng một giờ trước khi ngủ để chậm lại:
• Đặt điện thoại xa tầm tay, tắt thông báo không cần thiết.
• Giảm ánh sáng trong phòng.
• Đọc vài trang sách giấy hoặc nghe nhạc nhẹ.
• Duy trì giờ ngủ và thức dậy tương đối đều đặn.
Bắt đầu bằng một thay đổi nhỏ, phù hợp với sinh hoạt của anh."
- Comment 2:
"Ánh sáng từ màn hình vào buổi tối có thể khiến cơ thể nhận tín hiệu tiếp tục thức. Còn việc mải xem điện thoại dễ đẩy giờ ngủ muộn hơn dự định.
Thói quen này có thể góp phần khiến anh khó vào giấc, nhưng không phải nguyên nhân duy nhất gây mất ngủ, cũng không chỉ xảy ra ở tuổi 40."
- Comment 3:
"📱 Đó là lên giường rồi vẫn cầm điện thoại, tự nhủ: “Xem thêm một chút rồi ngủ.”
Một video, vài tin nhắn, thêm ít tin tức… Đến khi nhìn lại đồng hồ, giờ ngủ đã trôi qua từ lúc nào.
Anh đã nằm xuống nghỉ, nhưng vẫn chưa cho mình khoảng thời gian thật sự yên tĩnh."
- Comment 4:
"Chăm sóc bản thân đôi khi bắt đầu từ việc đặt chiếc điện thoại xuống sớm hơn mỗi tối.
Nếu khó ngủ kéo dài hoặc ảnh hưởng sinh hoạt ban ngày, anh nên đi khám để tìm nguyên nhân.
💬 Anh thường cất điện thoại lúc mấy giờ? Muốn nhận bảng nhắc thói quen trước giờ ngủ, anh có thể nhắn tin riêng cho trang nhé."
`;
  } else if (post.postType === 'text_cards') {
    formatSpecificInstruction = `
BẠN ĐANG LÀM BÀI DẠNG 2 ("text_cards" — TEXT NỀN + BỘ ẢNH THEO TIÊU ĐỀ):
- Bản chất: Text nền + ảnh là cách đăng ở trên Facebook. Phần nội dung CHỈ BAO GỒM 1 CÂU HOOK và BỘ ${targetCardCount} ẢNH để giải thích cho câu hook đó. TUYỆT ĐỐI KHÔNG viết bài văn dài ở phần caption!
- "caption": CHỈ ĐƯỢC PHÉP LÀ ĐÚNG 1 CÂU HOOK "${post.title}".
- "comments": Mảng rỗng [].
- "cards": Mảng gồm ĐÚNG ${targetCardCount} phần tử tương ứng với ${targetCardCount} bức ảnh giải thích cho câu hook.
  Mỗi phần tử trong "cards" đại diện cho 1 bức ảnh vuông 1:1 (phía trên là nền kem in 1 dòng chữ lớn ngắn gọn, phía dưới là ảnh chụp chân thực người đàn ông Việt 40–65 tuổi trong tình huống đó):
  + "badge": "01", "02"...
  + "cardTitle": Cụm tiêu đề CỰC KỲ NGẮN GỌN (chỉ 3–6 chữ, viết hoa chữ cái đầu tự nhiên, KHÔNG viết in hoa toàn bộ).
  + "sceneKey": Chọn 1 từ khóa bối cảnh phù hợp nhất trong ["alcohol", "stress", "smoking", "sedentary", "insomnia", "driver", "sleep", "morning", "couple", "herbal", "consult"] (mỗi ảnh 1 sceneKey khác nhau).
  + "sceneHint": Mô tả ngắn cảnh chụp người đàn ông Việt Nam 40–65 tuổi minh họa cho mục đó.

[VÍ DỤ MẪU CHUẨN DẠNG 2]:
Câu hook (caption): "5 thứ âm thầm rút cạn sinh lực đàn ông mỗi ngày mà không ai nghĩ tới"
Bộ 5 ảnh đi kèm ("cards"):
1. cardTitle: "Uống nhiều rượu bia" | sceneKey: "alcohol" | sceneHint: "Người đàn ông Việt trung niên ngồi bàn nhậu cầm ly bia trầm ngâm"
2. cardTitle: "Căng thẳng kéo dài" | sceneKey: "stress" | sceneHint: "Người đàn ông Việt trung niên ngồi bàn làm việc xem giấy tờ, tay đỡ trán căng thẳng"
3. cardTitle: "Hút thuốc mỗi ngày" | sceneKey: "smoking" | sceneHint: "Người đàn ông Việt trung niên ngồi ban công cùng ly cà phê và gạt tàn thuốc lá"
4. cardTitle: "Ngồi quá lâu, ít vận động" | sceneKey: "sedentary" | sceneHint: "Người đàn ông Việt trung niên ngồi ghế văn phòng xoa mỏi cổ vai gáy"
5. cardTitle: "Thiếu ngủ mỗi đêm" | sceneKey: "insomnia" | sceneHint: "Người đàn ông Việt trung niên mặc đồ ngủ ngồi bên mép giường lúc đêm khuya cạnh đèn ngủ và đồng hồ"
`;
  } else {
    formatSpecificInstruction = `
BẠN ĐANG LÀM BÀI DẠNG 3 ("content_image" — CONTENT TEXT + 1 ẢNH MINH HỌA):
- Bản chất: Content bao gồm đầy đủ Hook – Body – CTA và đăng cùng 1 ảnh minh họa cho content đó.
- "caption": Bài viết hoàn chỉnh (${post.funnel === 'BOFU' ? '120–200 chữ' : '180–320 chữ'}), học theo ĐÚNG cấu trúc, cách chia đoạn 2–4 dòng, cách ghi chú câu chuyện minh họa, lưu ý y khoa chuẩn mực và CTA của VÍ DỤ MẪU dưới đây:
  1. Dòng đầu tiên (Hook): Nguyên văn câu tiêu đề "${post.title}".
  2. Nếu là câu chuyện kể / nhân vật: Dòng tiếp theo ghi rõ "📌 Câu chuyện minh họa, không phải phản hồi khách hàng thực tế."
  3. Phần thân (Body): Kể câu chuyện gần gũi hoặc giải thích vấn đề chia thành các đoạn ngắn 2–4 dòng, có 2–3 emoji đầu đoạn (như 🚛, 🌙), kèm lời khuyên thăm khám chuẩn mực (ví dụ: không tự kết luận triệu chứng là "thận yếu", nếu kéo dài nên đi khám). Nếu bài có nhắc đến sản phẩm "${camp.productName}", chỉ dùng từ "hỗ trợ / góp phần / giúp chăm sóc" và bắt buộc có câu: "${MANDATORY_DISCLAIMER}".
  4. Dòng cuối (CTA): "📩 Inbox Fanpage nếu anh muốn trao đổi riêng tư về chủ đề..."
- "imageHeadline": Cụm tiêu đề ngắn gọn (3–6 chữ, viết hoa chữ cái đầu tự nhiên, ví dụ: "Đếm số đêm ngủ trọn giấc") để in lên dải nền kem phía trên của tấm ảnh minh họa đi kèm.
- "comments": Mảng rỗng [].

[VÍ DỤ MẪU CHUẨN DẠNG 3]:
"Anh tài xế 49 tuổi đếm số đêm ngủ trọn giấc trong tháng, con số khiến anh lặng người
📌 Câu chuyện minh họa, không phải phản hồi khách hàng thực tế.
Cuối tháng, anh mở cuốn sổ nhỏ vẫn dùng để ghi lịch chạy xe. Lần này, anh thử đánh dấu những đêm mình ngủ liền mạch, sáng dậy thấy được nghỉ ngơi.
Đếm xong, anh ngồi im. Những dấu đánh ấy thưa hơn anh tưởng.
🚛 Trước đây, anh chỉ nhớ hôm nào có chuyến sớm, hôm nào phải về muộn. Còn những đêm trằn trọc, tỉnh giấc rồi chờ ngủ lại, anh đều gạt đi: “Nghề này thì chịu thôi.”
Có hôm vừa tỉnh, anh cầm điện thoại xem lịch xe. Đặt máy xuống, đầu óc lại tính giờ xuất phát, đường đi và công việc ngày mai.
Anh nhận ra mình ghi rất kỹ từng chuyến hàng, nhưng chưa từng ghi lại giấc ngủ của bản thân.
🌙 Từ đó, anh bắt đầu theo dõi giờ ngủ, những lần thức giấc và cảm giác vào ban ngày. Anh cũng sắp xếp thời gian nghỉ và trao đổi với vợ về những thay đổi gần đây.
Ngủ chập chờn không đủ để kết luận là “thận yếu”. Nếu tình trạng kéo dài, ảnh hưởng sinh hoạt, anh nên thăm khám để tìm nguyên nhân. Khi buồn ngủ lúc lái xe, cần dừng ở nơi an toàn để nghỉ.
📩 Inbox Fanpage nếu anh muốn trao đổi riêng tư về chủ đề chăm sóc giấc ngủ ở tuổi trung niên."
`;
  }

  const prompt = `Bạn là Chuyên gia Copywriting & Biên tập Nội dung Fanpage cao cấp cho chiến dịch "${camp.name}" (Sản phẩm: "${camp.productName}").

THÔNG TIN BÀI ĐĂNG CẦN THỰC HIỆN:
- Tuyến nội dung: ${post.pillarName} (${post.pillarId})
- Tầng phễu: ${post.funnel}
- Dạng đăng bài: ${post.postType}
- Tiêu đề / Câu Hook đã chốt (BẮT BUỘC giữ nguyên văn): "${post.title}"
- Có gắn sản phẩm hay không: ${post.includeProduct ? 'CÓ (bắt buộc kèm câu cảnh báo thực phẩm bảo vệ sức khỏe)' : 'KHÔNG (tập trung giá trị nhận diện, đời sống & tương tác)'}

${formatSpecificInstruction}

QUY TẮC TUÂN THỦ Y KHOA & THƯƠNG HIỆU:
- Tuyệt đối KHÔNG dùng các từ: "chữa khỏi", "điều trị khỏi", "hết đau hoàn toàn", "cam kết khỏi".
- Không tự bịa giá bán, ưu đãi, số liệu nghiên cứu hoặc giả làm phản hồi khách hàng thật.
- Không lặp lại nội dung các bài trước: ${previousSnippets || '(Chưa có)'}
- Hồ sơ sản phẩm tham chiếu (chỉ dùng khi bài có nhắc sản phẩm):
${(camp.productInfo || '').slice(0, 14000)}
${skillContext ? `\n${skillContext.slice(0, 10000)}` : ''}

Trả về ĐÚNG 1 khối JSON hợp lệ theo cấu trúc sau:
{
  "caption": "Nội dung phần chữ bài chính theo đúng quy tắc của dạng ${post.postType}",
  "comments": ["Comment 1...", "Comment 2...", "Comment 3...", "Comment 4..."],
  "imageHeadline": "Tiêu đề ngắn 3-6 chữ trên ảnh minh họa (cho Dạng 3)",
  "imagePoints": [],
  "cards": [
    {
      "badge": "01",
      "cardTitle": "Tiêu đề ngắn 3-6 chữ trên ảnh (cho Dạng 2)",
      "sceneKey": "alcohol",
      "sceneHint": "Mô tả cảnh ảnh người đàn ông Việt 40-65 tuổi",
      "points": []
    }
  ]
}`;

  const WRITE_SCHEMA = {
    type: 'object',
    properties: {
      caption: { type: 'string' },
      comments: { type: 'array', items: { type: 'string' } },
      imageHeadline: { type: 'string' },
      imagePoints: { type: 'array', items: { type: 'string' } },
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            badge: { type: 'string' },
            cardTitle: { type: 'string' },
            sceneKey: { type: 'string' },
            sceneHint: { type: 'string' },
            points: { type: 'array', items: { type: 'string' } },
          },
          required: ['badge', 'cardTitle', 'sceneKey', 'sceneHint', 'points'],
        },
      },
    },
    required: ['caption', 'comments', 'imageHeadline', 'imagePoints', 'cards'],
  };

  const res = await callLLM({
    aiModel,
    systemPrompt: `Bạn là Chuyên gia Copywriting & Biên tập Nội dung Fanpage cao cấp cho chiến dịch "${camp.name}". Tuân thủ nghiêm ngặt cấu trúc 3 dạng bài của người dùng.`,
    schema: WRITE_SCHEMA,
    input: prompt,
  });

  const parsed = res.data || {};
  post.caption = parsed.caption || post.title;
  post.comments = Array.isArray(parsed.comments) ? parsed.comments : [];
  post.imageHeadline = parsed.imageHeadline || post.title;
  post.imagePoints = Array.isArray(parsed.imagePoints) ? parsed.imagePoints : [];
  post.cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  if (post.postType === 'text_cards' && post.cards.length) {
    post.cardCount = post.cards.length;
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
  post.aiBadge = `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`;

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
  if (mode === 'schedule' && !unixTs) {
    const dtStr = `${post.date || new Date().toISOString().slice(0, 10)}T${post.scheduledTime || '08:00'}:00+07:00`;
    const parsedMs = Date.parse(dtStr);
    if (!Number.isNaN(parsedMs)) unixTs = Math.floor(parsedMs / 1000);
  }
  if (mode === 'schedule') {
    const minTs = Math.floor(Date.now() / 1000) + 30 * 60;
    if (!unixTs || unixTs < minTs) unixTs = minTs;
  }

  let fbResult = null;
  const browserPage = FBB.browserPage();
  const graphReady = FB.fbConfigured();

  if (graphReady) {
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
