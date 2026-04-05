# Contract: Server Actions — Auth & Password Reset

**File**: `app/actions/auth.ts`
**Date**: 2026-03-30

---

## loginAction

```typescript
loginAction(email: string, password: string): Promise<LoginResult>
```

**Input** (Zod validated):
```typescript
z.object({
  email:    z.string().email(),
  password: z.string().min(8),
})
```

**Success response**:
```typescript
{
  success: true,
  user: {
    id:           string,   // cuid
    email:        string,
    name:         string | null,
    role:         'admin' | 'expert' | 'owner' | 'client',
    organization: string,  // org.name
  }
}
```

**Error response**:
```typescript
{ error: 'USER_NOT_FOUND' | 'WRONG_PASSWORD' | 'UNKNOWN' }
```

**Side effects**:
- Устанавливает `aistart360_role` и `aistart360_user_id` cookies (maxAge: 604800)
- Обновляет `users.lastLogin`

---

## registerAction

```typescript
registerAction(data: RegisterInput): Promise<RegisterResult>
```

**Input** (Zod validated):
```typescript
z.object({
  name:         z.string().min(2),
  email:        z.string().email(),
  password:     z.string().min(8),
  role:         z.enum(['admin', 'expert', 'owner', 'client']).optional(),
  organization: z.string().optional(),
  position:     z.string().optional(),
})
```

**Success response**: аналогично `loginAction.success`

**Error response**:
```typescript
{ error: 'EMAIL_TAKEN' | 'UNKNOWN' }
```

**Side effects**: устанавливает cookies, создаёт `Organization` если нет.

---

## logoutAction *(новый)*

```typescript
logoutAction(): Promise<void>
```

**Side effects**: удаляет cookies `aistart360_role` и `aistart360_user_id`
(устанавливает `maxAge: 0`), редиректит на `/login`.

---

## resetPasswordRequestAction *(новый)*

```typescript
resetPasswordRequestAction(email: string): Promise<{ success: true }>
```

**Input** (Zod validated):
```typescript
z.object({ email: z.string().email() })
```

**Always returns** `{ success: true }` — нейтральный ответ защищает от user enumeration.

**Side effects**:
- Если email найден: создаёт `VerificationToken`, отправляет письмо через Resend.
- Если email не найден: ничего не делает (ответ тот же).

---

## resetPasswordAction *(новый)*

```typescript
resetPasswordAction(token: string, email: string, newPassword: string): Promise<ResetResult>
```

**Input** (Zod validated):
```typescript
z.object({
  token:       z.string().length(64),
  email:       z.string().email(),
  newPassword: z.string().min(8),
})
```

**Success response**: `{ success: true }`

**Error response**:
```typescript
{ error: 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'USER_NOT_FOUND' | 'UNKNOWN' }
```

**Side effects**:
- Обновляет `users.passwordHash` (bcrypt, rounds=10)
- Удаляет `VerificationToken`
- НЕ устанавливает cookies — пользователь должен войти заново
