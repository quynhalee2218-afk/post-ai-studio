# -*- coding: utf-8 -*-
"""
Trình tạo Ảnh Minh Họa chuẩn Skill `ft-daily-content` (Bổ Thận FT):
- Gọi trực tiếp công cụ sinh ảnh `image_gen` của Codex (`$ft-daily-content` + `imagegen`) để tạo từng ảnh vuông 1:1 (1080 × 1080) riêng biệt, chân thực (photorealistic documentary photography):
  + Phần trên (~30%): Nền Kem ấm (#FAF3E8), chính giữa là dòng tiêu đề ngắn gọn bằng font chữ Serif đậm (Times New Roman Bold) màu Nâu đồng đậm (#5B2308), chuyển sắc mượt mà (soft seamless gradient fade) xuống phần ảnh chụp bên dưới.
  + Phần dưới (~70%): Ảnh chụp đời thực (candid 35mm documentary photo) của người đàn ông Việt Nam 40–65 tuổi đúng bối cảnh/tình huống của từng mục/bài viết.
  + Không chèn tên page, không đánh số "Ảnh 1/2/3", không watermark, không tự vẽ bao bì sản phẩm giả bằng AI.
- Khi bài có gắn sản phẩm (`includeProduct = true`):
  + Ghép ảnh gốc tách nền sạch chỉ gồm hộp đứng và lọ đứng cạnh (`assets/ft-cutout-box-bottle.png`, đã bỏ nền gốc, bàn gốc và hộp kê ngang) vào góc dưới bên phải kèm dòng khuyến cáo bắt buộc ở chân ảnh:
    "Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."
"""
import sys
import os
import re
import glob
import json
import time
import shutil
import base64
import html
import tempfile
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image, ImageDraw, ImageFont, ImageFilter

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

DISCLAIMER_TEXT = "Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."

