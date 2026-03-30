import type { Notification } from '@/types'
import { CHOCO_ALERTS } from './choco-data'

// ============================================================
// ChocoFamily Market Data
// ============================================================
export const CHOCO_MARKET = {
  tam: '$1.2B (KZ E-com)',
  sam: '$450M (Food Delivery KZ)',
  som: '$75.6M (Текущая доля 16.8%)',
  growth: '+14% CAGR',
  segments: [
    { name: 'Glovo', share: 36.6, color: '#ffbd60' },
    { name: 'Yandex Food', share: 25.7, color: '#ffbd60' },
    { name: 'Wolt', share: 17.6, color: '#00e29e' },
    { name: 'Chocofood', share: 16.8, color: '#6effc0' },
    { name: 'Другие', share: 3.3, color: '#84958a' },
  ],
  trends: [
    { label: 'Агрессивный маркетинг конкурентов', priority: 'critical', icon: 'campaign' },
    { label: 'Падение лояльности B2C', priority: 'high', icon: 'trending_down' },
    { label: 'Рост B2B SaaS (Smart Restaurant)', priority: 'medium', icon: 'rocket_launch' },
  ]
}

// ============================================================
// ChocoFamily Notifications (derived from alerts)
// ============================================================
export const CHOCO_NOTIFICATIONS: Notification[] = CHOCO_ALERTS.map(a => ({
  id: `notif-${a.id}`,
  type: (a.severity === 'critical' ? 'alert' : 'system') as Notification['type'],
  title: a.title,
  body: a.description,
  read: false,
  entityType: 'client',
  entityId: '7',
  time: a.time,
  createdAt: new Date().toISOString()
}))

// ============================================================
// ChocoFamily GRI Domains
// ============================================================
export const CHOCO_GRI_DOMAINS = [
  { id: 'fin', label: 'Финансы (Rev)', score: 6.5, max: 10, icon: 'payments', color: '#6effc0' },
  { id: 'mkt', label: 'Маркетинг (Food)', score: 4.2, max: 10, icon: 'campaign', color: '#ffbd60' },
  { id: 'ops', label: 'Операции (SaaS)', score: 8.5, max: 10, icon: 'settings_suggest', color: '#6effc0' },
  { id: 'tech', label: 'AI Стратегия', score: 5.0, max: 10, icon: 'memory', color: '#ffbd60' },
]

// ============================================================
// ChocoFamily Metrics
// ============================================================
export const CHOCO_METRICS = {
  financial: [
    { label: 'MRR (Smart Rest)', value: '$25K', delta: '+12%', up: true },
    { label: 'Выручка (Net)', value: '$14.5M', delta: '+11%', up: true },
    { label: 'EBITDA', value: '-$2.1M', delta: '-15%', up: false },
    { label: 'Инвестиции', value: '$12M', delta: 'Series A', up: true },
  ],
  growth: [
    { label: 'Доля рынка (Food)', value: '16.8%', delta: '-24%', up: false },
    { label: 'SaaS Клиенты', value: '400+', delta: '+45', up: true },
    { label: 'LTV/CAC (Food)', value: '0.8x', delta: '-0.4', up: false },
    { label: 'Retention SaaS', value: '92%', delta: '+2%', up: true },
  ],
  operational: [
    { label: 'AI Research', value: 'Активен', delta: 'New', up: true },
    { label: 'Strategic Pivot', value: 'В процессе', delta: 'Q1 2026', up: true },
  ]
}
