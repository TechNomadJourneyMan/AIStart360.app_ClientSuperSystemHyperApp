export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {children}
    </div>
  )
}
