'use client'
import RouteError, { type RouteErrorProps } from '@/components/common/RouteError'

// R-102: an error inside the SuperExpert workspace keeps its shell and leads
// back to the workspace's home page.
export default function SuperExpertError(props: Pick<RouteErrorProps, 'error' | 'reset'>) {
  return <RouteError {...props} homeHref="/super-expert" homeLabel="На главную кабинета" />
}
