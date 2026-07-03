# Аудит безопасности + план 2FA / биометрии / шифрования

**Дата:** 2026-07-02
**Проект:** AIStart360 (Next.js 14 App Router, Supabase Auth, Prisma, OpenRouter)
**Аудит проведён:** 5 параллельных агентов покрыли все API‑маршруты, middleware, конфиг платформы, зависимости.

---

## 0. Резюме за 30 секунд

- Реальная авторизация в проде — **Supabase GoTrue** (не Prisma/bcrypt — тот путь мёртвый). Значит 2FA и биометрию строим на уровне Supabase‑сессии.
- Аудит нашёл **1 Critical, 6 High, ~8 Medium, ~10 Low**. Причина большинства High — семейство старых маршрутов «личность из тела запроса, без `getUser()`, надежда только на RLS» (наследие до миграции на Supabase).
- **В этой сессии закрыты все Critical + High + дешёвые Medium** (20+ файлов, TypeScript компилируется чисто). Осталось: шифрование секретов, политика паролей, ряд Low.
- Экраны 2FA/биометрии в `SettingsClient.tsx` сейчас — заглушки «Скоро». План ниже превращает их в рабочие функции.
- Блокчейн для «передачи данных пользователя» — **не рекомендуется** как транспорт. Есть одно уместное применение (якорение хэшей журнала аудита для защиты от подделки) — детали в §6.

---

## 1. Как устроена аутентификация (карта)

| Что | Где | Примечание |
|---|---|---|
| Вход / регистрация / сессия | Supabase GoTrue через `@supabase/ssr` | Куки ставит библиотека (`httpOnly`, `secure` в проде, `sameSite=lax`) |
| Клиент Supabase (сервер) | `lib/supabase/server.ts`, `lib/supabase-server.ts` | anon‑ключ + куки пользователя |
| Обновление сессии | `lib/supabase/middleware.ts` → `middleware.ts` | `getUser()` на каждый запрос, роль из `profiles.role` |
| Личность в API‑маршруте | `sb.auth.getUser()` | `/api/*` исключён из middleware — каждый маршрут защищается сам |
| Роли/права (admin) | `lib/rbac.ts` (`requirePermission`, `getAdminSession`) | матрица SUPER_ADMIN/ADMIN/MANAGER/ANALYST/CLIENT |
| Гига‑супер‑админ | `lib/giga-cookie*.ts` | отдельная **HMAC‑подписанная** кука `aistart360_giga` |
| Регистрация | `app/api/auth/register/route.ts` | роль только `client`/`owner`, статус `pending_approval` |
| Второй (мёртвый) слой | NextAuth `lib/auth.ts` (только Google) + `lib/api-utils.requireAuth` | `auth()` всегда null → маршруты на нём fail‑closed (всегда 401) |
| Сброс пароля | `app/actions/auth.ts` | токен 32B crypto‑random, 60 мин, single‑use (но путь мёртвый) |

**Вывод для 2FA:** единственный «живой» источник личности — Supabase‑сессия. MFA‑gate вешаем поверх неё (см. §4).

---

## 2. Находки аудита (по severity)

### CRITICAL
- **C1 — `POST /api/v1/diagnostics/ai-analyze`: анонимный + без лимита + 4 платных AI‑генерации на вызов.** Любой мог в цикле сжигать бюджет OpenRouter и класть сервис. → **ИСПРАВЛЕНО** (подписанный внутренний токен + сессия‑владелец + rate‑limit).

### HIGH
- **H1 — `diagnostics/recalculate`: без auth, `user_id` из тела, запускает AI‑фан‑аут.** → **ИСПРАВЛЕНО** (сессия + лимит + токен на fan‑out).
- **H2 — Эскалация привилегий ADMIN → SUPER_ADMIN** через `admin/requests/[id]/approve` (роль из payload без проверки). → **ИСПРАВЛЕНО** (валидация роли + только SUPER_ADMIN выдаёт админ‑роли).
- **H3 — IDOR‑запись отчётов** `reports/upload` (`clientId` из формы, без скоупа орг). → **ИСПРАВЛЕНО** (скоуп по орг + staff, 404).
- **H4 — IDOR `onboarding/survey`** (чтение/запись чужих ответов анкеты). → **ИСПРАВЛЕНО** (сессия, staff может по чужому id).
- **H5 — `gri/expert-notes`: без auth и без роли** (чтение/запись «экспертных заметок» о любом юзере). → **ИСПРАВЛЕНО** (staff‑гейт).
- **H6 — SSRF через `documents/[id]/process`** (`fetch(doc.file_url)` без auth; `file_url` не валидируется при вставке → эксфильтрация). → **ИСПРАВЛЕНО** (валидатор storage‑URL при вставке + auth/скоуп/ре‑валидация в process).

