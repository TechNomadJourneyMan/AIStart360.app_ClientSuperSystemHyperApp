# HONOR dual dashboard — acceptance progress

Рабочая ветка: `codex/honor-dual-dashboard`, base `74d1775d`.

## Specification

- [x] Production/Git baseline зафиксирован.
- [x] Старый и канонический Journey разделены по истории commits.
- [x] Google Drive workbook проверен по контрольным суммам.
- [x] Исполняемый prompt/DoD записан.

## Data contract

- [x] Периоды today/MTD/latest published различаются явно.
- [x] `0` и `not_covered` семантически различены.
- [x] Operational/MyHonor не дают double count.
- [x] Per-domain freshness заменяет ложный общий live-label.
- [x] Исторические месяцы и P&L имеют owner-scoped published storage.
- [x] Workbook preview/publish проходит SHA/idempotency/invariant checks.

## Store UI

- [x] Период можно выбрать с клавиатуры и на mobile.
- [x] KPI имеют период, источник, scope и coverage.
- [x] Месячный trend и доступная таблица сходятся с итогами.
- [x] Comparable YoY не сравнивает full-year с YTD.
- [x] Отрицательная EBITDA показана как риск.
- [x] Существующие каналы, склады и каталог сохранены.

## Journey UI

- [x] Store-владелец может открыть доску до Точки B.
- [x] Conversation-first остаётся default.
- [x] Точка A и finance module используют тот же analytics DTO.
- [x] Goal/roadmap не выдумываются.
- [x] Store facts не попадают в localStorage.
- [x] Desktop fit и mobile tabs не перекрываются.

## Verification

- [x] Parser/publication golden tests.
- [x] Loader period/source/coverage tests.
- [x] API auth/MFA/access/no-store tests.
- [x] Journey regression tests.
- [x] Type-check.
- [x] Targeted unit suite: 54 files / 302 tests.
- [x] Финальный production build после всех reviewed изменений.
- [x] Desktop 1440×900 visual smoke.
- [x] Mobile 390×844 visual smoke.
- [x] PostgreSQL transactional preflight: tenant reject, publish, duplicate,
  supersede, superseded-conflict; полный `ROLLBACK` подтверждён.
- [ ] Remote/worktree/deployed SHA recheck.
- [ ] Preview URL behavior verified.
- [ ] Production schema ledger, 19 периодов и public deployment verified.
