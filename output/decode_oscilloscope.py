#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Декодер осциллограмм семейства OSC (.md3 = OSC v4, .osc = OSC v3) -> PNG + атом.
Файлы .mwf (магия "Mw") и прочие сжаты неизвестно -> логируются как "нужен экспорт".

Запуск:
  python3 decode_oscilloscope.py            # все .md3/.osc/.mwf/.dm2 в папке (рекурсивно)
  python3 decode_oscilloscope.py file.osc   # один файл
Результат -> output/oscilloscope/<имя>.png + .json, atoms.jsonl, need_export.txt

Калибровка в В/мс НЕ выполняется (нет спецификации). Числа — сырые единицы АЦП/отсчёты.
"""
import bz2, struct, json, sys, glob, os, statistics as st
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = os.path.join("output", "oscilloscope")
MAKES = ["Chevrolet","Niva","Nissan","Ford","Opel","Astra","Daewoo","Matiz","Dodge","Suzuki",
         "Volkswagen","Volksvagen","Infiniti","Lada","ВАЗ","ГАЗ","УАЗ","Kia","Hyundai","Toyota",
         "Renault","Peugeot","Mazda","Spectra","Спектра","Хантер","Almera"]

def is_osc(data):  return data[:3] == b"OSC"
def is_mwf(data):  return data[:2] == b"Mw"

def load_osc(path):
    d = open(path, "rb").read()
    meta = {"sample_count": None, "channels": None, "osc_version": d[3] if len(d) > 3 else None}
    h = d.find(b"KPR2")
    if h >= 0:
        f = struct.unpack("<8I", d[h+4:h+4+32]); meta["sample_count"], meta["channels"] = f[0], f[2]
    dec = bz2.decompress(d[d.find(b"BZh"):])
    k = dec.find(b"KDAT")
    body = dec[k+4:]; n = len(body)//2
    s = list(struct.unpack("<%dh" % n, body[:n*2]))
    if not meta["sample_count"]: meta["sample_count"] = n
    if not meta["channels"]: meta["channels"] = 1
    return s, meta

def analyze(s):
    n = len(s); base = int(st.median(s))
    clean = [v if abs(v-base) < 1500 else base for v in s]   # отсечь иглы-маркеры
    dev = [abs(v-base) for v in clean]
    thr = 8
    active = sum(1 for v in dev if v > thr)
    periodic = active > 0.10 * n          # сигнал размазан по записи -> периодика
    pk = max(range(n), key=lambda i: dev[i])
    feats = {"baseline_adc": base, "peak_adc": clean[pk], "peak_amplitude_rel": clean[pk]-base,
             "trough_adc": min(clean), "event_index": pk, "periodic": periodic,
             "units_note": "сырые единицы АЦП/отсчёты; калибровка в В/мс не выполнена"}
    return clean, base, periodic, pk, feats

def render(path, clean, base, periodic, pk, verdict):
    name = os.path.splitext(os.path.basename(path))[0]
    plt.figure(figsize=(12, 4.2))
    if periodic:                                   # периодика -> обзор всей записи (прорежено)
        step = max(1, len(clean)//4000)
        plt.plot(range(0, len(clean), step), clean[::step], lw=0.6, color="#0a4d8c")
        sub = "обзор записи"
    else:                                          # одиночное событие -> окно вокруг пика
        lo, hi = max(pk-6000, 0), min(pk+7000, len(clean))
        plt.plot(range(lo, hi), clean[lo:hi], lw=0.9, color="#0a7d2c")
        sub = "событие"
    plt.axhline(base, color="#888", lw=0.6, ls="--")
    plt.title("%s (%s, метка: %s)" % (name, sub, verdict))
    plt.xlabel("отсчёты"); plt.ylabel("АЦП (база ≈ %d)" % base); plt.grid(alpha=.3)
    plt.tight_layout(); png = os.path.join(OUT, name + ".png")
    plt.savefig(png, dpi=120); plt.close()
    return png

def parse_name(fname, pathparts):
    low = fname.lower()
    txt = " ".join(pathparts + [fname]).lower()
    verdict = ("неисправность" if any(w in low for w in ["неиспр","дефект","fault","обрыв","забит","нет запуск","не завод","позже","раньше","сбит"])
               else "норма" if any(w in low for w in ["норма","norm","исправ","ok"])
               else "неизвестно")
    make = next((m for m in MAKES if m.lower() in txt), None)
    system = ("зажигание" if any(w in txt for w in ["заж","ign","cop","сор","свеч","катуш","parade","первичк","вторичк"])
              else "питание" if any(w in txt for w in ["форсунк","инжект","рхх","дпдз","заслонк","топлив"])
              else "механика/ЦПГ" if any(w in txt for w in ["давлени","цилиндр","коллектор","впускн","фаз","зуб","катализат"])
              else "прочее")
    return verdict, make, system

def build_atom(path, meta, feats, verdict, make, system, png):
    name = os.path.splitext(os.path.basename(path))[0]
    return {
        "id": name, "atom_type": "reference", "title": name, "system": system,
        "vehicle": {"make": make, "model": None, "year": None, "engine": None},
        "reference_data": {"kind": "waveform", "verdict": verdict,
                           "channels": meta.get("channels"), "sample_count": meta.get("sample_count"),
                           "periodic": feats["periodic"], "features": feats,
                           "shape_description": None},   # заполнит агент, посмотрев PNG
        "image": png, "source": {"file": os.path.basename(path), "type": "oscilloscope_osc"},
        "confidence": "medium" if verdict != "неизвестно" else "low",
        "needs_human_review": True,
        "review_notes": "посмотреть PNG и заполнить shape_description"}

def process(path):
    d = open(path, "rb").read()
    if is_mwf(d) or os.path.splitext(path)[1].lower() in (".mwf", ".dm2"):
        return ("export", path)
    if not is_osc(d):
        return ("unknown", path)
    s, meta = load_osc(path)
    clean, base, periodic, pk, feats = analyze(s)
    parts = os.path.normpath(path).split(os.sep)[:-1]
    verdict, make, system = parse_name(os.path.basename(path), parts)
    png = render(path, clean, base, periodic, pk, verdict)
    atom = build_atom(path, meta, feats, verdict, make, system, png)
    json.dump(atom, open(os.path.join(OUT, os.path.splitext(os.path.basename(path))[0]+".json"),
                         "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("OK:", os.path.basename(path), "|", verdict, "| периодика:" , periodic)
    return ("ok", atom)

def main():
    os.makedirs(OUT, exist_ok=True)
    args = sys.argv[1:]
    targets = args or [p for ext in ("md3","osc","mwf","dm2")
                       for p in glob.glob("**/*."+ext, recursive=True)]
    atoms, export, unknown = [], [], []
    for p in targets:
        try:
            kind, res = process(p)
            if kind == "ok": atoms.append(res)
            elif kind == "export": export.append(res)
            else: unknown.append(res)
        except Exception as e:
            print("ОШИБКА:", p, "-", e); unknown.append(p)
    with open(os.path.join(OUT, "atoms.jsonl"), "w", encoding="utf-8") as f:
        for a in atoms: f.write(json.dumps(a, ensure_ascii=False)+"\n")
    if export:
        open(os.path.join(OUT, "need_export.txt"), "w", encoding="utf-8").write(
            "Сжаты неизвестным способом — экспортировать PNG/CSV из родного ПО:\n" + "\n".join(export))
    print(f"\nГотово. Декодировано: {len(atoms)} | на экспорт (.mwf/.dm2): {len(export)} | непонятных: {len(unknown)}")

if __name__ == "__main__":
    main()
