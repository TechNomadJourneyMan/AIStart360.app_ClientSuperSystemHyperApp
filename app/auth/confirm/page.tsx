import Link from 'next/link'
import { parseEmailLinkParams, type EmailLinkType } from '../verify/link-params'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Подтверждение — AIStart360',
  robots: { index: false, follow: false },
  // В адресе одноразовый токен: сторонним ресурсам Referer не уходит вовсе.
  // ('no-referrer' не годится: тогда браузер шлёт с формы `Origin: null`, и
  // POST /auth/verify не смог бы проверить, что форма наша.)
  referrer: 'same-origin' as const,
}

const COPY: Record<EmailLinkType, { title: string; text: string; button: string }> = {
  recovery: {
    title: 'Восстановление пароля',
    text: 'Нажмите «Продолжить», чтобы перейти к выбору нового пароля.',
    button: 'Продолжить',
  },
  invite: {
    title: 'Приглашение в AIStart360',
    text: 'Нажмите «Продолжить», чтобы принять приглашение и задать пароль.',
    button: 'Продолжить',
  },
  magiclink: {
    title: 'Вход по ссылке',
    text: 'Нажмите «Продолжить», чтобы войти в кабинет.',
    button: 'Продолжить',
  },
}

/**
 * /auth/confirm — промежуточная страница ссылки из письма.
 *
 * Одноразовый токен тратится только по нажатию кнопки (POST /auth/verify):
 * почтовые сканеры, которые заранее открывают ссылки из писем, видят лишь эту
 * страницу и токен не сжигают. Скрипты не нужны — обычная HTML-форма.
 */
export default function ConfirmEmailLinkPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => {
    const v = searchParams[k]
    return typeof v === 'string' ? v : null
  }
  const { tokenHash, type, next } = parseEmailLinkParams(one)
  const copy = COPY[type]

  if (!tokenHash) {
    return (
      <div className="glass-card rounded-2xl p-8 shadow-modal text-center">
        <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">Ссылка недействительна</h1>
        <p className="text-sm text-on-surface-variant mb-6">
          Похоже, ссылка открылась не целиком. Запросите новое письмо.
        </p>
        <Link href="/forgot-password" className="text-primary text-sm hover:underline">
          Запросить новую ссылку
        </Link>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-2xl p-8 shadow-modal">
      <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">{copy.title}</h1>
      <p className="text-sm text-on-surface-variant mb-6">{copy.text}</p>
      <form method="post" action="/auth/verify">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="w-full py-3 rounded-lg bg-gradient-to-br from-primary to-primary-container text-on-primary font-semibold text-sm hover:scale-[0.98] active:scale-95 transition-all duration-150"
        >
          {copy.button}
        </button>
      </form>
      <p className="mt-4 text-center text-[11px] text-on-surface-variant/70">
        Ссылка срабатывает один раз и действует ограниченное время.
      </p>
    </div>
  )
}
