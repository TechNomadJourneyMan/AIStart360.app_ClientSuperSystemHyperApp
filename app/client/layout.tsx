import { MascotLauncher } from '@/components/assistant/mascot/MascotLauncher'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {children}
      {/* Floating assistant — the mascot «Гри» on every client page (survey,
          Point A, etc.); static-launcher fallback via MascotLauncher */}
      <MascotLauncher />
    </div>
  )
}
