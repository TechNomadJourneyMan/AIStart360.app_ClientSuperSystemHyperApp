import { FullscreenPreloader } from '@/components/ui/Preloader'

// Branded fallback for public pages (gri-free lead magnet, privacy, terms) so
// they never flash a blank white screen on the dark theme during load.
export default function PublicLoading() {
  return <FullscreenPreloader label="Загрузка…" />
}
