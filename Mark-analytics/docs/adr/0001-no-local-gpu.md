# ADR-0001: AI-инференс только через cloud API в MVP

- Status: Accepted (2026-05-24)
- Deciders: проектное ядро

## Контекст

ТЗ требует «local-first AI с минимальной стоимостью», но запуск self-hosted GPU (RTX 4090 ≈ €200/мес, A100 ≈ $1500+/мес) добавляет:
- ops-нагрузку (мониторинг, OOM, драйверы)
- сложность деплоя (vLLM/Ollama, K8s GPU-scheduling)
- стоимость даже при низкой утилизации
- задержку запуска MVP

Frontend уже на Vercel, backend планируется на Railway/Fly.io — на этих платформах GPU нет.

## Решение

В MVP и Phase 2 **весь LLM-инференс идёт через cloud API**:
- Основной провайдер: **Google AI Studio** (Gemini 2.5 Flash 8B/Flash/Pro) — щедрый free-tier, дёшево.
- Запасной: **OpenRouter** (DeepSeek V3.1, Qwen3, Llama 3.3, Claude) — fallback и доступ к моделям, которых нет у Google.

Только embeddings гоняем локально через `fastembed` (BGE-M3 на CPU, без GPU) — это бесплатно и не требует инфраструктуры.

## Последствия

**Плюсы**:
- Time-to-MVP меньше на месяц.
- $0 capex, переменные расходы пропорциональны нагрузке.
- Free-tier Google AI Studio покрывает большую часть MVP-workload (1500 RPM на Flash).
- Можно масштабироваться без скачков (cloud API эластичны).

**Минусы**:
- Зависимость от cloud-провайдеров (mitigation: provider-agnostic AI Gateway + 2 провайдера).
- Latency выше, чем у local inference (mitigation: cache + правильный выбор моделей).
- При очень больших объёмах (10M+ вызовов/мес) cloud дороже local GPU (mitigation: пересмотр в Phase 3).

## Когда пересматривать

Триггеры для возврата к local GPU:
- Стоимость cloud AI > $1500/мес — экономика начинает оправдывать свой GPU.
- Объём embeddings > 10M/день — выделенный GPU embeddings оптимальнее, чем CPU fastembed на множестве воркеров.
- Required latency p95 < 200 ms для extraction — cloud API не всегда даёт.

## Альтернативы

1. **Полный self-hosted с самого начала** — отвергнут: высокий ops-overhead, замедляет MVP.
2. **Только OpenRouter без Google** — отвергнут: OpenRouter дороже на 5–10%, и нет такого free-tier.
3. **OpenAI / Anthropic напрямую** — отвергнут: дорого для high-volume runtime задач, лучше через OpenRouter и только для premium tasks.
