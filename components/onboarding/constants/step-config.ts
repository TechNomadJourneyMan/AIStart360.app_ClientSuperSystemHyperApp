export const TOTAL_STEPS = 12

export const STEPS = [
  { n: 1, title: 'Company', icon: 'business' },
  { n: 2, title: 'Goals', icon: 'flag' },
  { n: 3, title: 'Positioning', icon: 'groups' },
  { n: 4, title: 'Org. Structure', icon: 'account_tree' },
  { n: 5, title: 'Client Base', icon: 'database' },
  { n: 6, title: 'CJM', icon: 'route' },
  { n: 7, title: 'Marketing', icon: 'campaign' },
  { n: 8, title: 'Key Metrics', icon: 'monitoring' },
  { n: 9, title: 'Finance', icon: 'payments' },
  { n: 10, title: 'Personal Questions', icon: 'person' },
  { n: 11, title: 'Influence Map', icon: 'hub' },
  { n: 12, title: 'Tools', icon: 'build' },
] as const

export type StepConfig = (typeof STEPS)[number]
