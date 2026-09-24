/**
 * Оболочка бывшего портала эксперта. Страниц в группе больше нет — только
 * перенаправление в кабинет SuperExpert (см. expert/[[...slug]]/page.tsx).
 */
export default function ExpertLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
