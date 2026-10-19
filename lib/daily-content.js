// Module Tạo Content & Hình Ảnh Đăng Bài Hàng Ngày Cho Fanpage (Kéo Traffic Phễu TOFU - MOFU - BOFU)
// Quy trình: Lấy thông tin sản phẩm -> Gọi AI đọc thông tin sản phẩm -> Đề xuất các tuyến nội dung phễu kéo traffic
// -> Lựa chọn số bài đăng/ngày -> Đề xuất tiêu đề -> Viết content theo tiêu đề lựa chọn (15 quy tắc)
// -> Làm ảnh minh họa (12 quy tắc) & Lên lịch đăng bài lên Fanpage.
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
    name: 'Dạng 1: Text nền (Tiêu đề + Thả nội dung ở Comment)',
    shortName: 'Text nền + cmt',
    desc: 'Bài chính chỉ gồm 1 câu tiêu đề gây tò mò trên nền ảnh chữ lớn; toàn bộ nội dung chi tiết chia thành 3–4 comment thả dưới bài đăng (giống Ảnh 1 mẫu).',
  },
  {
    id: 'text_cards',
    name: 'Dạng 2: Text nền + Hình ảnh mô tả từng mục (#01, #02…)',
    shortName: 'Text nền + bộ ảnh',
    desc: '1 câu tiêu đề thu hút ở đầu kèm bộ hình ảnh thẻ (#01, #02…) minh họa tương ứng với con số trong tiêu đề (giống Ảnh 2 mẫu).',
  },
  {
    id: 'content_image',
    name: 'Dạng 3: Content Text đầy đủ + Ảnh minh họa',
    shortName: 'Content text + ảnh',
    desc: 'Bài viết caption đầy đủ chuẩn phễu TOFU/MOFU/BOFU (mở đầu bằng tiêu đề trước nút Xem thêm) kèm ảnh minh họa 1080×1080 hoặc 1080×1350.',
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

function extractFirstJson(raw) {
  const s = String(raw || '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : s;
  const startObj = candidate.indexOf('{');
  const endObj = candidate.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) {
    return JSON.parse(candidate.slice(startObj, endObj + 1));
  }
  throw new Error('Model AI không trả về dữ liệu JSON hợp lệ.');
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
 * Kiểm tra & chuẩn hóa bài viết theo đúng 15 Quy tắc Viết Content của người dùng:
 * - Câu mở đầu dùng đúng tiêu đề và nằm dòng đầu tiên trước nút "Xem thêm"
 * - Thay thế các từ cấm ("chữa khỏi", "điều trị khỏi", "hết đau hoàn toàn", "cam kết khỏi")
 * - Mỗi đoạn tối đa 3–4 dòng, xuống dòng thoáng
 * - Tối đa 15 emoji trong toàn bộ bài (kể cả comment)
 * - Tự động bổ sung câu cảnh báo bắt buộc khi có đề cập tên sản phẩm
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

  if (post.postType === 'text_comment') {
    // Dạng 1: Bài chính chỉ để đúng 1 câu tiêu đề gây tò mò, nội dung thả ở comment
    caption = title || caption.split('\n')[0] || '';
  } else {
    // Quy tắc 2: Câu mở đầu dùng đúng tiêu đề và nằm ở dòng đầu tiên trước nút "Xem thêm"
    if (title) {
      const cleanCapStart = caption.slice(0, title.length + 25).toLowerCase();
      if (!cleanCapStart.includes(title.toLowerCase().slice(0, Math.min(28, title.length)))) {
        caption = `${title}\n\n${caption}`.trim();
      } else {
        // Đảm bảo sau dòng tiêu đề có dòng trống để tách trước nút "Xem thêm"
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
    post.funnel === 'BOFU' ||
    post.includeProduct ||
    (productName && productName.length >= 2 && new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(combinedAll)) ||
    /\b(bổ thận ft|viên nang|lọ 30 viên|thực phẩm bảo vệ sức khỏe)\b/i.test(combinedAll)
  );

  if (mentionsProduct && !combinedAll.includes(MANDATORY_DISCLAIMER)) {
    if (post.postType === 'text_comment' && comments.length > 0) {
      comments[comments.length - 1] = `${comments[comments.length - 1].trim()}\n\n*Lưu ý: ${MANDATORY_DISCLAIMER}`;
    } else {
      caption = `${caption.trim()}\n\n*Lưu ý: ${MANDATORY_DISCLAIMER}`;
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

/** Trích xuất con số mục cần minh họa trong tiêu đề (Quy tắc 7: "5 dấu hiệu" -> 5, không nhầm với tuổi 40-65 hoặc %). */
export function detectItemCountFromTitle(title = '', fallback = 4) {
  const s = String(title || '');
  // Bắt các mẫu như "5 dấu hiệu", "6 câu lệnh", "4 sai lầm", "3 thói quen", "5 nguyên tắc", "3 mức"...
  const m = s.match(/\b([2-9]|10)\s+(dấu hiệu|thói quen|sai lầm|câu lệnh|nguyên tắc|cách|bước|mức|lý do|điểm|mẹo|thực phẩm|vị|nhóm|điều|thứ|bí quyết)\b/i);
  if (m) return Math.min(8, Math.max(2, Number(m[1])));
  return fallback;
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
          'Đầu tháng 10 trời chuyển mùa, giấc ngủ là thứ thay đổi trước tiên',
          'Đàn ông ngoài 45 tuổi sợ nhất không phải làm việc nặng, mà là tiếng thở dài lúc 2 giờ sáng',
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
        funnel: 'MOFU',
        ratio: '20%',
        desc: 'Thói quen sinh hoạt, ăn uống, vận động nhẹ và giấc ngủ giúp giữ gìn nền tảng sức khỏe bền vững tuổi trung niên.',
        sampleHooks: [
          '3 thói quen buổi tối giúp đàn ông tuổi 45 ngủ sâu giấc, sáng dậy tỉnh táo',
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
    posts: [
      {
        id: 'dp-sample-1',
        date: new Date().toISOString().slice(0, 10),
        scheduledTime: '08:00',
        pillarId: 'P1',
        pillarName: 'P1 · Đêm không yên',
        funnel: 'TOFU',
        postType: 'text_comment',
        title: 'Đầu tháng 10 trời chuyển mùa, giấc ngủ là thứ thay đổi trước tiên',
        cardCount: 1,
        includeProduct: false,
        imageSpec: 'Ảnh 1 khung vuông 1080×1080 nền tối sang trọng, chữ Times New Roman lớn giữa ảnh tạo sự đồng cảm cho người Việt 40–65 tuổi.',
        selected: true,
        status: 'content_ready',
        caption: 'Đầu tháng 10 trời chuyển mùa, giấc ngủ là thứ thay đổi trước tiên',
        comments: [
          'Tình huống minh họa: Nhiều anh ngoài 45 tuổi chia sẻ rằng cứ mỗi độ thu sang trời se lạnh là đêm lại thức giấc 2–3 lần. Đang ngủ ngon phải dậy đi vệ sinh, lúc quay lại giường thì mắt cứ tỉnh táo đến gần sáng.',
          'Ở tuổi trung niên, khi nhiệt độ ban đêm giảm xuống, cơ thể ít tiết mồ hôi hơn và nhịp sinh học cũng nhạy cảm hơn. Chỉ cần một lần thức giấc lúc 2 giờ sáng cũng đủ làm đứt quãng giấc ngủ sâu.',
          'Để hạn chế tình trạng trằn trọc khi giao mùa, các anh nên giữ ấm vùng thắt lưng và lòng bàn chân trước khi ngủ, đồng thời hạn chế uống nhiều nước hoặc trà đậm sau 8 giờ tối.',
          'Mấy hôm nay trời bắt đầu chuyển gió, giấc ngủ của các anh có bị ngắt quãng giữa đêm không? Anh em cùng chia sẻ ở dưới nhé 👇',
        ],
        cards: [],
        imagePoints: [],
        images: [],
        wordCount: 192,
        emojiCount: 1,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'dp-sample-2',
        date: new Date().toISOString().slice(0, 10),
        scheduledTime: '12:30',
        pillarId: 'P2',
        pillarName: 'P2 · Hiểu đúng về thận',
        funnel: 'MOFU',
        postType: 'text_cards',
        title: '4 lầm tưởng phổ biến về tiểu đêm ở đàn ông tuổi trung niên cần hiểu đúng',
        cardCount: 4,
        includeProduct: false,
        imageSpec: 'Bộ 4 tấm ảnh 4:5 (1080×1350) đánh số #01..#04 tương ứng 4 lầm tưởng, font Times New Roman rõ ràng dễ đọc.',
        selected: true,
        status: 'content_ready',
        caption: '4 lầm tưởng phổ biến về tiểu đêm ở đàn ông tuổi trung niên cần hiểu đúng\n\nNhiều anh bước qua tuổi 40 khi thấy mình thức dậy 2–3 lần mỗi đêm thường rơi vào hai thái cực: hoặc chủ quan coi đó là chuyện tuổi tác bình thường, hoặc lo lắng quá mức rồi tự ý tìm các biện pháp truyền miệng.\n\nThực tế, giấc ngủ ban đêm và thói quen sinh hoạt buổi tối có mối liên hệ rất chặt chẽ với nhau. Hiểu đúng bản chất từng dấu hiệu sẽ giúp các anh biết cách điều chỉnh nhịp sống khoa học, chăm sóc cơ thể từ gốc thay vì xử lý vội vàng.\n\nMời các anh xem chi tiết 4 lầm tưởng thường gặp nhất trong bộ ảnh bên dưới để tự đối chiếu với thói quen hằng ngày của mình nhé.',
        comments: [],
        cards: [
          {
            badge: '#01',
            cardTitle: 'CỨ TIỂU ĐÊM LÀ KẾT LUẬN THẬN HƯ NẶNG',
            boxHeader: 'Lầm tưởng #01 & Góc nhìn đúng',
            points: [
              '✗ Lầm tưởng: Thấy dậy đêm 1–2 lần đã hoang mang nghĩ ngay đến bệnh lý thận nặng.',
              '✓ Hiểu đúng: Có thể do uống nhiều nước/bia rượu buổi tối, căng thẳng thần kinh hoặc suy giảm chức năng sinh lý tự nhiên tuổi trung niên.',
            ],
          },
          {
            badge: '#02',
            cardTitle: 'NHỊN UỐNG NƯỚC CẢ NGÀY ĐỂ ĐÊM ĐỠ DẬY',
            boxHeader: 'Lầm tưởng #02 & Góc nhìn đúng',
            points: [
              '✗ Lầm tưởng: Cắt giảm nước toàn bộ ban ngày vì sợ ban đêm phải thức giấc.',
              '✓ Hiểu đúng: Cơ thể vẫn cần đủ nước ban ngày để đào thải; chỉ nên giảm lượng nước uống sau 20h00 tối.',
            ],
          },
          {
            badge: '#03',
            cardTitle: 'TỰ Ý DÙNG ĐỒ NGÂM RƯỢU KHÔNG RÕ NGUỒN',
            boxHeader: 'Lầm tưởng #03 & Góc nhìn đúng',
            points: [
              '✗ Lầm tưởng: Nghe mách các loại rượu ngâm tự chế uống vào buổi tối cho dễ ngủ.',
              '✓ Hiểu đúng: Cồn làm giấc ngủ chập chờn, kích thích bàng quang và tăng gánh nặng cho gan thận.',
            ],
          },
          {
            badge: '#04',
            cardTitle: 'MUỐN HIỆU QUẢ CẤP TỐC CHỈ SAU VÀI NGÀY',
            boxHeader: 'Lầm tưởng #04 & Góc nhìn đúng',
            points: [
              '✗ Lầm tưởng: Tìm kiếm các giải pháp tức thời mà bỏ qua việc bồi bổ nền tảng.',
              '✓ Hiểu đúng: Chăm sóc sức khỏe tuổi 40–65 cần sự kiên trì kết hợp sinh hoạt điều độ và thảo dược chuẩn hóa GMP.',
            ],
          },
        ],
        imagePoints: [],
        images: [],
        wordCount: 185,
        emojiCount: 0,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'dp-sample-3',
        date: new Date().toISOString().slice(0, 10),
        scheduledTime: '19:30',
        pillarId: 'P4',
        pillarName: 'P4 · Hiểu rõ Bổ Thận FT',
        funnel: 'BOFU',
        postType: 'content_image',
        title: 'Bổ Thận FT là sản phẩm gì, tóm tắt trong 60 giây cho người mới tìm hiểu',
        cardCount: 1,
        includeProduct: true,
        imageSpec: 'Infographic 1080×1350 tóm tắt 3 nhóm dược liệu trong Bổ Thận FT, ghép đúng bao bì sản phẩm tham chiếu và dòng cảnh báo.',
        selected: true,
        status: 'content_ready',
        caption: 'Bổ Thận FT là sản phẩm gì, tóm tắt trong 60 giây cho người mới tìm hiểu\n\nNhiều anh em tuổi trung niên khi tìm hiểu giải pháp chăm sóc sức khỏe thường muốn biết rõ nguồn gốc, thành phần trước khi lựa chọn.\n\nThực phẩm bảo vệ sức khỏe Bổ Thận FT (lọ 30 viên nang) được nghiên cứu hợp tác cùng Viện Y học Cổ truyền và sản xuất tại nhà máy đạt chuẩn GMP, kết hợp 11 dược liệu:\n• 6 vị bài Lục vị (Thục địa, Hoài sơn, Sơn thù du, Bạch linh, Trạch tả, Mẫu đơn bì) giúp bồi bổ phần gốc.\n• 4 thảo dược bổ trợ (Nhục thung dung, Ba kích, Thỏ ty tử, Dâm dương hoắc) kết hợp cùng Sâm Ngọc Linh hỗ trợ bổ thận, tráng dương và tăng cường sinh lực.\n\nAnh em cần tìm hiểu kỹ hơn về liệu trình phù hợp có thể nhắn tin trực tiếp cho Fanpage để được tư vấn riêng tư nhé.\n\nSản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh.',
        comments: [],
        cards: [],
        imageHeadline: 'TÓM TẮT CÔNG THỨC 11 DƯỢC LIỆU BỔ THẬN FT',
        imagePoints: [
          'Nhóm 1 — Nền tảng Lục vị (6 vị): Thục địa, Hoài sơn, Sơn thù du, Bạch linh, Trạch tả, Mẫu đơn bì giúp bồi bổ phần gốc.',
          'Nhóm 2 — Thảo dược bổ trợ (4 vị): Nhục thung dung, Ba kích, Thỏ ty tử, Dâm dương hoắc hỗ trợ bổ thận, tráng dương.',
          'Nhóm 3 — Điểm nhấn Sâm Ngọc Linh: Bồi bổ nguyên khí, sản xuất tại nhà máy đạt chuẩn GMP (Lọ 30 viên nang).',
        ],
        images: [],
        wordCount: 168,
        emojiCount: 0,
        createdAt: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  list.unshift(defaultCampaign);
  writeCampaignsRaw(list);
  return list;
}

export function listCampaigns() {
  const list = ensureDefaultFtCampaign(readCampaignsRaw());
  return list;
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

  // Nếu chọn liên kết với 1 Skill trong kho -> tự động đọc thêm tài liệu từ Skill đó
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

  // Xử lý file hồ sơ sản phẩm (File 1: .pdf, .docx, .xlsx, .txt, .md) tải lên trực tiếp
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

  // Xử lý file lịch Excel (.xlsx) tải lên trực tiếp
  if (files.scheduleDoc?.[0]) {
    const f = files.scheduleDoc[0];
    const origExt = path.extname(f.originalname || '').toLowerCase() || '.xlsx';
    const savedSched = path.join(campDir, `schedule-source${origExt}`);
    fs.writeFileSync(savedSched, fs.readFileSync(f.path));
    fs.rmSync(f.path, { force: true });
    const extracted = await extractSingleDocText(savedSched);
    if (extracted) mergedScheduleText = extracted;
  }

  // Xử lý ảnh bao bì sản phẩm tham chiếu (Quy tắc 10)
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

  // Xử lý ảnh Logo cố định ở góc (Quy tắc 9)
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
    postsPerDay: Math.max(1, Math.min(9, Number(postsPerDay) || existing.postsPerDay || 3)),
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
 * BƯỚC 2: Đề xuất danh sách Tiêu đề bài đăng theo Số bài/ngày, Tuyến nội dung đã chọn và 3 dạng bài
 * (Hoặc trích trực tiếp từ lịch Excel đính kèm nếu có yêu cầu).
 */
export async function proposeTitles(campaignId, {
  postsPerDay = 3,
  daysCount = 1,
  startDate = '',
  selectedPillarIds = [],
  postTypes = ['text_comment', 'text_cards', 'content_image'],
  sheetName = '',
  customInstruction = '',
  aiModel = '',
} = {}) {
  const camp = getCampaign(campaignId);
  const perDay = Math.max(1, Math.min(9, Number(postsPerDay) || camp.postsPerDay || 3));
  const days = Math.max(1, Math.min(14, Number(daysCount) || 1));
  camp.postsPerDay = perDay;

  const baseDate = startDate ? new Date(`${startDate}T08:00:00+07:00`) : new Date();
  const dateList = [];
  for (let d = 0; d < days; d++) {
    const dt = new Date(baseDate.getTime() + d * 86400_000);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    dateList.push(`${yyyy}-${mm}-${dd}`);
  }

  const activePillars = (camp.pillars || []).filter((p) => !selectedPillarIds?.length || selectedPillarIds.includes(p.id));
  const existingTitles = (camp.posts || []).map((p) => p.title).filter(Boolean).slice(-30);

  let skillContext = '';
  if (camp.skillId) {
    try {
      const sb = SK.buildSkillPromptBlock([camp.skillId], { includePinned: false });
      skillContext = sb.block || '';
    } catch { /* ignore */ }
  }

  const defaultSlots = ['08:00', '12:30', '19:30', '21:00', '10:00', '15:30'];

  const prompt = `Bạn là Trưởng phòng Kế hoạch Nội dung Fanpage chuyên kéo Traffic tự nhiên & Chuyển đổi cho sản phẩm "${camp.productName}".

NHIỆM VỤ:
Lập danh sách đề xuất TIÊU ĐỀ BÀI ĐĂNG HÀNG NGÀY (${perDay} bài/ngày × ${days} ngày = tổng cộng ${perDay * days} bài) cho các ngày: ${dateList.join(', ')}.
${sheetName ? `- Ưu tiên lấy đúng dữ liệu lịch từ Sheet/Kênh "${sheetName}" trong tài liệu lịch đính kèm nếu khớp ngày.` : ''}
${customInstruction ? `- Yêu cầu bổ sung từ người dùng: ${customInstruction}` : ''}

3 DẠNG ĐĂNG BÀI CẦN PHÂN BỔ TRONG NGÀY (theo lựa chọn: ${postTypes.join(', ')}):
1. "text_comment": Text nền (1 câu tiêu đề gây tò mò cực mạnh trên ảnh nền chữ — thả toàn bộ nội dung ở 3–4 comment bên dưới).
2. "text_cards": Text nền + Hình ảnh mô tả từng mục (1 câu tiêu đề thu hút có con số cụ thể như "3 thói quen...", "4 dấu hiệu...", "5 nguyên tắc..." kèm bộ ảnh thẻ #01, #02... tương ứng đúng với con số đó).
3. "content_image": Content text và ảnh (Bài viết đầy đủ mở đầu bằng tiêu đề trước nút Xem thêm + Ảnh minh họa chuyên nghiệp 1080×1080 hoặc 1080×1350).

CÁC TUYẾN NỘI DUNG PHỄU ĐANG ÁP DỤNG:
${JSON.stringify(activePillars, null, 2)}

QUY TẮC BẮT BUỘC:
- Mỗi ngày phân bổ hài hòa cả 3 tầng phễu (TOFU nhận diện vấn đề/tương tác, MOFU giải thích/xây niềm tin, BOFU giới thiệu giải pháp hỗ trợ từ "${camp.productName}") và đủ các dạng bài.
- Với dạng "text_cards", tiêu đề NÊN có con số mục rõ ràng (từ 3 đến 5 mục, ví dụ "4 dấu hiệu...", "3 sai lầm...", "5 nguyên tắc...") để hệ thống tạo đúng số khung ảnh tương ứng.
- Tuyệt đối KHÔNG dùng từ cấm: "chữa khỏi", "điều trị khỏi", "hết đau hoàn toàn", "cam kết khỏi".
- Không lặp lại các tiêu đề đã làm trước đó: ${existingTitles.join(' | ') || '(chưa có)'}.
${camp.scheduleText ? `\n DỮ LIỆU LỊCH EXCEL ĐÍNH KÈM (nếu ngày yêu cầu nằm trong lịch này, hãy ưu tiên lấy đúng tuyến, dạng bài và tiêu đề trong lịch):\n${camp.scheduleText.slice(0, 18000)}` : ''}
${skillContext ? `\n${skillContext.slice(0, 15000)}` : ''}

Trả về ĐÚNG 1 khối JSON hợp lệ theo cấu trúc sau:
{
  "proposals": [
    {
      "date": "YYYY-MM-DD",
      "scheduledTime": "08:00",
      "pillarId": "P1",
      "pillarName": "P1 · Đêm không yên",
      "funnel": "TOFU",
      "postType": "text_comment",
      "title": "Câu tiêu đề chính xác (sẽ đặt ở đầu bài trước nút Xem thêm)",
      "cardCount": 1,
      "includeProduct": false,
      "imageSpec": "Mô tả chi tiết Ảnh minh họa cần chuẩn bị (bối cảnh người Việt 40-65 tuổi, bố cục chữ, màu sắc, có ghép bao bì sản phẩm hay không)"
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
    systemPrompt: `Bạn là Trưởng phòng Kế hoạch Nội dung Fanpage chuyên kéo Traffic tự nhiên & Chuyển đổi cho sản phẩm "${camp.productName}".`,
    schema: PROPOSE_SCHEMA,
    input: prompt,
  });

  const parsed = res.data || {};
  const rawProposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];

  const newPosts = rawProposals.map((item, idx) => {
    const pType = ['text_comment', 'text_cards', 'content_image'].includes(item.postType)
      ? item.postType
      : postTypes[idx % postTypes.length] || 'content_image';
    const funnel = ['TOFU', 'MOFU', 'BOFU'].includes(String(item.funnel || '').toUpperCase())
      ? String(item.funnel).toUpperCase()
      : (idx % 3 === 0 ? 'TOFU' : idx % 3 === 1 ? 'MOFU' : 'BOFU');
    const title = String(item.title || '').trim();
    const detectedCount = pType === 'text_cards'
      ? detectItemCountFromTitle(title, Number(item.cardCount) || 4)
      : (Number(item.cardCount) || 1);
    const includeProduct = Boolean(
      item.includeProduct ?? (funnel === 'BOFU' || /bổ thận|sản phẩm|dược liệu|ft\b/i.test(title))
    );

    return {
      id: `dp-${Date.now()}-${idx + 1}`,
      date: item.date || dateList[Math.floor(idx / perDay)] || dateList[0],
      scheduledTime: item.scheduledTime || defaultSlots[idx % defaultSlots.length],
      pillarId: item.pillarId || 'P1',
      pillarName: item.pillarName || 'Tuyến nội dung',
      funnel,
      postType: pType,
      title,
      cardCount: detectedCount,
      includeProduct: funnel === 'TOFU' ? false : includeProduct,
      imageSpec: String(item.imageSpec || '').trim() || `Thiết kế chuẩn độ tuổi 40–65, font Times New Roman rõ nét cho chủ đề: ${title}`,
      selected: true,
      status: 'proposed', // proposed | content_ready | images_ready | scheduled | published
      caption: '',
      comments: [],
      cards: [],
      imagePoints: [],
      images: [],
      wordCount: 0,
      emojiCount: 0,
      createdAt: new Date().toISOString(),
    };
  });

  camp.posts = [...newPosts, ...(camp.posts || [])];
  saveCampaignObj(camp);

  return {
    added: newPosts,
    campaign: camp,
    aiBadge: `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`,
  };
}

/**
 * BƯỚC 3: Viết Content chi tiết cho 1 bài đăng theo đúng 15 QUY TẮC VIẾT CONTENT & 3 Dạng đầu ra.
 */
export async function generatePostContent(campaignId, postId, { aiModel = '' } = {}) {
  const camp = getCampaign(campaignId);
  const post = (camp.posts || []).find((p) => p.id === postId);
  if (!post) throw new Error('Không tìm thấy mục bài đăng này');

  // Lấy lịch sử các bài đã viết để tránh lặp nguyên văn (Quy tắc 15)
  const previousSnippets = (camp.posts || [])
    .filter((p) => p.id !== post.id && p.caption)
    .slice(0, 8)
    .map((p) => `- [${p.date}] ${p.title}: ${p.caption.slice(0, 140)}...`)
    .join('\n');

  let skillContext = '';
  if (camp.skillId) {
    try {
      const sb = SK.buildSkillPromptBlock([camp.skillId], { includePinned: false });
      skillContext = sb.block || '';
    } catch { /* ignore */ }
  }

  const targetCardCount = post.postType === 'text_cards'
    ? detectItemCountFromTitle(post.title, post.cardCount || 4)
    : 1;

  const prompt = `Bạn là Chuyên gia Copywriting & Biên tập Nội dung Fanpage cao cấp cho chiến dịch "${camp.name}" (Sản phẩm: "${camp.productName}").

THÔNG TIN BÀI ĐĂNG CẦN VIẾT:
- Ngày lịch: ${post.date} (${post.scheduledTime || '08:00'})
- Tuyến nội dung: ${post.pillarName} (${post.pillarId})
- Tầng phễu: ${post.funnel}
- Dạng đăng bài: ${post.postType} (${POST_FORMATS.find((f) => f.id === post.postType)?.name || post.postType})
- Tiêu đề đã chốt (BẮT BUỘC giữ nguyên): "${post.title}"
- Mô tả ảnh minh họa cần chuẩn bị: "${post.imageSpec}"
- Có xuất hiện sản phẩm hay không: ${post.includeProduct ? 'CÓ' : 'KHÔNG (tập trung giá trị & tương tác)'}

HỒ SƠ SẢN PHẨM NGUỌN (FILE 1):
- Tên sản phẩm: ${camp.productName}
- Đối tượng mục tiêu: ${camp.targetAudience}
- Giọng văn: ${camp.brandVoice}
- Nội dung hồ sơ gốc:
${(camp.productInfo || '').slice(0, 24000)}
${skillContext ? `\n${skillContext.slice(0, 16000)}` : ''}

15 QUY TẮC VIẾT CONTENT BẮT BUỘC TUÂN THỦ NGHIÊM NGẶT:
1. Dùng đúng chủ đề, tuyến nội dung (${post.pillarName}), tầng phễu (${post.funnel}), tiêu đề và mô tả ảnh của dòng lịch.
2. Câu mở đầu dùng ĐÚNG NGUYÊN VĂN tiêu đề "${post.title}" và phải nằm ngay dòng đầu tiên trước nút "Xem thêm".
3. Nếu bài là TOFU hoặc MOFU: độ dài khoảng 180–350 chữ.
4. Nếu bài là BOFU: độ dài khoảng 120–200 chữ, đi thẳng vào nhu cầu, giải pháp hỗ trợ và CTA.
5. Mỗi đoạn tối đa 3–4 dòng; xuống dòng thoáng, dễ đọc trên điện thoại.
6. Emoji vừa phải, TỐI ĐA 15 emoji trong toàn bộ bài (kể cả phần comment).
7. Bài TOFU: tập trung nhận diện vấn đề, tình huống đời thường và đặt câu hỏi tương tác, KHÔNG bán hàng quá sớm.
8. Bài MOFU: tập trung giải thích dễ hiểu, xây dựng niềm tin và kết nối sản phẩm tự nhiên (khi phù hợp).
9. Bài BOFU: có CTA nhắn tin Fanpage kín đáo hoặc bình luận đúng từ khóa ghi trong tiêu đề.
10. TUYỆT ĐỐI KHÔNG sử dụng các từ: "chữa khỏi", "điều trị khỏi", "hết đau hoàn toàn", "cam kết khỏi", "dứt điểm hoàn toàn".
11. CHỈ sử dụng các từ: "hỗ trợ", "góp phần", "giúp chăm sóc", "hỗ trợ giảm triệu chứng".
12. Khi đề cập sản phẩm "${camp.productName}", BẮT BUỘC phải có đúng câu:
    “Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh.”
13. KHÔNG tự tạo giá bán, ưu đãi, chứng nhận, số liệu nghiên cứu hoặc phản hồi khách hàng nếu File 1 không cung cấp.
14. Với số liệu y khoa không có nguồn trong File 1, không diễn giải thành cam kết chắc chắn. Với câu chuyện minh họa tự dựng, mở đầu rõ bằng "Câu chuyện minh họa:" hoặc "Tình huống minh họa:".
15. Không lặp lại nguyên văn nội dung các bài đã đăng trước đó:
${previousSnippets || '(Chưa có bài trước đó)'}

YÊU CẦU RIÊNG THEO DẠNG BÀI "${post.postType}":
- Nếu postType = "text_comment" (Dạng 1 — Text nền thả comment, giống Ảnh 1 mẫu):
  + "caption": Chỉ gồm ĐÚNG 1 câu tiêu đề "${post.title}" (để đăng kèm ảnh Text nền gây tò mò).
  + "comments": Chia nội dung chi tiết (tổng 180–320 chữ) thành ĐÚNG 4 comment riêng biệt:
    * Comment 1: Mở tình huống / Câu chuyện minh họa và trả lời trực tiếp vào hook tiêu đề.
    * Comment 2: Giải thích nguyên nhân / diễn biến dưới góc nhìn khoa học & đời sống trung niên 40–65 tuổi.
    * Comment 3: Hướng chăm sóc chủ động / giải pháp hỗ trợ (nếu là MOFU/BOFU có liên quan sản phẩm thì kết nối tự nhiên từ nguồn File 1).
    * Comment 4: Lời nhắn tương tác nhẹ nhàng hoặc CTA inbox trao đổi riêng tư kín đáo (kèm câu cảnh báo nếu có nhắc sản phẩm).
- Nếu postType = "text_cards" (Dạng 2 — Text nền + Bộ hình ảnh mô tả từng mục #01..#0N, giống Ảnh 2 mẫu):
  + "caption": Mở đầu bằng nguyên văn tiêu đề "${post.title}", theo sau là bài dẫn dắt chuẩn quy tắc phễu (${post.funnel === 'BOFU' ? '120–200 chữ' : '180–300 chữ'}), chia đoạn 3–4 dòng.
  + "cards": Mảng gồm ĐÚNG ${targetCardCount} phần tử (tương ứng ${targetCardCount} mục của tiêu đề). Mỗi phần tử có:
    * "badge": "#01", "#02"...
    * "cardTitle": "TIÊU ĐỀ MỤC NGẮN GỌN IN HOA (4–8 từ)"
    * "boxHeader": "Nhãn phụ ngắn trong khung (VD: Sai lầm #01 & Cách hiểu đúng)"
    * "points": Mảng 2–3 ý ngắn gọn, chữ lớn dễ đọc trên ảnh (VD: ["✗ Hiểu nhầm thường gặp: ...", "✓ Cách chăm sóc đúng: ..."]) — tuyệt đối không chép nguyên văn cả đoạn dài lên ảnh.
- Nếu postType = "content_image" (Dạng 3 — Content text đầy đủ + Ảnh minh họa):
  + "caption": Bài viết hoàn chỉnh mở đầu bằng nguyên văn tiêu đề "${post.title}" ở dòng đầu tiên trước nút "Xem thêm", độ dài chuẩn ${post.funnel === 'BOFU' ? '120–200 chữ' : '180–350 chữ'}, mỗi đoạn tối đa 3–4 dòng.
  + "imageHeadline": Tiêu đề ngắn gọn (6–14 từ) hiển thị trên ảnh minh họa.
  + "imagePoints": Mảng 2–3 ý cốt lõi cực kỳ cô đọng (mỗi ý 10–22 từ) để trình bày lên ảnh minh họa chuẩn Times New Roman dễ đọc cho người 40–65 tuổi.

Trả về ĐÚNG 1 khối JSON hợp lệ theo cấu trúc sau:
{
  "caption": "Nội dung bài chính",
  "comments": ["Comment 1...", "Comment 2...", "Comment 3...", "Comment 4..."],
  "imageHeadline": "Tiêu đề ngắn gọn trên ảnh minh họa",
  "imagePoints": ["Ý ngắn 1 trên ảnh", "Ý ngắn 2 trên ảnh", "Ý ngắn 3 trên ảnh"],
  "cards": [
    {
      "badge": "#01",
      "cardTitle": "TIÊU ĐỀ MỤC 1",
      "boxHeader": "Điểm cốt lõi #01",
      "points": ["✗ Thói quen sai: ...", "✓ Điều chỉnh đúng: ..."]
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
            boxHeader: { type: 'string' },
            points: { type: 'array', items: { type: 'string' } },
          },
          required: ['badge', 'cardTitle', 'boxHeader', 'points'],
        },
      },
    },
    required: ['caption', 'comments', 'imageHeadline', 'imagePoints', 'cards'],
  };

  const res = await callLLM({
    aiModel,
    systemPrompt: `Bạn là Chuyên gia Copywriting & Biên tập Nội dung Fanpage cao cấp cho chiến dịch "${camp.name}" (Sản phẩm: "${camp.productName}").`,
    schema: WRITE_SCHEMA,
    input: prompt,
  });

  const parsed = res.data || {};
  post.caption = parsed.caption || post.title;
  post.comments = Array.isArray(parsed.comments) ? parsed.comments : [];
  post.imageHeadline = parsed.imageHeadline || post.title;
  post.imagePoints = Array.isArray(parsed.imagePoints) ? parsed.imagePoints : [];
  post.cards = Array.isArray(parsed.cards) ? parsed.cards : [];

  const enforced = enforceContentRules(post, camp);
  post.caption = enforced.caption;
  post.comments = enforced.comments;
  post.wordCount = enforced.wordCount;
  post.emojiCount = enforced.emojiCount;
  post.complianceWarnings = enforced.complianceWarnings;
  post.status = post.images?.length ? 'images_ready' : 'content_ready';
  post.aiBadge = `${res.aiSelection?.providerIcon || '✦'} ${res.aiSelection?.modelName || res.model}`;

  saveCampaignObj(camp);
  return { post, campaign: camp };
}

/**
 * BƯỚC 4: Tạo bộ Ảnh Minh Họa cho bài đăng theo đúng 12 QUY TẮC TẠO ẢNH:
 * - Font Times New Roman rõ ràng, dễ đọc cho người Việt 40–65 tuổi
 * - 1 khung: vuông 1:1 (1080×1080); nhiều khung / nhiều ảnh: ưu tiên 4:5 (1080×1350)
 * - Khi tiêu đề có con số, số hình/khung tương ứng đúng con số đó
 * - Logo cố định tại 1 góc
 * - Ghép đúng bao bì sản phẩm tham chiếu (không làm sai chữ/màu/hình dáng, không quá lớn che nội dung) kèm câu cảnh báo
 */
export async function renderPostImagesForItem(campaignId, postId, {
  aspectRatio = 'auto', // 'auto' | '1:1' | '4:5'
  theme = 'twilight',   // 'twilight' | 'crimson' | 'herbal_gold' | 'navy'
} = {}) {
  const camp = getCampaign(campaignId);
  const post = (camp.posts || []).find((p) => p.id === postId);
  if (!post) throw new Error('Không tìm thấy mục bài đăng này');

  const postDir = path.join(campaignsRoot(), camp.id, post.id);
  fs.mkdirSync(postDir, { recursive: true });

  const itemsSpec = [];
  const stamp = Date.now();

  if (post.postType === 'text_comment') {
    // Dạng 1: Ảnh 1 khung vuông 1:1 (1080x1080) Text nền gây tò mò (Quy tắc 5)
    const w = 1080;
    const h = aspectRatio === '4:5' ? 1350 : 1080;
    const outFile = path.join(postDir, `text-bg-${stamp}.jpg`);
    itemsSpec.push({
      kind: 'text_background',
      width: w,
      height: h,
      theme: theme || 'twilight',
      headline: post.title,
      logoPath: camp.logoPath || '',
      logoText: camp.logoText || camp.brandName || '',
      logoCorner: camp.logoCorner || 'top-right',
      subFooter: '↓ Xem chi tiết nội dung ở phần Bình luận bên dưới',
      out: outFile,
    });
  } else if (post.postType === 'text_cards') {
    // Dạng 2: Text nền + Bộ hình ảnh mô tả từng mục (#01, #02... tương ứng con số trong tiêu đề - Quy tắc 6, 7)
    const expectedCount = detectItemCountFromTitle(post.title, post.cardCount || 4);
    let cards = Array.isArray(post.cards) && post.cards.length ? post.cards : [];
    if (!cards.length) {
      cards = Array.from({ length: expectedCount }, (_, i) => ({
        badge: `#0${i + 1}`,
        cardTitle: `ĐIỂM LƯU Ý SỐ ${i + 1}`,
        boxHeader: `${post.pillarName} · Mục ${i + 1}/${expectedCount}`,
        points: [post.imagePoints?.[i] || post.title],
      }));
    }
    const w = 1080;
    const h = aspectRatio === '1:1' ? 1080 : 1350; // Quy tắc 6: nhiều ảnh ưu tiên 4:5 (1080x1350)

    cards.forEach((c, idx) => {
      const outFile = path.join(postDir, `card-${idx + 1}-${stamp}.jpg`);
      itemsSpec.push({
        kind: 'card_item',
        width: w,
        height: h,
        index: idx + 1,
        total: cards.length,
        badge: c.badge || `#0${idx + 1}`,
        topBanner: idx === 0 ? post.title : '',
        bannerColor: theme === 'crimson' ? 'red' : 'bronze',
        cardTitle: c.cardTitle || `MỤC #0${idx + 1}`,
        boxHeader: c.boxHeader || `${post.pillarName} · #0${idx + 1}`,
        points: Array.isArray(c.points) ? c.points : [String(c.body || '')],
        includeProduct: Boolean(post.includeProduct && idx === cards.length - 1),
        productPath: camp.productImagePath || '',
        logoPath: camp.logoPath || '',
        logoText: camp.logoText || camp.brandName || '',
        logoCorner: camp.logoCorner || 'top-right',
        footerText: `${camp.productName} · ${post.pillarName}`,
        out: outFile,
      });
    });
  } else {
    // Dạng 3: Content text + Ảnh minh họa (1 khung: 1080x1080; nhiều khung: 1080x1350 - Quy tắc 5, 6)
    const pts = Array.isArray(post.imagePoints) && post.imagePoints.length
      ? post.imagePoints
      : [post.imageSpec || post.title];
    const isMultiFrame = pts.length >= 3;
    const w = 1080;
    const h = aspectRatio === '4:5' ? 1350 : aspectRatio === '1:1' ? 1080 : (isMultiFrame ? 1350 : 1080);
    const outFile = path.join(postDir, `illust-${stamp}.jpg`);
    itemsSpec.push({
      kind: 'content_image',
      width: w,
      height: h,
      multiFrame: isMultiFrame,
      pillar: post.pillarName || 'KIẾN THỨC SỨC KHỎE',
      imageHeadline: post.imageHeadline || post.title,
      points: pts,
      includeProduct: Boolean(post.includeProduct),
      productPath: camp.productImagePath || '',
      logoPath: camp.logoPath || '',
      logoText: camp.logoText || camp.brandName || '',
      logoCorner: camp.logoCorner || 'top-right',
      footerText: `${camp.productName} · Chăm sóc sức khỏe chủ động tuổi trung niên`,
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
  if (patch.caption !== undefined) post.caption = String(patch.caption);
  if (Array.isArray(patch.comments)) post.comments = patch.comments.map((x) => String(x || '').trim()).filter(Boolean);
  if (Array.isArray(patch.imagePoints)) post.imagePoints = patch.imagePoints.map((x) => String(x || '').trim()).filter(Boolean);
  if (Array.isArray(patch.cards)) post.cards = patch.cards;

  if (patch.caption !== undefined || patch.comments !== undefined || patch.title !== undefined) {
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
 * BƯỚC 5: Đăng ngay hoặc Lên lịch đăng bài (Text + Ảnh + Comment) lên Fanpage
 * Hỗ trợ tự động qua cả Facebook Graph API (nếu đã nối Page token) và Chrome Facebook (Meta Business Suite).
 */
export async function publishOrScheduleDailyPost(campaignId, postId, {
  mode = 'schedule', // 'publish' | 'schedule' | 'draft'
  scheduledAt = null,
} = {}) {
  const camp = getCampaign(campaignId);
  const post = (camp.posts || []).find((p) => p.id === postId);
  if (!post) throw new Error('Không tìm thấy bài đăng');

  if (!post.caption && !post.title) {
    throw new Error('Bài đăng chưa có nội dung — hãy bấm "Viết Content" trước khi đăng/lên lịch');
  }

  // Nếu chưa tạo ảnh minh họa thì tự động render ảnh trước khi đăng
  if (!post.images?.length) {
    await renderPostImagesForItem(campaignId, postId);
  }

  const imageFiles = (post.images || []).map((im) => im.path).filter((fp) => fp && fs.existsSync(fp));
  const captionToPost = post.caption || post.title;
  const commentsToPost = post.postType === 'text_comment' ? (post.comments || []) : [];

  // Tính unix timestamp hẹn giờ nếu mode === 'schedule'
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

  // Lưu vào sổ Lịch đăng chung (data/posts.json) để theo dõi ở tab Lịch đăng
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