### MEDIUM
- **M1 — AI‑маршруты без rate‑limit** (`market-analysis/generate`, `point-a/narrative`, `point-a/insights/ai-generate`, `assistant/analyze`, `assistant/ask`, `point-b/ai-generate`). → **ИСПРАВЛЕНО** (per‑user лимиты).
- **M2 — HTML/фишинг‑инъекция в письма** `lib/email.ts` (`file_name` пользователя без экранирования). → **ИСПРАВЛЕНО** (`escapeHtml`).
- **M3 — IDOR удаления документа** `documents/[id]` DELETE (`user_id` из query). → **ИСПРАВЛЕНО** (сессия).
- **M4 — CRM‑токены (`accessToken`) хранятся в БД открытым текстом** (`crm_integrations`). → **ОСТАЁТСЯ** → §5 (шифрование).
- **M5 — `xlsx` (без патча апстрима)** прототайп‑поллюшн/ReDoS на недоверенных файлах. → **ОСТАЁТСЯ** (мигрировать на `exceljs` или жёстко ограничить/санировать).
- **M6 — Отчёты пишутся в публичный `public/uploads/`** (`app/actions/reports.ts`) — доступны без auth. → **ОСТАЁТСЯ** (хранить вне `public/`, отдавать через signed‑URL‑маршрут; добавить `public/uploads` в `.gitignore`).
- **M7 — `client/register` без auth/лимита** → спам `admin_requests` (Prisma в обход RLS). → **ОСТАЁТСЯ** (rate‑limit + капча).
- **M8 — `next@14.2.x` HIGH‑advisory** (image‑optimizer DoS, request smuggling). → **ОСТАЁТСЯ** (обновить до пропатченного 14.2.x).

### LOW (осталось, вынесено в бэклог §7)
Утечка `error.message` в ряде маршрутов (частично поправлено в diagnostics), слабый минимум пароля (6) при регистрации, `email_confirm:true` (пропуск верификации почты), reset‑токен в БД открытым текстом (мёртвый путь), заголовок `x-user-role` в ответе, CSP `unsafe-inline` в script‑src, health‑endpoint светит имена env, порядок allowlist→auth в market‑прокси, немодульный `?limit=abc`→NaN.

### Проверено и в порядке (не трогаем)
Secrets в дереве — чисто (только `.env.example`). Server‑only ключи не утекают в клиентский бандл. Заголовки безопасности (HSTS/CSP/XFO/nosniff/Referrer/Permissions) присутствуют. Service‑worker не кэширует `/api/*`. Гига‑кука HMAC‑подписана. Платёжная заглушка — by design. Владелец ≠ SUPER_ADMIN (фикс на месте). Self‑registration не может выдать себе админа.

---

## 3. Что уже сделано в этой сессии

Новые хелперы:
- `lib/internal-auth.ts` — HMAC‑подписанный короткоживущий токен для доверенных server‑to‑server вызовов (на `AUTH_SECRET`).
- `lib/api-identity.ts` — `getSessionUser` / `getSessionRole` / `isStaffRole` / `resolveTargetUserId` (личность из сессии, staff может действовать за другого).
- `lib/upload-url.ts` — `isSupabaseStorageUrl` (SSRF‑гард).
- `lib/rate-limit.ts` — добавлен `isRateLimitedKey` (лимит по userId, а не только по IP).
- `lib/email.ts` — `escapeHtml` в шаблоне писем.

Исправленные маршруты: `admin/requests/[id]/approve`, `reports/upload`, `v1/onboarding/survey`, `v1/gri/expert-notes`, `v1/onboarding/documents` (+`[id]`, +`[id]/process`), `v1/diagnostics/{recalculate,ai-analyze,retry-ai,ai-status,point-b/ai-generate}`, `v1/market-analysis/generate`, `v1/point-a/{narrative,insights/ai-generate}`, `v1/assistant/{analyze,ask}`.

**Проверка:** `tsc --noEmit` — 0 ошибок по всему проекту. Требуется дымовой прогон против реального Supabase перед деплоем (в этом worktree нет `.env.local`), т.к. затронуты потоки онбординга и диагностики.

> ⚠️ **Новая зависимость окружения:** внутренний токен подписывается `AUTH_SECRET` (уже есть в `.env`). Если его нет — server‑to‑server AI‑фан‑аут (recalculate → ai‑analyze/point‑b) не пройдёт гейт. Убедиться, что `AUTH_SECRET` задан в проде.

---

