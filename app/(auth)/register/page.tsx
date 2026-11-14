import type { Metadata } from 'next'
import { Logo } from '@/components/ui/Logo'
import { SymbolIcon } from '@/components/ui/SymbolIcon'
import { RegisterForm } from '@/components/auth-home/RegisterForm'

export const metadata: Metadata = {
  title: { absolute: 'Регистрация — AIStart360' },
  openGraph: { title: 'Регистрация — AIStart360' },
}

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-background text-on-surface flex">
      {/* Left — Branding */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[150px]" />

        <div className="relative z-10">
          <Logo className="h-8" />
        </div>

        <div className="relative z-10">
          <p className="text-3xl font-headline font-extrabold text-on-surface leading-tight">
            Присоединяйтесь к<br />
            <span className="text-primary">AIStart360</span>
          </p>
          <p className="text-sm text-on-surface-variant/60 mt-4 max-w-sm leading-relaxed">
            Платформа для роста бизнеса с AI-диагностикой, рыночной аналитикой и стратегическим сопровождением.
          </p>

          {/* Features */}
          <div className="mt-8 space-y-4">
            {[
              { icon: 'radar', title: 'GRI-диагностика', desc: 'Оценка по 6 доменам готовности к росту' },
              { icon: 'query_stats', title: 'Рыночная аналитика', desc: 'TAM/SAM/SOM, тренды, конкуренты' },
              { icon: 'trending_up', title: 'Дорожная карта', desc: 'Точка А → Точка Б с конкретными KPI' },
            ].map((f) => (
              <div key={f.icon} className="flex items-start gap-3">
                <SymbolIcon name={f.icon} className="text-primary text-xl mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-on-surface/80">{f.title}</p>
                  <p className="text-xs text-on-surface-variant/50">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="relative z-10 grid grid-cols-3 gap-3">
          {[
            { val: '500+', label: 'клиентов' },
            { val: '27', label: 'отраслей' },
            { val: '94%', label: 'NPS' },
          ].map((s) => (
            <div key={s.label} className="bg-surface-container/30 border border-white/[0.05] rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-primary">{s.val}</p>
              <p className="text-[10px] font-mono text-on-surface-variant/50 uppercase tracking-wider mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right — Form */}
      <div className="w-full lg:w-[55%] flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <Logo className="h-8" />
          </div>

          <h1 className="text-2xl font-headline font-extrabold text-on-surface mb-1">Подать заявку</h1>
          <p className="text-base text-on-surface-variant mb-6">
            Зарегистрируйтесь как клиент для AI-диагностики бизнеса.
          </p>

          <RegisterForm />
        </div>
      </div>
    </div>
  )
}
