# 02 — AI Gateway

> Единственная точка контакта приложения с LLM-провайдерами. Никакой бизнес-код не должен импортировать `openai`, `google.generativeai` напрямую — только `from app.ai.gateway import gateway`.

## Зачем

1. **Provider lock-in elimination.** Переключение OpenRouter ↔ Google AI Studio ↔ direct DeepSeek API — изменение одной строчки.
2. **Cost control.** Все вызовы проходят через **Model Router**, который выбирает дешёвую viable-модель + двухуровневый кэш (key + semantic).
3. **Observability.** Каждый вызов пишет: модель, токены, латентность, стоимость, cache-hit, prompt-version, request-id, agent-name — в `ai_call_log`.
4. **Resilience.** Retry, fallback на другой провайдер при 429/5xx, circuit-breaker.
5. **Structured output.** Унифицированный API для JSON-mode и tool-calling, не зависящий от провайдера.

## Архитектура

```
┌──────────────────────────────────────────────────────────────────┐
│                       AI Gateway                                  │
│                                                                   │
│   ┌────────────┐   ┌────────────┐   ┌─────────────────────────┐ │
│   │ Cache      │──►│ Router     │──►│ Provider Adapters       │ │
│   │ (key +     │   │ (policy)   │   │  - OpenRouterProvider   │ │
│   │  semantic) │   │            │   │  - GoogleAIStudioProvider│ │
│   └────────────┘   └─────┬──────┘   │  - MockProvider (tests) │ │
│         ▲                │           └─────────────────────────┘ │
│         │                ▼                                       │
│         │          ┌───────────┐                                 │
│         │          │ Fallback  │                                 │
│         │          │ + Retry   │                                 │
│         │          └─────┬─────┘                                 │
│         │                ▼                                       │
│   ┌────────────┐   ┌───────────┐                                 │
│   │ ai_call_log│◄──┤ Telemetry │                                 │
│   └────────────┘   └───────────┘                                 │
└──────────────────────────────────────────────────────────────────┘
```

## Публичный API

```python
from app.ai.gateway import gateway
from app.ai.types import ChatMessage, GenerateRequest, Task

# Простой chat
resp = await gateway.generate(
    GenerateRequest(
        task=Task.SUMMARIZE_NEWS,   # ключ для Router → выбирает модель
        messages=[ChatMessage(role="user", content="Резюмируй новость: ...")],
        max_tokens=512,
        agent="summarization",       # для observability
    )
)
print(resp.text, resp.usage.cost_usd, resp.model_used)

# Structured output (Pydantic schema)
from pydantic import BaseModel

class Company(BaseModel):
    name: str
    bin: str
    industry: str | None = None

resp = await gateway.generate_structured(
    GenerateRequest(task=Task.EXTRACT_COMPANY, messages=[...]),
    schema=Company,
)
company: Company = resp.parsed

# Embeddings
vecs = await gateway.embed(
    texts=["компания N занимается ...", "вторая компания ..."],
    task=Task.EMBED_COMPANY_PROFILE,
)
```

## Task enum (стабильные ключи задач)

```python
class Task(StrEnum):
    # === Cheap, high-volume ===
    CLASSIFY_INDUSTRY        = "classify_industry"
    EXTRACT_CONTACTS         = "extract_contacts"
    NORMALIZE_ADDRESS        = "normalize_address"
    DETECT_LANGUAGE          = "detect_language"
    DEDUPE_DECISION          = "dedupe_decision"

    # === Medium ===
    EXTRACT_COMPANY          = "extract_company"
    EXTRACT_TENDER           = "extract_tender"
    EXTRACT_PERSON           = "extract_person"
    SUMMARIZE_NEWS           = "summarize_news"
    SUMMARIZE_REVIEWS        = "summarize_reviews"
    TAG_CONTENT              = "tag_content"

    # === Complex reasoning ===
    GRAPH_REASONING          = "graph_reasoning"
    INVESTMENT_THESIS        = "investment_thesis"
    ANOMALY_EXPLANATION      = "anomaly_explanation"
    OSINT_ENTITY_LINKING     = "osint_entity_linking"

    # === Vision / OCR ===
    OCR_DOCUMENT             = "ocr_document"
    VISION_LOGO              = "vision_logo"

    # === Embeddings ===
    EMBED_COMPANY_PROFILE    = "embed_company_profile"
    EMBED_QUERY              = "embed_query"
    EMBED_NEWS               = "embed_news"
```

Каждый `Task` имеет policy в [03-model-catalog.md](03-model-catalog.md): primary/fallback модель, max_tokens, temperature, timeout, cache TTL.

## Routing policy (в коде)

