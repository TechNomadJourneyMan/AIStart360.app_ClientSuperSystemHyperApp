import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'

export const metadata: Metadata = {
  title: 'Условия использования | AIStart360',
  description: 'Условия использования платформы AIStart360 — права и обязанности пользователей сервиса AI-диагностики и стратегического сопровождения бизнеса.',
}

const SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: '1. Общие положения',
    body: [
      'Настоящие Условия использования (далее — «Условия») регулируют отношения между AIStart360 (далее — «Платформа», «мы») и пользователем (далее — «Пользователь», «вы») при использовании сервиса AI-диагностики, рыночной аналитики и стратегического сопровождения бизнеса.',
      'Регистрируясь на Платформе или используя её функции, вы подтверждаете, что ознакомились с настоящими Условиями, принимаете их в полном объёме и обязуетесь соблюдать.',
    ],
  },
  {
    title: '2. Описание сервиса',
    body: [
      'Платформа предоставляет инструменты для оценки готовности бизнеса к росту (GRI-диагностика), анализа рынка, построения дорожной карты «Точка А → Точка Б» и сопровождения экспертами.',
      'Результаты диагностики и аналитики носят рекомендательный характер и не являются гарантией достижения конкретных бизнес-показателей.',
    ],
  },
  {
    title: '3. Регистрация и учётная запись',
    body: [
      'Для доступа к большинству функций требуется регистрация. Вы обязуетесь предоставлять достоверные данные и поддерживать их в актуальном состоянии.',
      'Вы несёте ответственность за сохранность учётных данных и за все действия, совершённые под вашей учётной записью.',
    ],
  },
  {
    title: '4. Права и обязанности пользователя',
    body: [
      'Вы вправе использовать Платформу в рамках, предусмотренных её функциональностью и настоящими Условиями.',
      'Запрещается: нарушать работу Платформы, получать несанкционированный доступ к данным других пользователей, использовать сервис для незаконной деятельности, а также копировать или распространять материалы Платформы без разрешения.',
    ],
  },
  {
    title: '5. Интеллектуальная собственность',
    body: [
      'Все права на программное обеспечение, дизайн, методологии и контент Платформы принадлежат AIStart360, если иное прямо не указано.',
      'Данные, загруженные Пользователем, остаются его собственностью; Платформа использует их исключительно для предоставления сервиса.',
    ],
  },
  {
    title: '6. Ограничение ответственности',
    body: [
      'Платформа предоставляется «как есть». Мы не гарантируем бесперебойную работу сервиса и не несём ответственности за решения, принятые на основе результатов диагностики и аналитики.',
    ],
  },
  {
    title: '7. Изменение условий',
    body: [
      'Мы вправе вносить изменения в настоящие Условия. Актуальная редакция всегда доступна на этой странице. Продолжение использования Платформы после изменений означает ваше согласие с ними.',
    ],
  },
]

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0A0B0F] text-on-surface relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-primary/5 rounded-full blur-[160px]" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-5 md:px-10 py-5">
        <Logo className="h-7" />
        <Link
          href="/register"
          className="text-sm text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-lg px-2 py-1"
        >
          Назад к регистрации
        </Link>
      </header>

      {/* Content */}
      <article className="relative z-10 max-w-3xl mx-auto px-5 md:px-10 pt-6 pb-20">
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Правовая информация
        </p>
        <h1 className="font-headline text-3xl md:text-4xl font-extrabold leading-tight text-on-surface">
          Условия использования
        </h1>
        <p className="text-sm text-on-surface-variant mt-3">
          Последнее обновление: 22 июня 2026 г.
        </p>

        <div className="mt-10 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="font-headline text-lg font-bold text-on-surface mb-3">{s.title}</h2>
              <div className="space-y-3">
                {s.body.map((p, i) => (
                  <p key={i} className="text-sm text-on-surface-variant leading-relaxed">{p}</p>
                ))}
              </div>
            </section>
          ))}

          <section className="rounded-2xl bg-surface-container-low border border-white/[0.06] p-6">
            <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Контакты</h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              По вопросам, связанным с настоящими Условиями, пишите на{' '}
              <a href="mailto:support@aistart360.app" className="text-primary hover:underline">
                support@aistart360.app
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  )
}