THEMES = {
    "ft_editorial": {
        "header_bg": "#FAF3E8",
        "title_ink": "#5B2308",
        "sub_ink": "#7A3E1D",
        "gold": "#C5933A",
    },
    "herbal_warm": {
        "header_bg": "#FBF5E9",
        "title_ink": "#542209",
        "sub_ink": "#753B1A",
        "gold": "#B8862D",
    },
    "deep_espresso": {
        "header_bg": "#F7EFE0",
        "title_ink": "#4A1B06",
        "sub_ink": "#6B3215",
        "gold": "#C8963E",
    },
    "clinical_clean": {
        "header_bg": "#FCF7EE",
        "title_ink": "#5C260E",
        "sub_ink": "#7A4022",
        "gold": "#B88938",
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
    Chuẩn hóa tiêu đề in trên nền kem của ảnh:
    - Bỏ số thứ tự đầu dòng (01, #01, 1., ...)
    - Viết hoa chữ cái đầu tự nhiên + giữ nguyên viết hoa tên riêng (Đông y, Tây y, Bổ Thận FT, Sâm Ngọc Linh)
    - Giữ ngắn gọn, súc tích (3–8 chữ).
    """
    s = str(raw_text or "").strip()
    s = re.sub(r"^(?:#?\d+[\.\:\-\)\s]+)+", "", s).strip()
    s = re.sub(r"^[\•\-\–\—\✗\✓\✘\✔]+\s*", "", s).strip()
    if ":" in s:
        left, right = s.split(":", 1)
        if len(left.split()) <= 3 and len(right.strip()) >= 4:
            s = right.strip()

    alpha_chars = [ch for ch in s if ch.isalpha()]
    if alpha_chars and sum(1 for ch in alpha_chars if ch.isupper()) / len(alpha_chars) > 0.7:
        s = s.lower()
        if s:
            s = s[0].upper() + s[1:]
    elif s:
        s = s[0].upper() + s[1:]

    for low, proper in PROPER_NOUNS:
        s = re.sub(re.escape(low), proper, s, flags=re.IGNORECASE)

    words = s.split()
    if len(words) > max_words:
        s = " ".join(words[:max_words]).rstrip(",;:")
    return s


def find_codex_bin() -> str:
    env_bin = os.environ.get("CODEX_BIN", "")
    if env_bin and os.path.isfile(env_bin):
        return env_bin
    home = Path.home()
    ext_roots = [
        home / ".vscode" / "extensions",
        home / ".cursor" / "extensions",
        home / ".antigravity" / "extensions",
    ]
    for root in ext_roots:
        if not root.is_dir():
            continue
        matches = sorted(root.glob("openai.chatgpt-*"), reverse=True)
        for m in matches:
            cand = m / "bin" / "windows-x86_64" / "codex.exe"
            if cand.is_file():
                return str(cand)
    return ""


def build_scene_subject_description(item: dict, heading_text: str) -> str:
    """
    Xây dựng mô tả bối cảnh chụp ảnh chân thực (candid documentary photography) của người đàn ông Việt Nam 45–60 tuổi
    bám sát nội dung riêng của từng mục/bài viết theo đúng chuẩn skill `ft-daily-content`.
    """
    scene_hint = str(item.get("sceneHint") or "").strip()
    image_spec = str(item.get("imageSpec") or "").strip()
    post_title = str(item.get("postTitle") or "").strip()
    scene_key = str(item.get("sceneKey") or "").lower().strip()
    blob = " ".join([heading_text, scene_hint, image_spec, post_title, scene_key]).lower()

    # Gợi ý chi tiết bối cảnh đời thực Việt Nam theo ngữ cảnh
    if any(k in blob for k in ["rượu", "bia", "nhậu", "tiệc", "alcohol", "beer"]):
        context_en = (
            "A realistic 50-year-old Vietnamese man in a casual short-sleeve button-down shirt sitting at a modest Vietnamese dining table in the evening, "
            "looking thoughtfully at a glass of beer on the table with a calm, reflective expression, warm indoor dining lighting."
        )
    elif any(k in blob for k in ["hút thuốc", "thuốc lá", "khói thuốc", "smoking", "ban công"]):
        context_en = (
            "A realistic 50-year-old Vietnamese man in casual home shirt sitting on a quiet apartment balcony in late afternoon, "
            "a small cup of Vietnamese coffee and an ashtray on the small table beside him, looking pensive and reflective."
        )
    elif any(k in blob for k in ["tài xế", "lái xe", "cuốn sổ", "chuyến xe", "driver", "notebook"]):
        context_en = (
            "A realistic 49-year-old Vietnamese man in a simple polo shirt sitting at a small wooden table at night under a warm desk lamp, "
            "looking thoughtfully at an open small handwritten notebook and a pen, calm and reflective mood."
        )
    elif any(k in blob for k in ["tiểu đêm", "dậy đêm", "thức giấc", "mất ngủ", "thiếu ngủ", "chập chờn", "insomnia", "sleep"]):
        context_en = (
            "A realistic 52-year-old Vietnamese man wearing a modest cotton T-shirt and plaid pajama pants sitting thoughtfully on the edge of his wooden bed at night, "
            "warm bedside table lamp glowing softly beside him in a cozy Vietnamese bedroom, contemplative expression, no bathroom and no medical equipment."
        )
    elif any(k in blob for k in ["dược sĩ", "nhà thuốc", "vai trò từng nhóm", "trao đổi", "tư vấn"]):
        context_en = (
            "A realistic 52-year-old Vietnamese man in a neat polo shirt having a calm, trustworthy conversation with a middle-aged Vietnamese pharmacist "
            "across a clean wooden consultation table in a warm traditional-modern Vietnamese health room, natural indoor lighting."
        )
    elif any(k in blob for k in ["11 dược liệu", "đủ tên", "thảo dược", "lục vị", "sâm ngọc linh", "herbal"]):
        context_en = (
            "A realistic 52-year-old Vietnamese man wearing reading glasses sitting at a warm wooden table at home, "
            "attentively reading a clean printed health information sheet held in his hands, with a porcelain cup of warm herbal tea and a small wooden tray of dried traditional herbs on the table."
        )
    elif any(k in blob for k in ["hàm lượng", "bảng thành phần", "đọc kỹ", "thông tin", "cửa sổ"]):
        context_en = (
            "A realistic 50-year-old Vietnamese man wearing reading glasses sitting near a sunlit wooden window in a Vietnamese living room in the morning, "
            "calmly examining a printed health guide sheet in his hands with a thoughtful, careful expression."
        )
    elif any(k in blob for k in ["6–4–1", "6-4-1", "cấu trúc nhóm", "đánh dấu", "ghi chép"]):
        context_en = (
            "A realistic 50-year-old Vietnamese man wearing reading glasses sitting at a warm wooden desk at home, "
            "holding a pen and calmly reviewing notes in an open notebook with a porcelain teacup beside him, warm natural lighting."
        )
    elif any(k in blob for k in ["ngồi quá lâu", "ít vận động", "cổ vai gáy", "mỏi lưng", "văn phòng", "sedentary"]):
        context_en = (
            "A realistic 48-year-old Vietnamese man in an office shirt sitting at a wooden desk in front of a laptop, "
            "gently resting one hand on the back of his neck with a mildly tired, thoughtful expression, natural warm indoor lighting."
        )
    elif any(k in blob for k in ["căng thẳng", "áp lực", "stress", "lo âu", "công việc"]):
        context_en = (
            "A realistic 48-year-old Vietnamese man in a button-down shirt sitting at a wooden desk in the evening with a laptop and notebook, "
            "resting his hand thoughtfully on his forehead, warm desk lamp lighting."
        )
    elif any(k in blob for k in ["vợ chồng", "người vợ", "bạn đời", "gia đình", "couple"]):
        context_en = (
            "A realistic middle-aged Vietnamese couple (man around 52 and wife around 48) sitting together warmly in a cozy Vietnamese living room with two cups of warm tea, "
            "sharing a gentle, understanding conversation, natural warm home lighting."
        )
    else:
        context_en = (
            "A realistic 50-year-old Vietnamese man in comfortable everyday smart-casual home attire in an authentic warm Vietnamese living room or study, "
            "natural posture and thoughtful, calm expression."
        )

    vn_detail = scene_hint or image_spec or post_title
    if vn_detail:
        return f"{context_en} Specific scene context: {vn_detail}."
    return context_en


def build_ft_imagegen_prompt(item: dict, is_single_story: bool = False) -> str:
    """
    Tạo prompt chuẩn cho công cụ `tools.image_gen__imagegen` theo đúng quy tắc của skill `ft-daily-content` và `imagegen`.
    """
    raw_heading = (
        item.get("cardTitle")
        if not is_single_story
        else (item.get("imageHeadline") or item.get("cardTitle") or item.get("postTitle") or "")
    )
    max_w = 9 if is_single_story else 7
    heading_text = normalize_short_heading(raw_heading, max_words=max_w)
    subject_desc = build_scene_subject_description(item, heading_text)

    include_product_note = ""
    if item.get("includeProduct"):
        include_product_note = (
            " Leave the bottom-right corner of the foreground relatively uncluttered (such as a clean warm wooden table surface or calm dark area) "
            "so the authentic product cutout can be composited cleanly in post-processing."
        )

    return (
        "Use case: ads-marketing\n"
        "Asset type: square 1:1 Vietnamese daily health social-media content image ($ft-daily-content)\n"
        "Primary request: Create one polished square 1:1 image with a two-part vertical composition following the exact ft-daily-content editorial style.\n"
        "Scene/backdrop: Top 32% is a flat warm cream field, exact color #FAF3E8. Bottom 68% seamlessly transitions via a soft, natural gradient fade into a realistic documentary photograph.\n"
        f"Subject: {subject_desc}{include_product_note}\n"
        "Style/medium: Top is clean editorial serif typography; lower area is authentic, candid 35mm documentary lifestyle photography of a real Vietnamese middle-aged man (45-60 years old) with natural skin texture, realistic pores, and authentic Vietnamese home details.\n"
        "Composition/framing: Exact 1:1 square. Top cream area has generous whitespace and centered typography. Below, natural photographic scene with a seamless soft blended border at the divide.\n"
        "Lighting/mood: Natural, calm, reassuring, warm, documentary realism (NOT CGI, NOT plastic skin, NOT glossy studio stock).\n"
        "Color palette: Warm cream #FAF3E8 and dark bronze-brown #5B2308 for top; warm natural earth and amber tones below.\n"
        f'Text (verbatim): "{heading_text}"\n'
        f'Typography: The ONLY visible text anywhere in the image must be the exact Vietnamese phrase "{heading_text}" on the cream top section, centered horizontally and vertically in that section, bold Times New Roman serif, dark bronze-brown #5B2308. Ensure all Vietnamese diacritics/accents are 100% accurate. Do not add any other words, symbols, labels, page numbers, logos, watermarks, or signatures.\n'
        "Constraints: Clean legible Vietnamese serif typography; natural documentary photo; seamless soft transition between top cream graphic and bottom photograph; do NOT draw any fake product boxes, supplement bottles, or readable text inside the bottom photograph.\n"
        "Avoid: Incorrect Vietnamese spelling, garbled text, duplicate text, CGI/plastic skin, ancient robes or temple tunics, hospital/clinic setting, fake product packaging, watermarks."
    )


def find_session_id_for_cwd(sessions_root: Path, target_cwd: str) -> str:
    if not sessions_root.is_dir():
        return ""
    norm_target = os.path.normcase(os.path.abspath(target_cwd))
    jsonl_files = sorted(sessions_root.rglob("rollout-*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    for jf in jsonl_files[:30]:
        try:
            with open(jf, "r", encoding="utf-8", errors="ignore") as f:
                first_line = f.readline().strip()
            if not first_line:
                continue
            data = json.loads(first_line)
            payload = data.get("payload") or {}
            cwd = payload.get("cwd") or ""
            if cwd and os.path.normcase(os.path.abspath(cwd)) == norm_target:
                return str(payload.get("session_id") or payload.get("id") or "")
        except Exception:
            continue
    return ""


def check_rollout_image_completed(sessions_root: Path, session_id: str) -> str:
    """
    Kiểm tra file rollout của session xem `image_gen.generation` đã `completed` chưa.
    Nếu có base64 trong `result`, trả về chuỗi base64 đó.
    """
    if not session_id or not sessions_root.is_dir():
        return ""
    matches = list(sessions_root.rglob(f"*{session_id}.jsonl"))
    if not matches:
        return ""
    rollout_file = matches[0]
    try:
        with open(rollout_file, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if '"image_gen.generation"' not in line:
                    continue
                obj = json.loads(line)
                item = (obj.get("payload") or {}).get("item") or {}
                if item.get("kind") == "image_gen.generation" and item.get("status") == "completed":
                    res_b64 = item.get("result") or ""
                    return res_b64 if res_b64 else "COMPLETED_ON_DISK"
    except Exception:
        pass
    return ""


def generate_single_image_via_codex(codex_bin: str, item: dict, is_single_story: bool, timeout_sec: int = 115) -> str:
    """
    Gọi `codex.exe exec` để chạy công cụ `tools.image_gen__imagegen` theo đúng chuẩn skill `ft-daily-content`.
    Trả về đường dẫn file PNG vừa sinh ra, hoặc chuỗi rỗng nếu lỗi.
    """
    if not codex_bin or not os.path.isfile(codex_bin):
        return ""

    img_prompt = build_ft_imagegen_prompt(item, is_single_story=is_single_story)
    codex_instruction = (
        "CRITICAL INSTRUCTION:\n"
        "- Do NOT read any files or SKILL.md via shell commands.\n"
        "- Do NOT run any PowerShell/shell commands (no Get-Content, no Get-ChildItem, no Copy-Item).\n"
        "- Do NOT call view_image.\n"
        "- Immediately call tools.image_gen__imagegen ONCE with the exact prompt below, and as soon as it completes, reply ONLY with the word DONE.\n\n"
        f"{img_prompt}"
    )

    codex_home = Path(os.environ.get("CODEX_HOME") or (Path.home() / ".codex"))
    gen_root = codex_home / "generated_images"
    sessions_root = codex_home / "sessions"
    tmp_cwd = tempfile.mkdtemp(prefix="ft_codex_img_")

    models_to_try = ["gpt-5.6-terra", "gpt-5.6-sol"]
    for model_name in models_to_try:
        proc = None
        try:
            cmd = [
                codex_bin,
                "exec",
                "--skip-git-repo-check",
                "-C",
                tmp_cwd,
                "-s",
                "danger-full-access",
                "-m",
                model_name,
                "-c",
                'model_reasoning_effort="low"',
                "-",
            ]
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="ignore",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            try:
                proc.stdin.write(codex_instruction)
                proc.stdin.close()
            except Exception:
                pass

            t0 = time.time()
            session_id = ""
            while time.time() - t0 < timeout_sec:
                if not session_id:
                    session_id = find_session_id_for_cwd(sessions_root, tmp_cwd)

                if session_id:
                    session_img_dir = gen_root / session_id
                    if session_img_dir.is_dir():
                        pngs = sorted(session_img_dir.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
                        for p in pngs:
                            if p.stat().st_size > 80_000:
                                time.sleep(0.35)
                                out_tmp = os.path.join(tmp_cwd, "generated.png")
                                shutil.copy2(str(p), out_tmp)
                                try:
                                    proc.kill()
                                except Exception:
                                    pass
                                return out_tmp

                    b64_or_status = check_rollout_image_completed(sessions_root, session_id)
                    if b64_or_status and b64_or_status != "COMPLETED_ON_DISK":
                        out_tmp = os.path.join(tmp_cwd, "generated.png")
                        with open(out_tmp, "wb") as bf:
                            bf.write(base64.b64decode(b64_or_status))
                        if os.path.getsize(out_tmp) > 80_000:
                            try:
                                proc.kill()
                            except Exception:
                                pass
                            return out_tmp

                if proc.poll() is not None:
                    # Process đã kết thúc — kiểm tra lần cuối
                    if not session_id:
                        session_id = find_session_id_for_cwd(sessions_root, tmp_cwd)
                    if session_id:
                        session_img_dir = gen_root / session_id
                        if session_img_dir.is_dir():
                            pngs = sorted(session_img_dir.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
                            for p in pngs:
                                if p.stat().st_size > 80_000:
                                    out_tmp = os.path.join(tmp_cwd, "generated.png")
                                    shutil.copy2(str(p), out_tmp)
                                    return out_tmp
                    break

                time.sleep(0.8)
        except Exception as e:
            print(f"[ft-daily-content] Codex image_gen attempt ({model_name}) error: {e}", file=sys.stderr)
        finally:
            if proc and proc.poll() is None:
                try:
                    proc.kill()
                except Exception:
                    pass

    return ""


def apply_product_and_logo_overlays(base_im: Image.Image, item: dict) -> Image.Image:
    """
    Nếu bài đăng có yêu cầu gắn sản phẩm (`includeProduct = true`) hoặc có `logoPath`:
    - Ghép ảnh gốc tách nền sạch `ft-cutout-box-bottle.png` (chỉ gồm hộp đứng + lọ đứng cạnh, không có hộp kê ngang)
      vào góc phải dưới, giữ nguyên 100% chữ/màu/tỷ lệ bao bì.
    - Thêm dải khuyến cáo bắt buộc ở chân ảnh:
      "Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."
    """
    im = base_im.convert("RGBA")
    w, h = im.size

    # 1. Ghép logo nếu chiến dịch có cài đặt logo
    logo_path = item.get("logoPath") or ""
    if logo_path and os.path.isfile(logo_path):
        try:
            with Image.open(logo_path) as lg:
                lg_rgba = lg.convert("RGBA")
                lg_rgba.thumbnail((140, 52), Image.Resampling.LANCZOS)
                lw, lh = lg_rgba.size
                corner = item.get("logoCorner") or "top-right"
                pos = {
                    "top-right": (w - lw - 28, 22),
                    "top-left": (28, 22),
                    "bottom-right": (w - lw - 28, h - lh - 54),
                    "bottom-left": (28, h - lh - 54),
                }.get(corner, (w - lw - 28, 22))
                im.alpha_composite(lg_rgba, dest=pos)
        except Exception:
            pass

    # 2. Ghép sản phẩm Bổ Thận FT tách nền sạch + dòng cảnh báo bắt buộc nếu `includeProduct = true`
    if item.get("includeProduct"):
        root_cutout = Path(__file__).resolve().parent.parent / "data" / "skills" / "ft-daily-content" / "assets" / "ft-cutout-box-bottle.png"
        prod_file = str(root_cutout) if root_cutout.is_file() else (item.get("productPath") or "")
        if prod_file and os.path.isfile(prod_file):
            try:
                with Image.open(prod_file) as prod_im:
                    prod_rgba = prod_im.convert("RGBA")
                    max_pw = int(w * 0.27)
                    max_ph = int(h * 0.34)
                    prod_rgba.thumbnail((max_pw, max_ph), Image.Resampling.LANCZOS)
                    pw, ph = prod_rgba.size
                    px = w - pw - 36
                    py = h - ph - 58

                    # Bóng đổ mềm tự nhiên dưới đáy hộp và lọ
                    shadow = Image.new("RGBA", (pw + 40, ph + 40), (0, 0, 0, 0))
                    alpha = prod_rgba.split()[3]
                    black_silhouette = Image.new("RGBA", (pw, ph), (20, 10, 4, 145))
                    shadow.paste(black_silhouette, (20, 24), mask=alpha)
                    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=12))
                    im.alpha_composite(shadow, dest=(px - 14, py - 10))
                    im.alpha_composite(prod_rgba, dest=(px, py))
            except Exception as e:
                print(f"[ft-daily-content] Product composite warning: {e}", file=sys.stderr)

        # Dải chữ cảnh báo bắt buộc ở chân ảnh
        bar_h = 44
        bar = Image.new("RGBA", (w, bar_h), (38, 20, 10, 232))
        im.alpha_composite(bar, dest=(0, h - bar_h))
        draw = ImageDraw.Draw(im)
        draw.line([(0, h - bar_h), (w, h - bar_h)], fill=(197, 147, 58, 220), width=2)
        font_candidates = [
            r"C:\Windows\Fonts\timesi.ttf",
            r"C:\Windows\Fonts\times.ttf",
            r"C:\Windows\Fonts\arial.ttf",
        ]
        disc_font = None
        for fc in font_candidates:
            if os.path.isfile(fc):
                try:
                    disc_font = ImageFont.truetype(fc, 19)
                    break
                except Exception:
                    pass
        if disc_font is None:
            disc_font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), DISCLAIMER_TEXT, font=disc_font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text(((w - tw) / 2, h - bar_h + (bar_h - th) / 2 - 2), DISCLAIMER_TEXT, fill=(250, 243, 232, 255), font=disc_font)

    return im.convert("RGB")


# ==============================================================================
# FALLBACK RENDERER (Khi Codex CLI không khả dụng hoặc mất kết nối mạng)
# ==============================================================================
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
    ]).lower()

    keyword_rules = [
        (["rượu", "bia", "nhậu", "cồn", "tiệc", "alcohol", "beer"], "scene-alcohol-beer.jpg"),
        (["căng thẳng", "áp lực", "stress", "lo âu", "công việc", "giấy tờ", "đầu óc"], "scene-work-stress.jpg"),
        (["hút thuốc", "thuốc lá", "khói thuốc", "smoking", "cà phê", "ban công"], "scene-smoking-balcony.jpg"),
        (["ngồi quá lâu", "ngồi lâu", "ít vận động", "cổ vai gáy", "văn phòng", "mỏi lưng", "sedentary"], "scene-sedentary-neck.jpg"),
        (["tài xế", "lái xe", "cuốn sổ", "ghi lịch", "chuyến xe", "đếm số đêm", "driver", "notebook"], "scene-driver-notebook.jpg"),
        (["thiếu ngủ", "mất ngủ", "thức khuya", "ngủ muộn", "tiểu đêm", "dậy đêm", "trằn trọc", "insomnia", "sleep"], "scene-insomnia-bed.jpg"),
        (["dược liệu", "thảo dược", "sâm ngọc linh", "lục vị", "11 dược liệu", "herbal"], "scene-herbal-essence.jpg"),
        (["hàm lượng", "buổi sáng", "cửa sổ", "morning"], "scene-morning-vitality.jpg"),
        (["vai trò", "dược sĩ", "tìm hiểu", "kiến thức", "consult"], "scene-consult-knowledge.jpg"),
        (["vợ chồng", "người vợ", "bạn đời", "couple"], "scene-couple-harmony.jpg"),
    ]

    for keywords, filename in keyword_rules:
        if any(k in text_blob for k in keywords):
            cand = os.path.join(scenes_dir, filename)
            if os.path.exists(cand) and cand not in used_files:
                used_files.add(cand)
                return file_to_data_uri(cand)

    fallback_order = [
        "scene-insomnia-bed.jpg",
        "scene-work-stress.jpg",
        "scene-alcohol-beer.jpg",
        "scene-smoking-balcony.jpg",
        "scene-sedentary-neck.jpg",
        "scene-driver-notebook.jpg",
    ]
    for fn in fallback_order:
        cand = os.path.join(scenes_dir, fn)
        if os.path.exists(cand) and cand not in used_files:
            used_files.add(cand)
            return file_to_data_uri(cand)

    existing = [os.path.join(scenes_dir, fn) for fn in fallback_order if os.path.exists(os.path.join(scenes_dir, fn))]
    if existing:
        idx = int(item.get("index") or 1)
        return file_to_data_uri(existing[(idx - 1) % len(existing)])
    return ""


def build_clean_editorial_card_html(item: dict, scene_uri: str, is_single_story: bool = False) -> str:
    w = int(item.get("width") or 1080)
    h = int(item.get("height") or 1080)
    theme_key = item.get("theme") if item.get("theme") in THEMES else "ft_editorial"
    pal = THEMES[theme_key]

    raw_heading = (
        item.get("cardTitle")
        if not is_single_story
        else (item.get("imageHeadline") or item.get("cardTitle") or item.get("postTitle") or "")
    )
    max_w = 9 if is_single_story else 7
    heading_text = normalize_short_heading(raw_heading, max_words=max_w)
    escaped_heading = html.escape(heading_text)

    char_len = len(heading_text)
    if char_len <= 18:
        font_size = 92
    elif char_len <= 24:
        font_size = 82
    elif char_len <= 32:
        font_size = 72
    else:
        font_size = 62

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
    font-family: 'Times New Roman', Georgia, serif;
    position: relative;
  }}
  .photo-stage {{
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: {int(h * 0.78)}px;
    overflow: hidden;
    background: #2B180E;
  }}
  .photo-stage img.scene-img {{
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 22%;
    display: block;
  }}
  .top-cream-blend {{
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: {int(h * 0.38)}px;
    background: linear-gradient(
      180deg,
      {pal['header_bg']} 0%,
      {pal['header_bg']} 64%,
      rgba(250, 243, 232, 0.88) 78%,
      rgba(250, 243, 232, 0.42) 90%,
      rgba(250, 243, 232, 0.0) 100%
    );
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 86px 48px 0 48px;
    text-align: center;
    z-index: 5;
  }}
  .banner-title {{
    font-family: 'Times New Roman', Georgia, serif;
    font-size: {font_size}px;
    font-weight: 700;
    color: {pal['title_ink']};
    line-height: 1.12;
    letter-spacing: -0.8px;
    transform: scaleX(0.93);
    text-rendering: geometricPrecision;
  }}
</style>
</head>
<body>
  <div class="photo-stage">
    {f'<img class="scene-img" src="{scene_uri}" alt="Minh họa" />' if scene_uri else ''}
  </div>
  <div class="top-cream-blend">
    <div class="banner-title">{escaped_heading}</div>
  </div>
</body>
</html>"""


def render_fallback_with_playwright(fallback_items: list):
    if not fallback_items:
        return
    render_jobs = []
    used_scenes = set()
    for item in fallback_items:
        w = int(item.get("width") or 1080)
        h = int(item.get("height") or 1080)
        out_path = item.get("out")
        scene_uri = pick_scene_photo(item, used_scenes)
        is_single = (item.get("kind") != "card_item")
        html_doc = build_clean_editorial_card_html(item, scene_uri, is_single_story=is_single)
        html_file = out_path + ".tmp.html"
        png_file = out_path + ".tmp.png"
        with open(html_file, "w", encoding="utf-8") as f:
            f.write(html_doc)
        render_jobs.append({
            "item": item,
            "htmlFile": os.path.abspath(html_file),
            "pngFile": os.path.abspath(png_file),
            "outFile": os.path.abspath(out_path),
            "width": w,
            "height": h,
        })

    repo_root = str(Path(__file__).resolve().parent.parent)
    jobs_json = json.dumps(
        [{k: v for k, v in j.items() if k != "item"} for j in render_jobs],
        ensure_ascii=False,
    )
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
        raise RuntimeError(f"Playwright fallback render failed: {res.stderr or res.stdout}")

    for j in render_jobs:
        try:
            with Image.open(j["pngFile"]) as im:
                resized = im.convert("RGB").resize((j["width"], j["height"]), Image.Resampling.LANCZOS)
                final_im = apply_product_and_logo_overlays(resized, j["item"])
                final_im.save(j["outFile"], "JPEG", quality=95, subsampling=0)
            print(f"Rendered (fallback): {j['outFile']} ({j['width']}x{j['height']})")
        finally:
            for tmp in (j["htmlFile"], j["pngFile"]):
                try:
                    if os.path.exists(tmp):
                        os.remove(tmp)
                except OSError:
                    pass


def process_all_items(items: list):
    valid_items = [
        it for it in items
        if it.get("kind") != "text_background" and it.get("out")
    ]
    if not valid_items:
        return

    for it in valid_items:
        os.makedirs(os.path.dirname(os.path.abspath(it["out"])), exist_ok=True)

    codex_bin = find_codex_bin()
    fallback_items = []

    if codex_bin:
        max_workers = min(4, len(valid_items))
        futures = {}
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            for it in valid_items:
                is_single = (it.get("kind") != "card_item")
                fut = pool.submit(generate_single_image_via_codex, codex_bin, it, is_single)
                futures[fut] = it

            for fut in as_completed(futures):
                it = futures[fut]
                w = int(it.get("width") or 1080)
                h = int(it.get("height") or 1080)
                out_path = os.path.abspath(it["out"])
                gen_png = ""
                try:
                    gen_png = fut.result()
                except Exception as e:
                    print(f"[ft-daily-content] Worker error: {e}", file=sys.stderr)

                if gen_png and os.path.isfile(gen_png):
                    try:
                        with Image.open(gen_png) as im:
                            resized = im.convert("RGB").resize((w, h), Image.Resampling.LANCZOS)
                            final_im = apply_product_and_logo_overlays(resized, it)
                            final_im.save(out_path, "JPEG", quality=95, subsampling=0)
                        print(f"Rendered (ft-daily-content image_gen): {out_path} ({w}x{h})")
                    except Exception as e:
                        print(f"[ft-daily-content] Save error: {e}", file=sys.stderr)
                        fallback_items.append(it)
                    finally:
                        try:
                            shutil.rmtree(os.path.dirname(gen_png), ignore_errors=True)
                        except Exception:
                            pass
                else:
                    fallback_items.append(it)
    else:
        fallback_items = valid_items

    if fallback_items:
        render_fallback_with_playwright(fallback_items)


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print("No input provided", file=sys.stderr)
        sys.exit(1)
    payload = json.loads(raw)
    items = payload.get("items") or []
    if not items:
        return
    process_all_items(items)


if __name__ == "__main__":
    main()