```python
ROUTING_POLICY: dict[Task, RoutePolicy] = {
    Task.CLASSIFY_INDUSTRY: RoutePolicy(
        primary="google/gemini-2.5-flash-8b",        # дёшево, быстро
        fallback=["openrouter/deepseek/deepseek-chat-v3"],
        max_tokens=64,
        temperature=0.0,
        cache_ttl=timedelta(days=30),
        semantic_cache_threshold=0.97,
    ),
    Task.EXTRACT_COMPANY: RoutePolicy(
        primary="google/gemini-2.5-flash",
        fallback=["openrouter/qwen/qwen-2.5-72b-instruct"],
        max_tokens=1024,
        structured_output=True,
        cache_ttl=timedelta(days=7),
    ),
    Task.GRAPH_REASONING: RoutePolicy(
        primary="google/gemini-2.5-pro",
        fallback=["openrouter/anthropic/claude-sonnet-4-6"],
        max_tokens=4096,
        cache_ttl=timedelta(hours=12),
        cost_ceiling_usd=0.05,                       # отказ если оценка > $0.05
    ),
    # ...
}
```

### Правила выбора модели
1. **Hard match по Task.** Каждая задача имеет primary-модель.
2. **Cost ceiling.** Если оценочная стоимость > policy.cost_ceiling — переключиться на cheaper fallback.
3. **Latency budget.** Если задача в hot-path (API request, не worker) — выбрать модель с p95 < 1.5s.
4. **Context length.** Если prompt > 32k токенов — переключиться на long-context модель (Gemini 2.5 Pro 1M).
5. **Provider health.** Если у primary за последние 60 секунд > 20% 5xx — переключиться на fallback.

## Кэш

### Key-based (точный)
- Ключ: `sha256(model + prompt + params)`
- Хранилище: Redis с TTL из policy
- Hit: ~30–40% при идемпотентных задачах (классификация, нормализация)

### Semantic cache
- Вычисляем embedding запроса (BGE-M3 локально, бесплатно)
- Ищем в Redis Vector / Qdrant ближайший с `cosine > threshold`
- Если есть — возвращаем сохранённый ответ
- Hit: ~15–25% дополнительно на free-form задачах

Кэш отключаем для:
- `temperature > 0.3`
- задач с `cache_ttl=None` в policy
- `force_refresh=True` в запросе

## Fallback / retry

```python
RETRY_POLICY = (
    stop_after_attempt(3),
    wait_exponential(min=1, max=8),
    retry_if_exception_type((Timeout, ProviderRateLimit, Provider5xx)),
)

# Если все попытки primary провалились → провайдер fallback из policy.
# Если и fallback провалился → raise AIGatewayUnavailable, бизнес-код решает (defer job)
```

## Cost tracking

Таблица `ai_call_log`:

```sql
CREATE TABLE ai_call_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    request_id UUID NOT NULL,
    agent VARCHAR(64),                  -- 'extraction', 'discovery', ...
    task VARCHAR(64) NOT NULL,          -- Task enum value
    model VARCHAR(128) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    tokens_in INT NOT NULL,
    tokens_out INT NOT NULL,
    cost_usd NUMERIC(10,6) NOT NULL,
    latency_ms INT NOT NULL,
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
    cache_type VARCHAR(16),             -- 'key' | 'semantic' | NULL
    error VARCHAR(512),
    prompt_version VARCHAR(32),
    request_fingerprint CHAR(64)
);

CREATE INDEX ON ai_call_log (created_at);
CREATE INDEX ON ai_call_log (task, created_at);
CREATE INDEX ON ai_call_log (agent, created_at);
```

Дашборд (Phase 2): «Cost per agent per day», «Cache hit-rate per task», «Latency p95 per model».

## Безопасность

- Промпты с PII (телефоны, ИИН) — не кэшируются (`policy.cache_pii_safe=False`).
- Каждый prompt template хранится в `app/ai/prompts/*.j2` с версией.
- `system prompt` инжектит `Do not generate PII that wasn't in the input`.
- Логируем только хэш промпта по умолчанию (full text — за фича-флагом).

## Тестирование

- `MockProvider` для unit-тестов (детерминированные ответы).
- `CassetteProvider` для интеграционных (vcrpy-like, записывает ответы).
- `LiveProvider` — только в `tests/live/` за маркером pytest, не в CI по умолчанию.

## Limits и rate-limiting

- Per-agent: `agent_concurrency_limit` (например, extraction = 20 одновременных вызовов).
- Per-provider: ограничение через `aiolimiter` (например, Google AI Studio free = 1500 RPM на Flash).
- Per-task: token budget per minute (`Task.GRAPH_REASONING` = 100k tokens/min).

Лимиты конфигурируются в `app/ai/limits.py` и проверяются перед отправкой запроса.
