# -*- coding: utf-8 -*-
"""
Trình tạo Ảnh Minh Họa chuẩn Hệ Thiết Kế Cao Cấp của Skill `ft-daily-content` (Bổ Thận FT):
- TUYỆT ĐỐI KHÔNG dùng bố cục cắt ngang "1/3 trên là mảng trắng/kem mờ đục + 2/3 dưới là ảnh chụp bị cắt cụt".
- Tham chiếu trực tiếp hệ thiết kế mẫu `ft-style-ref-herbs.jpg`, `ft-style-ref-product.jpg` và bao bì gốc tách nền `ft-cutout-box-bottle.png` (chỉ gồm hộp đứng + lọ thủy tinh nắp vàng đứng cạnh, bỏ hộp kê ngang):
  + Khung vuông 1:1 (1080 × 1080), bố cục toàn cảnh liền mạch, sang trọng, chân thực và có chiều sâu.
  + Phân cấp chữ Serif (Times New Roman Bold) chuẩn mực:
    * Nhãn pill nhỏ phía trên nền nâu đồng (#5B2308) viền vàng kim (#C8963E).
    * Tiêu đề chính cỡ lớn màu nâu đỏ trầm (#5B2308) kết hợp điểm nhấn chữ vàng đồng (#C58B2B) và đường kẻ hoa sen mảnh (─── ❀ ───).
    * Dòng mô tả ngắn (subtitle) và/hoặc các khung thẻ thông tin viền vàng đồng ngắn gọn, súc tích giúp người xem hiểu ngay ý chính của mục đó.
"""
import sys
import os
import re
import json
import time
import shutil
import base64
import tempfile
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image, ImageDraw, ImageFont, ImageFilter

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

DISCLAIMER_TEXT = "Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."

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


def is_product_or_formula_item(item: dict, heading_text: str) -> bool:
    if item.get("includeProduct"):
        return True
    pillar_id = str(item.get("pillarId") or "").upper()
    if pillar_id == "P4":
        return True
    blob = " ".join([
        heading_text,
        str(item.get("cardTitle") or ""),
        str(item.get("postTitle") or ""),
        str(item.get("imageSpec") or ""),
        str(item.get("pillar") or ""),
    ]).lower()
    product_keywords = [
        "bổ thận ft",
        "11 dược liệu",
        "bảng thành phần",
        "6–4–1",
        "6-4-1",
        "6 + 4 + 1",
        "sâm ngọc linh",
        "lục vị",
        "hàm lượng",
        "vai trò từng nhóm",
        "công thức",
    ]
    return any(k in blob for k in product_keywords)


