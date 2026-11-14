# Конфигурация Railway: railway.json → .railway/railway.ts (R-020)

## Что изменилось у Railway

- `railway.json` / `railway.toml` (Config as Code) **устарели**. Railway читает их только для сервисов,
  которые уже ими пользуются, и только **до 2026-12-01** (жёсткая дата). Новые сервисы включить Config
  as Code не могут.
- Замена — Infrastructure as Code: файл `.railway/railway.ts` (`import … from "railway/iac"`).
  **Railway не читает `.railway/` при деплое.** Файл применяет только CLI (`railway config plan` →
  `railway config apply`) или GitHub Action `railwayapp/config@v1`. Пока никто не выполнил `apply`,
  файл ни на что не влияет.

Источник: docs.railway.com → Build & deploy → Using Config as Code / Infrastructure as Code (IaC),
CLI → railway config (проверено 2026-11-14).

## Как сейчас настроен портал

Сервис `portal` (проект `aistart360-portal`, регион ams) создан после ухода Config as Code и
**`railway.json` не читает**: его настройки заданы в самом сервисе (2026-11-04, `update-service`):

| Настройка | Значение |
|---|---|
| Сборка | Railpack, `npm run build` |
| Запуск | `node node_modules/next/dist/bin/next start -H 0.0.0.0` (`-H 0.0.0.0` — слушать IPv4) |
| Pre-deploy | `node scripts/railway/predeploy.mjs` (таблицы очереди Workflow; при `PORTAL_ROLE=agents` ничего не делает) |
| Healthcheck | `/api/healthz`, таймаут 300 с |
| Перезапуск | `ON_FAILURE` |
| Перекрытие / дренаж | 45 с / 60 с (дренаж > 55 с ожидания в `lib/runtime/server-start.ts`) |
| Регион, реплики | europe-west4 (ams), 1 |

Сервис агентов (`PORTAL_ROLE=agents`, `docs/railway-agents-service.md`) собирается из того же
репозитория. Читает ли он `railway.json`, нужно проверить (шаг 1 ниже).

Отсюда главный вывод: **после 2026-12-01 поведение портала не изменится** — он и сейчас живёт на
настройках сервиса. `.railway/railway.ts` нужен, чтобы эти настройки хранились в git и менялись через
ревью, а не руками в панели.

## Что лежит в репозитории

- `railway.json` — **устаревший**, оставлен как справка (тот же набор настроек). Не удалять, пока
  не выполнен шаг 4. Railway перестанет его читать 2026-12-01.
- `.railway/railway.ts` — **черновик, не применён**. Повторяет таблицу выше; `export const partial =
  "portal"` — файл управляет только своими ресурсами. Без `partial` IaC **удалил бы** все сервисы
  проекта, которых нет в файле (собственный Supabase, Postgres, db-backup, бакет…).
  Поля pre-deploy, restart, overlap, draining закомментированы: их точные имена в IaC-DSL по
  документации подтвердить не удалось — берутся из `railway config pull`.
- Файл вне TypeScript-проекта: шаблон `**` в `tsconfig.json` пропускает папки с точкой, поэтому
  `tsc`/`next build` его не проверяют (пакет `railway` в зависимостях не нужен).

## Подключение (делает PO или DevOps с доступом к проекту; всё — сначала на staging)

1. **Разведка, ничего не меняет.** В корне репозитория:
   ```bash
   railway link                                   # проект aistart360-portal, окружение staging
   railway config migrate                         # ПРЕВЬЮ без --apply: какие сервисы ещё на Config as Code
   railway config pull --file /tmp/railway.pulled.ts   # текущее состояние окружения в DSL
   ```
   Если `migrate` нашёл сервис на Config as Code (например, сервис агентов) — его нужно перевести
   до 2026-12-01, иначе после этой даты его настройки, заданные только файлом, перестанут
   применяться.
2. `npm i -D railway` (SDK для `railway/iac`; отдельным PR, без него `plan` не запустится).
3. Сверить `.railway/railway.ts` с `/tmp/railway.pulled.ts`: перенести точные имена полей
   pre-deploy / restart / overlap / draining, добавить сервис агентов под его настоящим именем.
   **Переменные в файл не добавлять** — секреты остаются в Railway.
4. `railway config plan` на staging → изменений быть **не должно** (файл только повторяет текущие
   настройки). Любое «delete»/«update» — стоп, разобраться. Затем `railway config apply` на staging,
   `railway up` на staging, проверить `/api/healthz` и логи старта.
5. То же для production. После этого очистить в настройках сервисов поле «config file path», если оно
   задано, и пометить/удалить `railway.json` отдельным PR.
6. По желанию: GitHub Action `railwayapp/config@v1` (plan на PR, apply после слияния) с
   `RAILWAY_TOKEN` — токен проекта создаёт PO в панели Railway.

## Откат

- До `apply` откатывать нечего: файл инертен (удалить `.railway/` — достаточно).
- После `apply`: настройки сервиса меняются только тем, что показал `plan`. Откат — вернуть значения
  из таблицы выше в панели Railway (Settings сервиса) или `git revert` изменения в `.railway/railway.ts`
  и снова `plan`/`apply`. Владение ресурсами снимается `railway config` ownership-командами
  (release/transfer меняют только метаданные, сервисы не трогают).
- Деплой портала от этого не зависит: `railway up` берёт настройки сервиса.