## 4. План: 2FA + резервные коды + биометрия (Passkey/Face ID/Touch ID)

### Архитектурная развилка (нужно ваше решение)

**Вариант A — нативный Supabase MFA (только TOTP).** `supabase.auth.mfa.enroll/challenge/verify`, отслеживание AAL. Плюсы: минимум кода, безопасно. Минусы: **Passkey/Face ID/Touch ID Supabase как фактор здесь не умеет**; резервные коды приходится делать отдельно.

**Вариант B — единый app‑level MFA‑слой (рекомендую).** Своя таблица `user_security` (TOTP‑секрет зашифрован, резервные коды хэшированы, WebAuthn‑креды) + «step‑up» гейт на подписанной куке (та же HMAC‑инфраструктура, что у `giga-cookie`). Один слой одинаково обслуживает **TOTP + резервные коды + Passkey/Face ID/Touch ID**. Passkey/биометрия реализуются как WebAuthn (`@simplewebauthn`, уже установлен v9). Минусы: больше кода, MFA катаем сами (на проверенных библиотеках).

> Поскольку Passkey/Face ID/Touch ID — явное требование, а Supabase их как фактор здесь не поддерживает, **связный путь — Вариант B**. Face ID и Touch ID в вебе — это WebAuthn‑platform‑authenticator; отдельного «Face ID API» нет, устройство само выбирает биометрию.

### Фазировка (Вариант B)

**Фаза 1 — TOTP‑2FA + резервные коды**
1. Миграция `039_user_security.sql`: `user_security(user_id pk, totp_secret_enc, totp_enabled, backup_codes_hashed text[], webauthn ... )` + RLS (self‑read/write через сервис‑роль).
2. `lib/mfa/totp.ts` — генерация секрета (`otplib`), otpauth‑URL, QR (SVG), verify (окно ±1).
3. API: `POST /api/v1/security/2fa/setup` (секрет+QR), `/verify` (включить), `/disable`, `POST /backup-codes/regenerate`.
4. Step‑up гейт: после входа (AAL1) если `totp_enabled` — подписанная кука `aistart360_mfa` не выдаётся, пока не пройден код; middleware/лейаут требует её на защищённых зонах.
5. UI: заменить `TwoFactorCard` в `components/settings/SettingsClient.tsx` (QR, ввод кода, показ 10 резервных кодов один раз).

**Фаза 2 — Passkey / Face ID / Touch ID (WebAuthn)**
1. `lib/webauthn/*` на `@simplewebauthn/server` (v9): `generateRegistrationOptions/verifyRegistrationResponse`, `generateAuthenticationOptions/verifyAuthenticationResponse`. `rpID` = домен, `expectedOrigin` = прод‑URL.
2. Хранить credentialID/publicKey/counter/transports/deviceType в `user_webauthn_credentials`.
3. Регистрация из настроек (`BiometricsCard`): `@simplewebauthn/browser` `startRegistration()` с `authenticatorSelection.userVerification='preferred'`, `residentKey='preferred'` (для passkey).
4. Вход: как **второй фактор / step‑up** и опц. **беспарольный вход** — после верификации ассершена сервер минтит Supabase‑сессию через admin `generateLink`/сессию (service‑role). ← это ключевое решение (см. вопрос про режим passkey).
5. Управление ключами (список/удаление/переименование устройства) в настройках.

**Фаза 3 — SMS‑OTP** — см. §5 (нужен провайдер).

**Что нужно включить/задать (Фазы 1–2):**
- В Supabase Dashboard включить MFA (если используем нативный AAL хоть частично).
- `MFA_ENCRYPTION_KEY` (32 байта) для шифрования TOTP‑секретов (см. §5).
- `NEXT_PUBLIC_APP_ORIGIN` / `WEBAUTHN_RP_ID` для WebAuthn.

---

## 5. Шифрование

### 5.1 Секреты приложения в БД (делать в первую очередь)
- **CRM `accessToken` сейчас в открытом виде** (`crm_integrations.accessToken`) — прямой риск при утечке дампа. Также TOTP‑секреты (Фаза 1) и refresh‑токены CRM.
- Внедрить `lib/crypto/secrets.ts` — **AES‑256‑GCM** (`node:crypto`), ключ `SECRETS_ENCRYPTION_KEY` (base64, 32 байта) из env. Формат хранения: `v1:<iv_b64>:<tag_b64>:<ct_b64>`.
- Мигрировать запись/чтение CRM‑токенов через `encrypt()/decrypt()`; one‑shot скрипт для существующих строк.
- Роутинг ключей: держать `SECRETS_ENCRYPTION_KEY` только в проде‑секретах (Vercel env), не в git.

