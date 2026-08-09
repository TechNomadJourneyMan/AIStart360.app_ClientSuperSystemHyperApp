import { MarketSkeleton } from './MarketSkeleton'

/**
 * Скелетон перехода. Раньше рисовал «две карточки + большой блок» — форму,
 * которой нет ни на /market, ни на /market/analysis, поэтому вёрстка прыгала.
 */
export default function Loading() {
  return <MarketSkeleton />
}
