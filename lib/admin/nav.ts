import type { Permission } from './rbac'

/** GIGA-CRM navigation. Items the actor lacks permission for are hidden. */
/** Live counters the sidebar may show next to an item (fetched only when the item is visible). */
export type GigaNavBadge = 'pendingApprovals'
export interface GigaNavItem { href: string; label: string; icon: string; permission: Permission; exact?: boolean; badge?: GigaNavBadge }
export interface GigaNavGroup { label: string; items: GigaNavItem[] }

export const GIGA_BASE = '/admin-giga-panel'

export const GIGA_NAV: GigaNavGroup[] = [
  { label: 'Обзор', items: [
    { href: GIGA_BASE, label: 'Главная', icon: 'dashboard', permission: 'dashboard.view', exact: true },
    { href: `${GIGA_BASE}/notifications`, label: 'Уведомления', icon: 'bell', permission: 'dashboard.view' },
  ] },
  { label: 'Пользователи', items: [
    { href: `${GIGA_BASE}/users`, label: 'Пользователи', icon: 'users', permission: 'users.view' },
    { href: `${GIGA_BASE}/requests`, label: 'Заявки', icon: 'inbox', permission: 'users.view' },
    { href: `${GIGA_BASE}/invites`, label: 'Приглашения', icon: 'mail', permission: 'users.view' },
    { href: `${GIGA_BASE}/clients`, label: 'Клиенты', icon: 'building', permission: 'users.view' },
    { href: `${GIGA_BASE}/duplicates`, label: 'Дубликаты', icon: 'copy', permission: 'users.sensitive' },
    { href: `${GIGA_BASE}/leads`, label: 'Лиды', icon: 'sparkles', permission: 'leads.view' },
  ] },
  { label: 'Данные', items: [
    { href: `${GIGA_BASE}/surveys`, label: 'Анкеты', icon: 'clipboard', permission: 'survey.view' },
    { href: `${GIGA_BASE}/gri`, label: 'GRI', icon: 'radar', permission: 'gri.view' },
    { href: `${GIGA_BASE}/activity`, label: 'Активность', icon: 'activity', permission: 'activity.view' },
    { href: `${GIGA_BASE}/cjm`, label: 'Путь клиента (CJM)', icon: 'route', permission: 'cjm.view' },
  ] },
  { label: 'Коммуникации', items: [
    { href: `${GIGA_BASE}/inbox`, label: 'Instagram / WhatsApp', icon: 'messages', permission: 'inbox.view' },
    { href: `${GIGA_BASE}/market`, label: 'Инсайты рынка', icon: 'lightbulb', permission: 'market.manage' },
  ] },
  { label: 'ИИ и автоматизация', items: [
    { href: `${GIGA_BASE}/agents`, label: 'ИИ-агенты', icon: 'bot', permission: 'agents.view' },
    { href: `${GIGA_BASE}/agents/tasks`, label: 'Задачи агентов', icon: 'listchecks', permission: 'agents.view' },
    { href: `${GIGA_BASE}/agents/approvals`, label: 'Одобрения', icon: 'stamp', permission: 'agents.view', badge: 'pendingApprovals' },
    { href: `${GIGA_BASE}/agents/costs`, label: 'Стоимость ИИ', icon: 'coins', permission: 'agents.view' },
    // Read for agents.view; every change on the page needs settings.manage (checked by the API).
    { href: `${GIGA_BASE}/ai-providers`, label: 'Провайдеры и ключи', icon: 'plug', permission: 'agents.view' },
    { href: `${GIGA_BASE}/agents/events`, label: 'События платформы', icon: 'zap', permission: 'agents.view' },
    { href: `${GIGA_BASE}/reports`, label: 'Отчёты', icon: 'reports', permission: 'agents.view' },
    { href: `${GIGA_BASE}/ai-review`, label: 'Проверка выводов ИИ', icon: 'review', permission: 'insights.moderate' },
    { href: `${GIGA_BASE}/moderation`, label: 'Модерация ИИ', icon: 'shieldcheck', permission: 'insights.moderate' },
  ] },
  { label: 'Платформа', items: [
    { href: `${GIGA_BASE}/content`, label: 'Контент и страницы', icon: 'file', permission: 'content.view' },
    { href: `${GIGA_BASE}/sections`, label: 'Разделы и видимость', icon: 'layout', permission: 'platform.sections' },
    { href: `${GIGA_BASE}/settings`, label: 'Настройки', icon: 'settings', permission: 'users.manage' },
  ] },
  { label: 'Безопасность', items: [
    { href: `${GIGA_BASE}/staff`, label: 'Роли и права', icon: 'key', permission: 'dashboard.view' },
    { href: `${GIGA_BASE}/impersonation`, label: 'Вход от имени', icon: 'eye', permission: 'impersonate.view' },
    { href: `${GIGA_BASE}/audit`, label: 'Журнал аудита', icon: 'scroll', permission: 'audit.view' },
  ] },
]

