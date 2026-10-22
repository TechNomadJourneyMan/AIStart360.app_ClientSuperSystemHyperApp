import { PageSkeleton } from '@/components/loading/PageSkeleton'

export default function Loading() {
  return <PageSkeleton label="Загрузка сообщений…" variant="list" width="max-w-3xl" />
}
