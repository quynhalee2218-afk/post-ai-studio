#!/usr/bin/env python3
"""
Bộ dựng ảnh bài đăng Fanpage hàng ngày (Text nền, Text nền + Bộ ảnh thẻ #01..#0N, Content text + Ảnh minh họa)
Tuân thủ nghiêm ngặt 12 Quy tắc Tạo Ảnh:
1. Tạo ảnh mới đúng mô tả trong cột "Ảnh minh họa cần chuẩn bị".
2. Phong cách chuyên nghiệp, đáng tin cậy, hướng tới người Việt 40–65 tuổi.
4. Font chữ có hình thức tương tự Times New Roman (times.ttf / timesbd.ttf / georgia.ttf), rõ ràng, dễ đọc.
5. Ảnh một khung: tỷ lệ vuông 1:1, kích thước 1080 × 1080.
6. Nếu mô tả yêu cầu nhiều khung hoặc nhiều ảnh: ưu tiên tỷ lệ 4:5, 1080 × 1350 (hoặc 1080 × 1080 tuỳ chọn).
7. Khi tiêu đề có con số và nội dung cần minh họa từng mục, số khung hoặc số hình tương ứng với con số đó.
8. Chữ trên ảnh ít, lớn, dễ đọc; không chép toàn bộ caption lên ảnh.
9. Logo đặt cố định tại một góc, thống nhất trong cả chiến dịch.
10. Nếu xuất hiện sản phẩm, sử dụng đúng bao bì tham chiếu, không sửa chữ, màu sắc hoặc hình dáng sản phẩm.
11. Sản phẩm không được đặt quá lớn hoặc che nội dung chính.
12. Không tạo hình ảnh gây hiểu nhầm rằng sản phẩm là thuốc hoặc bảo đảm chữa khỏi bệnh.
"""
import json
import os
import random
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFilter, ImageFont

WIN_FONTS = r"C:\Windows\Fonts"


def find_font(candidates, fallback_path=None):
    for name in candidates:
        p = os.path.join(WIN_FONTS, name)
        if os.path.exists(p):
            return p
    if fallback_path and os.path.exists(fallback_path):
        return fallback_path
    return os.path.join(WIN_FONTS, "times.ttf")


def get_fonts(fallback_sans=None):
    serif_reg = find_font(["times.ttf", "georgia.ttf", "UTM Times.ttf"], fallback_sans)
    serif_bold = find_font(["timesbd.ttf", "georgiab.ttf", "UTMTimesBold.ttf"], serif_reg)
    serif_italic = find_font(["timesi.ttf", "georgiai.ttf", "UTM TimesItalic.ttf"], serif_reg)
    sans_reg = find_font(["arial.ttf", "segoeui.ttf"], fallback_sans or serif_reg)
    sans_bold = find_font(["arialbd.ttf", "segoeuib.ttf"], sans_reg)
    return {
        "serif": serif_reg,
        "serif_bold": serif_bold,
        "serif_italic": serif_italic,
        "sans": sans_reg,
        "sans_bold": sans_bold,
    }


CLEAN_MAP = {
    "🚨": "",
    "👇": "↓",
    "👉": "»",
    "➡": "»",
    "➜": "»",
    "→": "»",
    "✅": "[+]",
    "✔": "[+]",
    "✓": "[+]",
    "❌": "[x]",
    "✖": "[x]",
    "✗": "[x]",
    "⭐": "•",
    "★": "•",
    "🔥": "",
    "💡": "",
    "📌": "",
    "💬": "",
    "🌿": "",
    "🍃": "",
}


def norm_text(s):
    s = unicodedata.normalize("NFC", str(s or "")).strip()
    for k, v in CLEAN_MAP.items():
        s = s.replace(k, v)
    out = []
    for ch in s:
        cp = ord(ch)
        if cp > 0xFFFF:
            continue
        if 0xFE00 <= cp <= 0xFE0F:
            continue
        out.append(ch)
    return " ".join("".join(out).split())