### 5.2 Данные «в покое» и «в транзите» (уже частично есть)
- В транзите: HTTPS + HSTS (есть). Supabase Postgres — TLS.
- В покое: Supabase шифрует диски на уровне платформы. Дополнительно — приложенческое шифрование чувствительных **полей** (§5.1), а не всей таблицы.
- Пароли: Supabase хэширует внутри (bcrypt). Наш Prisma‑bcrypt cost=10 — мёртвый путь; при удалении не важен, иначе поднять до 12.

### 5.3 Что НЕ нужно
- Client‑side E2E‑шифрование бизнес‑данных сломало бы серверную аналитику/AI (им нужен доступ к открытому тексту). Не делаем без явного требования «нулевого доступа сервера».

---

## 6. SMS‑OTP — что требуется

Supabase Auth поддерживает phone/SMS, но нужен **провайдер** и его креды. Для Казахстана (KZT/.kz) деливери и цена зависят от локального провайдера:
- **Международные:** Twilio, Vonage, MessageBird — просто, дороже, вопросы к деливери в РК.
- **Локальные КЗ:** Mobizon, SMSC.kz, Kazinfoteh, Beeline Business — лучше деливери/цена, интеграция руками.

Каркас: `lib/sms/provider.ts` (интерфейс `sendOtp(phone, code)`), таблица `phone_otp(user_id, code_hash, expires_at, attempts)`, маршруты `request`/`verify`, rate‑limit по номеру и IP. **Блокер:** выбор провайдера + креды (`SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER`).

---

## 7. Блокчейн — честная оценка

**Идея «передавать данные пользователя по блокчейну».** Как **транспорт/хранилище пользовательских данных — не рекомендуется:**
- Публичный блокчейн **необратим и публичен** → прямое нарушение приватности и права на удаление (GDPR/152‑ФЗ/казахстанский закон о ПДн). Персональные данные в цепочке нельзя стереть.
- Пропускная способность/латентность/стоимость на порядки хуже Postgres. Для портала аналитики это чистый оверхед без выгоды.
- «Приватный блокчейн на 1 организацию» = сложная БД без децентрализации — смысла нет.

**Где блокчейн/крипто‑примитивы уместны и дают реальную ценность:**
1. **Якорение хэшей журнала аудита (tamper‑evidence).** У вас уже есть иммутабельный `audit_logs`. Строим hash‑chain (каждая запись включает хэш предыдущей) + периодически публикуем корневой хэш (Merkle root) во внешний якорь (публичный чейн или RFC‑3161 timestamp). Это доказывает, что журнал не переписывали задним числом. **Данные остаются в Postgres — в чейн уходит только хэш.** Дёшево, юридически чисто, реально полезно для «institutional grade».
2. **Подписанные, проверяемые отчёты.** Хэш PDF‑отчёта + подпись → любой может проверить подлинность/целостность экспортированного GRI‑отчёта. Не требует блокчейна вовсе (достаточно подписи), но можно заякорить хэш.

**Рекомендация:** не строить блокчейн‑транспорт. Если нужна «неподделываемость» (а именно это обычно стоит за запросом) — сделать **hash‑chain журнала аудита + опциональное якорение Merkle‑root**. Это отдельный небольшой воркстрим, не блокирует 2FA.

---

## 8. Приоритеты и статус

1. ✅ **Сделано:** Critical + High + дешёвые Medium (эта сессия).
2. ✅ **Фаза 1: TOTP‑2FA + резервные коды — РЕАЛИЗОВАНО** (эта сессия). Решения по архитектуре: единый app‑слой (Вариант B), passkey как второй фактор/step‑up, SMS позже, блокчейн = hash‑chain журнала аудита.
3. **Шифрование CRM‑токенов** (§5.1) — фундамент `lib/crypto/secrets.ts` уже готов, осталось применить к `crm_integrations`.
4. ✅ **Фаза 2: Passkey / Face ID / Touch ID (WebAuthn, второй фактор) — РЕАЛИЗОВАНО** (эта сессия).
5. **Шифрование CRM‑токенов** + **оставшиеся Medium** (M5 xlsx, M6 public uploads, M7 client/register, M8 next‑bump).
6. **Фаза 3: SMS** (после выбора провайдера).
7. **Low‑бэклог** + hash‑chain журнала аудита.

