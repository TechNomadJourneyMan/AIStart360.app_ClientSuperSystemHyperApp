import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'Вход — AIStart360' },
  openGraph: { title: 'Вход — AIStart360' },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
