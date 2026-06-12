#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_atoms.py — LLM-аудит атомов: оценка качества + нормализация vehicle-поля.

Для каждого кейс-атома LLM:
  1. Оценивает качество (GOOD / NEEDS_FIX / DELETE)
  2. Исправляет title и system если нужно
  3. Извлекает структурированные данные об автомобиле:
     make, model, year_from, year_to, engine, symptoms нормализованные

Запуск:
  python output/audit_atoms.py                  # все case-атомы
  python output/audit_atoms.py --type theory
  python output/audit_atoms.py --limit 5        # тест
"""

import json, os, re, sys, time, requests, argparse
sys.stdout.reconfigure(encoding='utf-8')

OR_KEY   = os.environ.get("OPENROUTER_API_KEY", "")
OR_MODEL = "google/gemini-2.5-flash"
OR_URL   = "https://openrouter.ai/api/v1/chat/completions"
ATOMS_FILE = "output/atoms_clean.jsonl"
LOG_FILE   = "output/audit_atoms.log"

AUDIT_PROMPT = """\
Ты — эксперт-аудитор базы знаний по диагностике автомобилей.

Оцени этот атом знаний и верни результат в JSON.

АТОМ:
id: {id}
atom_type: {atom_type}
title: {title}
system: {system}
vehicle: {vehicle}
symptoms: {symptoms}
content: {content}

ЗАДАЧА:
1. Оцени качество атома
2. Исправь title если он неточный или слишком общий
3. Исправь system если неверно определена
4. Извлеки и нормализуй данные об автомобиле из content и vehicle
5. Нормализуй список симптомов (3-5 коротких фраз)

Верни ТОЛЬКО JSON (без markdown):
{{
  "quality": "GOOD|NEEDS_FIX|DELETE",
  "quality_reason": "одна фраза почему",
  "title": "исправленный или исходный заголовок (до 80 символов)",
  "system": "зажигание|питание|механика/ЦПГ|фазы ГРМ|датчики|электросхемы|прочее|общее",
  "vehicle": {{
    "make": "марка или null",
    "model": "модель или null",
    "year_from": год_число_или_null,
    "year_to": год_число_или_null,
    "engine": "объём/тип двигателя или null"
  }},
  "symptoms": ["симптом 1", "симптом 2"],
  "verdict": "норма|неисправность|неизвестно"
}}

