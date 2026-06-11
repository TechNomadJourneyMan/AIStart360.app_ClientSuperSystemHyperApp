/**
 * Market Intelligence Portal — static mock data.
 *
 * TODO(supabase): Replace these static fixtures with live reads from Supabase tables
 * (market_overview, competitors, intelligence_alerts, news). When implementing:
 *   - Add a `market_overview` row (singleton) keyed by niche/region.
 *   - `competitors` table with columns matching the Competitor interface below.
 *   - `intelligence_alerts` table — insert-only feed keyed by competitor_id.
 *   - `news` table — insert rows from the /api/market/osint sync action.
 * For now these fixtures let the UI render in an empty-DB state.
 */

export interface MarketData {
  totalVolume: number
  yoyGrowth: number
  activePlayers: number
  marketTemp: string
  chartData: { year: string; volume: number }[]
  pestel: { factor: string; description: string; trend: 'positive' | 'negative' | 'neutral' }[]
}

export interface Competitor {
  id: string
  name: string
  category: 'Direct' | 'Indirect' | 'Substitute' | 'Leader' | 'Newcomer'
  bin_iin: string
  url: string
  estRevenue: number
  taxesPaid: number
  b2gDependency: number
  tags: string[]
  isTracked: boolean
}

export interface IntelligenceAlert {
  id: string
  competitorName: string
  type: 'Price Drop' | 'Tender Win' | 'Legal Risk' | 'New Vacancy'
  description: string
  timestamp: string
}

export interface NewsItem {
  id: string
  source: string
  headline: string
  summary: string
  timestamp: string
  tags: string[]
}

export const COMPETITOR_CATEGORIES = [
  'All',
  'Direct',
  'Indirect',
  'Substitute',
  'Leader',
  'Newcomer',
] as const

export const MOCK_MARKET_DATA: MarketData = {
  totalVolume: 1_250_000_000_000,
  yoyGrowth: 18.5,
  activePlayers: 1450,
  marketTemp: 'Hot',
  chartData: [
    { year: '2020', volume: 650 },
    { year: '2021', volume: 820 },
    { year: '2022', volume: 980 },
    { year: '2023', volume: 1250 },
    { year: '2024', volume: 1480 },
  ],
  pestel: [
    {
      factor: 'Political',
      description: 'Government digitalization programs (Digital Kazakhstan) driving demand.',
      trend: 'positive',
    },
    {
      factor: 'Economic',
      description: 'Inflation affecting hardware costs, but software services remain resilient.',
      trend: 'neutral',
    },
    {
      factor: 'Social',
      description: 'Increasing digital literacy and demand for online services.',
      trend: 'positive',
    },
    {
      factor: 'Technological',
      description: 'Rapid adoption of AI and cloud infrastructure.',
      trend: 'positive',
    },
    {
      factor: 'Legal',
      description: 'New data localization laws increasing compliance costs.',
      trend: 'negative',
    },
  ],
}

export const MOCK_COMPETITORS: Competitor[] = [
  {
    id: 'c-001',
    name: 'Kolesa Group',
    category: 'Leader',
    bin_iin: '050540012345',
    url: 'https://kolesa.kz',
    estRevenue: 42_000_000_000,
    taxesPaid: 3_800_000_000,
    b2gDependency: 18,
    tags: ['Classified', 'MarTech', 'B2C'],
    isTracked: true,
  },
  {
    id: 'c-003',
    name: 'Documentolog',
    category: 'Direct',
    bin_iin: '120740017331',
    url: 'https://documentolog.kz',
    estRevenue: 9_400_000_000,
    taxesPaid: 820_000_000,
    b2gDependency: 74,
    tags: ['SaaS', 'ECM', 'B2G'],
    isTracked: false,
  },
  {
    id: 'c-004',
    name: 'JET ICS',
    category: 'Direct',
    bin_iin: '091140003142',
    url: 'https://jet-ics.kz',
    estRevenue: 14_200_000_000,
    taxesPaid: 1_320_000_000,
    b2gDependency: 58,
    tags: ['IT Services', 'Integrator', 'Enterprise'],
    isTracked: false,
  },
  {
    id: 'c-005',
    name: 'Softline Kazakhstan',
    category: 'Substitute',
    bin_iin: '050840007812',
    url: 'https://softline.kz',
    estRevenue: 22_800_000_000,
    taxesPaid: 1_950_000_000,
    b2gDependency: 41,
    tags: ['Reseller', 'Cloud', 'B2B'],
    isTracked: false,
  },
  {
    id: 'c-006',
    name: 'AITU Lab',
    category: 'Newcomer',
    bin_iin: '220240011022',
    url: 'https://aitulab.kz',
    estRevenue: 1_200_000_000,
    taxesPaid: 85_000_000,
    b2gDependency: 22,
    tags: ['AI', 'R&D', 'Startup'],
    isTracked: false,
  },
]

export const MOCK_INTELLIGENCE_ALERTS: IntelligenceAlert[] = [
  {
    id: 'a-001',
    competitorName: 'Kolesa Group',
    type: 'Tender Win',
    description:
      'Won a ₸180M contract with the Ministry of Digital Development for classified-ad data syndication.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: 'a-003',
    competitorName: 'Kolesa Group',
    type: 'Price Drop',
    description:
      'Lowered premium listing tier by 22% to compete with emerging marketplaces in regional cities.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
]

export const MOCK_NEWS: NewsItem[] = [
  {
    id: 'n-001',
    source: 'Forbes KZ',
    headline: 'Kazakhstan\'s IT export revenue reaches record $500M in 2024',
    summary:
      'The country\'s IT export volume grew 58% YoY, driven by fintech and cloud-service providers targeting the CIS and Gulf markets.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    tags: ['IT Export', 'Growth'],
  },
  {
    id: 'n-002',
    source: 'Kursiv',
    headline: 'New data-localization law enters force; compliance costs rise for SaaS',
    summary:
      'Operators now must store citizen data on Kazakhstan-based servers, prompting major SaaS vendors to open local regions.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 34).toISOString(),
    tags: ['Regulation', 'Compliance'],
  },
  {
    id: 'n-003',
    source: 'Digital Business',
    headline: 'Astana Hub crosses 1,500 portfolio companies',
    summary:
      'Kazakhstan\'s flagship tech park added 220 new residents in the last quarter, with half in AI, fintech, and health-tech.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 52).toISOString(),
    tags: ['Ecosystem', 'Astana Hub'],
  },
  {
    id: 'n-004',
    source: 'Capital.kz',
    headline: 'Government launches ₸15B fund for AI research grants',
    summary:
      'The Ministry of Digital Development opened applications for an AI R&D grant program; priority is given to B2G and B2B use cases.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 70).toISOString(),
    tags: ['Government', 'AI', 'Funding'],
  },
]

export function formatKZT(value: number): string {
  if (value >= 1_000_000_000) return `\u20B8${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `\u20B8${(value / 1_000_000).toFixed(1)}M`
  return `\u20B8${value.toLocaleString()}`
}
