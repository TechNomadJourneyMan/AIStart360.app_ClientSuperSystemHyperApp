# HONOR GROUP / myhonor.shop в AIStart360

## Что считается фактом

Публичный профиль зафиксирован в
`lib/demo/myhonor-public-profile.json` и проверен 29 июля 2026 года по:

- https://myhonor.shop/
- https://myhonor.shop/catalog

В профиль входят только опубликованные самим магазином сведения: казахстанское
собственное производство с 2024 года, интернет-магазин, доставка по РК,
три магазина, 88 товаров в каталоге на дату проверки, категории outdoor /
охота / рыбалка и HONOR Club.

Выручка, маржа, конверсия, остатки, средний чек и другие частные KPI не
подставляются. В Journey они отмечены как неизвестные.

## Быстрый тест без базы

Откройте:

`/journey?demo=myhonor`

Сценарий создаётся локально в браузере, не затрагивает аккаунт пользователя и
не отправляет запросы в Journey API. Точка B «+20% за 6 месяцев» явно
обозначена как тестовая гипотеза, а не как реальная цель HONOR GROUP.

## Staging-клиент в Supabase

Задайте в локальном `.env.local` или в одноразовом окружении:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
MYHONOR_DEMO_EMAIL=
MYHONOR_DEMO_PASSWORD=
```

Затем выполните:

```bash
npm run seed:myhonor
```

Скрипт идемпотентно создаёт или обновляет одобренного клиента с vertical
`ecommerce`, компанию HONOR GROUP и только публичные ответы анкеты. Пароль
должен быть не короче 12 символов и не выводится в консоль.

После входа клиент попадает в канонический `/dashboard`. Специализированные
`/client/dashboard-ecommerce` и `/client/dashboard-medical` остаются только
отдельными preview-маршрутами и больше не являются финалом анкет.

## Заказы и WhatsApp

Серверный endpoint:

`POST /api/v1/integrations/myhonor/order-notifications`

работает только после применения миграции
`073_myhonor_order_notifications.sql` и настройки закрытого API-ключа,
WhatsApp Cloud token / phone number id и четырёх одобренных шаблонов из
`.env.example`. Повторные события дедуплицируются и обрабатываются durable
Workflow.
