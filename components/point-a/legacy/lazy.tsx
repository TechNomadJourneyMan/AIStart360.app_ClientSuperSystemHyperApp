'use client'

/**
 * The client components of the previous Point A pages (setting `point_a_v4` off), loaded only when
 * such a page is rendered (W4). `next/dynamic` splits a client component into its own chunk only when
 * it is called from a client module — in a Server Component page it stays in the page's first load —
 * so the server pages import these wrappers instead of the components.
 */
import dynamic from 'next/dynamic'

export const ClientPointALegacy = dynamic(() => import('./ClientPointALegacy'))

export const FileArea = dynamic(() => import('@/components/point-a/FileArea').then((m) => m.FileArea))
export const PointAQuickToolbar = dynamic(() => import('@/components/point-a/PointAQuickToolbar'))
export const SurveyOverview = dynamic(() => import('@/components/point-a/SurveyOverview').then((m) => m.SurveyOverview))
export const GrowthSnapshotHero = dynamic(() => import('@/components/dashboard/GrowthSnapshotHero'))
export const KeyMetricsHero = dynamic(() => import('@/components/point-a/v2/KeyMetricsHero'))
export const MetricZonesGrid = dynamic(() => import('@/components/point-a/v2/MetricZonesGrid'))
export const InsightsFeed = dynamic(() => import('@/components/point-a/v2/InsightsFeed'))
export const PointAQuickPills = dynamic(() => import('@/components/point-a/v2/PointAQuickPills'))
export const PointAFilterSection = dynamic(() => import('@/components/point-a/v2/PointAFilterSection'))
export const ExecutiveOverview = dynamic(() => import('@/components/point-a/ExecutiveOverview'))
export const PublishedReports = dynamic(() => import('@/components/reports/PublishedReports'))