def build_rich_editorial_spec(item: dict, heading_text: str, is_single_story: bool) -> dict:
    scene_hint = str(item.get("sceneHint") or "").strip()
    image_spec = str(item.get("imageSpec") or "").strip()
    post_title = str(item.get("postTitle") or "").strip()
    blob = " ".join([heading_text, scene_hint, image_spec, post_title]).lower()

    if any(k in blob for k in ["11 dược liệu", "đủ tên"]):
        return {
            "mode": "product_herbs_infographic",
            "exact_asset_name": "ft-style-ref-herbs.jpg",
            "pill_badge": "BỔ THẬN FT",
            "main_title": "11 DƯỢC LIỆU TRONG BỔ THẬN FT",
            "gold_highlight": "Phối hợp theo cấu trúc 6 + 4 + 1",
            "subtitle": "Kiểm tra đủ tên 11 vị thảo dược công bố rõ trên nhãn sản phẩm",
            "scene_desc": "",
        }

    if any(k in blob for k in ["6–4–1", "6-4-1", "6 + 4 + 1", "cấu trúc nhóm"]):
        return {
            "mode": "product_editorial",
            "exact_asset_name": "ft-style-ref-641.jpg",
            "pill_badge": "CÔNG THỨC BỔ THẬN FT",
            "main_title": "CẤU TRÚC NHÓM 6 + 4 + 1",
            "gold_highlight": "6 NỀN TẢNG • 4 PHỐI HỢP • 1 BỔ SUNG",
            "subtitle": "Sự kết hợp có trật tự giữa 11 vị dược liệu trong mỗi viên",
            "scene_desc": "",
        }

    if any(k in blob for k in ["hàm lượng", "định lượng"]):
        return {
            "mode": "product_editorial",
            "exact_asset_name": "ft-style-ref-hamluong.jpg",
            "pill_badge": "BẢNG THÀNH PHẦN BỔ THẬN FT",
            "main_title": "HÀM LƯỢNG TỪNG THÀNH PHẦN",
            "gold_highlight": "350MG CAO KHÔ • TỶ LỆ 1:10",
            "subtitle": "Minh bạch khối lượng từng vị dược liệu trong mỗi viên nang",
            "scene_desc": (
                "Warm sunlit cream-gold luxury editorial poster matching the attached reference image (ft-style-ref-product.jpg). "
                "Background has warm golden-cream studio lighting with dappled leaf shadows and subtle golden mountain & ginseng botanical line art. "
                "In the lower center foreground on a warm sunlit stone/wood surface stands the EXACT Bổ Thận FT standing box (left) and amber glass bottle with gold cap (right) from the attached reference image (preserve exact packaging design, GMP logo, and text; no horizontal base box). "
                "Above the product, display 3 elegant cream-and-gold bordered plaques with circular herb illustrations and clear Vietnamese serif labels: "
                "Plaque 1: '6 vị nền tảng: 420mg – 600mg/vị' | "
                "Plaque 2: '4 vị phối hợp: 560mg/vị' | "
                "Plaque 3: 'Sâm Ngọc Linh: 20mg/viên', beside small ceramic bowls of real dried herbs and ginseng root. "
                f"At the very bottom, include the clean disclaimer line: '{DISCLAIMER_TEXT}'"
            ),
        }

    if any(k in blob for k in ["vai trò từng nhóm", "vai trò"]):
        return {
            "mode": "product_editorial",
            "exact_asset_name": "ft-style-ref-vaitro.jpg",
            "pill_badge": "HIỂU RÕ BỔ THẬN FT",
            "main_title": "VAI TRÒ TỪNG NHÓM VỊ",
            "gold_highlight": "BỒI BỔ • TRÁNG DƯƠNG • TĂNG SINH LỰC",
            "subtitle": "Hiểu rõ sự phối hợp giữa 3 nhóm dược liệu trước khi lựa chọn",
            "scene_desc": (
                "Warm sunlit cream-gold luxury editorial poster matching the attached reference image (ft-style-ref-product.jpg). "
                "Warm sunlit stone/wooden podium with dappled leaf shadows and subtle golden mountain & ginseng line art in the background. "
                "In the foreground stands the EXACT Bổ Thận FT standing box (left) and amber glass bottle with gold cap (right) from the attached reference image, flanked by 3 refined gold-framed callout badges: "
                "Badge 1: 'Nhóm 6 vị Lục Vị: Nền tảng bồi bổ' | "
                "Badge 2: 'Nhóm 4 vị phối hợp: Hỗ trợ bổ thận, tráng dương' | "
                "Badge 3: 'Sâm Ngọc Linh: Giúp tăng cường sinh lực', with ceramic bowls of dried herbs and ginseng roots on the tabletop. "
                f"At the bottom, include the clean disclaimer line: '{DISCLAIMER_TEXT}'"
            ),
        }

    if is_product_or_formula_item(item, heading_text):
        return {
            "mode": "product_editorial",
            "pill_badge": "BỔ THẬN FT",
            "main_title": heading_text.upper(),
            "gold_highlight": "CÔNG THỨC 11 DƯỢC LIỆU • 6 + 4 + 1",
            "subtitle": "Hỗ trợ bổ thận, tráng dương • Giúp tăng cường sinh lực",
            "scene_desc": (
                "Warm sunlit cream-gold luxury editorial poster matching the attached reference image (ft-style-ref-product.jpg). "
                "On a sunlit stone/wooden surface with dappled leaf shadows and subtle golden mountain & ginseng botanical line art in the background, "
                "place the EXACT Bổ Thận FT standing box (left) and amber glass bottle with gold cap (right) from the attached reference image (preserve exact packaging text and GMP logo, no horizontal base box), accompanied by ceramic bowls of traditional herbs and fresh ginseng roots. "
                f"At the bottom, include the clean disclaimer line: '{DISCLAIMER_TEXT}'"
            ),
        }

    if any(k in blob for k in ["tiểu đêm", "dậy đêm", "thức giấc", "mất ngủ", "thiếu ngủ", "chập chờn"]):
        return {
            "mode": "lifestyle_editorial",
            "exact_asset_name": "ft-style-ref-tieudem.jpg" if "hiểu đúng thận và tiểu đêm" in blob else "",
            "pill_badge": "GÓC NHÌN ĐÔNG Y & SỨC KHỎE",
            "main_title": heading_text.upper(),
            "gold_highlight": "KHÔNG TỰ QUY KẾT LÀ THẬN YẾU",
            "subtitle": "Theo dõi biểu hiện 1–2 tuần • Thăm khám nếu kéo dài",
            "scene_desc": (
                "Full-bleed luxury health editorial poster combining the warm cream-gold typography hierarchy of the attached reference image with an authentic, warm-lit documentary scene. "
                "Do NOT use a flat white or cream fog bar cutting across the image. "
                "Instead, use a warm sunlit/amber cream-gold upper atmosphere with subtle golden mountain & botanical line art where the bronze pill badge, bold dark-brown Serif title, lotus divider '─── ❀ ───', metallic gold highlight, and subtitle are cleanly composed. "
                "In the lower 62% of the frame, a realistic 52-year-old Vietnamese man in a neat polo shirt sits calmly at a warm wooden table with a porcelain cup of warm herbal tea and a small notebook, flanked by 2 refined gold-bordered takeaway plaques at the bottom: "
                "'Hạn chế nước muộn & rượu bia tối' and 'Khám chuyên khoa nếu kéo dài'."
            ),
        }

    return {
        "mode": "lifestyle_editorial",
        "pill_badge": "CHĂM SÓC PHONG ĐỘ TUỔI TRUNG NIÊN",
        "main_title": heading_text.upper(),
        "gold_highlight": "CHỦ ĐỘNG LẮNG NGHE CƠ THỂ",
        "subtitle": scene_hint[:75] if scene_hint else "Duy trì lối sống điều độ và thăm khám sức khỏe định kỳ",
        "scene_desc": (
            "Full-bleed warm luxury editorial health poster matching the typography and warm cream-gold aesthetic of the attached reference image (NO flat white fog bar cutting across the photo). "
            "Upper area integrates the bronze pill badge, large bold dark-brown Times New Roman Serif headline, lotus gold divider '─── ❀ ───', metallic gold highlight phrase, and subtitle over a warm sunlit cream-gold backdrop with subtle golden botanical line art. "
            f"Lower area shows a realistic, authentic 50-year-old Vietnamese man in everyday smart-casual attire in a warm Vietnamese home setting ({scene_hint or post_title or heading_text}), natural warm lighting, refined and trustworthy."
        ),
    }