Правила качества:
- GOOD: содержательный текст, конкретная проблема/решение, всё понятно
- NEEDS_FIX: хороший контент но неточный заголовок/система/отсутствует vehicle
- DELETE: слишком общо, нет конкретики, дублирует другой атом, пустой/бессмысленный
"""

def load_atoms():
    return [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]

def save_atoms(atoms):
    with open(ATOMS_FILE, 'w', encoding='utf-8') as f:
        for a in atoms:
            f.write(json.dumps(a, ensure_ascii=False) + '\n')

def call_llm(prompt):
    body = json.dumps({
        "model": OR_MODEL,
        "max_tokens": 1000,
        "temperature": 0.1,
        "messages": [{"role": "user", "content": prompt}]
    }).encode('utf-8')
    for attempt in range(1, 4):
        try:
            resp = requests.post(OR_URL, data=body, headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OR_KEY}",
                "HTTP-Referer": "http://localhost",
                "X-Title": "AutoDiag-Audit"
            }, timeout=60)
            if resp.status_code == 200:
                raw = resp.json()["choices"][0]["message"]["content"].strip()
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```$', '', raw)
                return json.loads(raw)
            elif resp.status_code == 429:
                time.sleep(30)
            else:
                raise Exception(f"HTTP {resp.status_code}: {resp.text[:200]}")
        except (requests.exceptions.ConnectionError, json.JSONDecodeError) as e:
            if attempt < 3:
                time.sleep(10)
            else:
                raise
    raise Exception("Все попытки провалились")

def apply_audit(atom, result):
    """Применяет результат аудита к атому."""
    atom['title']   = result.get('title', atom['title'])
    atom['system']  = result.get('system', atom['system'])
    atom['verdict'] = result.get('verdict', atom.get('verdict', 'неизвестно'))

    # Нормализуем vehicle в структурированный dict
    v = result.get('vehicle', {})
    if v and any(v.get(k) for k in ('make', 'model', 'year_from', 'engine')):
        atom['vehicle'] = {k: v.get(k) for k in ('make', 'model', 'year_from', 'year_to', 'engine') if v.get(k)}

    # Симптомы
    if result.get('symptoms'):
        atom['symptoms'] = result['symptoms']

    # Если качество хорошее — снимаем флаг ревью
    quality = result.get('quality', 'NEEDS_FIX')
    if quality == 'GOOD':
        atom['confidence'] = 'high'
        atom['needs_human_review'] = False
    elif quality == 'NEEDS_FIX':
        atom['confidence'] = 'medium'
        atom['needs_human_review'] = True
        atom['review_notes'] = result.get('quality_reason', '')
    # DELETE — помечаем, но не удаляем сразу (покажем в отчёте)
    atom['_audit_quality'] = quality

    return atom

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--type',   default='case', help='atom_type для аудита (default: case)')
    parser.add_argument('--system', default='',     help='Фильтр по system')
    parser.add_argument('--limit',  type=int, default=0)
    parser.add_argument('--all',    action='store_true', help='Включая уже одобренные')
    args = parser.parse_args()

    log = open(LOG_FILE, 'a', encoding='utf-8')
    def lp(msg): print(msg, flush=True); log.write(msg + '\n'); log.flush()

    lp(f"\n=== audit_atoms: {time.strftime('%Y-%m-%d %H:%M:%S')} | type={args.type} ===")

    atoms = load_atoms()
    atom_map = {a['id']: i for i, a in enumerate(atoms)}

    candidates = [a for a in atoms
                  if a.get('atom_type') == args.type
                  and (args.all or a.get('needs_human_review'))
                  and (not args.system or args.system.lower() in (a.get('system') or '').lower())]

    if args.limit:
        candidates = candidates[:args.limit]

    total = len(candidates)
    lp(f"Атомов для аудита: {total}")

    stats = {'GOOD': 0, 'NEEDS_FIX': 0, 'DELETE': 0, 'ERROR': 0}
    to_delete = []

    for i, atom in enumerate(candidates, 1):
        aid = atom['id']
        lp(f"\n[{i}/{total}] {aid[:55]}")
        lp(f"  title: {atom.get('title','')[:60]}")

        prompt = AUDIT_PROMPT.format(
            id       = aid,
            atom_type= atom.get('atom_type', ''),
            title    = atom.get('title', ''),
            system   = atom.get('system', ''),
            vehicle  = json.dumps(atom.get('vehicle') or '', ensure_ascii=False),
            symptoms = json.dumps(atom.get('symptoms') or [], ensure_ascii=False),
            content  = (atom.get('content') or '')[:1500],
        )

        try:
            result = call_llm(prompt)
            quality = result.get('quality', '?')
            stats[quality] = stats.get(quality, 0) + 1

            lp(f"  → {quality}: {result.get('quality_reason','')[:70]}")
            if result.get('title') != atom.get('title'):
                lp(f"  title: «{atom.get('title','')[:50]}» → «{result['title'][:50]}»")
            v = result.get('vehicle', {})
            if v and any(v.get(k) for k in ('make', 'model')):
                lp(f"  vehicle: {v.get('make','')} {v.get('model','')} {v.get('year_from') or ''} {v.get('engine') or ''}")

            apply_audit(atoms[atom_map[aid]], result)

            if quality == 'DELETE':
                to_delete.append(aid)

            # Сохраняем после каждого атома
            save_atoms(atoms)

        except Exception as e:
            lp(f"  ОШИБКА: {e}")
            stats['ERROR'] = stats.get('ERROR', 0) + 1

        time.sleep(0.5)

    lp(f"\n{'='*60}")
    lp(f"ИТОГ АУДИТА ({args.type}):")
    lp(f"  ✅ GOOD:      {stats.get('GOOD', 0)}")
    lp(f"  🔧 NEEDS_FIX: {stats.get('NEEDS_FIX', 0)}")
    lp(f"  🗑  DELETE:    {stats.get('DELETE', 0)}")
    lp(f"  ❌ ОШИБКИ:    {stats.get('ERROR', 0)}")
    lp(f"{'='*60}")

    if to_delete:
        lp(f"\nАтомы помечены на удаление (_audit_quality=DELETE):")
        for aid in to_delete:
            title = atoms[atom_map[aid]].get('title', '')
            lp(f"  - {aid[:50]} | {title[:50]}")
        lp(f"\nЧтобы удалить их:")
        lp(f"  python output/audit_atoms.py --purge-deleted")

    # Статистика vehicle нормализации
    case_atoms = [a for a in atoms if a.get('atom_type') == 'case']
    with_vehicle = sum(1 for a in case_atoms if a.get('vehicle') and
                       isinstance(a.get('vehicle'), dict) and a['vehicle'].get('make'))
    lp(f"\nCASE-атомов с нормализованным vehicle: {with_vehicle}/{len(case_atoms)}")
    log.close()


if __name__ == "__main__":
    # Специальный режим удаления помеченных атомов
    if '--purge-deleted' in sys.argv:
        atoms = load_atoms()
        before = len(atoms)
        atoms = [a for a in atoms if a.get('_audit_quality') != 'DELETE']
        # Чистим служебное поле
        for a in atoms:
            a.pop('_audit_quality', None)
        save_atoms(atoms)
        print(f"Удалено: {before - len(atoms)} атомов. Осталось: {len(atoms)}")
    else:
        main()
