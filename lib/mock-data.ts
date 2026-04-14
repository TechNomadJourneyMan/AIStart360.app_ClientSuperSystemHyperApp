import type {
  Client, Alert, ActivityItem, Notification,
  Signal, TeamMember, Report
} from '@/types'

// ============================================================
// KPI Data — Dashboard main metrics
// ============================================================
export const MOCK_KPI = [
  { label: 'Revenue',  value: '₸84.2M',  trend: '+12.4%',  trendUp: true,  icon: 'payments',        sublabel: 'vs previous quarter',  href: '/analytics' },
  { label: 'Margin',   value: '34.2%',   trend: '+2.1 pp', trendUp: true,  icon: 'percent',          sublabel: 'net margin', href: '/metrics'  },
  { label: 'Clients',  value: '48',      trend: '+6',      trendUp: true,  icon: 'groups',           sublabel: 'active clients',   href: '/clients'   },
  { label: 'Expenses', value: '₸55.4M',  trend: '+8.2%',   trendUp: false, icon: 'trending_down',    sublabel: 'operating expenses', href: '/metrics'  },
]

// ============================================================
// Alerts
// ============================================================
export const MOCK_ALERTS: Alert[] = [
  {
    id: 'a1',
    severity: 'critical',
    title: 'Vortex Labs',
    description: 'GMV Drop: -24% below threshold deviation detected in scaling phase.',
    time: '2h ago',
    action: { label: 'Investigate', href: '/clients/1' },
  },
  {
    id: 'a2',
    severity: 'warning',
    title: 'Calyx Fintech',
    description: 'Churn Risk: Structural engagement score dropped to 4.2/10.',
    time: '4h ago',
    action: { label: 'Client Review', href: '/clients/2' },
  },
  {
    id: 'a3',
    severity: 'success',
    title: 'Nexum Systems',
    description: 'GRI Score improved to 8.4. Growth readiness reached Excellent tier.',
    time: '6h ago',
    action: { label: 'View Report', href: '/clients/3' },
  },
  {
    id: 'a4',
    severity: 'info',
    title: 'Market Signal',
    description: 'Regulatory update: New compliance framework announced for FinTech sector Q2.',
    time: '8h ago',
    action: { label: 'Open Signal', href: '/insights' },
  },
]

// ============================================================
// Activity Feed
// ============================================================
export const MOCK_ACTIVITY: ActivityItem[] = [
  {
    id: 'act1',
    actor: 'Stark Industries',
    actorRole: 'Client',
    event: 'completed GRI Diagnostics Phase 2 module',
    gri: 7.2,
    status: 'active',
    time: '10m ago',
  },
  {
    id: 'act2',
    actor: 'Alex M.',
    actorRole: 'Analyst',
    event: 'updated metrics for Stark Industries',
    gri: 7.8,
    status: 'active',
    time: '1h ago',
  },
]

// ============================================================
// Clients
// ============================================================
export const MOCK_CLIENTS: Client[] = [
  {
    id: '7', name: 'ChocoFamily',    industry: 'E-commerce', stage: 'Mature', status: 'active',
    manager: 'Alex Kim',  managerId: 'u1', griScore: 5.2, previousGriScore: 5.5,
    website: 'chocofamily.kz', createdAt: '2026-03-30',
  },
  {
    id: '1', name: 'Vortex Labs',    industry: 'FinTech',    stage: 'Scale',  status: 'active',
    manager: 'Alex Kim',  managerId: 'u1', griScore: 8.4, previousGriScore: 8.2,
    website: 'vortexlabs.io', createdAt: '2024-01-15',
  },
  {
    id: '2', name: 'Calyx Digital',  industry: 'E-commerce', stage: 'Growth', status: 'at risk',
    manager: 'Sarah Chen', managerId: 'u2', griScore: 7.3, previousGriScore: 7.6,
    website: 'calyx.co', createdAt: '2024-02-10',
  },
  {
    id: '3', name: 'Nexum Systems',  industry: 'SaaS',       stage: 'Growth', status: 'active',
    manager: 'Alex Kim',  managerId: 'u1', griScore: 6.2, previousGriScore: 6.0,
    website: 'nexumsystems.com', createdAt: '2024-03-05',
  },
  {
    id: '4', name: 'PulseCore',      industry: 'Healthcare', stage: 'Early',  status: 'inactive',
    manager: 'Maria Lopez', managerId: 'u3', griScore: 4.8, previousGriScore: 5.1,
    createdAt: '2024-04-20',
  },
  {
    id: '5', name: 'Astra Ventures', industry: 'FinTech',    stage: 'Scale',  status: 'active',
    manager: 'Sarah Chen', managerId: 'u2', griScore: 9.1, previousGriScore: 9.0,
    website: 'astraventures.io', createdAt: '2023-11-01',
  },
  {
    id: '6', name: 'Forge Analytics', industry: 'SaaS',     stage: 'Mature', status: 'active',
    manager: 'Alex Kim',  managerId: 'u1', griScore: 7.7, previousGriScore: 7.5,
    website: 'forgeanalytics.com', createdAt: '2023-09-12',
  },
]

