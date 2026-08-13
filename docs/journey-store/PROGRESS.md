# Journey Store — прогресс

Обновлено: 2026-08-13.

## Каноническая коррекция — реализовано в коде

- [x] Мастер-промпт v2 с явным запретом отдельного Store dashboard.
- [x] `/client/journey/store` переведён на `JourneyWorkspace context="store"`.
- [x] Удалён legacy `StoreJourneyView`.
- [x] Сохранён conversation-first stage `goal` до измеримой Точки B.
- [x] Store-показатели ясно расположены в компактной read-only сетке Точки A.
- [x] После цели используется реальный JourneyCanvas A → B и его WidgetModule.
- [x] Первая измеримая Точка B остаётся draft; roadmap создаётся только после
  отдельного подтверждения владельца.
- [x] Сохранены mobile modes `Путь / Спросить AI / Модули`.
- [x] Store client использует выделенные `/api/v1/journey/store/*` endpoints.
- [x] Browser localStorage и demo fallback для Store отключены.
- [x] GET/PATCH/chat/documents защищены session + MFA + Store role/status.
- [x] Выделенный owned Store workspace и отдельная HttpOnly cookie изолированы
  от ordinary Journey bootstrap/device flow.
- [x] Generic Journey routes отклоняют любой reserved Store workspace.
- [x] Live Point A заново строится на сервере и не доверяет browser payload.
- [x] Store financial facts редактируются перед Journey DB persistence.
- [x] Goals/messages/roadmap/layout сохраняются в выделенном Store overlay workspace.
- [x] Document mutation для Store Journey закрыта до multipart parsing.
- [x] Store PATCH сохраняет только layout и не принимает browser-smuggled цели/roadmap.
- [x] Desktop 1440×900 и mobile 390×844 проверены без горизонтального overflow;
  четыре Store-модуля не перекрываются ChatDock.

## Текущая верификация

- Journey unit Vitest: `29` файлов / `129` тестов — пройдено.
- TypeScript type-check: пройден.
- ESLint: пройден с одним существующим unrelated warning в `SimulatorClient`.
- Full Vitest: `234` файлов / `2 066` тестов — пройдено; `10` файлов /
  `28` environment-gated тестов пропущены штатно.
- Static route audit: `95` маршрутов, все literal transitions resolved.
- Next.js production build: пройден.
- Desktop/mobile visual smoke: пройден локально на `1440×900` и `390×844`.

## Production

Предыдущий deployment `dpl_9zpqDPXPfiLHQuceC3tt9rS8H5tk` (`b8c71627`) имел
неверный отдельный dashboard-интерфейс и заменён.

Исправленный canonical Journey релиз:

- commit: `599e0535`;
- deployment: `dpl_SZuuuHv4rkqG8xEKMLzt7bVNe7fu`;
- status: `READY`;
- immutable URL:
  `https://confident-brahmagupta-adxl4ibsf-viproman101-8397s-projects.vercel.app`;
- production alias: `https://aistart360-store.vercel.app`;
- Journey route: `https://aistart360-store.vercel.app/client/journey/store`.

Production anonymous smoke 2026-08-13:

- `/client/journey/store` → `307`
  `/login?from=%2Fclient%2Fjourney%2Fstore`;
- login route → `200`;
- `/api/v1/journey/store` без сессии → `401 JOURNEY_AUTH_REQUIRED` и
  `Cache-Control: private, no-store`.

## Не заявлять как выполненное без доказательства

- authenticated production E2E аккаунта магазина;
- visual verification реальных данных после login;
- изоляцию от чужого tenant через браузер без disposable/live test session.
