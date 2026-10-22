'use client'

/**
 * Widgets of the staff view of /dashboard, loaded only when that view is rendered (W4): a client's
 * dashboard does not download them. `next/dynamic` splits a chunk only from a client module, so the
 * Server Component page imports these wrappers.
 */
import dynamic from 'next/dynamic'

export const GoalsBar = dynamic(() => import('./GoalsBar').then((m) => m.GoalsBar))
export const DashboardKeyMetrics = dynamic(() => import('./DashboardKeyMetrics').then((m) => m.DashboardKeyMetrics))
export const WidgetGrid = dynamic(() => import('./WidgetGrid').then((m) => m.WidgetGrid))
export const CrmActivity = dynamic(() => import('./CrmActivity').then((m) => m.CrmActivity))