// ============================================================
// Reports
// ============================================================
export const MOCK_REPORTS: Report[] = [
  {
    id: 'r1', clientId: '1', clientName: 'Vortex Labs',
    name: 'Q4 2025 GRI Full Report', category: 'GRI', type: 'pdf',
    fileUrl: '#', fileSize: '2.4 MB', uploadedBy: 'System', uploadedAt: '24 Mar 2026',
  },
  {
    id: 'r2', clientId: '2', clientName: 'Calyx Digital',
    name: 'Financial Health Analysis H2', category: 'Financial', type: 'xlsx',
    fileUrl: '#', fileSize: '1.1 MB', uploadedBy: 'Sarah Chen', uploadedAt: '22 Mar 2026',
  },
  {
    id: 'r3', clientId: '3', clientName: 'Nexum Systems',
    name: 'Growth Roadmap 2026', category: 'Growth', type: 'pdf',
    fileUrl: '#', fileSize: '3.8 MB', uploadedBy: 'Alex Kim', uploadedAt: '20 Mar 2026',
  },
  {
    id: 'r4', clientId: '5', clientName: 'Astra Ventures',
    name: 'Market Expansion Research', category: 'Market', type: 'pdf',
    fileUrl: '#', fileSize: '5.2 MB', uploadedBy: 'Sarah Chen', uploadedAt: '18 Mar 2026',
  },
  {
    id: 'r5', clientId: '6', clientName: 'Forge Analytics',
    name: 'Custom Performance Dashboard', category: 'Custom', type: 'xlsx',
    fileUrl: '#', fileSize: '890 KB', uploadedBy: 'Alex Kim', uploadedAt: '15 Mar 2026',
  },
  {
    id: 'r6', clientId: '7', clientName: 'ChocoFamily',
    name: 'Analytical Profile (Kazakhstan)', category: 'GRI', type: 'pdf',
    fileUrl: '/app/(dashboard)/clients/ChocoFamily Data/Аналитический_профиль_компании_ChocoFamily_(Казахстан).pdf',
    fileSize: '224 KB', uploadedBy: 'System', uploadedAt: '30 Mar 2026',
  },
  {
    id: 'r7', clientId: '7', clientName: 'ChocoFamily',
    name: 'OSINT Project Report', category: 'Intelligence', type: 'pdf',
    fileUrl: '/app/(dashboard)/clients/ChocoFamily Data/ChocoFamily_OSINT_Analytical_Profile.pdf',
    fileSize: '85 KB', uploadedBy: 'Expert AI', uploadedAt: '30 Mar 2026',
  },
  {
    id: 'r8', clientId: '7', clientName: 'ChocoFamily',
    name: 'Modular Analytical Report', category: 'Strategic', type: 'pdf',
    fileUrl: '/app/(dashboard)/clients/ChocoFamily Data/_ChocoFamily Holding_ модульный аналитический отчёт.pdf',
    fileSize: '1.7 MB', uploadedBy: 'Alex Kim', uploadedAt: '30 Mar 2026',
  },
  {
    id: 'r9', clientId: '7', clientName: 'ChocoFamily',
    name: 'GPT Intelligence Summary', category: 'AI', type: 'pdf',
    fileUrl: '/app/(dashboard)/clients/ChocoFamily Data/ChocoFamilyGPTReport.pdf',
    fileSize: '87 KB', uploadedBy: 'GPT-4o', uploadedAt: '30 Mar 2026',
  },
  {
    id: 'r10', clientId: '7', clientName: 'ChocoFamily',
    name: 'Business Strategy Protocol', category: 'Protocol', type: 'pdf',
    fileUrl: '/app/(dashboard)/clients/ChocoFamily Data/Protocol ChocoFamily .pdf',
    fileSize: '322 KB', uploadedBy: 'System', uploadedAt: '30 Mar 2026',
  },
]

