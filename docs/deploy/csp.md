# Content-Security-Policy и адрес клиента (R-013, R-135, R-049)

## CSP собирается из переменных окружения

`next.config.mjs` берёт политику из `lib/security/csp.mjs` (чистая функция, тесты —
`tests/unit/security/csp.test.ts`). Источники:

| Директива | Откуда |
|---|---|
| `connect-src` | `'self'`, origin `NEXT_PUBLIC_SUPABASE_URL` и его `wss://` (Realtime), шрифты Google, origin «Рынка» |
| `media-src` | `'self'` и origin `NEXT_PUBLIC_SUPABASE_URL` (видео из бакета cms-media) |
| `frame-src` | `'self'`, origin «Рынка», youtube-nocookie, vimeo |
| `images.remotePatterns` | хост `NEXT_PUBLIC_SUPABASE_URL` и `lh3.googleusercontent.com` |

- Шаблона `*.supabase.co` больше нет: раньше он позволял внедрённому скрипту отправлять данные в любой
  облачный проект Supabase, а свой `https://supabase.aistart360.app` и `wss:` при этом не разрешал.
- «Рынок» (`NEXT_PUBLIC_MARKET_APP_URL`) попадает в production-сборку, только если задан и не указывает
  на localhost/127.0.0.1. Локально по умолчанию — `http://localhost:5173`.
- Оба значения `NEXT_PUBLIC_*` подставляются **при сборке**: смена адреса Supabase = пересборка.
  Если при сборке переменной нет или она неверна, в логе сборки появляется блок
  `[next.config] CSP / security config WARNINGS` — такую сборку не выкатывать.
- `lib/cms/blocks.ts` (`videoEmbed`) тоже принимает прямые видеофайлы только с хоста
  `NEXT_PUBLIC_SUPABASE_URL`.

Окружения: production — `https://supabase.aistart360.app` (свой Supabase на Railway); staging —
`https://<адрес staging будет позже>`; облачный проект supabase.com — только резерв, новые окружения на
него не направлять.

Проверка после выката: `curl -sI https://portal.aistart360.app/ | grep -i content-security-policy` —
в `connect-src` должны быть `https://supabase.aistart360.app wss://supabase.aistart360.app`, без
`supabase.co` и без `localhost`.

## Почему `script-src 'unsafe-inline'` пока остаётся (оценка nonce-CSP)

Next 14.2 вставляет собственные inline-скрипты (bootstrap, данные RSC) без nonce. Nonce-CSP требует:

1. В `middleware.ts` на каждый запрос генерировать nonce и ставить CSP (`'nonce-…' 'strict-dynamic'`)
   в заголовок запроса и ответа; убрать CSP из `next.config.mjs` для страниц.
2. Все страницы — только динамический рендер (nonce уникален на запрос): теряются статическая
   оптимизация и кеш страниц, растёт время ответа и нагрузка на один экземпляр Railway.
3. Передать nonce в свои inline-скрипты (3 места с `dangerouslySetInnerHTML`, `next/script`) и
   проверить PWA/service worker, встраивание «Рынка», Realtime.

Оценка: 2–3 дня работы + полный ручной прогон кабинетов и замер скорости. `style-src 'unsafe-inline'`
останется в любом случае (Tailwind/framer-motion ставят inline-стили). Решение — за PO после
снятия режима техработ.

## Адрес клиента (R-049)

Единственный источник — `lib/net/client-ip.ts`:

1. `X-Real-IP` — его выставляет edge Railway («X-Real-IP for identifying client's remote IP»,
   docs.railway.com → Networking → Specs & Limits); Vercel тоже.
2. Иначе `X-Forwarded-For`: запись на `TRUSTED_PROXY_HOPS` позиций **справа** (по умолчанию 1).
   Левые записи пишет клиент — им не верим.
3. Иначе `null` (`'unknown'` для ключей лимитов).

Используют: `lib/rate-limit.ts` (`clientIp`, все IP-лимиты), `lib/geo/country.ts`,
`lib/activity/log.ts`.

Проверка на проде (один раз, после выката): `curl -s -H 'X-Real-IP: 1.2.3.4' -H 'X-Forwarded-For: 5.6.7.8'
https://portal.aistart360.app/api/healthz` и посмотреть в HTTP-логах Railway/журнале активности, что
записан реальный адрес, а не 1.2.3.4/5.6.7.8. Если edge Railway пропускает клиентский `X-Real-IP` —
написать в отчёт и переключить источник (код читает `X-Real-IP` первым).
