import { AssistantChatLauncher } from '@/components/assistant/AssistantChatPanel'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {children}
      {/* Floating assistant — available on every client page (survey, Point A, etc.) */}
      <AssistantChatLauncher />
    </div>
  )
}
