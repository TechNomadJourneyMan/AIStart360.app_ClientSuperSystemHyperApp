# Мобильные приложения — Android и iOS

Нативные оболочки на Capacitor 8. Проекты `android/` и `ios/` уже созданы и настроены — осталось только собрать.

## Как это устроено

Кабинет — это Next.js с серверными компонентами, API-роутами и авторизацией через куки Supabase. Такое приложение нельзя выгрузить в статические файлы и упаковать внутрь: `output: 'export'` убьёт все `/api` и весь серверный рендер.

Поэтому оболочка открывает в WebView развёрнутый портал, а сверху добавляет нативное: заставку, статус-бар, аппаратную кнопку «назад», диплинки для авторизации и push-уведомления.

Адрес портала задаётся в `capacitor.config.ts`, по умолчанию `https://aistart360.vercel.app`. Переопределяется переменной `CAP_SERVER_URL` — удобно, чтобы проверить ветку до выкатки.

## Что нужно поставить

На этой машине **ничего из этого пока нет**, установка требует пароля администратора.

**Для Android:**
- JDK 21 — `brew install openjdk@21` либо с сайта Adoptium
- Android Studio — https://developer.android.com/studio
- В самой студии: SDK Platform 35 и Build-Tools

**Для iOS:**
- Xcode из App Store (сейчас стоят только Command Line Tools — этого мало, около 10 ГБ)
- После установки: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
- CocoaPods не нужен — Capacitor 8 использует Swift Package Manager

## Сборка

```bash
npm run mobile:sync        # перенести настройки в нативные проекты
npm run mobile:android     # открыть в Android Studio
npm run mobile:ios         # открыть в Xcode
```

Запуск на устройстве или эмуляторе:

```bash
npm run mobile:run:android
npm run mobile:run:ios
```

Готовые файлы для магазинов собираются в Android Studio (Build → Generate Signed Bundle, формат AAB) и в Xcode (Product → Archive).

## Идентификаторы

| | значение |
|---|---|
| Идентификатор приложения | `kz.aistart360.app` |
| Название | AIStart360 |
| Фон заставки и статус-бара | `#0A0B0F` |

## Иконки и заставки

Исходники лежат в `assets/`: `icon.png` (1024×1024), `icon-foreground.png` для адаптивной иконки Android, `splash.png` (2732×2732). Сделаны из `public/icon-512.png`.

Перегенерировать все размеры после замены исходников:

```bash
npm run mobile:assets && npm run mobile:sync
```

Сейчас сгенерировано 118 файлов для Android и 13 для iOS.

## Что осталось сделать перед публикацией

**Push-уведомления.** Плагин подключён, но не настроен. Для Android нужен `google-services.json` из Firebase, для iOS — ключ APNs в Apple Developer и включённая возможность Push Notifications в Xcode.

**Диплинки.** Обработчик в `components/native/NativeShell.tsx` готов, но связь домена с приложением не настроена. Для Android нужен `assetlinks.json` на сайте, для iOS — Associated Domains и файл `apple-app-site-association`. Без этого ссылки из писем Supabase будут открываться в браузере, а не в приложении.

**Подписи.** Для Android — свой keystore, для iOS — учётная запись Apple Developer, 99 долларов в год.

## Что уже работает

Кнопка «назад» на Android ходит по истории и закрывает приложение только на первом экране. Заставка прячется, когда интерфейс отрисован, а не по таймауту. Статус-бар тёмный под цвет кабинета. При отсутствии интернета вместо белой страницы ошибки показывается экран из `mobile/www/index.html` с кнопкой повтора.

Код нативной обвязки — `components/native/NativeShell.tsx`. Он подключён в корневом макете и в обычном браузере не делает ничего: все модули Capacitor грузятся динамически и только после проверки, что это нативная платформа.
