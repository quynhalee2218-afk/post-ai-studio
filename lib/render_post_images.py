# -*- coding: utf-8 -*-
"""
Trình tạo Ảnh Minh Họa chuẩn Phong cách Thiết kế của Skill `ft-daily-content` (Bổ Thận FT):
- Mặc định khung vuông 1:1 (1080 × 1080).
- Dạng 1 (`text_comment`): KHÔNG tạo ảnh.
- Dạng 2 (`card_item` — Bộ ảnh giải thích cho câu Hook):
  + Mỗi ảnh vuông 1080 × 1080 gồm:
    * Phần trên (~22% chiều cao): Nền Kem ấm (#FAF3E6), chính giữa là 1 dòng tiêu đề ngắn gọn (3–6 chữ, viết hoa chữ cái đầu tự nhiên) bằng font chữ Serif đậm (Times New Roman Bold) cỡ rất lớn (62px–76px), màu Nâu đồng đậm (#5B240B).
    * Phần dưới (~78% chiều cao): Ảnh chụp chân thực (photorealistic) tràn viền của người đàn ông Việt Nam 40–65 tuổi trong đúng bối cảnh/tình huống của mục đó.
    * Tuyệt đối KHÔNG chèn khung hộp chữ dài dòng, không đánh số trang, không watermark.
- Dạng 3 (`content_image` — 1 Ảnh minh họa đi kèm bài Content Hook-Body-CTA):
  + Ảnh vuông 1080 × 1080 đồng nhất phong cách: Phần trên nền Kem ấm (#FAF3E6) kèm tiêu đề ngắn gọn chữ lớn font Times New Roman Bold màu Nâu đậm (#5B240B); phần dưới là ảnh chụp chân thực người đàn ông Việt 40–65 tuổi đúng bối cảnh câu chuyện.
  + Nếu bài có gắn sản phẩm (`includeProduct = true`): ghép hộp đứng + lọ thủy tinh Bổ Thận FT tách nền sạch (`ft-cutout-box-bottle.png`) kèm dòng khuyến cáo bắt buộc ở chân ảnh.
"""
import sys
import os
import re
import json
import base64
import html
from pathlib import Path
from PIL import Image

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

DISCLAIMER_TEXT = "Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."

THEMES = {
    "ft_editorial": {
        "header_bg": "#FAF3E6",
        "title_ink": "#5B240B",
        "sub_ink": "#7A3E1D",
        "gold": "#C5933A",
        "card_bg": "#F6EFE2",
        "card_border": "#DAC6A7",
    },
    "herbal_warm": {
        "header_bg": "#FBF5E9",
        "title_ink": "#542209",
        "sub_ink": "#753B1A",
        "gold": "#B8862D",
        "card_bg": "#F5ECDC",
        "card_border": "#D5BC96",
    },
    "deep_espresso": {
        "header_bg": "#F7EFE0",
        "title_ink": "#4A1B06",
        "sub_ink": "#6B3215",
        "gold": "#C8963E",
        "card_bg": "#F4EBDD",
        "card_border": "#D2BBA0",
    },
    "clinical_clean": {
        "header_bg": "#FCF7EE",
        "title_ink": "#5C260E",
        "sub_ink": "#7A4022",
        "gold": "#B88938",
        "card_bg": "#F5F1E8",
        "card_border": "#D6C8B2",
    },
}

PROPER_NOUNS = [
    ("bổ thận ft", "Bổ Thận FT"),
    ("sâm ngọc linh", "Sâm Ngọc Linh"),
    ("lục vị địa hoàng", "Lục Vị Địa Hoàng"),
    ("lục vị", "Lục Vị"),
    ("đông y", "Đông y"),
    ("tây y", "Tây y"),
    ("gmp", "GMP"),
    ("thục địa", "Thục địa"),
    ("hoài sơn", "Hoài sơn"),
    ("sơn thù du", "Sơn thù du"),
    ("bạch linh", "Bạch linh"),
    ("trạch tả", "Trạch tả"),
    ("mẫu đơn bì", "Mẫu đơn bì"),
    ("nhục thung dung", "Nhục thung dung"),
    ("ba kích", "Ba kích"),
    ("thỏ ty tử", "Thỏ ty tử"),
    ("dâm dương hoắc", "Dâm dương hoắc"),
]