export const SUPER_EXPERT_BASE = '/super-expert'

/**
 * Навигация кабинета SuperExpert.
 *
 * Тот же CRM-подход (список → карточка → данные → действия), но без разделов
 * платформы, контента, ролей, настроек и входа от имени: их нет ни в меню, ни
 * в правах роли (см. lib/admin/rbac.ts) — то есть и напрямую по URL туда не
 * попасть, проверку делает сервер.
 */
export const SUPER_EXPERT_NAV: GigaNavGroup[] = [
  { label: 'Обзор', items: [
    { href: SUPER_EXPERT_BASE, label: 'Главная', icon: 'dashboard', permission: 'dashboard.view', exact: true },
  ] },
  { label: 'Пользователи', items: [
    { href: `${SUPER_EXPERT_BASE}/users`, label: 'Пользователи', icon: 'users', permission: 'users.view' },
    { href: `${SUPER_EXPERT_BASE}/requests`, label: 'Заявки на доступ', icon: 'inbox', permission: 'users.approve' },
    { href: `${SUPER_EXPERT_BASE}/accounts`, label: 'Аккаунты и компании', icon: 'building', permission: 'users.view' },
    { href: `${SUPER_EXPERT_BASE}/duplicates`, label: 'Дубликаты', icon: 'copy', permission: 'users.sensitive' },
  ] },
  { label: 'Данные', items: [
    { href: `${SUPER_EXPERT_BASE}/surveys`, label: 'Анкеты', icon: 'clipboard', permission: 'survey.view' },
    { href: `${SUPER_EXPERT_BASE}/gri`, label: 'GRI', icon: 'radar', permission: 'gri.view' },
    { href: `${SUPER_EXPERT_BASE}/activity`, label: 'Активность', icon: 'activity', permission: 'activity.view' },
  ] },
  { label: 'Взаимодействие', items: [
    { href: `${SUPER_EXPERT_BASE}/invites`, label: 'Приглашения', icon: 'mail', permission: 'users.invite' },
  ] },
]

// Most specific first: «/agents/tasks/…» must resolve to «Задачи агентов», not to «ИИ-агенты».
const TITLES: Array<[RegExp, string, number]> = [...GIGA_NAV, ...SUPER_EXPERT_NAV].flatMap((g) => g.items)
  .map((i): [RegExp, string, number] => [
    new RegExp(`^${i.href.replace(/[/-]/g, (c) => `\\${c}`)}${i.exact ? '$' : '(/|$)'}`),
    i.label,
    i.href.length,
  ])
  .sort((a, b) => b[2] - a[2])

/** Breadcrumb label for the section a path belongs to. */
export function gigaSectionTitle(pathname: string): string | null {
  for (const [re, label] of TITLES) if (re.test(pathname)) return label
  return null
}

export function isNavActive(item: GigaNavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/**
 * The one item to highlight for `pathname`: the most specific match. Nested
 * sections («ИИ-агенты» → «Задачи агентов») would otherwise both light up.
 */
export function activeNavHref(nav: GigaNavGroup[], pathname: string): string | null {
  let best: GigaNavItem | null = null
  for (const g of nav) {
    for (const i of g.items) {
      if (isNavActive(i, pathname) && (!best || i.href.length > best.href.length)) best = i
    }
  }
  return best?.href ?? null
}

/** Groups and items the actor may see; empty groups are dropped. */
export function visibleNav(nav: GigaNavGroup[], can: (p: Permission) => boolean): GigaNavGroup[] {
  return nav
    .map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) }))
    .filter((g) => g.items.length > 0)
}
