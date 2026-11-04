import { Logo } from '@/components/ui/Logo'

/**
 * Оболочка служебных страниц входа по ссылке из письма (/auth/confirm,
 * /auth/reset-password): по центру экрана, с логотипом. Маршруты
 * /auth/verify и /auth/callback — обработчики, на них макет не влияет.
 */
export default function AuthFlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo className="h-8" />
        </div>
        {children}
      </div>
    </div>
  )
}
