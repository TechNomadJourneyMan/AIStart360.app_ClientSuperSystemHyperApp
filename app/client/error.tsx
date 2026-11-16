'use client'
import RouteError, { type RouteErrorProps } from '@/components/common/RouteError'

// R-102: an error in the cabinet leads back to the cabinet's home page.
export default function ClientError(props: Pick<RouteErrorProps, 'error' | 'reset'>) {
  return <RouteError {...props} homeHref="/client/home" />
}
