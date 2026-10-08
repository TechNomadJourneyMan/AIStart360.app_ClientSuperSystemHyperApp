import { TodayPage } from '@/components/giga-panel/pages/TodayPage'
import { ExpertBotLinkCard } from '@/components/giga-panel/ExpertBotLinkCard'

export default function Page() {
  return (
    <div className="space-y-6">
      <ExpertBotLinkCard />
      <TodayPage />
    </div>
  )
}