def wrap_lines(draw, text, font, max_w):
    text = norm_text(text)
    if not text:
        return []
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def make_gradient(w, h, c_top, c_bot, c_mid=None):
    base = Image.new("RGB", (w, h))
    px = base.load()
    for y in range(h):
        t = y / max(1, h - 1)
        if c_mid:
            if t < 0.55:
                lt = t / 0.55
                r = int(c_top[0] + (c_mid[0] - c_top[0]) * lt)
                g = int(c_top[1] + (c_mid[1] - c_top[1]) * lt)
                b = int(c_top[2] + (c_mid[2] - c_top[2]) * lt)
            else:
                lt = (t - 0.55) / 0.45
                r = int(c_mid[0] + (c_bot[0] - c_mid[0]) * lt)
                g = int(c_mid[1] + (c_bot[1] - c_mid[1]) * lt)
                b = int(c_mid[2] + (c_bot[2] - c_mid[2]) * lt)
        else:
            r = int(c_top[0] + (c_bot[0] - c_top[0]) * t)
            g = int(c_top[1] + (c_bot[1] - c_top[1]) * t)
            b = int(c_top[2] + (c_bot[2] - c_top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return base.convert("RGBA")


def draw_parchment_bg(w, h, base_color=(250, 245, 236), seed=42):
    """Tạo nền giấy kem ấm áp chuyên nghiệp (giống Ảnh 2 mẫu & tông kem-nâu đồng trung niên 40-65)."""
    rng = random.Random(seed)
    img = make_gradient(w, h, base_color, (base_color[0] - 10, base_color[1] - 12, base_color[2] - 16))
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for _ in range(28):
        x0 = rng.randint(-100, w + 100)
        y0 = rng.randint(-100, h + 100)
        x1 = x0 + rng.randint(-450, 450)
        y1 = y0 + rng.randint(-450, 450)
        alpha = rng.randint(8, 18)
        col = (205, 188, 165, alpha) if rng.random() > 0.4 else (255, 255, 255, alpha + 8)
        d.line([(x0, y0), (x1, y1)], fill=col, width=rng.randint(2, 6))
    overlay = overlay.filter(ImageFilter.GaussianBlur(6))
    return Image.alpha_composite(img, overlay)


def draw_twilight_tree_bg(w, h):
    """Nền bầu trời chiều chạng vạng xanh-vàng ấm kèm bóng cây (giống Ảnh 1 mẫu)."""
    img = make_gradient(w, h, (16, 78, 107), (218, 206, 182), c_mid=(96, 140, 146))
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    trunk_x = int(w * 0.72)
    trunk_bot = h
    pts = [
        (trunk_x - 8, trunk_bot),
        (trunk_x - 12, int(h * 0.88)),
        (trunk_x - 36, int(h * 0.73)),
        (trunk_x - 24, int(h * 0.72)),
        (trunk_x - 2, int(h * 0.87)),
        (trunk_x + 10, trunk_bot),
    ]
    d.polygon(pts, fill=(18, 24, 18, 245))
    rng = random.Random(101)
    canopy_cx, canopy_cy = trunk_x - 42, int(h * 0.67)
    for _ in range(110):
        ox = rng.gauss(0, 40)
        oy = rng.gauss(0, 22)
        r = rng.randint(8, 24)
        col = (20, 34, 22, rng.randint(190, 250))
        d.ellipse((canopy_cx + ox - r, canopy_cy + oy - r, canopy_cx + ox + r, canopy_cy + oy + r), fill=col)
    return Image.alpha_composite(img, overlay)


def paste_logo(canvas, logo_path, logo_text="", corner="top-right", dark_bg=False):
    """Đặt logo cố định tại 1 góc thống nhất trong toàn chiến dịch (Quy tắc 9)."""
    w, h = canvas.size
    pad = 44
    if logo_path and os.path.exists(logo_path):
        try:
            lg = Image.open(logo_path).convert("RGBA")
            max_lw, max_lh = 170, 76
            scale = min(max_lw / max(1, lg.width), max_lh / max(1, lg.height))
            nw, nh = max(1, int(lg.width * scale)), max(1, int(lg.height * scale))
            lg = lg.resize((nw, nh), Image.LANCZOS)
            x = w - pad - nw if "right" in corner else pad
            y = pad if "top" in corner else h - pad - nh
            canvas.alpha_composite(lg, (x, y))
            return
        except Exception:
            pass
    if logo_text:
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        f_path = find_font(["timesbd.ttf", "georgia.ttf"])
        font = ImageFont.truetype(f_path, 22)
        txt = norm_text(logo_text).upper()
        tw = d.textlength(txt, font=font)
        bw, bh = int(tw + 36), 44
        x = w - pad - bw if "right" in corner else pad
        y = pad if "top" in corner else h - pad - bh
        bg_col = (12, 28, 42, 165) if dark_bg else (244, 234, 218, 245)
        fg_col = (255, 245, 225, 255) if dark_bg else (112, 48, 16, 255)
        border_col = (255, 235, 195, 140) if dark_bg else (156, 94, 44, 180)
        d.rounded_rectangle((x, y, x + bw, y + bh), radius=22, fill=bg_col, outline=border_col, width=2)
        d.text((x + 18, y + 9), txt, font=font, fill=fg_col)
        canvas.alpha_composite(layer)


def draw_status_icon(canvas, x, y, size, kind="check"):
    """Vẽ icon dấu tích xanh [✓] hoặc dấu nhân đỏ [✗] sắc nét bằng vector (không phụ thuộc glyph của Times New Roman)."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if kind == "cross":
        d.rounded_rectangle((x, y, x + size, y + size), radius=6, fill=(216, 42, 42, 255))
        m = int(size * 0.26)
        d.line([(x + m, y + m), (x + size - m, y + size - m)], fill=(255, 255, 255, 255), width=3)
        d.line([(x + size - m, y + m), (x + m, y + size - m)], fill=(255, 255, 255, 255), width=3)
    else:
        d.rounded_rectangle((x, y, x + size, y + size), radius=6, fill=(34, 156, 75, 255))
        d.line(
            [(x + int(size * 0.22), y + int(size * 0.54)), (x + int(size * 0.44), y + int(size * 0.76)), (x + int(size * 0.80), y + int(size * 0.26))],
            fill=(255, 255, 255, 255),
            width=3,
        )
    canvas.alpha_composite(layer)


def prepare_product_cutout(product_path):
    """
    Đọc ảnh sản phẩm tham chiếu (ưu tiên bản tách nền chuẩn ft-cutout-box-bottle.png nếu dùng ảnh gốc Bổ Thận FT),
    giữ nguyên 100% chữ, màu sắc và hình dáng bao bì (Quy tắc 10).
    """
    if not product_path or not os.path.exists(product_path):
        return None
    cutout_sibling = os.path.join(os.path.dirname(product_path), "ft-cutout-box-bottle.png")
    if os.path.basename(product_path) == "ft-original-product.jpg" and os.path.exists(cutout_sibling):
        return Image.open(cutout_sibling).convert("RGBA")

    im = Image.open(product_path).convert("RGBA")
    px = im.load()
    w, h = im.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    if all(c[0] > 235 and c[1] > 235 and c[2] > 235 for c in corners):
        out = Image.new("RGBA", (w, h))
        opx = out.load()
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if r > 240 and g > 240 and b > 240:
                    opx[x, y] = (r, g, b, 0)
                else:
                    opx[x, y] = (r, g, b, a)
        bbox = out.getbbox()
        return out.crop(bbox) if bbox else out
    return im


def paste_product_and_disclaimer(canvas, product_path, max_height_ratio=0.28):
    """
    Ghép bao bì sản phẩm tham chiếu ở góc dưới phải với kích thước vừa phải (không quá lớn, không che nội dung chính - Quy tắc 10, 11)
    kèm dòng cảnh báo bắt buộc ở chân ảnh (Quy tắc 12).
    """
    w, h = canvas.size
    prod = prepare_product_cutout(product_path)
    if prod:
        max_ph = int(h * max_height_ratio)
        max_pw = int(w * 0.34)
        scale = min(max_pw / max(1, prod.width), max_ph / max(1, prod.height))
        pw, ph = max(1, int(prod.width * scale)), max(1, int(prod.height * scale))
        prod_resized = prod.resize((pw, ph), Image.LANCZOS)
        px = w - pw - 42
        py = h - ph - 62
        canvas.alpha_composite(prod_resized, (px, py))

    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f_italic = find_font(["timesi.ttf", "times.ttf"])
    font_disc = ImageFont.truetype(f_italic, 20)
    disc_text = "Thực phẩm bảo vệ sức khỏe · Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."
    bar_h = 46
    d.rectangle((0, h - bar_h, w, h), fill=(48, 26, 14, 245))
    tw = d.textlength(disc_text, font=font_disc)
    d.text(((w - tw) / 2, h - bar_h + 12), disc_text, font=font_disc, fill=(255, 242, 220, 255))
    canvas.alpha_composite(layer)


def render_text_background(spec, fonts):
    """
    Dạng 1: Text nền (1 câu tiêu đề gây tò mò trên nền màu/cảnh, thả nội dung ở comment - giống Ảnh 1 mẫu).
    Kích thước chuẩn 1080x1080 (1:1).
    """
    w = int(spec.get("width") or 1080)
    h = int(spec.get("height") or 1080)
    theme = spec.get("theme") or "twilight"
    bg_image_path = spec.get("bgImage")

    if bg_image_path and os.path.exists(bg_image_path):
        bg = Image.open(bg_image_path).convert("RGBA")
        bw, bh = bg.size
        target_ratio = w / h
        if (bw / bh) > target_ratio:
            nw = int(bh * target_ratio)
            bg = bg.crop(((bw - nw) // 2, 0, (bw + nw) // 2, bh))
        else:
            nh = int(bw / target_ratio)
            bg = bg.crop((0, (bh - nh) // 2, bw, (bh + nh) // 2))
        canvas = bg.resize((w, h), Image.LANCZOS)
        dark_overlay = Image.new("RGBA", (w, h), (15, 22, 34, 135))
        canvas = Image.alpha_composite(canvas, dark_overlay)
        dark_bg = True
    elif theme == "crimson":
        canvas = make_gradient(w, h, (218, 12, 54), (175, 8, 42))
        dark_bg = True
    elif theme == "herbal_gold":
        canvas = make_gradient(w, h, (92, 42, 18), (44, 18, 8), c_mid=(124, 58, 24))
        dark_bg = True
    elif theme == "navy":
        canvas = make_gradient(w, h, (18, 43, 74), (10, 24, 44))
        dark_bg = True
    else:
        canvas = draw_twilight_tree_bg(w, h)
        dark_bg = True

    paste_logo(canvas, spec.get("logoPath"), spec.get("logoText") or "", corner=spec.get("logoCorner") or "top-right", dark_bg=dark_bg)

    headline = norm_text(spec.get("headline") or spec.get("title") or "")
    if headline and not headline.endswith("↓"):
        headline = f"{headline} ↓"

    font_path = fonts["serif_bold"] if spec.get("useSerif", True) else fonts["sans_bold"]
    char_len = len(headline)
    font_size = 64 if char_len <= 95 else 56 if char_len <= 145 else 48 if char_len <= 200 else 42
    font = ImageFont.truetype(font_path, font_size)

    d = ImageDraw.Draw(canvas)
    max_text_w = int(w * 0.84)
    lines = wrap_lines(d, headline, font, max_text_w)
    line_h = int(font_size * 1.34)
    total_h = len(lines) * line_h
    start_y = int((h - total_h) * 0.44)

    shadow_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    y = start_y
    for line in lines:
        lw = d.textlength(line, font=font)
        x = (w - lw) / 2
        sd.text((x + 3, y + 4), line, font=font, fill=(0, 0, 0, 180))
        y += line_h
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(4))
    canvas = Image.alpha_composite(canvas, shadow_layer)

    d = ImageDraw.Draw(canvas)
    y = start_y
    for line in lines:
        lw = d.textlength(line, font=font)
        x = (w - lw) / 2
        d.text((x, y), line, font=font, fill=(255, 255, 255, 255))
        y += line_h

    sub_text = spec.get("subFooter") or "↓ Xem chi tiết nội dung ở phần Bình luận bên dưới"
    f_sub = ImageFont.truetype(fonts["serif_italic"], 25)
    stw = d.textlength(sub_text, font=f_sub)
    foot_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    fd = ImageDraw.Draw(foot_layer)
    fd.rounded_rectangle(((w - stw) / 2 - 24, h - 86, (w + stw) / 2 + 24, h - 38), radius=24, fill=(10, 16, 22, 155))
    fd.text(((w - stw) / 2, h - 76), sub_text, font=f_sub, fill=(255, 248, 230, 245))
    canvas.alpha_composite(foot_layer)

    out_path = spec["out"]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.convert("RGB").save(out_path, quality=95)
    return out_path


def render_card_item(spec, fonts):
    """
    Dạng 2 (Ảnh thẻ từng mục #01, #02... hoặc ảnh tổng hợp có banner tiêu đề phía trên giống Ảnh 2 mẫu).
    """
    w = int(spec.get("width") or 1080)
    h = int(spec.get("height") or 1350)
    idx = int(spec.get("index") or 1)
    total = int(spec.get("total") or 1)
    badge_text = spec.get("badge") or f"#{idx:02d}"
    card_title = norm_text(spec.get("cardTitle") or f"MỤC {idx}").upper()
    hook_banner = norm_text(spec.get("topBanner") or "")
    include_product = bool(spec.get("includeProduct")) and bool(spec.get("productPath"))

    canvas = draw_parchment_bg(w, h, seed=100 + idx)
    d = ImageDraw.Draw(canvas)

    top_offset = 56
    if hook_banner:
        if not hook_banner.endswith("↓"):
            hook_banner = f"{hook_banner} ↓"
        banner_h = int(h * 0.33)
        banner_col = (212, 14, 56, 255) if spec.get("bannerColor") == "red" else (128, 46, 20, 255)
        d.rectangle((0, 0, w, banner_h), fill=banner_col)
        f_ban = ImageFont.truetype(fonts["serif_bold"], 46 if len(hook_banner) <= 110 else 40)
        b_lines = wrap_lines(d, hook_banner, f_ban, int(w * 0.86))
        lh = int(f_ban.size * 1.32)
        by = (banner_h - len(b_lines) * lh) // 2
        for bl in b_lines:
            bw = d.textlength(bl, font=f_ban)
            d.text(((w - bw) / 2, by), bl, font=f_ban, fill=(255, 255, 255, 255))
            by += lh
        top_offset = banner_h + 40

    paste_logo(
        canvas,
        spec.get("logoPath"),
        spec.get("logoText") or "",
        corner=spec.get("logoCorner") or "top-right",
        dark_bg=bool(hook_banner and top_offset > 100),
    )

    f_badge = ImageFont.truetype(fonts["serif_bold"], 34)
    btw = d.textlength(badge_text, font=f_badge)
    bw_pill, bh_pill = int(btw + 48), 58
    bx = (w - bw_pill) // 2
    by = top_offset
    d.rounded_rectangle((bx, by, bx + bw_pill, by + bh_pill), radius=14, fill=(224, 98, 24, 255))
    d.text((bx + 24, by + 10), badge_text, font=f_badge, fill=(255, 255, 255, 255))

    f_title = ImageFont.truetype(fonts["serif_bold"], 46 if len(card_title) <= 34 else 40)
    t_lines = wrap_lines(d, card_title, f_title, int(w * 0.86))
    ty = by + bh_pill + 24
    for tl in t_lines:
        tw = d.textlength(tl, font=f_title)
        d.text(((w - tw) / 2, ty), tl, font=f_title, fill=(32, 24, 18, 255))
        ty += int(f_title.size * 1.25)

    box_x0 = 72
    box_x1 = w - 72
    box_y0 = ty + 24
    bottom_reserve = 320 if include_product else 110
    box_y1 = h - bottom_reserve

    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((box_x0 + 4, box_y0 + 8, box_x1 + 4, box_y1 + 8), radius=22, fill=(60, 40, 20, 32))
    canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(canvas)

    d.rounded_rectangle((box_x0, box_y0, box_x1, box_y1), radius=22, fill=(255, 253, 249, 255), outline=(95, 72, 52, 210), width=3)

    sub_header = norm_text(spec.get("boxHeader") or spec.get("pillar") or f"Điểm cốt lõi {idx}/{total}")
    f_sub = ImageFont.truetype(fonts["serif_bold"], 28)
    d.text((box_x0 + 34, box_y0 + 24), sub_header, font=f_sub, fill=(138, 62, 22, 255))
    arrow_x0 = int(box_x0 + 54 + d.textlength(sub_header, font=f_sub))
    arrow_x1 = box_x1 - 38
    if arrow_x1 - arrow_x0 > 60:
        ay = box_y0 + 40
        d.line([(arrow_x0, ay), (arrow_x1, ay)], fill=(95, 72, 52, 200), width=3)
        d.line([(arrow_x1 - 14, ay - 9), (arrow_x1, ay), (arrow_x1 - 14, ay + 9)], fill=(95, 72, 52, 200), width=3)

    d.line([(box_x0, box_y0 + 74), (box_x1, box_y0 + 74)], fill=(215, 198, 178, 255), width=2)

    points = spec.get("points") or []
    if not points and spec.get("body"):
        points = [p.strip() for p in str(spec.get("body")).split("\n") if p.strip()]

    f_body = ImageFont.truetype(fonts["serif"], 34 if len(" ".join(points)) <= 220 else 30)
    f_body_bold = ImageFont.truetype(fonts["serif_bold"], f_body.size)
    cy = box_y0 + 102
    inner_w = (box_x1 - box_x0) - 72

    for p_idx, pt in enumerate(points[:4]):
        clean_pt = norm_text(pt)
        if not clean_pt:
            continue
        icon_kind = None
        if clean_pt.startswith("[x]") or clean_pt.lower().startswith("sai:") or clean_pt.lower().startswith("sai lầm:"):
            icon_kind = "cross"
            clean_pt = clean_pt.replace("[x]", "").strip()
        elif clean_pt.startswith("[+]") or clean_pt.lower().startswith("đúng:") or clean_pt.lower().startswith("nên:") or clean_pt.lower().startswith("cách điều chỉnh:"):
            icon_kind = "check"
            clean_pt = clean_pt.replace("[+]", "").strip()

        text_col = (185, 30, 30, 255) if icon_kind == "cross" else (20, 118, 56, 255) if icon_kind == "check" else (36, 28, 22, 255)
        use_font = f_body_bold if (p_idx == 0 and len(points) > 1 and len(clean_pt) < 75 and not icon_kind) else f_body
        indent_x = 46 if icon_kind else 0
        p_lines = wrap_lines(d, clean_pt, use_font, inner_w - indent_x)

        if icon_kind and p_lines:
            draw_status_icon(canvas, box_x0 + 34, cy + 5, 32, kind=icon_kind)
            d = ImageDraw.Draw(canvas)

        for l_idx, pl in enumerate(p_lines):
            if cy + int(use_font.size * 1.35) > box_y1 - 24:
                break
            tx = box_x0 + 34 + (indent_x if l_idx == 0 else 0)
            d.text((tx, cy), pl, font=use_font, fill=text_col)
            cy += int(use_font.size * 1.36)
        cy += 22

    if include_product:
        paste_product_and_disclaimer(canvas, spec.get("productPath"), max_height_ratio=0.25)
    else:
        footer_brand = norm_text(spec.get("footerText") or spec.get("brandName") or "")
        if footer_brand:
            f_foot = ImageFont.truetype(fonts["serif_bold"], 22)
            ftw = d.textlength(footer_brand.upper(), font=f_foot)
            d.text(((w - ftw) / 2, h - 62), footer_brand.upper(), font=f_foot, fill=(120, 92, 68, 255))

    out_path = spec["out"]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.convert("RGB").save(out_path, quality=95)
    return out_path


def render_content_illustration(spec, fonts):
    """
    Dạng 3: Content text + Ảnh minh họa (1080x1080 cho 1 khung hoặc 1080x1350 cho nhiều khung).
    """
    points = [norm_text(p) for p in (spec.get("points") or []) if norm_text(p)]
    multi_frame = len(points) >= 2 and spec.get("multiFrame", len(points) >= 3)
    w = int(spec.get("width") or 1080)
    h = int(spec.get("height") or (1350 if multi_frame else 1080))
    include_product = bool(spec.get("includeProduct")) and bool(spec.get("productPath"))

    bg_image_path = spec.get("bgImage")
    if bg_image_path and os.path.exists(bg_image_path):
        bg = Image.open(bg_image_path).convert("RGBA")
        bw, bh = bg.size
        target_ratio = w / h
        if (bw / bh) > target_ratio:
            nw = int(bh * target_ratio)
            bg = bg.crop(((bw - nw) // 2, 0, (bw + nw) // 2, bh))
        else:
            nh = int(bw / target_ratio)
            bg = bg.crop((0, (bh - nh) // 2, bw, (bh + nh) // 2))
        canvas = bg.resize((w, h), Image.LANCZOS)
        grad_overlay = Image.new("RGBA", (w, h), (250, 244, 234, 212))
        canvas = Image.alpha_composite(canvas, grad_overlay)
    else:
        canvas = draw_parchment_bg(w, h, base_color=(252, 247, 238), seed=77)

    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((28, 28, w - 28, h - 28), radius=24, outline=(148, 88, 38, 200), width=3)
    d.rounded_rectangle((38, 38, w - 38, h - 38), radius=20, outline=(188, 136, 76, 140), width=1)

    paste_logo(canvas, spec.get("logoPath"), spec.get("logoText") or "", corner=spec.get("logoCorner") or "top-right", dark_bg=False)
    d = ImageDraw.Draw(canvas)

    pillar_tag = norm_text(spec.get("pillar") or spec.get("tag") or "KIẾN THỨC CHĂM SÓC SỨC KHỎE").upper()
    f_tag = ImageFont.truetype(fonts["serif_bold"], 23)
    ttw = d.textlength(pillar_tag, font=f_tag)
    d.rounded_rectangle((64, 58, 64 + int(ttw) + 36, 102), radius=22, fill=(138, 58, 20, 255))
    d.text((82, 67), pillar_tag, font=f_tag, fill=(255, 248, 235, 255))

    headline = norm_text(spec.get("imageHeadline") or spec.get("headline") or spec.get("title") or "")
    f_head = ImageFont.truetype(fonts["serif_bold"], 50 if len(headline) <= 55 else 44 if len(headline) <= 85 else 38)
    h_lines = wrap_lines(d, headline, f_head, w - 136)[:3]
    hy = 124
    for hl in h_lines:
        d.text((64, hy), hl, font=f_head, fill=(76, 30, 12, 255))
        hy += int(f_head.size * 1.26)

    d.line([(64, hy + 12), (w - 64, hy + 12)], fill=(176, 118, 56, 220), width=3)
    content_top = hy + 34
    bottom_limit = h - (330 if include_product else 96)

    if len(points) <= 1:
        main_txt = points[0] if points else norm_text(spec.get("imageSubtext") or "")
        box_y1 = bottom_limit
        d.rounded_rectangle((64, content_top, w - 64, box_y1), radius=22, fill=(255, 252, 246, 255), outline=(168, 118, 68, 200), width=2)
        f_main = ImageFont.truetype(fonts["serif"], 38 if len(main_txt) <= 140 else 33)
        m_lines = wrap_lines(d, main_txt, f_main, w - 208)
        lh = int(f_main.size * 1.42)
        my = content_top + max(32, ((box_y1 - content_top) - len(m_lines) * lh) // 2)
        for ml in m_lines:
            d.text((104, my), ml, font=f_main, fill=(42, 28, 18, 255))
            my += lh
    else:
        items = points[:5]
        n_items = len(items)
        gap = 18
        avail_h = max(240, bottom_limit - content_top)
        card_h = max(92, (avail_h - gap * (n_items - 1)) // n_items)
        f_num = ImageFont.truetype(fonts["serif_bold"], 32)
        f_pt = ImageFont.truetype(fonts["serif_bold"] if n_items <= 3 else fonts["serif"], 31 if n_items <= 3 else 28)

        cy = content_top
        for i, pt in enumerate(items, 1):
            right_edge = (w - 390) if (include_product and i == n_items and cy + card_h > h - 380) else (w - 64)
            d.rounded_rectangle((64, cy, right_edge, cy + card_h), radius=18, fill=(255, 253, 248, 255), outline=(168, 118, 68, 200), width=2)
            badge_r = 26
            bcx, bcy = 64 + 44, cy + card_h // 2
            d.ellipse((bcx - badge_r, bcy - badge_r, bcx + badge_r, bcy + badge_r), fill=(148, 68, 24, 255))
            num_str = str(i)
            nw = d.textlength(num_str, font=f_num)
            d.text((bcx - nw / 2, bcy - 19), num_str, font=f_num, fill=(255, 248, 235, 255))

            tx0 = 64 + 88
            max_tw = right_edge - tx0 - 28
            p_lines = wrap_lines(d, pt, f_pt, max_tw)[:3]
            lh = int(f_pt.size * 1.28)
            ty = cy + max(12, (card_h - len(p_lines) * lh) // 2)
            for pl in p_lines:
                d.text((tx0, ty), pl, font=f_pt, fill=(38, 26, 18, 255))
                ty += lh
            cy += card_h + gap

    if include_product:
        paste_product_and_disclaimer(canvas, spec.get("productPath"), max_height_ratio=0.28)
    else:
        footer_note = norm_text(spec.get("footerText") or "Chăm sóc sức khỏe chủ động · Khoa học · Bền vững")
        f_foot = ImageFont.truetype(fonts["serif_italic"], 23)
        ftw = d.textlength(footer_note, font=f_foot)
        d.text(((w - ftw) / 2, h - 66), footer_note, font=f_foot, fill=(115, 82, 54, 255))

    out_path = spec["out"]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.convert("RGB").save(out_path, quality=95)
    return out_path


def main():
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    payload = json.load(sys.stdin)
    fonts = get_fonts(payload.get("fallbackFont"))
    outputs = []
    for item in payload.get("items", []):
        kind = item.get("kind") or "content_image"
        if kind == "text_background":
            outputs.append(render_text_background(item, fonts))
        elif kind == "card_item":
            outputs.append(render_card_item(item, fonts))
        else:
            outputs.append(render_content_illustration(item, fonts))
    print(json.dumps({"ok": True, "files": outputs}))


if __name__ == "__main__":
    main()
