# AIStart360.app_ClientSuperSystemHyperApp
Клиентский портал AIStart360.app

## Локальный запуск

1. Установить зависимости:
	npm install
2. Скопировать `.env.example` в `.env.local` и заполнить как минимум:
	- `DATABASE_URL`
	- `DIRECT_URL`
	- `NEXT_PUBLIC_SUPABASE_URL`
	- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
	- `SUPABASE_SERVICE_ROLE_KEY`
	- `AUTH_SECRET`
	- `AUTH_URL`
	- `OPENROUTER_API_KEY`
	- `JOURNEY_CONNECT_CODE_SECRET` (минимум 32 случайных байта, только сервер)
	- `RESEND_API_KEY` (обязательно для восстановления пароля)
3. Запустить проект:
	npm run dev

Экспериментальная AI-first рабочая область доступна по `/journey` и
`/client/journey`. Для устойчивого хранения и синхронизации устройств примените
миграции `069_ai_first_workspace.sql` и `070_ai_journey_device_sync.sql`.