def build_ft_imagegen_prompt(item: dict, is_single_story: bool = False) -> tuple[str, list[str], str]:
    """
    Trả về `(prompt, ref_image_paths, exact_asset_path)`.
    Chỉ đính kèm tối đa 1 ảnh tham chiếu gọn nhẹ (`ft-style-ref-product.jpg`, 424KB) để `gpt-image-2` xử lý nhanh trong ~45–60s.
    """
    raw_heading = (
        item.get("cardTitle")
        if not is_single_story
        else (item.get("imageHeadline") or item.get("cardTitle") or item.get("postTitle") or "")
    )
    max_w = 8 if is_single_story else 6
    heading_text = normalize_short_heading(raw_heading, max_words=max_w)
    spec = build_rich_editorial_spec(item, heading_text, is_single_story)

    assets_dir = Path(__file__).resolve().parent.parent / "data" / "skills" / "ft-daily-content" / "assets"
    exact_name = spec.get("exact_asset_name") or ""
    if exact_name:
        exact_fp = assets_dir / exact_name
        if exact_fp.is_file():
            return "", [], str(exact_fp)

    ref_prod_fp = assets_dir / "ft-style-ref-product.jpg"
    if spec.get("mode") == "product_editorial" and ref_prod_fp.is_file():
        ref_paths = [str(ref_prod_fp)]
        input_img_line = "Input images: Image 1 shows the exact target typography hierarchy, bronze pill badge, bold dark-brown Serif headline, lotus gold divider, metallic gold highlight text, warm sunlit cream-gold backdrop with subtle mountain/ginseng line art, and the authentic Bổ Thận FT standing box and amber glass bottle.\n"
    else:
        ref_paths = []
        input_img_line = ""

    prompt = (
        "Use case: ads-marketing\n"
        "Asset type: square 1:1 Vietnamese premium health & herbal editorial poster ($ft-daily-content)\n"
        "Primary request: Create one cohesive, full-bleed square 1:1 luxury editorial poster with warm sunlit cream-gold upper typography and a photorealistic scene.\n"
        f"{input_img_line}"
        f"Scene/backdrop & Subject: {spec['scene_desc']}\n"
        "Typography & Hierarchy (in the upper section, integrated seamlessly into the warm sunlit cream-gold backdrop — NEVER use a flat white fog bar that cuts off the photo):\n"
        f'  1. Top pill badge (dark bronze-brown #5B2308 fill with thin gold border #C8963E): "{spec["pill_badge"]}"\n'
        f'  2. Main headline (large bold Times New Roman Serif in deep mahogany/bronze-brown #5B2308): "{spec["main_title"]}"\n'
        "  3. Delicate gold divider line with a small central lotus ornament (─── ❀ ───)\n"
        f'  4. Highlight line (bold metallic gold serif #C58B2B): "{spec["gold_highlight"]}"\n'
        f'  5. Subtitle (clean dark-brown serif #5B2308): "{spec["subtitle"]}"\n'
        "Color palette: Warm sunlit ivory/cream-gold (#FBF4E4 to #EAD2AC), deep mahogany bronze-brown (#5B2308), and rich metallic gold (#C58B2B).\n"
        "Constraints: Ensure 100% accurate Vietnamese spelling and diacritics. Keep layout balanced, luxurious, authentic, and easy to read. Do NOT use the ugly split layout of a plain white/cream fog block over a cropped photo. Do NOT add page numbers, watermarks, or channel names.\n"
        "Avoid: Plain white top banner with blurred edge, blank white sheets of paper, CGI plastic skin, ancient Chinese robes, garbled Vietnamese text, altered product packaging."
    )
    return prompt, ref_paths, ""


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