// ============================================================
// Notifications
// ============================================================
export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'n1', type: 'alert', title: 'Critical Alert: Vortex Labs',
    body: 'GMV dropped 24% below threshold. Immediate review recommended.',
    read: false, entityType: 'client', entityId: '1', time: '2h ago', createdAt: '2026-03-24T10:00:00Z',
  },
  {
    id: 'n2', type: 'gri_updated', title: 'GRI Updated: Astra Ventures',
    body: 'GRI Score increased to 9.1 — reached Excellent tier.',
    read: false, entityType: 'gri', entityId: '5', time: '4h ago', createdAt: '2026-03-24T08:00:00Z',
  },
  {
    id: 'n3', type: 'report', title: 'New Report Uploaded',
    body: 'Q4 GRI Full Report for Vortex Labs is now available.',
    read: false, entityType: 'report', entityId: 'r1', time: '6h ago', createdAt: '2026-03-24T06:00:00Z',
  },
  {
    id: 'n4', type: 'project', title: 'Project Status Changed',
    body: 'Growth Roadmap for Nexum Systems moved to "In Review".',
    read: true, entityType: 'project', entityId: 'p1', time: '1d ago', createdAt: '2026-03-23T12:00:00Z',
  },
  {
    id: 'n5', type: 'system', title: 'Scheduled Maintenance',
    body: 'Scheduled maintenance window: Sunday 02:00–04:00 UTC.',
    read: true, time: '2d ago', createdAt: '2026-03-22T10:00:00Z',
  },
]

// ============================================================
// Intelligence Signals
// ============================================================
export const MOCK_SIGNALS: Signal[] = [
  {
    id: 's1', priority: 'critical',
    title: 'Central Bank Raises Rate: Impact on FinTech Liquidity',
    description: 'Unexpected rate increase of 50bps expected to tighten lending conditions for mid-stage FinTech companies in Q2 2026.',
    type: 'financial', tags: ['FinTech', 'Rates', 'Liquidity'], time: '1h ago', relatedClient: 'Vortex Labs',
  },
  {
    id: 's2', priority: 'high',
    title: 'E-commerce CPM Up 23% Year-over-Year',
    description: 'Meta and Google CPM costs rising significantly in consumer retail vertical. Acquisition costs to increase across the board.',
    type: 'market', tags: ['E-commerce', 'Marketing', 'CAC'], time: '3h ago', relatedClient: 'Calyx Digital',
  },
  {
    id: 's3', priority: 'medium',
    title: 'New EU Regulation: AI Data Processing Rules',
    description: 'EU proposes new framework for AI-driven data processing. SaaS companies serving EU customers should review data handling.',
    type: 'regulatory', tags: ['SaaS', 'Compliance', 'GDPR'], time: '6h ago',
  },
  {
    id: 's4', priority: 'medium',
    title: 'Healthcare Tech Investment Up 34% in Q1 2026',
    description: 'Global HealthTech funding up 34% QoQ. Telemedicine and diagnostic AI categories lead growth.',
    type: 'market', tags: ['Healthcare', 'Investment', 'AI'], time: '12h ago', relatedClient: 'PulseCore',
  },
  {
    id: 's5', priority: 'low',
    title: 'SaaS Study: Usage-Based Pricing Displacing Seat-Based',
    description: 'Annual SaaS pricing study shows seat-based pricing losing ground to usage-based models across mid-market.',
    type: 'market', tags: ['SaaS', 'Pricing', 'Benchmark'], time: '1d ago',
  },
  {
    id: 's6', priority: 'high',
    title: 'Competitor Closes $40M Series B',
    description: 'Direct competitor in B2B analytics space closes Series B. New features targeting GRI-equivalent diagnostics announced.',
    type: 'competitive', tags: ['Competitive', 'Funding', 'B2B'], time: '1d ago',
  },
]

// ============================================================
// Team
// ============================================================
export const MOCK_TEAM: TeamMember[] = [
  { id: 'u1', name: 'Alex Kim',    role: 'Senior Manager',    load: 82, clients: ['Vortex Labs', 'Nexum Systems', 'Forge Analytics'], email: 'alex@aistart360.com' },
  { id: 'u2', name: 'Sarah Chen',  role: 'Manager',           load: 71, clients: ['Calyx Digital', 'Astra Ventures'], email: 'sarah@aistart360.com' },
  { id: 'u3', name: 'Maria Lopez', role: 'Junior Manager',    load: 55, clients: ['PulseCore'], email: 'maria@aistart360.com' },
  { id: 'u4', name: 'James Park',  role: 'Senior Analyst',    load: 94, clients: ['Vortex Labs', 'Calyx Digital', 'PulseCore'], email: 'james@aistart360.com' },
  { id: 'u5', name: 'Elena Sobol', role: 'Analyst',           load: 63, clients: ['Astra Ventures', 'Nexum Systems'], email: 'elena@aistart360.com' },
  { id: 'u6', name: 'David Ngo',   role: 'Growth Strategist', load: 78, clients: ['Forge Analytics', 'Astra Ventures'], email: 'david@aistart360.com' },
]

