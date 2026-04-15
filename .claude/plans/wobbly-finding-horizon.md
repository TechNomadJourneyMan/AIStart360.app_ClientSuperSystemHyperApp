# План: Создание проекта BookReader

## Контекст
Пользователь подготовил конфигурационные файлы Claude Code для нового проекта **BookReader** — кроссплатформенной читалки (iOS + Android + Web). Нужно развернуть полный монорепо с нуля, используя эти конфиги как основу.

**Стек:** Turborepo + pnpm, Expo SDK 52, React Native 0.76, TypeScript strict, Reanimated 3, Skia, Tamagui, Zustand, TanStack Query, Supabase, RevenueCat, PostHog, Sentry.

**Путь проекта:** `~/Documents/Проекты /bookreader`

## Текущее окружение
- Node.js v20.11.0 (`/usr/local/bin/node`)
- npm 10.2.4
- **pnpm не установлен** — нужно установить через `npm install -g pnpm` или `corepack enable`

---

## Шаги

### 1. Установить pnpm
```bash
/usr/local/bin/node /usr/local/bin/npm install -g pnpm
```

### 2. Создать структуру директорий
```
bookreader/
├── .claude/
├── apps/
│   └── mobile/
│       └── app/           — Expo Router screens
│       └── src/
│           └── components/
│           └── hooks/
│       └── assets/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── parsers/
│   │       ├── reader/
│   │       ├── sync/
│   │       └── types/
│   ├── ui/
│   │   └── src/
│   ├── api/
│   │   └── src/
│   └── db/
│       └── migrations/
├── services/
│   └── converter/
├── supabase/
│   ├── functions/
│   └── migrations/
```

### 3. Разложить Claude Code конфиги
- `CLAUDE.md` → корень проекта
- `CLAUDE_mobile.md` → `apps/mobile/CLAUDE.md`
- `CLAUDE_core.md` → `packages/core/CLAUDE.md`
- `settings.json` → `.claude/settings.json`
- `claudeignore.txt` → `.claudeignore`

### 4. Инициализировать монорепо
- `pnpm init` в корне
- Создать `pnpm-workspace.yaml`
- Создать `turbo.json`

### 5. Настроить корневые конфиги
- `tsconfig.base.json` — общий TypeScript конфиг
- `.prettierrc` + `.prettierignore`
- `eslint.config.mjs` (ESLint flat config)
- `.gitignore` (на основе .claudeignore + дополнения)
- `.editorconfig`

### 6. Создать packages/core
- `package.json` с `@bookreader/core`
- `tsconfig.json` (extends base)
- `tsup.config.ts` → ESM + CJS + типы
- `vitest.config.ts`
- `src/index.ts` — заглушка публичного API
- `src/parsers/types.ts` — базовые типы Book, Chapter, Metadata

### 7. Создать packages/db
- `package.json` с `@bookreader/db`
- `tsconfig.json`
- `migrations/0001_initial.sql` — пустой шаблон
- `src/index.ts` — реэкспорт типов

### 8. Создать packages/api
- `package.json` с `@bookreader/api`
- `tsconfig.json`
- `src/index.ts` — заглушка Supabase клиента

### 9. Создать packages/ui
- `package.json` с `@bookreader/ui`
- `tsconfig.json`
- `src/index.ts` — заглушка

### 10. Создать apps/mobile (Expo)
- Инициализировать Expo app: `npx create-expo-app@latest apps/mobile --template blank-typescript`
- Или вручную: `package.json`, `app.json`/`app.config.ts`, `tsconfig.json`, `babel.config.js`
- Файловая маршрутизация: `app/_layout.tsx`, `app/(tabs)/library.tsx` и др.
- Положить `CLAUDE.md` для mobile

### 11. Установить зависимости
```bash
pnpm install
```

### 12. Инициализировать Git
```bash
git init
git add .
git commit -m "feat: initial monorepo setup for BookReader"
```

## Ключевые файлы из zip-архива
- `/tmp/files_zip_contents/CLAUDE.md`
- `/tmp/files_zip_contents/CLAUDE_mobile.md`
- `/tmp/files_zip_contents/CLAUDE_core.md`
- `/tmp/files_zip_contents/settings.json`
- `/tmp/files_zip_contents/claudeignore.txt`

## Верификация
1. `pnpm install` — без ошибок
2. `pnpm type-check` (или `tsc --noEmit`) — без ошибок
3. `pnpm --filter core build` — собирает dist/
4. Структура соответствует CLAUDE.md
5. Все CLAUDE.md файлы на местах
