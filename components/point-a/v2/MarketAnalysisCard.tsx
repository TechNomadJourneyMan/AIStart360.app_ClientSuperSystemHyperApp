/**
 * MarketAnalysisCard — section card for /point-a showing the AI market analysis
 * snapshot (TAM/SAM/SOM + tracked trends, weaknesses, micro-segments).
 *
 * Data source: NO real aggregator exists yet for the per-user market analysis.
 * The Market Intelligence Portal (/market) uses a static fixture
 * (`components/market/mock-data.ts`) and the only live endpoints are
 * `/api/market/osint` (sync) and `/api/market/generate-insights`. Neither is
 * a per-tenant market-snapshot read.
 *
 * → We fall back to a derived static snapshot, scoped by user vertical when
 *   possible. The component is server-rendered so the upstream wiring can
 *   later move into a real `/api/v1/market/*` endpoint without changing the
 *   call-site.
 *
 * TODO: wire real market analysis aggregator (per-tenant, sourced from
 * Supabase `market_overview` + AI-generated insights table).
 */

import Link from 'next/link'
import MarketAnalysisFooter from './MarketAnalysisFooter'

interface MarketSnapshotRow {
  data: Partial<MarketSnapshot> | null
  computed_at: string | null
}

interface MarketSnapshot {
  tam: { value: string; caption: string }
  sam: { value: string; delta: string }
  som: { value: string; caption: string }
  trendWindow: { open: boolean; caption: string }
  mainTrend: string
  competitorWeakness: string
  microSegment: string
  updatedAt: Date
  source: 'db' | 'mock'
}

// Empty placeholder snapshot — used ONLY when no `market_snapshots` row exists
// for this user. Data-integrity rule: we never render fabricated market numbers;
// without a real OSINT/AI snapshot the card shows an honest empty state.
function buildSnapshot(): MarketSnapshot {
  return {
    tam: { value: '—', caption: '' },
    sam: { value: '—', delta: '' },
    som: { value: '—', caption: '' },
    trendWindow: { open: false, caption: '' },
    mainTrend: '',
    competitorWeakness: '',
    microSegment: '',
    updatedAt: new Date(),
    source: 'mock',
  }
}

function mergeDbSnapshot(
  base: MarketSnapshot,
  dbRow: MarketSnapshotRow | null,
): MarketSnapshot {
  if (!dbRow || !dbRow.data) return base
  const d = dbRow.data
  return {
    tam: d.tam ?? base.tam,
    sam: d.sam ?? base.sam,
    som: d.som ?? base.som,
    trendWindow: d.trendWindow ?? base.trendWindow,
    mainTrend: d.mainTrend ?? base.mainTrend,
    competitorWeakness: d.competitorWeakness ?? base.competitorWeakness,
    microSegment: d.microSegment ?? base.microSegment,
    updatedAt: dbRow.computed_at ? new Date(dbRow.computed_at) : new Date(),
    source: 'db',
  }
}

