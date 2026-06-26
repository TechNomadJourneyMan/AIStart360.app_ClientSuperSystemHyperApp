# ADR-0002: Два AI-провайдера: OpenRouter + Google AI Studio

- Status: Accepted (2026-05-24)
- Related: [ADR-0001](0001-no-local-gpu.md)

## Контекст

Нужен runtime AI-доступ для extraction, classification, summarization, embeddings, OCR. Критерии выбора:
- Дёшево на high volume (Gemini Flash 8B ~$0.04/M input, free-tier 1500 RPM).
- Доступ к разнообразным моделям (DeepSeek, Qwen, Llama, Claude — для fallback и A/B).
- Доступ из РФ/КЗ без VPN (Yandex/VK не подходят — нет нужных моделей).
- Structured output (JSON-mode), function-calling, vision.

## Решение

**Два провайдера**:

1. **Google AI Studio** — primary для high-volume задач.
   - Доступ напрямую из CIS-региона
   - Огромный free-tier (1500 RPM Flash, 50 RPM Pro)
   - 1M-2M токенов контекст
   - Vision встроен в Flash и Pro
   - Очень дёшево даже после free

2. **OpenRouter** — fallback + доступ к 200+ моделям.
   - DeepSeek V3.1 — лучшая reasoning value
   - Qwen, Llama, Mistral для разнообразия
   - Claude Sonnet 4.6 для критичного reasoning
   - Async batches со скидкой 50% (Phase 2)

Оба интегрированы через единый `AIProvider` интерфейс в `app.ai.providers`.

## Последствия

**Плюсы**:
- Resilience: падение одного провайдера → автоматический fallback.
- Cost: основная нагрузка на дешёвой Gemini Flash.
- Доступ к новейшим моделям через OpenRouter без отдельных интеграций.

**Минусы**:
- Две интеграции вместо одной — больше кода для тестирования (mitigation: чёткий интерфейс провайдера).
- Разные форматы ответов и rate-limit логики (mitigation: адаптеры в провайдерах).

## Когда пересматривать

- Если Google AI Studio станет недоступен из РФ/КЗ → добавить direct Anthropic + сильнее на OpenRouter.
- Если появится провайдер дешевле для основного workload (Groq за $0.01/M?) — добавить.
- Если direct DeepSeek API станет на 30%+ дешевле OpenRouter — переключить тяжёлый DeepSeek workload напрямую.

## Альтернативы

- **Только OpenRouter** — отвергнут: дороже на 5–10%, нет такого free-tier.
- **Только Google AI Studio** — отвергнут: нет fallback, нет доступа к Claude/DeepSeek/Qwen.
- **Direct провайдеры (Anthropic + OpenAI + Google)** — отвергнут: 3+ интеграции, дороже на reasoning моделях.
