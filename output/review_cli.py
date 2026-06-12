#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review_cli.py — быстрое ревью атомов в терминале.

Управление:
  A / Enter — одобрить (confidence=high, needs_human_review=False)
  E         — редактировать заголовок
  S         — пропустить (оставить как есть)
  D         — удалить атом
  Q         — выйти и сохранить прогресс

Запуск:
  python output/review_cli.py                   # все нуждающиеся в ревью
  python output/review_cli.py --type case        # только кейсы
  python output/review_cli.py --system зажигание
  python output/review_cli.py --limit 20         # первые 20
"""

import json, os, sys, argparse, re
sys.stdout.reconfigure(encoding='utf-8')

ATOMS_FILE = "output/atoms_clean.jsonl"

def load_atoms():
    return [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]

def save_atoms(atoms):
    with open(ATOMS_FILE, 'w', encoding='utf-8') as f:
        for a in atoms:
            f.write(json.dumps(a, ensure_ascii=False) + '\n')

def clear():
    os.system('cls' if os.name == 'nt' else 'clear')

def wrap(text, width=90):
    words = text.split()
    lines, line = [], []
    for w in words:
        if sum(len(x)+1 for x in line) + len(w) > width:
            lines.append(' '.join(line))
            line = [w]
        else:
            line.append(w)
    if line:
        lines.append(' '.join(line))
    return '\n'.join(lines)

def show_atom(atom, idx, total):
    clear()
    atype   = atom.get('atom_type', '?')
    system  = atom.get('system', '?')
    conf    = atom.get('confidence', '?')
    title   = atom.get('title', '')
    content = atom.get('content', '')
    vehicle = atom.get('vehicle') or ''
    symptoms = atom.get('symptoms') or []
    verdict  = atom.get('verdict', '')
    source   = atom.get('source', {}).get('locator', '')

    type_color = {'case': '🔴', 'theory': '🔵', 'procedure': '🟢', 'reference': '🟡'}.get(atype, '⚪')

    print(f"{'─'*92}")
    print(f"  [{idx}/{total}]  {type_color} {atype.upper():10}  │  {system:20}  │  conf: {conf}")
    print(f"{'─'*92}")
    print(f"  📌 {title}")
    if vehicle:
        print(f"  🚗 {vehicle}")
    if symptoms:
        print(f"  ⚡ Симптомы: {', '.join(symptoms[:3])}")
    if verdict and verdict != 'неизвестно':
        print(f"  📋 Вердикт: {verdict}")
    print(f"{'─'*92}")
    print(wrap(content[:600]))
    if len(content) > 600:
        print(f"  ... [{len(content)} символов всего]")
    print(f"{'─'*92}")
    print(f"  Источник: {str(source)[:80]}")
    print(f"{'─'*92}")
    print()
    print("  [A/Enter] Одобрить  [E] Редактировать  [S] Пропустить  [D] Удалить  [Q] Выйти")
    print()

def get_key():
    try:
        import msvcrt
        ch = msvcrt.getwch()
        return ch.lower()
    except ImportError:
        import tty, termios
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            return sys.stdin.read(1).lower()
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--type',   default='', help='Фильтр по atom_type (case/theory/procedure)')
    parser.add_argument('--system', default='', help='Фильтр по system')
    parser.add_argument('--limit',  type=int, default=0, help='Максимум атомов')
    parser.add_argument('--all',    action='store_true', help='Включая уже одобренные')
    args = parser.parse_args()

    atoms = load_atoms()
    atom_map = {a['id']: i for i, a in enumerate(atoms)}

    # Фильтр кандидатов
    candidates = []
    for a in atoms:
        if not args.all and not a.get('needs_human_review'):
            continue
        if args.type and a.get('atom_type') != args.type:
            continue
        if args.system and args.system.lower() not in (a.get('system') or '').lower():
            continue
        candidates.append(a['id'])

    if args.limit:
        candidates = candidates[:args.limit]

    total = len(candidates)
    if total == 0:
        print("Нет атомов для ревью.")
        return

    approved = deleted = skipped = edited = 0

    for idx, aid in enumerate(candidates, 1):
        if aid not in atom_map:
            continue
        atom = atoms[atom_map[aid]]
        show_atom(atom, idx, total)

        key = get_key()

        if key in ('a', '\r', '\n', ' '):
            atom['confidence'] = 'high'
            atom['needs_human_review'] = False
            approved += 1
            print(f"\r  ✅ Одобрен                                    ", end='')

        elif key == 'e':
            print(f"\r  📝 Новый заголовок: ", end='')
            sys.stdout.flush()
            new_title = input()
            if new_title.strip():
                atom['title'] = new_title.strip()
                atom['confidence'] = 'high'
                atom['needs_human_review'] = False
                edited += 1
                print(f"  ✅ Сохранён: {atom['title'][:60]}")
            else:
                skipped += 1
                print("  ⏭  Пропущен (пустой заголовок)")

        elif key == 'd':
            print(f"\r  🗑  Удалён: {atom['title'][:60]}          ")
            atoms[atom_map[aid]] = None
            deleted += 1

        elif key == 'q':
            print("\r  👋 Выход...                                    ")
            break

        else:  # s или любая другая клавиша
            skipped += 1
            print(f"\r  ⏭  Пропущен                                   ", end='')

        # Сохраняем после каждого действия
        atoms_clean = [a for a in atoms if a is not None]
        save_atoms(atoms_clean)
        # Обновляем map после удалений
        atom_map = {a['id']: i for i, a in enumerate(atoms_clean)}
        atoms = atoms_clean

        import time; time.sleep(0.3)

    clear()
    print(f"\n{'═'*50}")
    print(f"  ИТОГ РЕВЬЮ")
    print(f"{'═'*50}")
    print(f"  ✅ Одобрено:     {approved}")
    print(f"  📝 Отредактировано: {edited}")
    print(f"  ⏭  Пропущено:    {skipped}")
    print(f"  🗑  Удалено:      {deleted}")
    print(f"{'═'*50}")
    remaining = sum(1 for a in atoms if a and a.get('needs_human_review'))
    print(f"  Осталось на ревью: {remaining}")
    print()

if __name__ == "__main__":
    main()
