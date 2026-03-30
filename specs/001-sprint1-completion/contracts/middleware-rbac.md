# Contract: Middleware Route Protection Matrix

**File**: `middleware.ts`
**Date**: 2026-03-30

---

## Правила защиты маршрутов

| Маршрут | Без куки | client | expert | owner | admin | super_admin |
|---------|----------|--------|--------|-------|-------|-------------|
| `/login`, `/register`, `/forgot-password` | ✅ доступ | → role dashboard | → role dashboard | → role dashboard | → role dashboard | → /admin-giga-panel |
| `/dashboard/*` | → /login | → /login | → /expert/dashboard | → /owner/dashboard | ✅ | → /admin-giga-panel |
| `/expert/*` | → /login | → /login | ✅ | → /owner/dashboard | → /dashboard | → /admin-giga-panel |
| `/owner/*` | → /login | → /login | → /expert/dashboard | ✅ | → /dashboard | → /admin-giga-panel |
| `/client/*` | → /login | ✅ | → /expert/dashboard | → /owner/dashboard | → /dashboard | → /admin-giga-panel |
| `/admin-giga-panel/*` | → /giga-login | → /giga-login | → /giga-login | → /giga-login | → /giga-login | ✅ |
| `/_next/*`, `/api/*`, `/` | ✅ всегда | ✅ | ✅ | ✅ | ✅ | ✅ |

## Логика неизвестной роли

Кука `aistart360_role` с неизвестным значением (не из списка выше) →
редирект на `/login` (обрабатывается как отсутствие куки).

## Cookie параметры

```typescript
{
  httpOnly: true,
  sameSite: 'lax',
  path:     '/',
  maxAge:   604800,  // 7 дней
  // secure: true — автоматически на Vercel production
}
```