def normalize_short_heading(raw_text: str, max_words: int = 8) -> str:
    """
    Chuẩn hóa tiêu đề trên ảnh:
    - Bỏ số thứ tự đầu dòng (01, #01, 1., ...)
    - Nếu đang viết IN HOA toàn bộ thì chuyển về viết hoa chữ cái đầu câu tự nhiên (giống "Uống nhiều rượu bia", "Căng thẳng kéo dài")
    - Giữ ngắn gọn, súc tích, dễ đọc.
    """
    s = str(raw_text or "").strip()
    s = re.sub(r"^(?:#?\d+[\.\:\-\)\s]+)+", "", s).strip()
    s = re.sub(r"^[\•\-\–\—\✗\✓\✘\✔]+\s*", "", s).strip()
    # Nếu có dấu hai chấm kiểu "Thứ 1: Uống nhiều rượu bia", lấy phần chính
    if ":" in s:
        left, right = s.split(":", 1)
        if len(left.split()) <= 3 and len(right.strip()) >= 4:
            s = right.strip()

    # Nếu chuỗi đang IN HOA toàn bộ -> chuyển về sentence case tự nhiên
    alpha_chars = [ch for ch in s if ch.isalpha()]
    if alpha_chars and sum(1 for ch in alpha_chars if ch.isupper()) / len(alpha_chars) > 0.7:
        s = s.lower()
        if s:
            s = s[0].upper() + s[1:]
        for low, proper in PROPER_NOUNS:
            s = re.sub(re.escape(low), proper, s, flags=re.IGNORECASE)
    elif s:
        s = s[0].upper() + s[1:]

    words = s.split()
    if len(words) > max_words:
        s = " ".join(words[:max_words]).rstrip(",;:")
    return s


