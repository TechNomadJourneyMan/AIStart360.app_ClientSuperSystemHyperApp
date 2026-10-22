import { PageSkeleton } from '@/components/loading/PageSkeleton'

export default function Loading() {
  return <PageSkeleton label="Загрузка документов…" variant="list" width="max-w-2xl" />
}
