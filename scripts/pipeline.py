#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RAG-pipeline: обходит C:\dia рекурсивно, маршрутизирует файлы по типу,
извлекает атомы знаний и пишет output/atoms.jsonl + manifest.json.

Запуск:
  python pipeline.py               # полный прогон
  python pipeline.py --skip-video  # без транскрипции видео
  python pipeline.py --only pdf    # только PDF
"""

import os, sys, json, glob, datetime, hashlib, re, struct, traceback
from pathlib import Path

# --- настройки ---
BASE    = Path(__file__).parent
OUT     = BASE / "output"
ATOMS_DIR = OUT / "atoms"
RAW_DIR   = OUT / "raw"
OSC_DIR   = OUT / "oscilloscope"

SKIP_VIDEO = "--skip-video" in sys.argv
ONLY_TYPE  = None
for i, a in enumerate(sys.argv):
    if a == "--only" and i + 1 < len(sys.argv):
        ONLY_TYPE = sys.argv[i + 1].lower()

# расширения → тип
EXT_MAP = {
    "mp4": "video", "mov": "video", "mkv": "video", "avi": "video",
    "wmv": "video", "webm": "video", "flv": "video",
    "mp3": "audio", "wav": "audio", "m4a": "audio", "wma": "audio",
    "ogg": "audio", "aac": "audio", "flac": "audio",
    "m4v": "video",   # встречается в курсе
    "pdf": "pdf",
    "docx": "document", "doc": "document", "pptx": "document",
    "ppt": "document", "txt": "document", "md": "document", "rtf": "document",
    "jpg": "image", "jpeg": "image", "png": "image",
    "webp": "image", "bmp": "image", "tiff": "image",
    "md3": "osc_md3",
    "mwf": "osc_other", "ws": "osc_other", "dm2": "osc_other",
    "osc": "osc_other",
}

manifest = []   # список записей по каждому файлу
all_atoms = []  # все атомы

# ------------------------------------------------------------------ helpers --

def uid(path, idx=0):
    stem = Path(path).stem[:40]
    stem = re.sub(r"[^\w\-]", "_", stem)
    return f"{stem}_{idx:02d}" if idx else stem

def save_atom(atom):
    all_atoms.append(atom)
    p = ATOMS_DIR / (atom["id"] + ".json")
    p.write_text(json.dumps(atom, ensure_ascii=False, indent=2), encoding="utf-8")

def log(path, ftype, status, n_atoms=0, error=""):
    manifest.append({
        "file": str(Path(path).relative_to(BASE)),
        "type": ftype,
        "status": status,
        "atoms": n_atoms,
        "error": error,
        "ts": datetime.datetime.now().isoformat(timespec="seconds"),
    })
    symbol = "OK" if status == "done" else ("SKIP" if status == "skipped" else "ERR")
    print(f"[{symbol}] {Path(path).relative_to(BASE)}  ({ftype}) atoms={n_atoms}" +
          (f" | {error}" if error else ""))


# -------------------------------------------------------------- 2.1 видео ---

def process_video(path):
    if SKIP_VIDEO:
        log(path, "video", "skipped", 0, "--skip-video flag")
        return
    import subprocess, tempfile
    name = Path(path).stem
    raw_dir = RAW_DIR / name
    raw_dir.mkdir(parents=True, exist_ok=True)
    wav = raw_dir / "audio.wav"

    # извлечь аудио
    if not wav.exists():
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", str(path), "-ar", "16000", "-ac", "1", str(wav)],
            capture_output=True, text=True)
        if r.returncode != 0:
            log(path, "video", "error", 0, "ffmpeg: " + r.stderr[-200:])
            return

    # транскрипция
    tr_path = raw_dir / "transcript.json"
    if not tr_path.exists():
        try:
            from faster_whisper import WhisperModel
            model = WhisperModel("large-v3", device="cpu", compute_type="int8")
            segments, _ = model.transcribe(str(wav), language="ru", beam_size=5)
            segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                    for s in segments]
            tr_path.write_text(json.dumps(segs, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            log(path, "video", "error", 0, f"whisper: {e}")
            return
    else:
        segs = json.loads(tr_path.read_text(encoding="utf-8"))

    atoms = build_atoms_from_transcript(segs, path, "video")
    for a in atoms:
        save_atom(a)
    log(path, "video", "done", len(atoms))


# -------------------------------------------------------------- 2.2 аудио ---

def process_audio(path):
    if SKIP_VIDEO:
        log(path, "audio", "skipped", 0, "--skip-video flag")
        return
    name = Path(path).stem
    raw_dir = RAW_DIR / name
    raw_dir.mkdir(parents=True, exist_ok=True)
    tr_path = raw_dir / "transcript.json"
    if not tr_path.exists():
        try:
            from faster_whisper import WhisperModel
            model = WhisperModel("large-v3", device="cpu", compute_type="int8")
            segments, _ = model.transcribe(str(path), language="ru", beam_size=5)
            segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                    for s in segments]
            tr_path.write_text(json.dumps(segs, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            log(path, "audio", "error", 0, f"whisper: {e}")
            return
    else:
        segs = json.loads(tr_path.read_text(encoding="utf-8"))
    atoms = build_atoms_from_transcript(segs, path, "audio")
    for a in atoms:
        save_atom(a)
    log(path, "audio", "done", len(atoms))


def build_atoms_from_transcript(segs, path, src_type):
    """Режем транскрипт на смысловые атомы по паузам/темам."""
    if not segs:
        return []
    full_text = " ".join(s["text"] for s in segs)
    # один summary-атом на весь файл — тип theory/procedure определяется ниже
    name = Path(path).stem
    atom = {
        "id": uid(path),
        "atom_type": "theory",
        "vehicle": {"make": None, "model": None, "year": None, "generation": None,
                    "engine": None, "body": None},
        "title": name,
        "symptom": None,
        "dtc_codes": [],
        "system": guess_system(full_text, name),
        "content": full_text[:2000],
        "diagnostic_steps": [],
        "root_cause": None,
        "solution": None,
        "parts": [],
        "visual_facts": [],
        "reference_data": {"kind": None},
        "image": None,
        "source": {"file": str(Path(path).relative_to(BASE)), "type": src_type, "locator": "00:00"},
        "confidence": "medium",
        "needs_human_review": True,
        "review_notes": "транскрипт не разбит на кейсы вручную; визуальные факты не извлечены",
    }
    return [atom]


# --------------------------------------------------------------- 2.3 PDF ---

def process_pdf(path):
    try:
        import fitz  # pymupdf
    except ImportError:
        log(path, "pdf", "error", 0, "pymupdf not installed")
        return
    name = Path(path).stem
    raw_dir = RAW_DIR / name
    raw_dir.mkdir(parents=True, exist_ok=True)
    img_dir = raw_dir / "images"
    img_dir.mkdir(exist_ok=True)

    try:
        doc = fitz.open(str(path))
    except Exception as e:
        log(path, "pdf", "error", 0, str(e))
        return

    pages_text = {}
    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        pages_text[i + 1] = text
        # извлечь встроенные изображения
        for img_idx, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            try:
                base_img = doc.extract_image(xref)
                ext = base_img["ext"]
                img_bytes = base_img["image"]
                out_path = img_dir / f"p{i+1:03d}_img{img_idx:02d}.{ext}"
                out_path.write_bytes(img_bytes)
            except Exception:
                pass

    # сохранить текст
    text_path = raw_dir / "text.json"
    text_path.write_text(json.dumps(pages_text, ensure_ascii=False, indent=2), encoding="utf-8")

    # список изображений для последующего просмотра
    images = sorted(img_dir.glob("*"))
    img_list = [str(p.relative_to(BASE)) for p in images]

    # собрать атомы
    atoms = build_atoms_from_pdf(pages_text, img_list, path)
    for a in atoms:
        save_atom(a)
    log(path, "pdf", "done", len(atoms))


def build_atoms_from_pdf(pages_text, img_list, path):
    """Один theory/procedure атом на PDF + reference-атомы для изображений."""
    atoms = []
    name = Path(path).stem
    full_text = "\n".join(f"[p.{p}] {t}" for p, t in pages_text.items() if t)[:4000]

    # основной атом
    atom = {
        "id": uid(path),
        "atom_type": "theory",
        "vehicle": {"make": None, "model": None, "year": None, "generation": None,
                    "engine": None, "body": None},
        "title": name,
        "symptom": None,
        "dtc_codes": [],
        "system": guess_system(full_text, name),
        "content": full_text,
        "diagnostic_steps": [],
        "root_cause": None,
        "solution": None,
        "parts": [],
        "visual_facts": [],
        "reference_data": {"kind": None},
        "image": None,
        "source": {"file": str(Path(path).relative_to(BASE)), "type": "pdf", "locator": "p.1"},
        "confidence": "medium",
        "needs_human_review": True,
        "review_notes": "требует ручного разбиения на кейсы/процедуры; изображения не описаны",
    }
    atoms.append(atom)

    # placeholder-атом на каждое изображение
    for img_path in img_list:
        img_atom = {
            "id": uid(img_path),
            "atom_type": "reference",
            "title": Path(img_path).name,
            "system": guess_system("", Path(img_path).stem),
            "content": None,
            "reference_data": {
                "kind": None,
                "verdict": None,
                "shape_description": None,
            },
            "image": img_path,
            "source": {"file": str(Path(path).relative_to(BASE)), "type": "pdf",
                       "locator": Path(img_path).stem},
            "confidence": "low",
            "needs_human_review": True,
            "review_notes": "изображение не просмотрено агентом; требует описания вручную",
            "vehicle": {"make": None, "model": None, "year": None, "generation": None,
                        "engine": None, "body": None},
            "dtc_codes": [], "parts": [], "diagnostic_steps": [],
            "symptom": None, "root_cause": None, "solution": None,
            "visual_facts": [],
        }
        atoms.append(img_atom)
    return atoms


# ------------------------------------------------------------ 2.4 документы ---

def process_document(path):
    ext = Path(path).suffix.lower()
    text = ""
    try:
        if ext in (".txt", ".md", ".rtf"):
            for enc in ("utf-8", "cp1251", "latin-1"):
                try:
                    text = Path(path).read_text(encoding=enc)
                    break
                except UnicodeDecodeError:
                    continue
        elif ext in (".docx",):
            from docx import Document
            doc = Document(str(path))
            text = "\n".join(p.text for p in doc.paragraphs)
        elif ext in (".doc",):
            # .doc без LibreOffice — попробуем textract или просто пропустим
            try:
                import subprocess
                r = subprocess.run(["antiword", str(path)], capture_output=True, text=True, encoding="utf-8")
                text = r.stdout if r.returncode == 0 else ""
            except Exception:
                text = ""
            if not text:
                log(path, "document", "skipped", 0, ".doc без antiword — нужен LibreOffice/antiword")
                return
        else:
            log(path, "document", "skipped", 0, f"неизвестный формат {ext}")
            return
    except Exception as e:
        log(path, "document", "error", 0, str(e))
        return

    if not text.strip():
        log(path, "document", "skipped", 0, "пустой текст")
        return

    name = Path(path).stem
    atom = {
        "id": uid(path),
        "atom_type": "theory",
        "vehicle": {"make": None, "model": None, "year": None, "generation": None,
                    "engine": None, "body": None},
        "title": name,
        "symptom": None,
        "dtc_codes": [],
        "system": guess_system(text, name),
        "content": text[:3000],
        "diagnostic_steps": [],
        "root_cause": None,
        "solution": None,
        "parts": [],
        "visual_facts": [],
        "reference_data": {"kind": None},
        "image": None,
        "source": {"file": str(Path(path).relative_to(BASE)), "type": "document", "locator": ""},
        "confidence": "medium",
        "needs_human_review": True,
        "review_notes": "требует разбиения на атомы по смыслу",
    }
    save_atom(atom)
    log(path, "document", "done", 1)


# ------------------------------------------------------------ 2.5 изображения ---

def process_image(path):
    name = Path(path).stem
    img_rel = str(Path(path).relative_to(BASE))
    atom = {
        "id": uid(path),
        "atom_type": "reference",
        "vehicle": {"make": None, "model": None, "year": None, "generation": None,
                    "engine": None, "body": None},
        "title": name,
        "symptom": None,
        "dtc_codes": [],
        "system": guess_system("", name),
        "content": None,
        "diagnostic_steps": [],
        "root_cause": None,
        "solution": None,
        "parts": [],
        "visual_facts": [],
        "reference_data": {
            "kind": None,
            "verdict": None,
            "shape_description": None,
        },
        "image": img_rel,
        "source": {"file": img_rel, "type": "image", "locator": name},
        "confidence": "low",
        "needs_human_review": True,
        "review_notes": "изображение требует просмотра агентом для заполнения reference_data",
    }
    save_atom(atom)
    log(path, "image", "done", 1)


# --------------------------------------------------------- 2.6 .md3 декодер ---

def process_md3(path):
    """Запускает decode_md3.py и читает результат из output/oscilloscope/."""
    import subprocess
    r = subprocess.run(
        [sys.executable, str(BASE / "decode_md3.py"), str(path)],
        capture_output=True, text=True, cwd=str(BASE)
    )
    name = Path(path).stem
    json_out = OSC_DIR / (name + ".json")
    if json_out.exists():
        atom = json.loads(json_out.read_text(encoding="utf-8"))
        # добавить полный путь к source
        atom["source"]["file"] = str(Path(path).relative_to(BASE))
        atom.setdefault("vehicle", {"make": None, "model": None, "year": None,
                                    "generation": None, "engine": None, "body": None})
        atom.setdefault("symptom", None)
        atom.setdefault("dtc_codes", [])
        atom.setdefault("diagnostic_steps", [])
        atom.setdefault("root_cause", None)
        atom.setdefault("solution", None)
        atom.setdefault("parts", [])
        atom.setdefault("visual_facts", [])
        atom.setdefault("content", None)
        # метить на человеческий просмотр для описания формы
        atom["needs_human_review"] = True
        atom["review_notes"] = "PNG создан; требует просмотра формы и заполнения shape_description"
        save_atom(atom)
        log(path, "osc_md3", "done", 1)
    else:
        log(path, "osc_md3", "error", 0,
            f"json не создан; stderr: {r.stderr[-200:]}")


# ------------------------------------------------------ 2.7 осц. без декодера ---

def process_osc_other(path):
    ext = Path(path).suffix.lower()
    atom = {
        "id": uid(path),
        "atom_type": "reference",
        "vehicle": {"make": None, "model": None, "year": None, "generation": None,
                    "engine": None, "body": None},
        "title": Path(path).stem,
        "symptom": None,
        "dtc_codes": [],
        "system": guess_system("", Path(path).stem),
        "content": None,
        "diagnostic_steps": [],
        "root_cause": None,
        "solution": None,
        "parts": [],
        "visual_facts": [],
        "reference_data": {
            "kind": "waveform",
            "verdict": label_from_name(Path(path).stem),
            "shape_description": None,
        },
        "image": None,
        "source": {"file": str(Path(path).relative_to(BASE)),
                   "type": f"oscilloscope_{ext[1:]}", "locator": ""},
        "confidence": "low",
        "needs_human_review": True,
        "review_notes": f"Формат {ext} требует экспорта из родного ПО (PNG/CSV); данные не прочитаны",
    }
    save_atom(atom)
    log(path, "osc_other", "done", 1)


# ------------------------------------------------------------------ утилиты --

def guess_system(text, name):
    low = (text + " " + name).lower()
    if any(w in low for w in ["заж", "ign", "свеч", "катуш", "cop", "сор", "зажигани"]):
        return "зажигание"
    if any(w in low for w in ["форс", "injec", "топлив", "давлен", "бензин", "дизель"]):
        return "питание"
    if any(w in low for w in ["питани", "масс", "акб", "заряд", "генер", "батар", "power"]):
        return "питание"
    if any(w in low for w in ["дпкв", "дпрв", "распред", "фаз", "синхр", "маркер"]):
        return "запуск"
    if any(w in low for w in ["старт", "запуск", "прокрутк"]):
        return "запуск"
    if any(w in low for w in ["can", "шина", "протокол", "диагн"]):
        return "CAN-шина"
    if any(w in low for w in ["лямбд", "lambda", "катализ", "выхлоп", "o2"]):
        return "питание"
    if any(w in low for w in ["компрес", "цилиндр", "давлен", "клапан", "кольцо"]):
        return "прочее"
    return "прочее"


def label_from_name(name):
    low = name.lower()
    if any(w in low for w in ["норма", "norm", "испр", "ok", "good"]):
        return "норма"
    elif any(w in low for w in ["неиспр", "fault", "деф", "проблем", "bad", "обрыв"]):
        return "неисправность"
    return "неизвестно"


# ---------------------------------------------------------------- главный цикл --

def collect_files():
    """Рекурсивно собирает все файлы, кроме output/ и самих скриптов."""
    skip_dirs = {"output", "__pycache__"}
    skip_files = {"pipeline.py", "decode_md3.py", "AGENT_INSTRUCTION_RAG.md"}
    result = []
    for root, dirs, files in os.walk(BASE):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for fn in files:
            if fn in skip_files:
                continue
            result.append(Path(root) / fn)
    return result


def main():
    # создать структуру вывода
    for d in [OUT, ATOMS_DIR, RAW_DIR, OSC_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    files = collect_files()
    print(f"Найдено файлов: {len(files)}")

    # счётчики по типам
    type_counts = {}
    for f in files:
        ext = f.suffix.lower().lstrip(".")
        ftype = EXT_MAP.get(ext, "unknown")
        type_counts[ftype] = type_counts.get(ftype, 0) + 1
    print("Распределение:", json.dumps(type_counts, ensure_ascii=False))

    for path in files:
        ext = path.suffix.lower().lstrip(".")
        ftype = EXT_MAP.get(ext, "unknown")

        if ONLY_TYPE and ftype != ONLY_TYPE:
            continue

        try:
            if ftype == "video":
                process_video(path)
            elif ftype == "audio":
                process_audio(path)
            elif ftype == "pdf":
                process_pdf(path)
            elif ftype == "document":
                process_document(path)
            elif ftype == "image":
                process_image(path)
            elif ftype == "osc_md3":
                process_md3(path)
            elif ftype == "osc_other":
                process_osc_other(path)
            else:
                log(path, "unknown", "skipped", 0, f"неизвестное расширение .{ext}")
        except Exception as e:
            log(path, ftype, "error", 0, traceback.format_exc()[-300:])

    # записать atoms.jsonl
    jsonl_path = OUT / "atoms.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as f:
        for a in all_atoms:
            f.write(json.dumps(a, ensure_ascii=False) + "\n")

    # записать manifest.json
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # статистика
    done = sum(1 for m in manifest if m["status"] == "done")
    errors = sum(1 for m in manifest if m["status"] == "error")
    skipped = sum(1 for m in manifest if m["status"] == "skipped")
    print(f"\nГотово: {done} файлов обработано, {errors} ошибок, {skipped} пропущено")
    print(f"Всего атомов: {len(all_atoms)} -> {jsonl_path}")

    # review_report.md
    write_review_report()


def write_review_report():
    lines = ["# Review Report\n",
             f"Сгенерировано: {datetime.datetime.now().isoformat(timespec='seconds')}\n\n"]

    # статистика
    type_stats = {}
    for m in manifest:
        k = m["type"]
        type_stats[k] = type_stats.get(k, {"done": 0, "error": 0, "skipped": 0})
        type_stats[k][m["status"]] = type_stats[k].get(m["status"], 0) + 1

    lines.append("## Статистика по типам файлов\n\n| Тип | done | error | skipped |\n|---|---|---|---|\n")
    for t, s in sorted(type_stats.items()):
        lines.append(f"| {t} | {s.get('done',0)} | {s.get('error',0)} | {s.get('skipped',0)} |\n")

    atom_types = {}
    review_atoms = []
    low_conf_atoms = []
    for a in all_atoms:
        k = a.get("atom_type", "?")
        atom_types[k] = atom_types.get(k, 0) + 1
        if a.get("needs_human_review"):
            review_atoms.append(a)
        if a.get("confidence") == "low":
            low_conf_atoms.append(a)

    lines.append(f"\n**Атомов по типам:** {json.dumps(atom_types, ensure_ascii=False)}\n")
    lines.append(f"**Всего на проверку:** {len(review_atoms)}\n")
    lines.append(f"**Низкая уверенность:** {len(low_conf_atoms)}\n\n")

    lines.append("## Атомы на ручную проверку\n\n")
    for a in review_atoms[:200]:  # первые 200
        lines.append(f"- `{a['id']}` — {a.get('review_notes', '')}\n")

    lines.append("\n## Ошибки обработки\n\n")
    for m in manifest:
        if m["status"] == "error":
            lines.append(f"- `{m['file']}` — {m['error'][:120]}\n")

    (OUT / "review_report.md").write_text("".join(lines), encoding="utf-8")
    print("review_report.md записан")


if __name__ == "__main__":
    main()
