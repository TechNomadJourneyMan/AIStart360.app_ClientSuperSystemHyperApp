'use client'
import RouteError, { type RouteErrorProps } from '@/components/common/RouteError'

// R-102: an error in the expert portal leads back to the expert's dashboard.
export default function ExpertError(props: Pick<RouteErrorProps, 'error' | 'reset'>) {
  return <RouteError {...props} homeHref="/expert/dashboard" />
}
