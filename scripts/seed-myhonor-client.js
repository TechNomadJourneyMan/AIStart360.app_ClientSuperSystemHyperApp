// Backward-compatible entry point. The old command no longer rotates a real
// user's password or seeds demo survey facts. See provision-store-account.js.
const { main } = require('./provision-store-account')

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : 'Store provisioning failed')
  process.exitCode = 1
})