def file_to_data_uri(fp: str) -> str:
    if not fp or not os.path.exists(fp):
        return ""
    ext = Path(fp).suffix.lower()
    mime = "image/png" if ext == ".png" else "image/jpeg"
    with open(fp, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def get_scenes_dir(item: dict) -> str:
    scenes_dir = item.get("scenesDir") or ""
    if scenes_dir and os.path.isdir(scenes_dir):
        return scenes_dir
    root_guess = Path(__file__).resolve().parent.parent / "data" / "skills" / "ft-daily-content" / "assets" / "scenes"
    if root_guess.is_dir():
        return str(root_guess)
    return ""


def pick_scene_photo(item: dict, used_files: set) -> str:
    scenes_dir = get_scenes_dir(item)
    if not scenes_dir:
        return ""

    scene_key = str(item.get("sceneKey") or "").lower().strip()
    text_blob = " ".join([
        scene_key,
        str(item.get("cardTitle") or ""),
        str(item.get("imageHeadline") or ""),
        str(item.get("sceneHint") or ""),
        str(item.get("imageSpec") or ""),
        str(item.get("postTitle") or ""),
        " ".join(item.get("points") or []),
    ]).lower()

    # Bản đồ từ khóa ngữ cảnh -> file ảnh chụp người đàn ông Việt 40-65 tuổi chân thực
    keyword_rules = [
        (["rượu", "bia", "nhậu", "cồn", "tiệc", "alcohol", "beer"], "scene-alcohol-beer.jpg"),
        (["căng thẳng", "áp lực", "stress", "lo âu", "công việc", "giấy tờ", "đầu óc"], "scene-work-stress.jpg"),
        (["hút thuốc", "thuốc lá", "khói thuốc", "smoking", "cà phê", "ban công"], "scene-smoking-balcony.jpg"),
        (["ngồi quá lâu", "ngồi lâu", "ít vận động", "lười vận động", "cổ vai gáy", "văn phòng", "mỏi lưng", "sedentary"], "scene-sedentary-neck.jpg"),
        (["tài xế", "lái xe", "cuốn sổ", "ghi lịch", "chuyến xe", "đếm số đêm", "driver", "notebook"], "scene-driver-notebook.jpg"),
        (["thiếu ngủ", "mất ngủ", "thức khuya", "ngủ muộn", "insomnia", "đồng hồ"], "scene-insomnia-bed.jpg"),
        (["tiểu đêm", "dậy đêm", "2 giờ sáng", "3 giờ sáng", "trằn trọc", "đứt quãng", "chập chờn"], "scene-sleep-night.jpg"),
        (["vợ chồng", "người vợ", "bạn đời", "chị vợ", "hôn nhân", "couple"], "scene-couple-harmony.jpg"),
        (["dược liệu", "thảo dược", "sâm ngọc linh", "lục vị", "thục địa", "hoài sơn", "11 vị", "công thức", "herbal"], "scene-herbal-essence.jpg"),
        (["buổi sáng", "đi bộ", "tập thể dục", "vận động", "nắng sớm", "tỉnh táo", "morning"], "scene-morning-vitality.jpg"),
        (["trà", "tìm hiểu", "kiến thức", "hiểu đúng", "consult"], "scene-consult-knowledge.jpg"),
    ]

    # Ưu tiên khớp trên tiêu đề riêng của thẻ trước (`cardTitle` / `sceneHint` / `sceneKey`)
    primary_blob = " ".join([
        scene_key,
        str(item.get("cardTitle") or ""),
        str(item.get("sceneHint") or ""),
        str(item.get("imageHeadline") or ""),
    ]).lower()

    for keywords, filename in keyword_rules:
        if any(k in primary_blob for k in keywords):
            cand = os.path.join(scenes_dir, filename)
            if os.path.exists(cand) and cand not in used_files:
                used_files.add(cand)
                return file_to_data_uri(cand)

    # Tiếp theo xét toàn bộ ngữ cảnh bài viết
    for keywords, filename in keyword_rules:
        if any(k in text_blob for k in keywords):
            cand = os.path.join(scenes_dir, filename)
            if os.path.exists(cand) and cand not in used_files:
                used_files.add(cand)
                return file_to_data_uri(cand)

    # Danh sách dự phòng đa dạng (đảm bảo 5 ảnh trong 1 bộ không bao giờ trùng nhau)
    fallback_order = [
        "scene-alcohol-beer.jpg",
        "scene-work-stress.jpg",
        "scene-smoking-balcony.jpg",
        "scene-sedentary-neck.jpg",
        "scene-insomnia-bed.jpg",
        "scene-driver-notebook.jpg",
        "scene-sleep-night.jpg",
        "scene-consult-knowledge.jpg",
        "scene-morning-vitality.jpg",
        "scene-couple-harmony.jpg",
        "scene-herbal-essence.jpg",
    ]
    for fn in fallback_order:
        cand = os.path.join(scenes_dir, fn)
        if os.path.exists(cand) and cand not in used_files:
            used_files.add(cand)
            return file_to_data_uri(cand)

    # Nếu tất cả đã dùng qua 1 vòng thì lấy theo index
    existing = [os.path.join(scenes_dir, fn) for fn in fallback_order if os.path.exists(os.path.join(scenes_dir, fn))]
    if existing:
        idx = int(item.get("index") or 1)
        return file_to_data_uri(existing[(idx - 1) % len(existing)])
    return ""


def resolve_product_uri(item: dict) -> str:
    if not item.get("includeProduct"):
        return ""
    root_cutout = Path(__file__).resolve().parent.parent / "data" / "skills" / "ft-daily-content" / "assets" / "ft-cutout-box-bottle.png"
    if root_cutout.is_file():
        return file_to_data_uri(str(root_cutout))
    prod_path = item.get("productPath") or ""
    if prod_path and os.path.exists(prod_path):
        return file_to_data_uri(prod_path)
    return ""


def build_logo_html(item: dict) -> str:
    logo_path = item.get("logoPath") or ""
    if not logo_path or not os.path.exists(logo_path):
        return ""
    uri = file_to_data_uri(logo_path)
    if not uri:
        return ""
    corner = item.get("logoCorner") or "top-right"
    pos_css = {
        "top-right": "top: 22px; right: 28px;",
        "top-left": "top: 22px; left: 28px;",
        "bottom-right": "bottom: 48px; right: 28px;",
        "bottom-left": "bottom: 48px; left: 28px;",
    }.get(corner, "top: 22px; right: 28px;")
    return f'<img src="{uri}" style="position:absolute;{pos_css}max-height:48px;max-width:140px;object-fit:contain;z-index:20;" />'


def build_clean_editorial_card_html(item: dict, scene_uri: str, is_single_story: bool = False) -> str:
    """
    Thiết kế chuẩn theo đúng 5 ảnh mẫu người dùng cung cấp:
    - Khung vuông 1:1 (1080 × 1080).
    - Phần trên (~235px): Nền Kem ấm (#FAF3E6), chữ Serif đậm (Times New Roman Bold) màu Nâu đồng đậm (#5B240B), cỡ chữ lớn, căn giữa.
    - Phần dưới (~845px): Ảnh chụp chân thực người đàn ông Việt Nam 40–65 tuổi tràn viền, chuyển sắc mượt ở mép giáp nền kem.
    - Nếu `includeProduct = true` (bài giới thiệu sản phẩm): ghép thêm hộp đứng + lọ thủy tinh tách nền ở góc phải dưới và dòng cảnh báo ở chân ảnh.
    """
    w = int(item.get("width") or 1080)
    h = int(item.get("height") or 1080)
    theme_key = item.get("theme") if item.get("theme") in THEMES else "ft_editorial"
    pal = THEMES[theme_key]

    raw_heading = (
        item.get("cardTitle")
        if not is_single_story
        else (item.get("imageHeadline") or item.get("cardTitle") or item.get("postTitle") or "")
    )
    max_w = 10 if is_single_story else 7
    heading_text = normalize_short_heading(raw_heading, max_words=max_w)
    escaped_heading = html.escape(heading_text)

    char_len = len(heading_text)
    if char_len <= 20:
        font_size = 78
        header_h = 236
    elif char_len <= 28:
        font_size = 68
        header_h = 238
    elif char_len <= 40:
        font_size = 58
        header_h = 246
    else:
        font_size = 50
        header_h = 256

    photo_h = h - header_h
    prod_uri = resolve_product_uri(item)
    logo_html = build_logo_html(item)

    product_overlay_html = ""
    if prod_uri:
        product_overlay_html = f"""
        <div class="prod-badge-stage">
          <img src="{prod_uri}" alt="Bổ Thận FT" />
        </div>
        <div class="disclaimer-strip">
          {html.escape(DISCLAIMER_TEXT)}
        </div>
        """

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: {w}px;
    height: {h}px;
    overflow: hidden;
    background: {pal['header_bg']};
    font-family: 'Times New Roman', Georgia, 'Noto Serif', serif;
    position: relative;
    display: flex;
    flex-direction: column;
  }}
  .top-cream-banner {{
    width: 100%;
    height: {header_h}px;
    background: {pal['header_bg']};
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px 54px 10px 54px;
    text-align: center;
    position: relative;
    z-index: 5;
    flex-shrink: 0;
  }}
  .banner-title {{
    font-family: 'Times New Roman', Georgia, serif;
    font-size: {font_size}px;
    font-weight: 700;
    color: {pal['title_ink']};
    line-height: 1.14;
    letter-spacing: -0.4px;
    text-rendering: geometricPrecision;
  }}
  .photo-stage {{
    width: 100%;
    height: {photo_h}px;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
    background: #2B180E;
  }}
  .photo-stage img.scene-img {{
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 22%;
    display: block;
  }}
  /* Lớp chuyển mềm nhẹ ở mép trên ảnh giáp với nền kem */
  .top-soft-fade {{
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 22px;
    background: linear-gradient(180deg, {pal['header_bg']} 0%, rgba(250, 243, 230, 0) 100%);
    z-index: 3;
    pointer-events: none;
  }}
  .prod-badge-stage {{
    position: absolute;
    right: 34px;
    bottom: 62px;
    width: 270px;
    height: 350px;
    z-index: 10;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: radial-gradient(circle at center, rgba(250, 243, 230, 0.92) 0%, rgba(250, 243, 230, 0.0) 74%);
    padding: 12px;
    filter: drop-shadow(0 14px 24px rgba(25, 12, 5, 0.45));
  }}
  .prod-badge-stage img {{
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }}
  .disclaimer-strip {{
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 12;
    background: rgba(43, 24, 14, 0.92);
    color: #FAF3E6;
    text-align: center;
    padding: 10px 20px;
    font-size: 19px;
    font-style: italic;
    border-top: 1.5px solid {pal['gold']};
  }}
