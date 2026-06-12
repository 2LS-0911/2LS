#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, json, time, re, requests
from bs4 import BeautifulSoup
sys.stdout.reconfigure(encoding='utf-8')

OR_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OR_MODEL = "google/gemini-2.5-flash"
OR_URL = "https://openrouter.ai/api/v1/chat/completions"
ATOMS_FILE = r"output\atoms_clean.jsonl"

PROMPT = """\
Ты — эксперт по диагностике автомобилей. Дана статья (кейс) с портала по автодиагностике.
Твоя задача извлечь из неё подробный атомарный кейс для базы знаний AI-ассистента автосервиса.

ВАЖНО: Наше приложение должно предоставлять диагносту полную картину. Поэтому извлеки максимально точные данные для заказ-наряда и пошагового алгоритма.

Верни ТОЛЬКО валидный JSON-массив с одним или несколькими кейсами (без markdown):
[
  {{
    "atom_type": "case",
    "title": "Краткая суть поломки (до 80 символов)",
    "vehicle": "Марка Модель (Двигатель, Год) - если есть",
    "symptoms": ["симптом 1", "симптом 2"],
    "diagnostic_sequence": ["Шаг 1: Подключение сканера...", "Шаг 2: Замер осциллографом..."],
    "tools_needed": ["Инструмент 1", "Инструмент 2"],
    "parts_needed": ["Запчасть 1"],
    "dtc": ["P0300", "P0171"],
    "verdict": "Истинная причина неисправности",
    "content": "Подробный осмысленный пересказ кейса (200-500 слов). Опиши логику поиска неисправности."
  }}
]

ТЕКСТ СТАТЬИ "{title}":
{text}
"""

def load_atoms():
    if not os.path.exists(ATOMS_FILE): return []
    return [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]

def get_all_article_links():
    sections = [
        "https://autodata.ru/article/praktika_remonta/",
        "https://autodata.ru/article/elektrika/",
        "https://autodata.ru/article/diagnostika/"
    ]
    links = []
    headers = {"User-Agent": "Mozilla/5.0"}
    
    print("Собираем базу ссылок (Bitrix SHOWALL)...")
    for sec in sections:
        for suffix in ["?SHOWALL_1=1", "?SHOWALL_2=1"]:
            url = sec + suffix
            try:
                r = requests.get(url, headers=headers, timeout=10)
                if r.status_code != 200: continue
                soup = BeautifulSoup(r.text, 'lxml')
                
                for a in soup.find_all('a'):
                    href = a.get('href')
                    if href and href.startswith(sec.replace("https://autodata.ru", "")) and len(href.split('/')) > 4 and 'PAGEN' not in href and 'SHOWALL' not in href:
                        full_url = "https://autodata.ru" + href
                        if full_url not in links:
                            links.append(full_url)
                time.sleep(1)
            except Exception as e:
                print(f"Ошибка получения {url}: {e}")
                
    return list(set(links))

def parse_article(url):
    headers = {"User-Agent": "Mozilla/5.0"}
    r = requests.get(url, headers=headers, timeout=15)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'lxml')
    
    title_el = soup.select_one('h1')
    title = title_el.text.strip() if title_el else "Без названия"
    
    content_div = soup.select_one('div.news-detail') or soup.select_one('div.detail_text') or soup.select_one('div.main-content')
    if content_div:
        text = content_div.get_text(separator=' ', strip=True)
    else:
        text = " ".join([p.text for p in soup.find_all('p')])
        
    return title, text

def llm_extract(title, text):
    prompt = PROMPT.format(title=title, text=text[:30000])
    body = json.dumps({
        "model": OR_MODEL,
        "temperature": 0.1,
        "messages": [{"role": "user", "content": prompt}]
    }).encode('utf-8')
    
    req = requests.post(OR_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OR_KEY}",
        "HTTP-Referer": "http://localhost",
        "X-Title": "AutoDiag-MassParser"
    }, timeout=60)
    
    if req.status_code == 402 or "insufficient_quota" in req.text:
        print("\n!!! ВНИМАНИЕ: БАЛАНС OPENROUTER ИСЧЕРПАН !!!")
        print("Скрипт безопасно останавливает работу. Прогресс сохранен.")
        sys.exit(0) # Безопасный выход без ошибки
        
    req.raise_for_status()
    raw = req.json()["choices"][0]["message"]["content"].strip()
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    return json.loads(raw)

def main():
    print("=== Массовый сбор кейсов Autodata ===")
    atoms = load_atoms()
    existing_urls = {a.get('source', {}).get('file') for a in atoms if a.get('source')}
    print(f"Уже в базе: {len(existing_urls)} файлов")
    
    links = get_all_article_links()
    print(f"\nВсего ссылок для парсинга: {len(links)}")
    
    processed = 0
    with open(ATOMS_FILE, 'a', encoding='utf-8') as f_out:
        for url in links:
            if url in existing_urls:
                continue
                
            print(f"\n[{processed+1}] Скачиваем: {url}")
            try:
                title, text = parse_article(url)
                if len(text) < 500:
                    print(" Слишком короткий текст, пропускаем.")
                    # Записываем пустышку, чтобы больше не парсить этот url
                    existing_urls.add(url)
                    continue
                    
                print(" Извлечение AI-структуры (ждем ответа LLM)...")
                cases = llm_extract(title, text)
                
                if isinstance(cases, dict): cases = [cases]
                elif not isinstance(cases, list): cases = []
                
                added = 0
                for i, c in enumerate(cases):
                    if not isinstance(c, dict): continue
                    atom_id = "ad_" + re.sub(r'[^a-zA-Z0-9]', '', url.split('/')[-2])[:20] + f"_{i}"
                    c['id'] = atom_id
                    c['source'] = {'file': url, 'locator': 'autodata'}
                    c['system'] = 'общее'
                    c['stage'] = 'final'
                    c['confidence'] = 'high'
                    
                    f_out.write(json.dumps(c, ensure_ascii=False) + '\n')
                    added += 1
                
                f_out.flush()
                processed += 1
                print(f" ✅ Готово! Создано атомов: {added}. Всего обработано статей: {processed}")
                existing_urls.add(url) # Запоминаем
                time.sleep(1.5)
                
            except Exception as e:
                print(f" ❌ Ошибка {url}: {e}")

    print(f"\n=== ИТОГ: Новых статей обработано: {processed} ===")

if __name__ == "__main__":
    main()
