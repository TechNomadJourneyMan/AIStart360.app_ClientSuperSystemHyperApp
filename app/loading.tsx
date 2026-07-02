import { FullscreenPreloader } from '@/components/ui/Preloader'

// Root-level Suspense fallback for top-level route transitions (e.g. moving
// between route groups). Branded full-screen preloader keeps the dark
// background so there is no white flash on slow loads.
export default function RootLoading() {
  return <FullscreenPreloader label="Загрузка…" />
}
