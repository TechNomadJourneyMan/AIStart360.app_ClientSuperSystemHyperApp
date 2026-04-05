# AIStart360.app_ClientSuperSystemHyperApp
Клиентский портал AIStart360.app

## Локальный запуск

1. Установить зависимости:
	npm install
2. Заполнить переменные окружения в `.env` или `.env.local`:
	- `DATABASE_URL`
	- `DIRECT_URL`
	- `NEXT_PUBLIC_SUPABASE_URL`
	- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
	- `SUPABASE_SERVICE_ROLE_KEY`
	- `NEXTAUTH_SECRET`
	- `NEXTAUTH_URL`
	- `RESEND_API_KEY` (обязательно для восстановления пароля)
3. Запустить проект:
	npm run dev
