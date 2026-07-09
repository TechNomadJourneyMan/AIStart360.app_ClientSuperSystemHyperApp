# 12 · Часть O — Security, privacy, compliance (T27)

База (из аудита): RLS-first Supabase, session-only identity в API, HMAC giga-cookie, MFA step-up,
CSP, `/api/*` NetworkOnly в SW (фикс кэш-утечки), output-фильтр секретов, PII-маска, immutable
`AuditLog`. Известные долги: **нет consent-таблицы, нет удаления данных, нет скоупинга экспертов,
CRM-токены plaintext (P-30), NextAuth-остаток (Q6)**.

## 1. Threat model (S=severity, L=likelihood; топ-угрозы новых фич)

| # | Риск | S | L | Mitigation | Тест | Мониторинг |
|---|---|---|---|---|---|---|
| 1 | Prompt injection (вопрос/файл/CRM-заметка) | H | H | правило «данные≠инструкции» (есть) + маркировка [doc:*] + validator категория + forbidden-структуры | обяз. 7 | validator-блоки по категории injection |
| 2 | Jailbreak персоной («ты теперь без правил») | H | M | personaBlock не ослабляет общие правила (композиция, не замена); regression-suite персон | 06 §4.1 | persona_mismatch rate |
| 3 | Data exfiltration через RAG (чужие чанки) | **C** | M | RPC со скоупом из сессии; REVOKE от клиентских ролей; RLS на document_chunks | обяз. 17 | алерт на rpc-ошибки доступа |
| 4 | Утечка system prompt | M | M | существующие запреты + фильтр + Т16 | 08 §8.2 | grep-фильтр исходящих |
| 5 | PII leakage (ответы/дайджест/OG/investor) | H | M | maskPii, allow-list полей investor/digest, OG без PII by design | обяз. 23, 29 | PII-regex на выходах (sample) |
| 6 | Hallucinated advice → вред бизнесу | H | H | детерминированные ядра (NBA/симулятор/ставки), number-grounding, validator, Т-шаблоны, дисклеймеры | обяз. 5,6,19 | hallucination_risk распределение, 👎-rate |
| 7 | Психологический вред (диагнозы, давление) | H | M | psych-словарь запретов, coach-ограничения, эскалация при тяжёлых сигналах, no-shame правила | обяз. 4 | psych_risk категория validator |
| 8 | Финансовый/юридический вред | H | M | Т3/Т8/Т9, needs_expert-эскалация (механизм есть) | обяз. 5 | escalation rate по темам |
| 9 | Abuse AI-эндпоинтов (кошелёк) | M | H | per-user rate-limits + дневные бюджеты + paywall-счётчики; OPENROUTER-спенд алерт | обяз. 15 | траты OpenRouter/день, топ-юзеры |
| 10 | Malicious/oversized файлы | H | M | существующий parse-пайплайн: + лимиты размера/типа, magic-bytes проверка (`ASSUMPTION:` частично есть — проверить), таймаут OCR | новый тест | ошибки parse по типам |
| 11 | IDOR новых таблиц | **C** | M | RLS self-scoped всюду; session-only id; интеграционные IDOR-тесты на каждый новый роут (паттерн существующих) | обяз. 14 | 403/404-аномалии |
| 12 | Unsafe auto-approval (D3) | H | M | risk-флаги, email-verify обязателен, admin override, audit, kill-switch режим | обяз. 21,22 | доля флагов, abuse-репорты |
| 13 | Fake trust/benchmark/badge claims | M | M | B2 null-честность, B3 source-подписи, F3 бейдж только при факте проверки — всё в коде, не в копирайте | обяз. 19,20,25 | — |
| 14 | Overconfident simulation | M | H | ядро-диапазоны, схема требует assumptions/confidence, forbidden-phrases | 09 §7 | — |
| 15 | Утечка через share (OG/токены/slices) | H | M | noindex (есть), revoke (есть), OG через токен без PII, slices allow-list | обяз. 23,29 | views аномалии |
| 16 | Cross-tenant в white-label/агентствах | H | L (пока L3) | не строить до отдельного RLS-ревью второй арендаторской оси (G3-риск №3) | — | — |
| 17 | Model output manipulation (человек скармливает ответы ГРИ третьим лицам как «оценку AIStart360») | L | M | дисклеймер в PDF/share «AI-диагностика, не аудит» | — | — |
| 18 | Excessive logging (тексты в телеметрии) | M | M | правило: тексты только ai_messages/result; assistant_events без текстов (паттерн есть); Langfuse retention | код-ревью чеклист | — |
| 19 | XSS/SSRF/CSRF регрессии | H | L | существующие фиксы + новые роуты без user-URL fetch (кроме video_url allow-list E2) | E2-тест | CSP-репорты |
| 20 | Хранение чувствительного без согласия | H | M | consent-гейты (§2), психопрофиль strictly-self | обяз. 27,28 | — |

