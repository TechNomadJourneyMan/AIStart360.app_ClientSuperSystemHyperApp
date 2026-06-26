# 03 — Model Catalog

> Каталог моделей с актуальными ценами, лимитами free-tier и рекомендациями. Цены на 2026-01 — **проверяйте перед production**.

## Принцип выбора

```
                ┌──────────────────────────────────────────────┐
                │  Стоимость + латентность + качество          │
                │      для конкретной задачи                    │
                └──────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
   Free-tier есть?     <$0.30/M input?          Long context?
        │                     │                      │
        ▼                     ▼                      ▼
   Gemini Flash-8B     DeepSeek V3.1          Gemini 2.5 Pro (1M)
   Gemini 2.5 Flash    Qwen3 32B/72B          Claude Sonnet 4.6 (200k)
                       Llama 3.3 70B
```

## Google AI Studio (provider key: `google`)

> Free-tier очень щедрый — основной рабочий провайдер для high-volume задач.

| Модель | Контекст | $/M input | $/M output | Free RPM | Use case |
|--------|----------|-----------|------------|----------|----------|
| `gemini-2.5-flash-8b` | 1M | $0.0375 | $0.15 | 4000 | classify, normalize, dedupe |
| `gemini-2.5-flash` | 1M | $0.075 | $0.30 | 1500 | extract, summarize, tag |
| `gemini-2.5-pro` | 2M | $1.25 | $5.00 | 50 | reasoning, long-doc analysis |
| `text-embedding-004` | 2k | бесплатно (до лимита) | — | 1500 | embeddings (768d) |

**Лимиты free**: 1M tokens/day на 2.5 Pro, неограниченно на Flash до RPM-cap.
**Region**: API доступен из RU/KZ напрямую (без прокси).

## OpenRouter (provider key: `openrouter`)

> Универсальный шлюз к ~200 моделям. Берёт 5–10% сверху от цены провайдера. Удобно для fallback и экспериментов.

### Cheap / High-volume

| Модель | Контекст | $/M input | $/M output | Use case |
|--------|----------|-----------|------------|----------|
| `deepseek/deepseek-chat-v3.1` | 64k | $0.27 | $1.10 | extract, summarize, classify |
| `deepseek/deepseek-chat-v3.1:free` | 64k | бесплатно | бесплатно | A/B тесты, dev |
| `qwen/qwen-2.5-72b-instruct` | 32k | $0.40 | $0.40 | extract, multilingual |
| `qwen/qwen3-32b` | 128k | $0.20 | $0.60 | reasoning, code |
| `meta-llama/llama-3.3-70b-instruct` | 128k | $0.39 | $0.39 | general-purpose |
| `mistralai/mistral-small-3.1-24b` | 128k | $0.10 | $0.30 | summarize, classify |
| `google/gemma-3-27b-it` | 128k | $0.20 | $0.40 | tagging, short answers |
| `microsoft/phi-4` | 16k | $0.07 | $0.14 | fast classify, simple QA |

### Reasoning / Premium

| Модель | Контекст | $/M input | $/M output | Use case |
|--------|----------|-----------|------------|----------|
| `anthropic/claude-sonnet-4-6` | 200k | $3.00 | $15.00 | complex reasoning, code review |
| `anthropic/claude-haiku-4-5` | 200k | $1.00 | $5.00 | balanced quality/cost |
| `openai/gpt-5-mini` | 128k | $0.25 | $2.00 | balanced |
| `deepseek/deepseek-r1` | 64k | $0.55 | $2.19 | reasoning, math, analytical |

### Vision

| Модель | $/M input | $/image | Use case |
|--------|-----------|---------|----------|
| `google/gemini-2.5-flash` | $0.075 | ~$0.0001 | OCR, screenshots |
| `qwen/qwen-2.5-vl-72b` | $0.40 | ~$0.0005 | document parsing |
| `mistralai/pixtral-12b` | $0.10 | ~$0.0002 | logos, charts |

## Embeddings