### Что реализовано в Фазе 2 (Passkey / Face ID / Touch ID)
- Библиотеки: `lib/webauthn/{config,challenge,store}.ts` (RP‑конфиг из `NEXT_PUBLIC_APP_ORIGIN`/`WEBAUTHN_RP_ID`; подписанная кука вызова‑challenge на HMAC; service‑role доступ к `webauthn_credentials`). Стек: `@simplewebauthn/server` + `/browser` v9.
- Таблица `webauthn_credentials` — уже была в миграции 039 (отдельная миграция не нужна).
- API: `/api/v1/security/webauthn/register/{options,verify}`, `/authenticate/{options,verify}`, `/credentials` (GET список + DELETE). Регистрация первого ключа как первого фактора автоматически выдаёт резервные коды (защита от потери устройства).
- Enforcement: тот же step‑up‑гейт — passkey **выставляет ту же куку `aistart360_mfa`**, флаг `user_metadata.mfa_webauthn` расширил условие гейта в `middleware.ts` (TOTP **или** passkey).
- UI: рабочая карточка «Вход по биометрии» в настройках (список ключей, добавить Face ID/Touch ID/ключ, удалить) + кнопка «Войти по Face ID/Touch ID/ключом» на странице `/2fa`.
- Проверка: `tsc` = 0 ошибок; крипто‑логику куки‑challenge (подпись/проверка/чужой‑user/чужой‑purpose/просрочка/подмена) прогнал — все ✓. Сами WebAuthn‑церемонии требуют браузера → тестировать вручную после деплоя.

> ⚠️ **Env для Фазы 2:** в проде задать `NEXT_PUBLIC_APP_ORIGIN` (напр. `https://app.aistart360.app`) — из него берётся `rpID` и `expectedOrigin`. В dev берётся из Origin‑заголовка (`localhost`). `AUTH_SECRET` переиспользуется для куки‑challenge. Отдельная миграция не нужна (таблица в 039).

### Что реализовано в Фазе 1 (TOTP‑2FA)
- Библиотеки: `lib/crypto/secrets.ts` (AES‑256‑GCM), `lib/mfa/{totp,backup-codes,step-up,step-up-edge,store}.ts` (TOTP по RFC 6238 — проверен на официальных тест‑векторах; резервные коды bcrypt; step‑up‑кука HMAC для Node и Edge).
- Миграция `supabase/migrations/039_user_security.sql`: таблицы `user_security` (+ `webauthn_credentials` для Фазы 2), RLS on, только service‑role.
- API: `/api/v1/security/2fa/{setup,verify,disable,status,challenge}` + `/api/v1/security/backup-codes/regenerate` (все с per‑user rate‑limit и логированием в журнал безопасности).
- Enforcement: MFA‑gate в `middleware.ts` (флаг `user_metadata.mfa_totp` из подписанного JWT + проверка step‑up‑куки), страница челленджа `app/2fa/page.tsx`.
- UI: рабочая карточка 2FA в `components/settings/SettingsClient.tsx` (QR, ввод кода, показ резервных кодов один раз, отключение, перевыпуск кодов).
- Проверка: `tsc --noEmit` = 0 ошибок; дымовой прогон крипто‑логики (шифрование/TOTP/резервные коды/step‑up Node↔Edge) — все ✓.

### Чтобы включить Фазу 1 в проде (руками)
```bash
# 1. Сгенерировать ключ шифрования (32 байта) и добавить в env:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#   → SECRETS_ENCRYPTION_KEY=<полученное значение>   (Vercel env / .env.local)
#   Убедиться, что AUTH_SECRET задан (используется для step-up и внутренних токенов).
# 2. Применить миграцию:
node scripts/apply-migration.js supabase/migrations/039_user_security.sql
# 3. Дымовой тест: включить 2FA в Настройки→Безопасность, выйти, войти → /2fa, ввести код.
```
> ⚠️ Все правки этой сессии затрагивают боевые потоки (онбординг, диагностика, вход). Проверены компиляцией и юнит‑логикой, но **перед деплоем нужен прогон против реального Supabase** (в worktree нет `.env.local`).

---

## 9. Что нужно от вас (решения/креды)

- [ ] Архитектура MFA: **Вариант B** (единый слой, рекомендую) или A (только Supabase TOTP)?
- [ ] Режим Passkey: беспарольный вход (заменяет пароль) или только второй фактор/step‑up?
- [ ] SMS‑провайдер (Twilio / локальный КЗ / позже) + креды.
- [ ] Глубина блокчейна: пропустить / hash‑chain журнала аудита / полноценно.
- [ ] Прод‑env: подтвердить `AUTH_SECRET`; добавить `SECRETS_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`, `WEBAUTHN_RP_ID`/`NEXT_PUBLIC_APP_ORIGIN`.
- [ ] Дымовой прогон исправлений этой сессии против реального Supabase перед деплоем.
