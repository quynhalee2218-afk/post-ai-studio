# -*- coding: utf-8 -*-
"""
Trình tạo Ảnh Minh Họa chuẩn Phong cách Thiết kế của Skill `ft-daily-content` (Bổ Thận FT):
- Mặc định khung vuông 1:1 (1080 × 1080), không tự đổi 4:5 (trừ khi được yêu cầu rõ).
- Phong cách Editorial Dược liệu & Sức khỏe Trung niên (tông Kem ấm #FAF6F0 – Nâu đồng #3B2214/#7B3F1D – Vàng đồng #C5933A).
- Font chữ Times New Roman (serif) rõ ràng, chữ lớn, ít chữ dễ đọc cho người Việt 40–65 tuổi.
- Kết hợp hình ảnh chân thực của người Việt 40–65 tuổi (ánh sáng tự nhiên) & thảo dược Đông y.
- Tuyệt đối KHÔNG thêm tên "PHONG ĐỘ", watermark tự chế hay số thứ tự "Ảnh 1/2/3".
- Khi có sản phẩm: sử dụng bản tách nền chuẩn `ft-cutout-box-bottle.png` (chỉ gồm hộp đứng và lọ đứng cạnh hộp, bỏ nền/bàn/hộp kê ngang), đặt tại vùng riêng không che chữ, kèm câu cảnh báo bắt buộc ở chân ảnh.
"""
import sys
import os
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
        "bg": "#FAF6F0",
        "bg_grad": "linear-gradient(165deg, #FBF8F3 0%, #F3EAD8 100%)",
        "header_grad": "linear-gradient(135deg, #2B180E 0%, #5E2F16 58%, #844522 100%)",
        "card_bg": "#F6EFE2",
        "card_alt": "#EFE5D4",
        "card_border": "#DAC6A7",
        "ink": "#2B180E",
        "ink_sub": "#5A3E2B",
        "accent": "#8C431E",
        "gold": "#C5933A",
        "gold_light": "#E6C786",
        "badge_bg": "#3B2214",
        "badge_fg": "#F7E7C4",
        "wrong_bg": "#FDF2F0",
        "wrong_border": "#E6B8B0",
        "wrong_ink": "#8B261D",
        "right_bg": "#F2F7F1",
        "right_border": "#B8D4B4",
        "right_ink": "#1E5631",
    },
    "herbal_warm": {
        "bg": "#F9F5EB",
        "bg_grad": "linear-gradient(165deg, #FCF9F2 0%, #EFE4CE 100%)",
        "header_grad": "linear-gradient(135deg, #3A2312 0%, #6E3B19 58%, #965526 100%)",
        "card_bg": "#F5ECDC",
        "card_alt": "#EDE0C9",
        "card_border": "#D5BC96",
        "ink": "#2D1A0E",
        "ink_sub": "#5C4028",
        "accent": "#945020",
        "gold": "#B8862D",
        "gold_light": "#E2C178",
        "badge_bg": "#4A2A14",
        "badge_fg": "#FAE8C0",
        "wrong_bg": "#FDF2F0",
        "wrong_border": "#E6B8B0",
        "wrong_ink": "#8B261D",
        "right_bg": "#F2F7F1",
        "right_border": "#B8D4B4",
        "right_ink": "#1E5631",
    },
    "deep_espresso": {
        "bg": "#F7F2EA",
        "bg_grad": "linear-gradient(165deg, #FAF6F0 0%, #EDE1CF 100%)",
        "header_grad": "linear-gradient(135deg, #1F1109 0%, #442210 60%, #69361A 100%)",
        "card_bg": "#F4EBDD",
        "card_alt": "#EAE0CE",
        "card_border": "#D2BBA0",
        "ink": "#23130A",
        "ink_sub": "#523826",
        "accent": "#753818",
        "gold": "#C8963E",
        "gold_light": "#E5C481",
        "badge_bg": "#2B180E",
        "badge_fg": "#F5E1B9",
        "wrong_bg": "#FDF2F0",
        "wrong_border": "#E6B8B0",
        "wrong_ink": "#8B261D",
        "right_bg": "#F2F7F1",
        "right_border": "#B8D4B4",
        "right_ink": "#1E5631",
    },
    "clinical_clean": {
        "bg": "#F8F7F4",
        "bg_grad": "linear-gradient(165deg, #FFFFFF 0%, #F1EDE4 100%)",
        "header_grad": "linear-gradient(135deg, #2C1D12 0%, #5B341B 60%, #7C4927 100%)",
        "card_bg": "#F5F1E8",
        "card_alt": "#EBE5D8",
        "card_border": "#D6C8B2",
        "ink": "#26180F",
        "ink_sub": "#543D2C",
        "accent": "#7C421E",
        "gold": "#B88938",
        "gold_light": "#DFC082",
        "badge_bg": "#362012",
        "badge_fg": "#F6E5C2",
        "wrong_bg": "#FDF2F0",
        "wrong_border": "#E6B8B0",
        "wrong_ink": "#8B261D",
        "right_bg": "#F2F7F1",
        "right_border": "#B8D4B4",
        "right_ink": "#1E5631",
    },
}