// ============================================================
// GRI Domain scores (for GRI page)
// ============================================================
export const MOCK_GRI_DOMAINS = [
  { id: 'fin',  label: 'Finance',        score: 8.2, max: 10, icon: 'payments',      color: '#6effc0' },
  { id: 'mkt',  label: 'Marketing',      score: 7.1, max: 10, icon: 'campaign',      color: '#6effc0' },
  { id: 'ops',  label: 'Operations',     score: 7.6, max: 10, icon: 'settings_suggest', color: '#6effc0' },
  { id: 'hr',   label: 'Team',           score: 6.8, max: 10, icon: 'groups',        color: '#6effc0' },
  { id: 'tech', label: 'Technology',     score: 8.9, max: 10, icon: 'memory',        color: '#6effc0' },
  { id: 'strat',label: 'Strategy',       score: 7.4, max: 10, icon: 'route',         color: '#6effc0' },
]

// ============================================================
// Market data (for Market page)
// ============================================================
export const MOCK_MARKET = {
  tam: '₸4.2T',
  sam: '₸840B',
  som: '₸42B',
  growth: '+18.4% CAGR',
  segments: [
    { name: 'FinTech',    share: 34, color: '#6effc0' },
    { name: 'E-commerce', share: 28, color: '#00e29e' },
    { name: 'SaaS',       share: 22, color: '#bcc7de' },
    { name: 'Healthcare', share: 10, color: '#ffbd60' },
    { name: 'Other',      share: 6,  color: '#84958a' },
  ],
  trends: [
    { label: 'AI Integration Accelerating', priority: 'high',   icon: 'smart_toy' },
    { label: 'B2B Market Consolidation',    priority: 'medium', icon: 'merge' },
    { label: 'Regulatory Burden Growing',   priority: 'medium', icon: 'gavel' },
    { label: 'Shift to Usage-Based',        priority: 'low',    icon: 'tune' },
  ],
}

// ============================================================
// Metrics (for Metrics page)
// ============================================================
export const MOCK_METRICS = {
  financial: [
    { label: 'MRR',          value: '₸7.02M',  delta: '+14.2%', up: true },
    { label: 'ARR',          value: '₸84.2M',  delta: '+14.2%', up: true },
    { label: 'Gross Margin', value: '34.2%',   delta: '+2.1pp',  up: true },
    { label: 'Burn Rate',    value: '₸4.62M',  delta: '-3.1%',  up: true },
    { label: 'Runway',       value: '18 mo',   delta: '+2 mo',  up: true },
    { label: 'CAC',          value: '₸84K',    delta: '-8.4%',  up: true },
  ],
  growth: [
    { label: 'New Clients',  value: '6',       delta: '+2 q/q',   up: true },
    { label: 'Churn Rate',   value: '2.1%',    delta: '-0.4pp',   up: true },
    { label: 'NPS',          value: '74',      delta: '+6',       up: true },
    { label: 'LTV',          value: '₸2.84M',  delta: '+11.2%',   up: true },
    { label: 'LTV:CAC',      value: '4.82x',   delta: '+0.15',    up: true },
    { label: 'Retention',    value: '94.2%',   delta: '+1.2pp',   up: true },
  ],
  operational: [
    { label: 'Team Utilization', value: '74%',   delta: '+4pp',     up: false },
    { label: 'SLA Compliance',   value: '98.4%', delta: '+0.2pp',   up: true  },
    { label: 'Avg GRI Score',    value: '7.6',   delta: '+0.2',     up: true  },
    { label: 'GRI Reports/mo',   value: '18',    delta: '+3',       up: true  },
    { label: 'Avg Time to Value',value: '12d',   delta: '-2d',      up: true  },
    { label: 'CSAT',             value: '4.7/5', delta: '+0.1',     up: true  },
  ],
}

// ============================================================
// Competitors (for Competitors page)
// ============================================================
export const MOCK_COMPETITORS = [
  {
    id: 'c1', name: 'GrowthOS',     funding: '$120M Series C', stage: 'Scale',
    strengths: ['Automation', 'UI/UX'],    weaknesses: ['No GRI', 'Expensive'],
    threat: 'high',   market: 'US/EU', clients: 340, arr: '$28M',
  },
  {
    id: 'c2', name: 'RevIQ',        funding: '$40M Series B',  stage: 'Growth',
    strengths: ['AI Analytics', 'API'],       weaknesses: ['No B2B', 'Young Product'],
    threat: 'high',   market: 'EU',    clients: 120, arr: '$8M',
  },
  {
    id: 'c3', name: 'ScaleMetrics', funding: '$18M Series A',  stage: 'Early',
    strengths: ['Affordable', 'Fast Onboarding'], weaknesses: ['No Strategy', 'Weak Team'],
    threat: 'medium', market: 'RU/CIS', clients: 55,  arr: '$2.4M',
  },
  {
    id: 'c4', name: 'B2B Radar',    funding: 'Bootstrapped',   stage: 'Niche',
    strengths: ['Niche Focus'],                   weaknesses: ['No Scalability'],
    threat: 'low',    market: 'RU',    clients: 22,  arr: '$0.8M',
  },
]