function formatUpdated(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export default async function MarketAnalysisCard({ userId }: { userId: string }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Pull the user's market_snapshots row (real OSINT/AI output). Without it the
  // card renders an honest empty state — never fabricated market numbers.
  let dbRow: MarketSnapshotRow | null = null
  if (supabaseUrl && serviceKey) {
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    try {
      const snapshotRes = await fetch(
        `${supabaseUrl}/rest/v1/market_snapshots?user_id=eq.${userId}&order=computed_at.desc&limit=1`,
        { headers, cache: 'no-store' },
      )
      if (snapshotRes.ok) {
        const rows = (await snapshotRes.json()) as MarketSnapshotRow[]
        dbRow = Array.isArray(rows) && rows[0] ? rows[0] : null
      }
    } catch (err) {
      console.error('[point-a/v2/MarketAnalysisCard] fetch error', err)
    }
  }

  const snap = mergeDbSnapshot(buildSnapshot(), dbRow)
  const isMock = snap.source === 'mock'

  return (
    <section>
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 sm:p-7 shadow-card">
        {/* ── Header row ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center border border-white/[0.06] flex-shrink-0">
              <span className="material-symbols-outlined text-2xl text-primary">public</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-headline text-2xl sm:text-3xl font-extrabold text-on-surface tracking-tight">
                  Анализ рынка
                </h2>
                <span className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.18em] px-2 py-0.5 rounded-md border border-primary/15 bg-primary/[0.04]">
                  6 блоков · 50 параметров
                </span>
                {isMock && (
                  <span
                    className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-md border"
                    style={{
                      color: '#e87a35',
                      borderColor: 'rgba(232,122,53,0.4)',
                      background: 'rgba(232,122,53,0.08)',
                    }}
                    title="OSINT-пайплайн ещё не сформировал снимок рынка для этого пользователя"
                  >
                    Нет данных
                  </span>
                )}
              </div>
              <p className="text-sm text-on-surface-variant mt-1.5 leading-relaxed">
                TAM/SAM/SOM, тренды, барьеры, конкуренты, микросегменты · AI-агенты OSINT в реальном времени
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isMock && (
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-2 py-1 rounded-md border border-white/[0.06] bg-surface-container">
                Обновлено {formatUpdated(snap.updatedAt)}
              </span>
            )}
            <Link
              href="/market"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-bold text-sm hover:brightness-110 focus:ring-2 transition-all"
              style={{
                background: 'linear-gradient(90deg, #e87a35, #dc524b)',
                boxShadow: '0 0 20px -8px rgba(232,122,53,0.55)',
              }}
            >
              <span className="material-symbols-outlined text-base">open_in_new</span>
              Открыть «Рынок»
            </Link>
          </div>
        </div>

        {isMock ? (
          /* ── Honest empty state: no fabricated market numbers ─────────── */
          <div className="bg-surface-container rounded-xl border border-white/[0.04] p-8 text-center mb-5">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/60">public_off</span>
            <p className="text-sm font-bold text-on-surface mt-3">Анализ рынка ещё не сформирован</p>
            <p className="text-xs text-on-surface-variant mt-1.5 max-w-md mx-auto leading-relaxed">
              TAM/SAM/SOM, тренды и слабости конкурентов появятся здесь после
              подключения источников рынка и обработки данных AI-агентами.
              Заполните анкету (отрасль и конкуренты) — это ускорит анализ.
            </p>
          </div>
        ) : (
        <>
        {/* ── 4 tiles ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 [&>a]:p-5">
          {/* TAM */}
          <Link
            href="/market"
            className="bg-surface-container rounded-xl border border-white/[0.04] p-3.5 hover:border-primary/30 hover:bg-surface-container-high transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 group"
            title="Открыть Market Intelligence Portal"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="material-symbols-outlined text-[14px] text-primary/70">language</span>
              <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">
                TAM / год
              </span>
            </div>
            <p className="text-3xl sm:text-4xl font-mono font-black text-on-surface tabular-nums leading-none tracking-tight">{snap.tam.value}</p>
            <p className="text-[11px] text-on-surface-variant mt-2 truncate" title={snap.tam.caption}>
              {snap.tam.caption}
            </p>
          </Link>

          {/* SAM */}
          <Link
            href="/market"
            className="bg-surface-container rounded-xl border border-white/[0.04] p-3.5 hover:border-primary/30 hover:bg-surface-container-high transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 group"
            title="Открыть Market Intelligence Portal"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="material-symbols-outlined text-[14px] text-primary/70">my_location</span>
              <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">
                SAM (доступный)
              </span>
            </div>
            <p className="text-3xl sm:text-4xl font-mono font-black text-on-surface tabular-nums leading-none tracking-tight">{snap.sam.value}</p>
            <p className="text-[11px] text-primary mt-1 font-mono flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[12px]">trending_up</span>
              {snap.sam.delta}
            </p>
          </Link>

          {/* SOM */}
          <Link
            href="/market"
            className="bg-surface-container rounded-xl border border-white/[0.04] p-3.5 hover:border-primary/30 hover:bg-surface-container-high transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 group"
            title="Открыть Market Intelligence Portal"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="material-symbols-outlined text-[14px] text-primary/70">flag</span>
              <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">
                SOM (12–18 мес)
              </span>
            </div>
            <p className="text-3xl sm:text-4xl font-mono font-black text-on-surface tabular-nums leading-none tracking-tight">{snap.som.value}</p>
            <p className="text-[11px] text-on-surface-variant mt-1 truncate" title={snap.som.caption}>
              {snap.som.caption}
            </p>
          </Link>

          {/* Trend window */}
          <Link
            href="/market"
            className="bg-surface-container rounded-xl border border-white/[0.04] p-3.5 hover:border-primary/30 hover:bg-surface-container-high transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 group"
            title="Открыть Market Intelligence Portal"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="material-symbols-outlined text-[14px] text-primary/70">schedule</span>
              <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">
                Trend window
              </span>
            </div>
            <div
              className={`inline-flex items-center gap-1 text-[11px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                snap.trendWindow.open
                  ? 'text-primary border-primary/30 bg-primary/10'
                  : 'text-error border-error/30 bg-error/10'
              }`}
            >
              <span className="material-symbols-outlined text-[12px]">
                {snap.trendWindow.open ? 'check_circle' : 'cancel'}
              </span>
              {snap.trendWindow.open ? 'Открыто' : 'Закрыто'}
            </div>
            <p className="text-[11px] text-on-surface-variant mt-1.5">{snap.trendWindow.caption}</p>
          </Link>
        </div>

        {/* ── 3 insight strips ──────────────────────────────────────────── */}
        <div className="space-y-2 mb-1">
          <div className="flex items-center justify-between gap-3 bg-surface-container rounded-xl border border-white/[0.04] px-4 py-2.5 hover:border-primary/15 transition-colors">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[14px] text-primary">trending_up</span>
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.18em] whitespace-nowrap">
                Главный тренд
              </span>
            </div>
            <p className="text-sm text-on-surface text-right truncate" title={snap.mainTrend}>
              {snap.mainTrend}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 bg-surface-container rounded-xl border border-white/[0.04] px-4 py-2.5 hover:border-primary/15 transition-colors">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[14px] text-error">target</span>
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.18em] whitespace-nowrap">
                Слабость #1 конкурента
              </span>
            </div>
            <p
              className="text-sm text-on-surface text-right truncate"
              title={snap.competitorWeakness}
            >
              {snap.competitorWeakness}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 bg-surface-container rounded-xl border border-white/[0.04] px-4 py-2.5 hover:border-primary/15 transition-colors">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[14px] text-amber-400">stars</span>
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.18em] whitespace-nowrap">
                Микросегмент ×10
              </span>
            </div>
            <p className="text-sm text-on-surface text-right truncate" title={snap.microSegment}>
              {snap.microSegment}
            </p>
          </div>
        </div>
        </>
        )}

        {/* ── Quick links to /market sub-sections (Гига Раздел Рынок) ────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
          {[
            { href: '/market', label: 'Обзор рынка', icon: 'dashboard' },
            { href: '/market?tab=competitors', label: 'Конкуренты', icon: 'groups' },
            { href: '/market?tab=intelligence', label: 'Intelligence', icon: 'radar' },
            { href: '/market?tab=news', label: 'Новости отрасли', icon: 'newspaper' },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-surface-container border border-white/[0.06] text-on-surface hover:border-primary/40 hover:text-primary text-xs font-mono font-bold uppercase tracking-wide transition-colors focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[14px]">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>

        {/* ── Collapsible footer ────────────────────────────────────────── */}
        <MarketAnalysisFooter />
      </div>
    </section>
  )
}
