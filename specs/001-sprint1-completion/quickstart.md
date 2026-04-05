# Quickstart: Верификация Sprint 1

**Branch**: `001-sprint1-completion` | **Date**: 2026-03-30

Пошаговая проверка того, что реализация соответствует спецификации.
Выполняй по порядку. Каждый шаг — независимый checkpoint.

---

## Шаг 1 — Проверка отсутствия btoa/atob

```bash
grep -r "btoa\|atob" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules \
  .
```

**Ожидаемый результат**: пустой вывод (0 совпадений).

---

## Шаг 2 — Проверка build

```bash
npm run build
```

**Ожидаемый результат**: `✓ Compiled successfully` без ошибок TypeScript.

---

## Шаг 3 — Проверка loading.tsx в каждом (dashboard) маршруте

```bash
for dir in app/\(dashboard\)/*/; do
  if [ ! -f "${dir}loading.tsx" ]; then
    echo "MISSING loading.tsx in $dir"
  fi
done
echo "Check complete"
```

**Ожидаемый результат**: только строка `Check complete`, без `MISSING`.

---

## Шаг 4 — Проверка error.tsx

```bash
ls app/error.tsx app/global-error.tsx
```

**Ожидаемый результат**: оба файла найдены.

---

## Шаг 5 — Проверка RBAC (без cookies)

```bash
# Запусти dev-сервер: npm run dev
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard
```

**Ожидаемый результат**: `307` (редирект на /login).

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/client/waiting-room
```

**Ожидаемый результат**: `307`.

---

## Шаг 6 — Проверка входа и реальных данных на /settings

1. Открой `http://localhost:3000/login`
2. Войди под существующим пользователем из БД (не seed из auth.service.ts)
3. Перейди на `http://localhost:3000/settings`
4. Убедись, что email совпадает с тем, под которым вошёл
5. Повтори с другим пользователем — email должен быть другим

---

## Шаг 7 — Проверка Dashboard KPI (не mock)

1. Будучи залогиненным как admin, открой `http://localhost:3000/dashboard`
2. Убедись, что KPI-блоки не показывают статичные значения `84 200 000` или `48`
3. Открой `app/(dashboard)/dashboard/page.tsx` — там не должно быть импорта `MOCK_KPI`

---

## Шаг 8 — Проверка восстановления пароля

1. Открой `http://localhost:3000/forgot-password`
2. Введи реальный email зарегистрированного пользователя
3. Нажми «Отправить»
4. Проверь почту в течение 60 секунд — должно прийти письмо
5. Перейди по ссылке — должна открыться форма нового пароля
6. Введи новый пароль → должен быть редирект на `/login`
7. Войди с новым паролем — должно работать

---

## Шаг 9 — Тесты

```bash
npm run test
```

**Ожидаемый результат**: все тесты зелёные, 0 failed.

---

## Шаг 10 — Финальный sprint gate

```bash
# Запусти все gate-проверки из constitution
grep -r "btoa\|atob" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules . | wc -l
# → 0

npm run build 2>&1 | grep -E "error|Error" | grep -v "node_modules"
# → пустой вывод

npm run test 2>&1 | tail -5
# → все зелёные
```
