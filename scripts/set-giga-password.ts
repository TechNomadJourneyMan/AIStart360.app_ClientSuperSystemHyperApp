/**
 * Печатает хеш пароля входа в ГИГА-Панель для GIGA_OWNER_PASSWORD_HASH.
 *
 *   npx tsx scripts/set-giga-password.ts
 *
 * Пароль вводится скрыто (звёздочками) и никуда не записывается — ни в файл, ни в БД.
 * Полученную строку положите в .env.local и в Vercel (Production):
 *   vercel env add GIGA_OWNER_PASSWORD_HASH production
 */
import { hashOwnerPassword, MAX_PASSWORD_LENGTH } from '../lib/admin/owner-password'

let piped = ''

/** Hidden input: each character is echoed as `*`, Backspace works, Ctrl+C aborts. */
function ask(prompt: string): Promise<string> {
  const stdin = process.stdin
  process.stdout.write(prompt)
  if (!stdin.isTTY) {
    // Piped input (e.g. `printf 'p\\np\\n' | ...`): one line per question; the
    // leftover of a chunk is kept for the next question.
    return new Promise((resolve) => {
      const take = () => {
        const nl = piped.indexOf('\n')
        if (nl < 0) return false
        const line = piped.slice(0, nl).replace(/\r$/, '')
        piped = piped.slice(nl + 1)
        stdin.off('data', onData); stdin.pause(); process.stdout.write('\n'); resolve(line)
        return true
      }
      const onData = (d: Buffer) => { piped += d.toString('utf8'); take() }
      stdin.on('data', onData)
      if (!take()) stdin.resume()
    })
  }
  return new Promise((resolve) => {
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    const onData = (d: Buffer) => {
      for (const ch of d.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData); stdin.setRawMode(false); stdin.pause()
          process.stdout.write('\n'); resolve(value); return
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130) }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) { value = [...value].slice(0, -1).join(''); process.stdout.write('\b \b') }
          continue
        }
        if (ch >= ' ') { value += ch; process.stdout.write('*') }
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const a = await ask('Новый пароль: ')
  const b = await ask('Повторите пароль: ')
  if (a !== b) throw new Error('Пароли не совпадают')
  if (a.length < 12) throw new Error('Минимум 12 символов')
  if (a.length > MAX_PASSWORD_LENGTH) throw new Error(`Максимум ${MAX_PASSWORD_LENGTH} символов`)
  console.log('\nGIGA_OWNER_PASSWORD_HASH=' + hashOwnerPassword(a))
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