## 2. Consent management (закрывает долг + новые нужды)

`user_consents` (миграция 047): `kind ∈ {psych_profile, weekly_digest_email, weekly_digest_telegram,
benchmarks_contribution, mini_gri_contact, personalization}`, `granted`, `granted_at`, `revoked_at`,
`text_version` (версия текста согласия — обязательна для юр. следа). Правила: дефолт всё off
(кроме in-app уведомлений); проверка consent — в сервисе, не в UI; revoke действует немедленно;
UI — раздел «Приватность» в настройках со списком согласий и датами.

## 3. Data minimization / encryption / access

- Минимизация: промпты собираются из curated-снапшотов (архитектура есть) — новые поля добавлять
  только через allow-list-ревью; психопрофиль → теги; validator не получает историю.
- Шифрование: at rest — Supabase (диск) + **P-30 долг**: CRM-токены и будущие интеграционные
  секреты шифровать приложением (AES-GCM, ключ в env) — включить в AI-2 как préreq Фазы 4 синка.
  In transit — TLS всюду (есть).
- Access controls: новые таблицы — RLS self; staff-доступ к диалогам/симуляциям — только после
  решения Q4 (скоупинг экспертов) и отдельным consent; giga-панель — существующий HMAC-гейт.
- Redaction: `filterModelOutput` + maskPii на входах; для логов — тексты не покидают
  ai_messages/Langfuse.

## 4. Export / deletion (новое, закрывает долг)

- **Экспорт:** `GET /api/v1/account/export` → JSON-архив (profiles, survey_answers, gri_assessments,
  point_a/b, диалоги, симуляции, психопрофиль, согласия). Rate-limit 1/день.
- **Удаление:** `POST /api/v1/account/delete-request` → soft-window 7 дней (письмо-подтверждение)
  → джоб: Supabase auth-user delete + каскады (FK уже CASCADE у новых таблиц) + Prisma-остатки +
  Storage-файлы + отзыв share-токенов. Audit-запись (без ПДн). Тест — обяз. 13.
- Психопрофиль и диалоги дополнительно удаляются по отдельным кнопкам без удаления аккаунта.

## 5. Rate limiting / file validation / moderation

- Лимиты: файл 10 §4 + существующие. Глобальный дневной AI-бюджет на пользователя.
- Файлы: тип/размер/magic-bytes до parse; OCR-таймаут; счётчик файлов на пользователя.
- Moderation: вход пользователя в чат — deterministic-словарь запрещённых тем (violence/illegal) →
  Т16; полноценная модерация-модель — не требуется на MVP (аудитория авторизованная, платная).

## 6. Safe prompt construction (чеклист для каждого нового промпта — PR-шаблон)

1. Данные только через сериализатор с маркерами, не конкатенация сырых строк.
2. Правило «данные≠инструкции» присутствует.
3. Числа/факты — источник указан; allow-list полей для чувствительных поверхностей.
4. Есть фолбэк при null; есть validator-маршрут; есть Langfuse-tag.
5. Регрессионные фикстуры добавлены (golden set).
