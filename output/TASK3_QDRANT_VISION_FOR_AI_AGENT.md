# Задание для AI-агента: Qdrant-пилот + зрение

## Жёсткие правила
1. НЕ ВЫДУМЫВАЙ вывод команд — покажи реальный.
2. СНАЧАЛА ПРОВЕРЬ наличие файлов перед использованием.
3. ОСТАНОВИСЬ при ошибках, не продолжай молча.
4. Docker и pip-установку выполняй реально, не симулируй.

---

## Часть A. Поднять Qdrant + загрузить атомы

### A.1 Проверить что atoms_clean.jsonl существует

```bash
ls -la output/atoms_clean.jsonl || echo "❌ СТОП: atoms_clean.jsonl не найден"
python3 -c "
import json
atoms=[json.loads(l) for l in open('output/atoms_clean.jsonl')]
final_good=[a for a in atoms if a.get('stage')=='final' and a.get('confidence') in ('high','medium') and not a.get('needs_human_review')]
print(f'Всего: {len(atoms)}, для загрузки: {len(final_good)}')
"
```

**Если для загрузки < 10 — СТОП, база слишком мала для пилота.**

### A.2 Установить зависимости

```bash
pip install "qdrant-client[fastembed]" --break-system-packages
```

**Покажи вывод. Если ошибка — СТОП.**

### A.3 Запустить Qdrant в Docker

```bash
# Проверь Docker
docker --version || echo "❌ Docker не установлен — СТОП"

# Запусти Qdrant (если уже запущен — пропусти)
docker run -d --name qdrant -p 6333:6333 -v $(pwd)/qdrant_data:/qdrant/storage qdrant/qdrant 2>/dev/null || echo "Контейнер уже существует, проверяю..."
docker start qdrant 2>/dev/null

# Проверь доступность
sleep 3
curl -s http://localhost:6333/ | head -5 || echo "❌ Qdrant не отвечает — СТОП"
```

### A.4 Загрузить атомы

```bash
python3 qdrant_pilot.py load
```

**Покажи ПОЛНЫЙ вывод. Ожидается:**
- `Загружено N атомов` где N > 30
- Статистика коллекции

### A.5 Тестовые запросы

```bash
python3 qdrant_pilot.py test
```

**Покажи ПОЛНЫЙ вывод всех 10 запросов.** Это самая важная часть — по ней мы увидим, работает ли гибридный поиск.

---

## Часть B. Зрение (запуск после Qdrant)

### B.1 Проверка: сколько картинок нужно обработать

```bash
python3 vision_pass.py --dry-run
```

**Покажи вывод.** Ожидается список атомов с ✅/❌ по наличию файлов картинок.

### B.2 Тестовый запуск зрения (5 картинок)

Перед массовым запуском — проверь на 5 картинках:

```bash
# Убедись что API-ключ задан (или вписан в скрипт)
# Для Claude: export ANTHROPIC_API_KEY="sk-..."
# Для OpenAI: export OPENAI_API_KEY="sk-..."

python3 vision_pass.py --limit 5
```

**Покажи ПОЛНЫЙ вывод.** Если 5 из 5 ✅ — запусти полный прогон:

```bash
python3 vision_pass.py
```

### B.3 Перезагрузка в Qdrant с обновлёнными описаниями

После зрения атомы обновились — перезагрузи:

```bash
python3 qdrant_pilot.py load
python3 qdrant_pilot.py test
```

---

## Часть C. Итоговый отчёт

Сохрани в `output/QDRANT_PILOT_REPORT.md`:

```markdown
# Отчёт: Qdrant-пилот

## Загрузка
- Атомов загружено: ...
- Время загрузки: ~...

## Тестовые запросы (ВСТАВЬ ВСЕ 10 РЕЗУЛЬТАТОВ)
<полный вывод python3 qdrant_pilot.py test>

## Зрение
- Картинок обработано: ...
- Ошибок: ...
- Обновлённых shape_description: ...

## Оценка качества поиска (ТВОЁ мнение)
- Какие запросы нашли релевантные результаты?
- Какие запросы промахнулись?
- Где sparse помог (коды, конкретные термины)?
- Где dense помог (семантика, похожий симптом)?

## Проблемы
(если были)
```

**Задание завершено.**
