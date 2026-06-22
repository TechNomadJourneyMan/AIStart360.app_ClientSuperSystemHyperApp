import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'

export const metadata: Metadata = {
  title: 'Политика конфиденциальности | AIStart360',
  description: 'Политика конфиденциальности AIStart360 — как мы собираем, используем и защищаем персональные данные и бизнес-данные пользователей.',
}

const SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: '1. Какие данные мы собираем',
    body: [
      'Контактные данные: имя, email, телефон, название компании, должность — предоставляемые при регистрации и подаче заявки.',
      'Бизнес-данные: сведения, которые вы загружаете в анкетах и отчётах для проведения диагностики (показатели, документы, выгрузки).',
      'Технические данные: журналы доступа, тип устройства и браузера, необходимые для работы и безопасности сервиса.',
    ],
  },
  {
    title: '2. Как мы используем данные',
    body: [
      'Для предоставления сервиса: проведения GRI-диагностики, рыночной аналитики, построения стратегии и сопровождения экспертами.',
      'Для связи с вами: уведомления о статусе заявки, изменениях в сервисе и ответы на обращения.',
      'Для улучшения Платформы: анализ обезличенных данных об использовании функций.',
    ],
  },
  {
    title: '3. Правовые основания обработки',
    body: [
      'Мы обрабатываем данные на основании вашего согласия, необходимости исполнения договора (предоставления сервиса) и наших законных интересов по обеспечению работы и безопасности Платформы.',
    ],
  },
  {
    title: '4. Передача данных третьим лицам',
    body: [
      'Мы не продаём ваши данные. Передача возможна только поставщикам инфраструктуры (хостинг, рассылки, аналитика), действующим по нашему поручению и обязанным обеспечивать конфиденциальность, а также в случаях, прямо предусмотренных законом.',
    ],
  },
  {
    title: '5. Хранение и защита',
    body: [
      'Данные хранятся в течение срока, необходимого для предоставления сервиса и соблюдения требований законодательства.',
      'Мы применяем организационные и технические меры защиты: шифрование при передаче, разграничение доступа и регулярный аудит безопасности.',
    ],
  },
  {
    title: '6. Ваши права',
    body: [
      'Вы вправе запросить доступ к своим данным, их исправление или удаление, ограничить обработку и отозвать согласие. Для реализации этих прав свяжитесь с нами по контактам ниже.',
    ],
  },
  {
    title: '7. Файлы cookie',
    body: [
      'Мы используем cookie и аналогичные технологии для аутентификации, сохранения настроек и анализа использования. Вы можете управлять cookie в настройках браузера.',
    ],
  },
]

export default function PrivacyPage() {
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
          Политика конфиденциальности
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
              По вопросам обработки персональных данных пишите на{' '}
              <a href="mailto:privacy@aistart360.app" className="text-primary hover:underline">
                privacy@aistart360.app
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  )
}
