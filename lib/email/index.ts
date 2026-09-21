/**
 * lib/email — почтовый слой AIStart360.
 *
 *   brand.ts        — фирменные константы, часовой пояс, формат даты/времени
 *   layout.ts       — единый макет письма (таблицы + inline-CSS)
 *   templates.ts    — тексты и данные конкретных писем
 *   send.ts         — отправка в Resend: идемпотентность, журнал, повторы
 *   notify.ts       — событийный слой: что вызывает бизнес-код
 *   notification.ts — совместимость: старые sendNotificationEmail/sendUserEmail
 *
 * Точка входа одна — `@/lib/email`.
 */
export * from './brand'
export * from './layout'
export * from './templates'
export * from './send'
export * from './notify'
export * from './notification'