</style>
</head>
<body>
  {logo_html}
  <div class="top-cream-banner">
    <div class="banner-title">{escaped_heading}</div>
  </div>
  <div class="photo-stage">
    <div class="top-soft-fade"></div>
    {f'<img class="scene-img" src="{scene_uri}" alt="Minh họa" />' if scene_uri else ''}
    {product_overlay_html}
  </div>
</body>
</html>"""


def render_items_with_playwright(items: list):
    import subprocess

    render_jobs = []
    used_scenes = set()

    for item in items:
        kind = item.get("kind")
        if kind == "text_background":
            continue
        w = int(item.get("width") or 1080)
        h = int(item.get("height") or 1080)
        out_path = item.get("out")
        if not out_path:
            continue
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

        scene_uri = pick_scene_photo(item, used_scenes)
        is_single = (kind != "card_item")
        html_doc = build_clean_editorial_card_html(item, scene_uri, is_single_story=is_single)

        html_file = out_path + ".tmp.html"
        png_file = out_path + ".tmp.png"
        with open(html_file, "w", encoding="utf-8") as f:
            f.write(html_doc)
        render_jobs.append({
            "htmlFile": os.path.abspath(html_file),
            "pngFile": os.path.abspath(png_file),
            "outFile": os.path.abspath(out_path),
            "width": w,
            "height": h,
        })

    if not render_jobs:
        return

    repo_root = str(Path(__file__).resolve().parent.parent)
    jobs_json = json.dumps(render_jobs, ensure_ascii=False)

    node_script = """
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const jobs = JSON.parse(process.argv[1]);
const chromePaths = [
  process.env.CHROME_BIN,
  'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
  'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
  'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
].filter((p) => p && fs.existsSync(p));