| Модель | Provider | Размерность | Цена | Где использовать |
|--------|----------|-------------|------|------------------|
| `text-embedding-004` | google | 768 | бесплатно | основной embedding для семантического поиска (RU/KZ есть) |
| `BAAI/bge-m3` | локально (fastembed) | 1024 | $0 (CPU) | multilingual, лучше для KZ/RU/EN/UZ |
| `intfloat/multilingual-e5-large` | локально | 1024 | $0 | альтернатива BGE-M3 |
| `text-embedding-3-small` | openrouter→openai | 1536 | $0.02/M | fallback |

**Решение MVP**: основной — `BAAI/bge-m3` через `fastembed` (CPU, offline, бесплатно). Fallback — Google `text-embedding-004`.

## Конкретное соответствие Task → Model

| Task | Primary | Fallback | $/1k calls* | Кэш TTL |
|------|---------|----------|-------------|---------|
| `CLASSIFY_INDUSTRY` | gemini-2.5-flash-8b | deepseek-chat-v3.1 | $0.02 | 30 дней |
| `EXTRACT_CONTACTS` | gemini-2.5-flash-8b | qwen-2.5-72b | $0.05 | 30 дней |
| `NORMALIZE_ADDRESS` | gemini-2.5-flash-8b | phi-4 | $0.01 | 90 дней |
| `DETECT_LANGUAGE` | local fasttext | gemini-2.5-flash-8b | $0 | — |
| `DEDUPE_DECISION` | gemini-2.5-flash-8b | deepseek-chat-v3.1 | $0.03 | 7 дней |
| `EXTRACT_COMPANY` | gemini-2.5-flash | qwen-2.5-72b | $0.30 | 7 дней |
| `EXTRACT_TENDER` | gemini-2.5-flash | deepseek-chat-v3.1 | $0.25 | 14 дней |
| `SUMMARIZE_NEWS` | gemini-2.5-flash | mistral-small-3.1 | $0.20 | 30 дней |
| `SUMMARIZE_REVIEWS` | deepseek-chat-v3.1 | gemini-2.5-flash | $0.40 | 7 дней |
| `TAG_CONTENT` | gemma-3-27b | gemini-2.5-flash-8b | $0.15 | 14 дней |
| `GRAPH_REASONING` | gemini-2.5-pro | claude-sonnet-4-6 | $3.00 | 12 часов |
| `INVESTMENT_THESIS` | gemini-2.5-pro | claude-sonnet-4-6 | $5.00 | 7 дней |
| `OSINT_ENTITY_LINKING` | deepseek-r1 | claude-sonnet-4-6 | $1.50 | 30 дней |
| `OCR_DOCUMENT` | gemini-2.5-flash (vision) | qwen-2.5-vl-72b | $0.10 | бессрочно |
| `EMBED_COMPANY_PROFILE` | bge-m3 (local) | gemini text-embedding-004 | $0 | бессрочно |

*Грубая оценка при средних входных размерах задачи, без учёта cache-hit.

## Free-tier comparison

| Provider | Free quota | Достаточно для |
|----------|-----------|----------------|
| Google AI Studio | 1500 RPM Flash, 50 RPM Pro, 1M tokens/day Pro | ~80% MVP workload |
| OpenRouter `:free` варианты | DeepSeek/Llama/Mistral free | dev и A/B, не production |
| Groq (через OpenRouter) | до 30k tokens/min | не MVP, оценить позже |

## Мониторинг изменений

- Раз в неделю запускать `scripts/check_model_prices.py` — pull актуальных цен с OpenRouter API и Google docs.
- Любое изменение прайса > 20% → автоматический алерт в Slack `#mark-ai-cost`.
- Расчёт «cost per company processed» — еженедельный отчёт.

## Конфигурация в коде

См. `backend/app/ai/registry.py` — `MODEL_CATALOG` dict с метаданными.
См. `backend/app/ai/router.py` — `ROUTING_POLICY` с Task→Model mapping.

## Когда переоценивать выбор моделей

- Появление новой модели в OpenRouter с лучшим quality/cost.
- Падение качества на конкретной задаче (метрика в `ai_call_log` + ручной sample).
- Изменение цен > 20%.
- Появление собственного GPU → миграция embeddings, потом extraction на локальные модели.
