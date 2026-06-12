#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')

ATOMS_FILE = "output/atoms_clean.jsonl"
DTC_RE = re.compile(r'\b([PBCU][0-9]{4})\b', re.IGNORECASE)

atoms = [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]

updated = 0
all_codes = set()
for a in atoms:
    text = ' '.join([
        a.get('title') or '',
        a.get('content') or '',
        str(a.get('reference_data') or {}),
        str(a.get('review_notes') or ''),
    ])
    codes = sorted(set(c.upper() for c in DTC_RE.findall(text)))
    if codes:
        a['dtc'] = codes
        updated += 1
        all_codes.update(codes)
    elif 'dtc' not in a:
        a['dtc'] = []

with open(ATOMS_FILE, 'w', encoding='utf-8') as f:
    for a in atoms:
        f.write(json.dumps(a, ensure_ascii=False) + '\n')

print(f"Обновлено: {updated} атомов с DTC-кодами")
print(f"Всего атомов: {len(atoms)}")
print(f"Уникальных кодов: {len(all_codes)}")
print(f"Коды: {sorted(all_codes)}")