def generate_single_image_via_codex(codex_bin: str, item: dict, is_single_story: bool, timeout_sec: int = 185) -> tuple[str, bool]:
    img_prompt, ref_paths, exact_asset_path = build_ft_imagegen_prompt(item, is_single_story=is_single_story)

    if exact_asset_path and os.path.isfile(exact_asset_path):
        tmp_cwd = tempfile.mkdtemp(prefix="ft_codex_exact_")
        out_tmp = os.path.join(tmp_cwd, "generated.png")
        shutil.copy2(exact_asset_path, out_tmp)
        return out_tmp, True

    if not codex_bin or not os.path.isfile(codex_bin):
        return "", False

    ref_arg_note = f"and num_last_images_to_include: {len(ref_paths)} " if ref_paths else "(do NOT pass num_last_images_to_include) "
    codex_instruction = (
        "CRITICAL INSTRUCTION:\n"
        "- Do NOT read any files or SKILL.md via shell commands.\n"
        "- Do NOT run any PowerShell/shell commands (no Get-Content, no Get-ChildItem, no Copy-Item).\n"
        f"- Immediately call tools.image_gen__imagegen ONCE with yield_time_ms: 180000 {ref_arg_note}"
        "using the exact prompt below. As soon as it completes, reply ONLY with the word DONE.\n\n"
        f"{img_prompt}"
    )

    codex_home = Path(os.environ.get("CODEX_HOME") or (Path.home() / ".codex"))
    gen_root = codex_home / "generated_images"
    sessions_root = codex_home / "sessions"
    tmp_cwd = tempfile.mkdtemp(prefix="ft_codex_img_")
    has_prod_in_gen = bool(ref_paths)

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
            ]
            for rp in ref_paths:
                cmd.extend(["-i", rp])
            cmd.append("-")

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
                                return out_tmp, has_prod_in_gen

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
                            return out_tmp, has_prod_in_gen

                if proc.poll() is not None:
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
                                    return out_tmp, has_prod_in_gen
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

    return "", False


def apply_product_and_logo_overlays(base_im: Image.Image, item: dict, skip_product_overlay: bool = False) -> Image.Image:
    im = base_im.convert("RGBA")
    w, h = im.size

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

    if item.get("includeProduct") and not skip_product_overlay:
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

                    shadow = Image.new("RGBA", (pw + 40, ph + 40), (0, 0, 0, 0))
                    alpha = prod_rgba.split()[3]
                    black_silhouette = Image.new("RGBA", (pw, ph), (20, 10, 4, 145))
                    shadow.paste(black_silhouette, (20, 24), mask=alpha)
                    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=12))
                    im.alpha_composite(shadow, dest=(px - 14, py - 10))
                    im.alpha_composite(prod_rgba, dest=(px, py))
            except Exception as e:
                print(f"[ft-daily-content] Product composite warning: {e}", file=sys.stderr)

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
    if not codex_bin:
        raise RuntimeError("Không tìm thấy Codex CLI (codex.exe) để tạo ảnh chuẩn skill ft-daily-content.")

    # Chạy tuần tự (max_workers = 1) để tránh xung đột hàng đợi image_gen có ảnh tham chiếu của OpenAI
    max_workers = 1
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
            gen_png, already_has_prod = fut.result()

            if gen_png and os.path.isfile(gen_png):
                try:
                    with Image.open(gen_png) as im:
                        resized = im.convert("RGB").resize((w, h), Image.Resampling.LANCZOS)
                        final_im = apply_product_and_logo_overlays(resized, it, skip_product_overlay=already_has_prod)
                        final_im.save(out_path, "JPEG", quality=95, subsampling=0)
                    print(f"Rendered (ft-daily-content luxury style): {out_path} ({w}x{h})")
                finally:
                    try:
                        shutil.rmtree(os.path.dirname(gen_png), ignore_errors=True)
                    except Exception:
                        pass
            else:
                raise RuntimeError(f"Không tạo được ảnh cho mục: {it.get('cardTitle') or it.get('imageHeadline')}")


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
