#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Декодер осциллограмм MotoDoc III (.md3) -> чистый PNG + reference-атом для RAG.

Что делает:
  1. Распаковывает тело файла (bzip2) и извлекает поток отсчётов int16 после метки KDAT.
  2. Читает из заголовка (поле KPR2) число отсчётов и каналов.
  3. Отсекает одиночные иглы-маркеры синхронизации.
  4. Находит событие (центрируется на игле пробоя) и рисует чистую осциллограмму.
  5. Извлекает структурные признаки и собирает атом знаний (atom_type=reference).
  6. Метку (норма/неисправность) и подсказки по авто/системе берёт из ИМЕНИ ФАЙЛА.

ВАЖНО про калибровку:
  Значения выводятся в СЫРЫХ единицах АЦП и в ОТНОСИТЕЛЬНЫХ величинах.
  Перевод в вольты/миллисекунды требует калибровки прибора (масштаб и частота
  дискретизации), которой нет в открытом виде. Поэтому числовые признаки тут —
  для сравнения формы, а НЕ абсолютные физические значения. Не выдавай их боту
  как «X вольт / Y мс» без калибровки.

Запуск:
  python3 decode_md3.py                 # обработать все *.md3 в текущей папке
  python3 decode_md3.py file.md3        # обработать один файл
Результат -> ./output/oscilloscope/<имя>.png и <имя>.json
"""

import bz2, struct, json, sys, glob, os, statistics as st

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = os.path.join("output", "oscilloscope")
MARKER_DELTA = 1500   # отклонение от базы, выше которого точка считается маркером
EVENT_HALF_L = 6000   # отсчётов слева от иглы пробоя в окне отрисовки
EVENT_HALF_R = 7000   # отсчётов справа


def load_md3(path):
    """Возвращает (samples:list[int], meta:dict)."""
    data = open(path, "rb").read()

    # --- метаданные из заголовка (поле KPR2: sample_count, ?, channels, ...) ---
    meta = {"sample_count": None, "channels": None}
    h = data.find(b"KPR2")
    if h >= 0:
        f = struct.unpack("<8I", data[h + 4:h + 4 + 32])
        meta["sample_count"] = f[0]
        meta["channels"] = f[2]

    # --- распаковка тела (bzip2) и поток отсчётов после KDAT ---
    bz = data.find(b"BZh")
    if bz < 0:
        raise ValueError("Не найдено bzip2-тело (BZh). Возможно, другой формат .md3.")
    dec = bz2.decompress(data[bz:])
    k = dec.find(b"KDAT")
    if k < 0:
        raise ValueError("Не найдена метка KDAT в распакованных данных.")
    body = dec[k + 4:]
    n = len(body) // 2
    samples = list(struct.unpack("<%dh" % n, body[:n * 2]))
    if not meta["sample_count"]:
        meta["sample_count"] = n
    if not meta["channels"]:
        meta["channels"] = 1
    return samples, meta


def clean_markers(s, base):
    """Заменяет точки дальше base±MARKER_DELTA на базовую линию (убирает иглы-маркеры)."""
    return [v if abs(v - base) < MARKER_DELTA else base for v in s]


def extract(samples):
    """Возвращает (окно_для_рисунка, признаки)."""
    n = len(samples)
    base = int(st.median(samples))
    clean = clean_markers(samples, base)

    # игла пробоя = максимальное отклонение от базы
    pk_i = max(range(n), key=lambda i: abs(clean[i] - base))
    lo = max(pk_i - EVENT_HALF_L, 0)
    hi = min(pk_i + EVENT_HALF_R, n)
    win = clean[lo:hi]

    peak = max(win)
    trough = min(win)
    # грубая длительность горения: от иглы до возврата к базе (в ОТСЧЁТАХ, не мс)
    burn = 0
    for i in range(pk_i, hi):
        if abs(clean[i] - base) < 8:
            burn = i - pk_i
            break

    feats = {
        "baseline_adc": base,
        "turnoff_peak_adc": peak,
        "peak_amplitude_rel": peak - base,      # относительная высота иглы пробоя
        "dwell_trough_adc": trough,
        "event_index": pk_i,
        "burn_len_samples": burn,               # длительность горения в ОТСЧЁТАХ
        "units_note": "сырые единицы АЦП / отсчёты; калибровка в В/мс не выполнена",
    }
    return (lo, hi, clean), feats


def label_from_name(fname):
    """Грубая разметка из имени файла."""
    low = fname.lower()
    if any(w in low for w in ["норма", "norm", "испр", "ok", "good"]):
        verdict = "норма"
    elif any(w in low for w in ["неиспр", "fault", "деф", "проблем", "bad", "обрыв", "проб"]):
        verdict = "неисправность"
    else:
        verdict = "неизвестно"
    system = "зажигание" if any(w in low for w in
                                ["ign", "заж", "cop", "сор", "первичк", "вторичк", "катуш"]) else "прочее"
    return verdict, system


def render(path, window, feats, verdict):
    lo, hi, clean = window
    name = os.path.splitext(os.path.basename(path))[0]
    plt.figure(figsize=(12, 4.5))
    plt.plot(range(lo, hi), clean[lo:hi], lw=0.9, color="#0a7d2c")
    plt.axhline(feats["baseline_adc"], color="#888", lw=0.6, ls="--")
    plt.title("%s  (декодировано из .md3, метка: %s)" % (name, verdict))
    plt.xlabel("отсчёты")
    plt.ylabel("АЦП (база ≈ %d)" % feats["baseline_adc"])
    plt.grid(alpha=0.3)
    plt.tight_layout()
    png = os.path.join(OUT_DIR, name + ".png")
    plt.savefig(png, dpi=120)
    plt.close()
    return png


def build_atom(path, meta, feats, verdict, system, png):
    name = os.path.splitext(os.path.basename(path))[0]
    return {
        "id": name,
        "atom_type": "reference",
        "title": name,
        "system": system,
        "reference_data": {
            "kind": "waveform",
            "verdict": verdict,                      # норма / неисправность / неизвестно
            "channels": meta.get("channels"),
            "sample_count": meta.get("sample_count"),
            "features": feats,
        },
        "image": png,                                # картинку отдать в зрение для описания формы
        "source": {"file": os.path.basename(path), "type": "oscilloscope_md3"},
        "confidence": "medium" if verdict != "неизвестно" else "low",
        "needs_human_review": verdict == "неизвестно",
        "review_notes": "проверить метку и форму вручную" if verdict == "неизвестно" else "",
    }


def process(path):
    samples, meta = load_md3(path)
    window, feats = extract(samples)
    verdict, system = label_from_name(os.path.basename(path))
    png = render(path, window, feats, verdict)
    atom = build_atom(path, meta, feats, verdict, system, png)
    jpath = os.path.join(OUT_DIR, os.path.splitext(os.path.basename(path))[0] + ".json")
    json.dump(atom, open(jpath, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("OK:", path, "->", png, "|", verdict)
    return atom


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    targets = sys.argv[1:] or sorted(glob.glob("*.md3"))
    if not targets:
        print("Не найдено .md3 файлов.")
        return
    atoms = []
    for p in targets:
        try:
            atoms.append(process(p))
        except Exception as e:
            print("ОШИБКА:", p, "-", e)
    # общий jsonl для загрузки в RAG
    with open(os.path.join(OUT_DIR, "atoms.jsonl"), "w", encoding="utf-8") as f:
        for a in atoms:
            f.write(json.dumps(a, ensure_ascii=False) + "\n")
    print("Готово. Атомов:", len(atoms), "->", OUT_DIR)


if __name__ == "__main__":
    main()