def file_to_data_uri(fp: str) -> str:
    if not fp or not os.path.exists(fp):
        return ""
    ext = Path(fp).suffix.lower()
    mime = "image/png" if ext == ".png" else "image/jpeg"
    with open(fp, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def pick_scene_photo(item: dict) -> str:
    scenes_dir = item.get("scenesDir") or ""
    if not scenes_dir or not os.path.isdir(scenes_dir):
        root_guess = Path(__file__).resolve().parent.parent / "data" / "skills" / "ft-daily-content" / "assets" / "scenes"
        if root_guess.is_dir():
            scenes_dir = str(root_guess)
        else:
            return ""

    pillar_id = str(item.get("pillarId") or "").upper()
    text_blob = " ".join([
        str(item.get("postTitle") or ""),
        str(item.get("cardTitle") or ""),
        str(item.get("imageHeadline") or ""),
        str(item.get("imageSpec") or ""),
        " ".join(item.get("points") or []),
    ]).lower()

    idx = int(item.get("index") or 1)

    # Danh sách ảnh bối cảnh người Việt 40-65 tuổi & thảo dược chân thực
    sleep_img = os.path.join(scenes_dir, "scene-sleep-night.jpg")
    consult_img = os.path.join(scenes_dir, "scene-consult-knowledge.jpg")
    morning_img = os.path.join(scenes_dir, "scene-morning-vitality.jpg")
    herbal_img = os.path.join(scenes_dir, "scene-herbal-essence.jpg")
    couple_img = os.path.join(scenes_dir, "scene-couple-harmony.jpg")

    all_Rotation = [consult_img, sleep_img, morning_img, herbal_img, couple_img]
    existing_rot = [p for p in all_Rotation if os.path.exists(p)]
    if not existing_rot:
        return ""

    # Nếu là bộ thẻ nhiều tấm (card_item), xoay vòng ảnh hợp lý theo nội dung từng thẻ để mỗi tấm có hình minh họa riêng sống động
    if item.get("kind") == "card_item":
        if any(k in text_blob for k in ["rượu", "thảo dược", "dược liệu", "gmp", "bổ thận", "cấp tốc"]):
            cand = herbal_img if idx % 2 == 0 else consult_img
        elif any(k in text_blob for k in ["nước", "buổi tối", "sinh hoạt", "vận động", "thói quen"]):
            cand = morning_img
        elif any(k in text_blob for k in ["vợ chồng", "bạn đời", "gia đình"]):
            cand = couple_img
        elif any(k in text_blob for k in ["tiểu đêm", "thức giấc", "2 giờ", "mất ngủ", "đêm"]):
            cycle = [sleep_img, consult_img, morning_img, herbal_img]
            cand = cycle[(idx - 1) % len(cycle)]
        else:
            cand = existing_rot[(idx - 1) % len(existing_rot)]
        if os.path.exists(cand):
            return file_to_data_uri(cand)

    # Nếu là ảnh đơn (content_image)
    if pillar_id == "P1" or any(k in text_blob for k in ["mất ngủ", "thức giấc", "2 giờ sáng", "trằn trọc"]):
        cand = sleep_img
    elif pillar_id == "P5" or any(k in text_blob for k in ["vợ chồng", "người vợ", "bạn đời"]):
        cand = couple_img
    elif pillar_id == "P4" or item.get("includeProduct") or any(k in text_blob for k in ["dược liệu", "lục vị", "sâm ngọc linh", "bổ thận ft"]):
        cand = herbal_img
    elif pillar_id == "P3" or any(k in text_blob for k in ["thói quen", "vận động", "buổi sáng"]):
        cand = morning_img
    else:
        cand = consult_img

    if os.path.exists(cand):
        return file_to_data_uri(cand)
    return file_to_data_uri(existing_rot[0])


def resolve_product_uri(item: dict) -> str:
    if not item.get("includeProduct"):
        return ""
    # Ưu tiên bản tách nền chuẩn hộp đứng + lọ đứng cạnh hộp (ft-cutout-box-bottle.png)
    root_cutout = Path(__file__).resolve().parent.parent / "data" / "skills" / "ft-daily-content" / "assets" / "ft-cutout-box-bottle.png"
    if root_cutout.is_file():
        return file_to_data_uri(str(root_cutout))
    prod_path = item.get("productPath") or ""
    if prod_path and os.path.exists(prod_path):
        return file_to_data_uri(prod_path)
    return ""


def build_logo_html(item: dict) -> str:
    # SKILL.md: "Không thêm tên PHONG ĐỘ, tên page khác, watermark hay logo tự chế."
    # Chỉ hiển thị ảnh Logo nếu người dùng thực sự tải file ảnh Logo riêng lên chiến dịch.
    logo_path = item.get("logoPath") or ""
    if not logo_path or not os.path.exists(logo_path):
        return ""
    uri = file_to_data_uri(logo_path)
    if not uri:
        return ""
    corner = item.get("logoCorner") or "top-right"
    pos_css = {
        "top-right": "top: 28px; right: 32px;",
        "top-left": "top: 28px; left: 32px;",
        "bottom-right": "bottom: 52px; right: 32px;",
        "bottom-left": "bottom: 52px; left: 32px;",
    }.get(corner, "top-right")
    return f'<img src="{uri}" style="position:absolute;{pos_css}max-height:54px;max-width:160px;object-fit:contain;z-index:20;" />'


def format_point_html(pt: str, pal: dict, idx: int) -> str:
    s = str(pt or "").strip()
    # Phân biệt dòng Lầm tưởng (✗) vs Hiểu đúng (✓) để trình bày trực quan, sang trọng
    if s.startswith("✗") or "lầm tưởng:" in s.lower() or "sai lầm:" in s.lower() or "hiểu nhầm:" in s.lower():
        clean = s.lstrip("✗✘•- ").strip()
        parts = clean.split(":", 1)
        if len(parts) == 2 and len(parts[0]) < 32:
            label, body = html.escape(parts[0].strip()), html.escape(parts[1].strip())
        else:
            label, body = "Lầm tưởng thường gặp", html.escape(clean)
        return f"""
        <div class="pt-box wrong">
          <div class="pt-icon wrong-icon">✗</div>
          <div class="pt-content">
            <div class="pt-tag wrong-tag">{label}</div>
            <div class="pt-text">{body}</div>
          </div>
        </div>"""

    if s.startswith("✓") or "hiểu đúng:" in s.lower() or "điều chỉnh:" in s.lower() or "cách đúng:" in s.lower():
        clean = s.lstrip("✓✔•- ").strip()
        parts = clean.split(":", 1)
        if len(parts) == 2 and len(parts[0]) < 32:
            label, body = html.escape(parts[0].strip()), html.escape(parts[1].strip())
        else:
            label, body = "Góc nhìn đúng & Cách chăm sóc", html.escape(clean)
        return f"""
        <div class="pt-box right">
          <div class="pt-icon right-icon">✓</div>
          <div class="pt-content">
            <div class="pt-tag right-tag">{label}</div>
            <div class="pt-text">{body}</div>
          </div>
        </div>"""

    # Dạng mục 01, 02, 03 (như 3 nhóm dược liệu trong ft-product-source.pdf)
    clean = s.lstrip("•- ").strip()
    parts = clean.split(":", 1)
    num_str = f"0{idx + 1}"
    if len(parts) == 2 and len(parts[0]) < 45:
        label, body = html.escape(parts[0].strip()), html.escape(parts[1].strip())
        return f"""
        <div class="numbered-row">
          <div class="num-badge">{num_str}</div>
          <div class="num-content">
            <div class="num-title">{label}</div>
            <div class="num-desc">{body}</div>
          </div>
        </div>"""
    return f"""
    <div class="numbered-row">
      <div class="num-badge">{num_str}</div>
      <div class="num-content">
        <div class="num-desc" style="font-size:26px;font-weight:600;color:{pal['ink']}">{html.escape(clean)}</div>
      </div>
    </div>"""


def build_card_item_html(item: dict) -> str:
    """
    Dạng 2 (`card_item`): Bộ ảnh vuông 1:1 (1080x1080) minh họa từng mục (01, 02, 03, 04)
    Thiết kế theo đúng ngôn ngữ Kem – Nâu đồng – Vàng đồng của `ft-product-source.pdf` & `SKILL.md`.
    """
    w = int(item.get("width") or 1080)
    h = int(item.get("height") or 1080)
    theme_key = item.get("theme") if item.get("theme") in THEMES else "ft_editorial"
    pal = THEMES[theme_key]

    badge = html.escape(str(item.get("badge") or f"0{item.get('index', 1)}").replace("#", ""))
    post_title = html.escape(str(item.get("postTitle") or ""))
    card_title = html.escape(str(item.get("cardTitle") or ""))
    box_header = html.escape(str(item.get("boxHeader") or item.get("pillar") or "Kiến thức sức khỏe trung niên"))
    points = item.get("points") or []
    scene_uri = pick_scene_photo(item)
    prod_uri = resolve_product_uri(item)
    logo_html = build_logo_html(item)

    pts_html = "\n".join(format_point_html(p, pal, i) for i, p in enumerate(points[:3]))

    product_section_html = ""
    if prod_uri:
        product_section_html = f"""
        <div class="prod-float">
          <img src="{prod_uri}" alt="Bổ Thận FT" />
        </div>
        """

    disclaimer_html = ""
    if prod_uri:
        disclaimer_html = f"""
        <div class="disclaimer-bar">
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
    background: {pal['bg_grad']};
    font-family: 'Times New Roman', Georgia, serif;
    color: {pal['ink']};
    position: relative;
    padding: 38px 42px { '74px' if prod_uri else '42px' } 42px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 24px;
  }}
  .outer-frame {{
    position: absolute;
    inset: 16px;
    border: 1.5px solid {pal['card_border']};
    border-radius: 24px;
    pointer-events: none;
    z-index: 1;
  }}
  /* Khung Header trên cùng: Tông Nâu Đồng + Ảnh người Việt 40-65 tuổi chân thực */
  .hero-banner {{
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: 1.12fr 0.88fr;
    gap: 26px;
    background: {pal['header_grad']};
    border-radius: 22px;
    padding: 30px 32px;
    color: #FAF6F0;
    box-shadow: 0 14px 32px rgba(43, 24, 14, 0.16);
    border: 2px solid {pal['gold']};
    align-items: center;
    height: 430px;
  }}
  .hero-left {{
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 18px;
    height: 100%;
  }}
  .topic-kicker {{
    font-size: 21px;
    color: {pal['gold_light']};
    letter-spacing: 0.3px;
    font-style: italic;
    line-height: 1.38;
    border-left: 3.5px solid {pal['gold']};
    padding-left: 14px;
  }}
  .badge-row {{
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }}
  .num-pill-wrap {{
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }}
  .num-pill {{
    background: {pal['gold']};
    color: #231208;
    font-size: 32px;
    font-weight: 700;
    padding: 6px 20px;
    border-radius: 12px;
    letter-spacing: 1px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.22);
  }}
  .sub-pill-label {{
    font-size: 20px;
    color: #EAD8B8;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }}
  .card-main-title {{
    font-size: 38px;
    font-weight: 700;
    line-height: 1.22;
    color: #FFFDF9;
    text-transform: uppercase;
  }}
  .gold-divider {{
    width: 110px;
    height: 3.5px;
    background: {pal['gold']};
    border-radius: 2px;
  }}
  .hero-photo-wrap {{
    width: 100%;
    height: 366px;
    border-radius: 18px;
    overflow: hidden;
    border: 2.5px solid {pal['gold_light']};
    box-shadow: 0 10px 26px rgba(0,0,0,0.32);
    background: #3B2214;
  }}
  .hero-photo-wrap img {{
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 18%;
    display: block;
  }}
  /* Khung Nội dung chính bên dưới: Ít chữ, chữ lớn dễ đọc, lấp đầy cân đối */
  .body-area {{
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: stretch;
    gap: 20px;
    padding-right: { '255px' if prod_uri else '0px' };
  }}
  .pt-box {{
    flex: 1;
    border-radius: 20px;
    padding: 24px 30px;
    display: flex;
    align-items: center;
    gap: 22px;
    box-shadow: 0 8px 22px rgba(43, 24, 14, 0.06);
  }}
  .pt-box.wrong {{
    background: {pal['wrong_bg']};
    border: 1.5px solid {pal['wrong_border']};
    border-left: 9px solid {pal['wrong_ink']};
  }}
  .pt-box.right {{
    background: {pal['right_bg']};
    border: 1.5px solid {pal['right_border']};
    border-left: 9px solid {pal['right_ink']};
  }}
  .pt-icon {{
    width: 58px;
    height: 58px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    font-weight: 700;
    flex-shrink: 0;
  }}
  .wrong-icon {{
    background: #F9D7D2;
    color: {pal['wrong_ink']};
  }}
  .right-icon {{
    background: #D5EBCD;
    color: {pal['right_ink']};
  }}
  .pt-content {{
    display: flex;
    flex-direction: column;
    gap: 6px;
  }}
  .pt-tag {{
    font-size: 23px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }}
  .wrong-tag {{ color: {pal['wrong_ink']}; }}
  .right-tag {{ color: {pal['right_ink']}; }}
  .pt-text {{
    font-size: 28px;
    line-height: 1.38;
    color: {pal['ink']};
    font-weight: 600;
  }}
  .numbered-row {{
    flex: 1;
    display: flex;
    align-items: center;
    gap: 22px;
    background: {pal['card_bg']};
    border: 1.5px solid {pal['card_border']};
    border-radius: 20px;
    padding: 24px 28px;
  }}
  .num-badge {{
    background: {pal['badge_bg']};
    color: {pal['badge_fg']};
    font-size: 28px;
    font-weight: 700;
    min-width: 62px;
    height: 62px;
    border-radius: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }}
  .num-content {{
    display: flex;
    flex-direction: column;
    gap: 6px;
  }}
  .num-title {{
    font-size: 27px;
    font-weight: 700;
    color: {pal['accent']};
  }}
  .num-desc {{
    font-size: 25px;
    line-height: 1.38;
    color: {pal['ink']};
  }}
  .prod-float {{
    position: absolute;
    right: 36px;
    bottom: 72px;
    width: 240px;
    height: 310px;
    z-index: 10;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    filter: drop-shadow(0 12px 20px rgba(43,24,14,0.28));
  }}
  .prod-float img {{
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }}
  .disclaimer-bar {{
    position: absolute;
    left: 34px;
    right: 34px;
    bottom: 22px;
    z-index: 15;
    background: #2B180E;
    color: #F7EBD5;
    text-align: center;
    padding: 9px 18px;
    border-radius: 10px;
    font-size: 18.5px;
    font-style: italic;
    border: 1px solid {pal['gold']};
  }}
</style>
</head>
<body>
  <div class="outer-frame"></div>
  {logo_html}

  <div class="hero-banner">
    <div class="hero-left">
      {f'<div class="topic-kicker">{post_title}</div>' if post_title else ''}
      <div class="badge-row">
        <div class="num-pill-wrap">
          <div class="num-pill">{badge}</div>
          <div class="sub-pill-label">{box_header}</div>
        </div>
        <div class="card-main-title">{card_title}</div>
      </div>
      <div class="gold-divider"></div>
    </div>
    <div class="hero-photo-wrap">
      {f'<img src="{scene_uri}" alt="Minh họa" />' if scene_uri else ''}
    </div>
  </div>

  <div class="body-area">
    {pts_html}
  </div>

  {product_section_html}
  {disclaimer_html}
</body>
</html>"""


def build_content_image_html(item: dict) -> str:
    """
    Dạng 3 (`content_image`): Ảnh minh họa vuông 1:1 (1080x1080) đi kèm bài viết đầy đủ.
    """
    w = int(item.get("width") or 1080)
    h = int(item.get("height") or 1080)
    theme_key = item.get("theme") if item.get("theme") in THEMES else "ft_editorial"
    pal = THEMES[theme_key]

    headline = html.escape(str(item.get("imageHeadline") or item.get("postTitle") or ""))
    subtitle = html.escape(str(item.get("postTitle") or ""))
    points = item.get("points") or []
    scene_uri = pick_scene_photo(item)
    prod_uri = resolve_product_uri(item)
    logo_html = build_logo_html(item)

    pts_html = "\n".join(format_point_html(p, pal, i) for i, p in enumerate(points[:4]))

    if prod_uri:
        # Bố cục có Sản phẩm Bổ Thận FT tách nền (Hộp đứng + Lọ đứng cạnh hộp, giữ nguyên 100% bao bì)
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
    background: {pal['bg_grad']};
    font-family: 'Times New Roman', Georgia, serif;
    color: {pal['ink']};
    position: relative;
    padding: 36px 40px 76px 40px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }}
  .outer-frame {{
    position: absolute;
    inset: 16px;
    border: 1.5px solid {pal['card_border']};
    border-radius: 22px;
    pointer-events: none;
    z-index: 1;
  }}
  .top-header {{
    position: relative;
    z-index: 2;
    background: {pal['header_grad']};
    border-radius: 20px;
    padding: 24px 32px;
    border: 2px solid {pal['gold']};
    color: #FFFDF9;
    box-shadow: 0 10px 26px rgba(43, 24, 14, 0.15);
    text-align: center;
  }}
  .top-kicker {{
    font-size: 20px;
    color: {pal['gold_light']};
    font-style: italic;
    margin-bottom: 6px;
  }}
  .top-headline {{
    font-size: 36px;
    font-weight: 700;
    line-height: 1.22;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }}
  .main-grid {{
    position: relative;
    z-index: 2;
    flex: 1;
    display: grid;
    grid-template-columns: 1.24fr 0.76fr;
    gap: 24px;
    margin-top: 22px;
    align-items: stretch;
  }}
  .left-cards {{
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 16px;
  }}
  .numbered-row {{
    display: flex;
    align-items: center;
    gap: 20px;
    background: {pal['card_bg']};
    border: 1.5px solid {pal['card_border']};
    border-left: 7px solid {pal['accent']};
    border-radius: 18px;
    padding: 22px 24px;
    flex: 1;
    box-shadow: 0 6px 16px rgba(43, 24, 14, 0.05);
  }}
  .num-badge {{
    background: {pal['badge_bg']};
    color: {pal['badge_fg']};
    font-size: 28px;
    font-weight: 700;
    min-width: 62px;
    height: 62px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1.5px solid {pal['gold']};
  }}
  .num-content {{
    display: flex;
    flex-direction: column;
    gap: 6px;
  }}
  .num-title {{
    font-size: 26px;
    font-weight: 700;
    color: {pal['accent']};
    line-height: 1.25;
  }}
  .num-desc {{
    font-size: 24px;
    line-height: 1.38;
    color: {pal['ink']};
  }}
  .right-showcase {{
    background: linear-gradient(180deg, #EFE4D0 0%, #E2CEAE 100%);
    border: 2px solid {pal['gold']};
    border-radius: 20px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    position: relative;
    overflow: hidden;
    box-shadow: inset 0 2px 12px rgba(255,255,255,0.6);
  }}
  .scene-circle {{
    width: 100%;
    height: 255px;
    border-radius: 14px;
    overflow: hidden;
    border: 2px solid #FFFDF9;
    box-shadow: 0 6px 16px rgba(43,24,14,0.16);
    flex-shrink: 0;
  }}
  .scene-circle img {{
    width: 100%;
    height: 100%;
    object-fit: cover;
  }}
  .product-stage {{
    flex: 1;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
  }}
  .product-stage img {{
    max-width: 98%;
    max-height: 445px;
    object-fit: contain;
    filter: drop-shadow(0 16px 22px rgba(43, 24, 14, 0.34));
  }}
  .gmp-caption {{
    font-size: 19px;
    font-weight: 700;
    color: {pal['ink']};
    text-align: center;
    background: rgba(255, 253, 249, 0.9);
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid {pal['card_border']};
    width: 100%;
    flex-shrink: 0;
  }}
  .disclaimer-bar {{
    position: absolute;
    left: 36px;
    right: 36px;
    bottom: 22px;
    z-index: 15;
    background: #2B180E;
    color: #F7EBD5;
    text-align: center;
    padding: 9px 18px;
    border-radius: 10px;
    font-size: 18.5px;
    font-style: italic;
    border: 1px solid {pal['gold']};
  }}
</style>
</head>
<body>
  <div class="outer-frame"></div>
  {logo_html}

  <div class="top-header">
    <div class="top-kicker">Thực phẩm bảo vệ sức khỏe · Chuẩn sản xuất GMP</div>
    <div class="top-headline">{headline}</div>
  </div>

  <div class="main-grid">
    <div class="left-cards">
      {pts_html}
    </div>
    <div class="right-showcase">
      {f'<div class="scene-circle"><img src="{scene_uri}" alt="Dược liệu" /></div>' if scene_uri else ''}
      <div class="product-stage">
        <img src="{prod_uri}" alt="Bổ Thận FT" />
      </div>
      <div class="gmp-caption">Hộp đứng & Lọ 30 viên nang</div>
    </div>
  </div>

  <div class="disclaimer-bar">
    {html.escape(DISCLAIMER_TEXT)}
  </div>
</body>
</html>"""

    # Bố cục KHÔNG có sản phẩm (TOFU / MOFU thuần kiến thức & đồng cảm người Việt 40-65 tuổi)
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
    background: {pal['bg_grad']};
    font-family: 'Times New Roman', Georgia, serif;
    color: {pal['ink']};
    position: relative;
    padding: 40px 44px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 22px;
  }}
  .outer-frame {{
    position: absolute;
    inset: 16px;
    border: 1.5px solid {pal['card_border']};
    border-radius: 22px;
    pointer-events: none;
    z-index: 1;
  }}
  .hero-split {{
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: 1.12fr 0.88fr;
    gap: 26px;
    background: {pal['header_grad']};
    border-radius: 22px;
    padding: 30px 32px;
    border: 2px solid {pal['gold']};
    color: #FFFDF9;
    align-items: center;
    height: 410px;
    box-shadow: 0 12px 28px rgba(43, 24, 14, 0.15);
  }}
  .hero-text {{
    display: flex;
    flex-direction: column;
    gap: 16px;
  }}
  .hero-headline {{
    font-size: 37px;
    font-weight: 700;
    line-height: 1.24;
    text-transform: uppercase;
    color: #FFFDF9;
  }}
  .hero-sub {{
    font-size: 22px;
    line-height: 1.4;
    color: {pal['gold_light']};
    font-style: italic;
  }}
  .gold-bar {{
    width: 100px;
    height: 3.5px;
    background: {pal['gold']};
    border-radius: 2px;
  }}
  .hero-img {{
    width: 100%;
    height: 346px;
    border-radius: 16px;
    overflow: hidden;
    border: 2.5px solid {pal['gold_light']};
    box-shadow: 0 8px 22px rgba(0,0,0,0.28);
  }}
  .hero-img img {{
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 20%;
  }}
  .points-stack {{
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: stretch;
    gap: 18px;
  }}
  .numbered-row {{
    flex: 1;
    display: flex;
    align-items: center;
    gap: 22px;
    background: {pal['card_bg']};
    border: 1.5px solid {pal['card_border']};
    border-left: 7px solid {pal['accent']};
    border-radius: 18px;
    padding: 22px 26px;
  }}
  .num-badge {{
    background: {pal['badge_bg']};
    color: {pal['badge_fg']};
    font-size: 28px;
    font-weight: 700;
    min-width: 60px;
    height: 60px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }}
  .num-content {{
    display: flex;
    flex-direction: column;
    gap: 6px;
  }}
  .num-title {{
    font-size: 26px;
    font-weight: 700;
    color: {pal['accent']};
  }}
  .num-desc {{
    font-size: 24.5px;
    line-height: 1.38;
    color: {pal['ink']};
  }}
</style>
</head>
<body>
  <div class="outer-frame"></div>
  {logo_html}

  <div class="hero-split">
    <div class="hero-text">
      <div class="hero-headline">{headline}</div>
      <div class="gold-bar"></div>
      {f'<div class="hero-sub">{subtitle}</div>' if subtitle and subtitle.lower() != headline.lower() else ''}
    </div>
    <div class="hero-img">
      {f'<img src="{scene_uri}" alt="Minh họa" />' if scene_uri else ''}
    </div>
  </div>

  <div class="points-stack">
    {pts_html}
  </div>
</body>
</html>"""


def render_items_with_playwright(items: list):
    import subprocess
    import tempfile

    render_jobs = []
    for item in items:
        kind = item.get("kind")
        if kind == "text_background":
            # Dạng 1 (text_comment) không sử dụng ảnh đính kèm
            continue
        w = int(item.get("width") or 1080)
        h = int(item.get("height") or 1080)
        out_path = item.get("out")
        if not out_path:
            continue
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

        if kind == "card_item":
            html_doc = build_card_item_html(item)
        else:
            html_doc = build_content_image_html(item)

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
    await page.waitForTimeout(150);
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

