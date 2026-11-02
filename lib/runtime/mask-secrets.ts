/**
 * lib/runtime/mask-secrets.ts — keeps database credentials out of log lines.
 *
 * A pg or graphile-worker error message can echo the connection string, or the user and the
 * password taken out of it (raw or percent-decoded). Every one of those is replaced with ***.
 */

/** `message` with the connection string, its user and its password (as written and decoded) masked. */
export function maskConnectionSecrets(message: string, connectionString: string | undefined): string {
  if (!connectionString) return message
  const secrets: string[] = [connectionString]
  try {
    const url = new URL(connectionString)
    for (const part of [url.password, url.username]) {
      secrets.push(part)
      // Each decode on its own: a malformed % in one must not drop the others from the list.
      try {
        secrets.push(decodeURIComponent(part))
      } catch {
        // the raw value is already in the list
      }
    }
  } catch {
    // not a URL: the whole string is masked above
  }
  return secrets
    .filter(Boolean) // an empty user or password would otherwise put *** between every character
    .sort((a, b) => b.length - a.length) // longest first: the whole URL before the parts inside it
    .reduce((out, secret) => out.split(secret).join('***'), message)
}
