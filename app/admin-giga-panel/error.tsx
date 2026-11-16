'use client'
import RouteError, { type RouteErrorProps } from '@/components/common/RouteError'

// R-102: an error inside the GIGA panel keeps its shell and leads back to the
// panel's home page, not to the client sign-in.
export default function GigaPanelError(props: Pick<RouteErrorProps, 'error' | 'reset'>) {
  return <RouteError {...props} homeHref="/admin-giga-panel" homeLabel="На главную панели" />
}
