# Фаза 6: Пакет VIII «Доступ и тарифы» + лендинг «GRI Health Check» — Implementation Plan

> По спеке `2026-07-08-ux-ideas-competitors.md` §5.4 (решение ПО) + позиционирование Option 2. ⚠ ГЛАВНЫЙ УРОК аудита 2026-07-04 ([[aistart360-admin-audit-2026-07-04]]): админ-мутации ОБЯЗАНЫ идти под реальной сессией (RLS работает) и проверять число затронутых строк — «кнопки, которые выглядят рабочими, но молча не работают» уже были причиной инцидента (giga shared-password → auth.uid() null → RLS тихо дропает UPDATE profiles).

**Goal:** Self-serve активация без ручного одобрения; полный GRI — платная функция; рабочие админ-кнопки лимитов доступа free-пользователей; лендинг переориентирован на «GRI Health Check».

## ✅ Решение ПО получено (2026-07-09): ВАРИАНТ А
free = mini-GRI + Пульс + мини-CRM + **1 демо-проход полного GRI**; pro = повторные
полные GRI, PDF-экспорт, AI-чат, бенчмарки. Тиры: free/pro. Эквайринг НЕ включаем —
гейты поверх флагов, CTA ведёт на биллинг-заглушку.

## Статус (2026-07-09, вечерний спринт) — СДЕЛАНО
- ✅ 6A модель (772dc7f): миграция 048 (tier+feature_flags), entitlements/server/gate.
- ✅ 6A энфорсмент (fe827a7): системный тумблер `access_gates` (default OFF —
  fail-safe); гейты в POST gri/assessment (402 после лимита), converse+ask
  (AI-чат; скриптовый /chat и туры Гри free); GET /api/v1/access/me + useEntitlements.
- ✅ 6B авто-одобрение (fe827a7): `auto_approve_clients` (default ON) — в режиме
  approval self-serve роли одобряются сами; тумблер у супер-админа.
- ✅ 6C админ-кнопки (fe827a7 + 783dfef): системные тумблеры в RegistrationModeControl;
  per-user Тариф(Free/Pro)+4 фича-override в UserDetailPanel; PATCH/GET
  /api/giga-admin/users/[id]/access — service-client + проверка затронутых строк
  (409 при 0) + audit (урок 2026-07-04 соблюдён).
- ✅ 6D UpgradeGate (fe827a7): paywall-экран, «Пройти заново» в GRIAssessment.
- ✅ 6E лендинг (7d10eeb): «GRI Health Check» — hero «за 5 минут», честные секции,
  валюта по x-vercel-ip-country.
- ✅ 6F smoke: авторизованный HTTP-прогон (access/me: gatesEnabled=false → ничего
  не ограничено; 401/403-гейты всех новых роутов; 200 SSR-страниц).

ОСТАЛОСЬ (прод-активация, НЕ код): применить миграцию 048 → выставить тиры
существующим (или оставить free: у них уже ≥1 GRI — лимит их коснётся!) →
включить тумблер «Гейты тарифов» в giga-admin. ВАЖНО: включение гейтов при
free-базе означает, что все существующие с ≥1 assessment теряют пересчёт GRI —
включать осознанно, вместе с коммуникацией/промо Pro.

## Батч 6A — Модель доступа (feature-флаги)
- Миграция 048: `profiles.tier TEXT DEFAULT 'free'` + `profiles.feature_flags JSONB DEFAULT '{}'` (per-user override); либо таблица `access_tiers`. RLS: читать может сам пользователь; писать — только staff (через service-client, НЕ под giga-сессией).
- `lib/access/entitlements.ts` (чистое): `can(user, feature)` из tier + per-user override. Фичи: `gri_full`, `pdf_export`, `ai_chat`, `benchmarks`. Тесты.
- Гейт на сервере: `/api/v1/gri/assessment` (полный GRI), PDF-роут, чат-роут проверяют `can(...)` → 402/403 + маркер upgrade. НЕ доверять клиенту.

## Батч 6B — Авто-одобрение self-serve (№15)
- `getRegistrationMode` уже есть (open|approval|invite). Self-serve client-регистрация → авто-approved (status='approved') кроме staff-ролей и при флаге `manual_moderation`. Реюз `applyApprovalDecision`. Тест на режимы.

## Батч 6C — Админ-кнопки лимитов (рабочие!)
- В `giga-admin` панель: на карточке пользователя — переключатели tier + per-feature флаги.
- API `/api/giga-admin/users/[id]/access` PATCH под service-client, **обязательно `.select()` и проверка `data.length` → 409/500 если 0 строк** (урок аудита). Оптимистичный UI + рефетч (не полагаться на «выглядит применилось»).
- Тест: PATCH меняет флаг; при 0 затронутых строк — честная ошибка.

## Батч 6D — Paywall-экраны (№25)
- Изящный upgrade-экран при упоре в лимит (`components/access/UpgradeGate.tsx`): что даёт тариф, CTA (пока → страница тарифов/заглушка оплаты). Без включения эквайринга.

## Батч 6E — Лендинг «GRI Health Check»
- Переориентировать заголовки/тексты лендинга на «проверьте готовность бизнеса к росту за 5 минут» (скоринг + бенчмарки), не «операционная система роста».
- Встроить sample-отчёт (Фаза 5 №13) и якорь vs консалтинг (№14).

## Батч 6F — Верификация фазы
- Свежий free-аккаунт: mini-GRI/Пульс доступны; полный GRI/PDF/чат → upgrade-гейт; админ-кнопка меняет флаг и это РЕАЛЬНО применяется (проверить в БД/повторным запросом). vitest+lint чисто.

## Не делаем
Включение реального эквайринга; GRI-кредиты агентств (№26, бэклог); white-label (№27, P2).
