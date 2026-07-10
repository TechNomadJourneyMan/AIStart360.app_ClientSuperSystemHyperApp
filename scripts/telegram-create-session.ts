import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID)
  const apiHash = process.env.TELEGRAM_API_HASH?.trim()

  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH before running this script.')
  }

  const rl = readline.createInterface({ input, output })
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  })

  await client.start({
    phoneNumber: async () => rl.question('Telegram phone number (+770...): '),
    phoneCode: async () => rl.question('Login code from Telegram: '),
    password: async () => rl.question('2FA password, if enabled: '),
    onError: (error) => console.error('[telegram-create-session]', error),
  })

  const session = (client.session as StringSession).save()
  console.log('\nTELEGRAM_USER_SESSION=')
  console.log(session)
  console.log('\nStore it only in server-side env variables. Do not commit it.')

  await client.disconnect()
  rl.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