const browser = await chromium.launch({
  executablePath: chromePaths[0],
  headless: true,
});
try {
  for (const j of jobs) {
    const page = await browser.newPage({
      viewport: { width: j.width, height: j.height },
      deviceScaleFactor: 2,
    });
    await page.goto(pathToFileURL(j.htmlFile).href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(120);
    await page.screenshot({ path: j.pngFile, fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
}
"""
    res = subprocess.run(
        ["node", "--input-type=module", "-e", node_script, jobs_json],
        cwd=repo_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if res.returncode != 0:
        raise RuntimeError(f"Playwright render failed: {res.stderr or res.stdout}")

    for j in render_jobs:
        try:
            with Image.open(j["pngFile"]) as im:
                rgb_im = im.convert("RGB").resize((j["width"], j["height"]), Image.Resampling.LANCZOS)
                rgb_im.save(j["outFile"], "JPEG", quality=95, subsampling=0)
            print(f"Rendered: {j['outFile']} ({j['width']}x{j['height']})")
        finally:
            for tmp in (j["htmlFile"], j["pngFile"]):
                try:
                    if os.path.exists(tmp):
                        os.remove(tmp)
                except OSError:
                    pass


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print("No input provided", file=sys.stderr)
        sys.exit(1)
    payload = json.loads(raw)
    items = payload.get("items") or []
    if not items:
        return
    render_items_with_playwright(items)


if __name__ == "__main__":
    main()
