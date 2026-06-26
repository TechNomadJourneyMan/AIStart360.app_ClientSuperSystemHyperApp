# 08 — Cost Optimization Playbook

## Бюджет (целевой)

| Объём | AI-стоимость / месяц | Стек |
|-------|----------------------|------|
| MVP (100K вызовов) | < $20 | Gemini Flash 8B (free-tier) + кэш |
| Phase 2 (1M вызовов) | < $150 | Микс Flash 8B / Flash / DeepSeek + semantic cache |
| Phase 3 (10M вызовов) | < $1000 | + batch-обработка + локальные embeddings |
| Phase 4 (50M+) | < $3000 | + collective fine-tune + selective local GPU |

Без оптимизации те же объёмы стоили бы в 5–15 раз больше.

## Семь уровней оптимизации

### 1. Не делать AI-вызов вообще

- **Rule-based first.** Для знакомых источников — CSS-парсер, не LLM. Сэкономит 60–80% extraction-вызовов.
- **Heuristics first.** Industry classification по ключевым словам + ОКЭД-словарю → LLM только если не определилось.
- **Раннее завершение.** Если confidence уже > 0.95 без AI — не зовём.

### 2. Cache, cache, cache

#### Key cache (точный)
- Ключ: `sha256(model:str + prompt:str + temperature:float + max_tokens:int)`
- Хранилище: Redis с TTL из `RoutePolicy`
- Ожидаемый hit rate: **35–45%** на стационарном workload (re-extract тех же URL)

#### Semantic cache
- Embedding запроса → поиск в Redis Vector / Qdrant с `cosine > 0.97`
- Если найден — возвращаем сохранённый ответ
- Hit rate: дополнительно **10–20%** на free-form задачах
- **Когда не использовать**: PII в промпте, `temperature > 0.3`, structured output с критичной точностью

#### HTTP-level cache
- Для повторных запросов с одинаковым `Idempotency-Key` от фронта — кэш ответа на 5 мин (для дорогих эндпоинтов типа `/summary`)

### 3. Правильная модель под задачу

- **8B-модели** (Gemini Flash 8B, Phi-4, Gemma) для:
  - бинарных решений (relevant/not, same/different)
  - извлечения 1–2 полей
  - классификации с фиксированным набором классов
- **Mid-tier** (Gemini Flash, DeepSeek V3.1, Qwen 32B) для:
  - extraction со схемой 5–15 полей
  - суммаризации 1–3 параграфов
  - tagging
- **Pro/Premium** (Gemini Pro, Claude Sonnet, DeepSeek R1) **только** для:
  - reasoning по графу
  - аналитических отчётов
  - long-context (> 32k токенов)

Каждое использование Pro-модели — записывается в `ai_call_log.tier='premium'`, дашборд считает share. Цель: **< 5%** запросов через premium.

### 4. Prompt compression

- **Удаление шума.** Перед отправкой в LLM прогнать HTML через `readability-lxml` или `trafilatura` — сэкономит 70–90% токенов.
- **System prompt в кэш.** OpenRouter поддерживает prompt caching — выносим стабильную часть system prompt в кэшируемый блок.
- **Output schema sparingly.** Просим только нужные поля, не всю таблицу.
- **Compaction для long-context.** Если документ > 50 страниц — map-reduce: суммаризируем chunk'и Flash-моделью, потом отдаём в Pro.

### 5. Batching

- **Embeddings**: всегда batch (32–256 текстов за вызов). fastembed/Google API поддерживают.
- **Extraction**: можно batch 5–10 коротких страниц в один промпт с явной нумерацией, и парсить JSON-массив на выходе. Экономит на system-prompt overhead.
- **Async batches** (OpenRouter / OpenAI): для не-realtime задач — 50% скидка от стандартной цены, ответ за 24ч. Используем для backfill и переобработки.

### 6. Token budget per task

Каждый `Task` имеет `max_tokens` в policy. Превышение → ошибка/truncation. Никаких «давай отправим побольше на всякий случай».

Глобальные guard-rails (в `app/ai/limits.py`):
- Per-agent per-minute: token budget (например, extraction = 500k токенов/мин)
- Per-day cost ceiling: $100 — после этого только cached/free responses, alert админу

### 7. Дешёвые embeddings локально

- `BAAI/bge-m3` через `fastembed` (CPU, ~50 текстов/сек на 8-vCPU инстансе)
- Стоимость: $0 за вызов, только compute (входит в стоимость воркера)
- Качество: лучше openai-3-small на multilingual задачах, особенно RU/KZ

Это убирает ~30% всех AI-вызовов (embeddings = громадная доля volume).

## Semantic dedup

До отправки в LLM проверяем: похожий текст уже обрабатывался?

```python
def maybe_skip(text: str, task: Task) -> SkipResult | None:
    emb = bge_m3.embed_one(text)
    sim, payload = redis_vec.search(task, emb, threshold=0.985)
    if sim:
        return SkipResult(value=payload["result"], reason="semantic_match", saved=payload["cost_usd"])
    return None
```

Полезно для:
- Re-extract тех же страниц после смены модели → не перепарсить, если HTML не изменился
- Суммаризация новостей-перепечаток

## Мониторинг и алёрты

Дашборд (Phase 2, Grafana или встроенный):
- **Cost per day** (line)
- **Cost per agent per day** (stacked bar)
- **Cache hit rate per task** (gauge)
- **Cost per processed company** (KPI)
- **Anomaly**: ежедневная стоимость > 2x от 7-day median → Slack alert

## Что НЕ оптимизировать преждевременно

- Не пишите свой router раньше, чем будет 100k+ AI-вызовов с реальной telemetry.
- Не покупайте GPU, пока cloud API стоит < $500/мес.
- Не делайте fine-tune, пока нет 10k labeled examples и стабильной метрики качества.
- Не разворачивайте dedicated semantic cache (Qdrant), пока Redis Vector справляется.

## Чек-лист для каждой новой AI-задачи

- [ ] Может ли rule-based / heuristic справиться?
- [ ] Если LLM нужен — какая самая дешёвая модель даст приемлемое качество?
- [ ] Есть ли cache TTL? (нет ttl = всегда мисс, надо явное обоснование)
- [ ] Может ли запрос быть в batch с другими?
- [ ] Записан ли `Task` в Router policy?
- [ ] Логируем ли в `ai_call_log`?
- [ ] Есть ли тест с MockProvider?
