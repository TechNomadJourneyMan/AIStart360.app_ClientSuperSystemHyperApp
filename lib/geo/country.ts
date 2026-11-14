/**
 * lib/geo/country.ts — the visitor's country (ISO 3166-1 alpha-2) from the request headers.
 *
 * Vercel's edge sets `x-vercel-ip-country`; Railway sends nothing of the sort, only the visitor's IP
 * (`x-real-ip` / `x-forwarded-for`, read through lib/net/client-ip). So the header wins when it is there, and otherwise the IP goes
 * through an offline GeoIP lookup (no network call). Private, loopback, link-local and malformed
 * addresses are never looked up: they carry no country, and the caller falls back to its default.
 */
import { BlockList, isIP } from 'node:net'
import { clientIpFromHeaders } from '@/lib/net/client-ip'

type HeaderBag = { get(name: string): string | null }

/** IP → ISO country code, or null when the address is unknown. May throw; the caller treats that as unknown. */
export type CountryLookup = (ip: string) => string | null

/** Addresses that can never carry a country: not routable on the public internet. */
const NON_PUBLIC = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network" / unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // private
  ['192.168.0.0', 16], // private
  ['224.0.0.0', 3], // multicast, reserved, broadcast
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv6')
}

/**
 * One address out of a header entry: whitespace, a `:port` and IPv6 brackets or zone id are dropped.
 * Null when what is left is not an IP address, or is one that is not public. (BlockList reads an
 * IPv4-mapped IPv6 address such as ::ffff:10.0.0.1 as the IPv4 address it wraps.)
 */
function publicIp(raw: string): string | null {
  let s = raw.trim()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s)
  if (bracketed) s = bracketed[1]
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'))
  s = s.replace(/%.*$/, '')
  const family = isIP(s)
  if (family === 0) return null
  return NON_PUBLIC.check(s, family === 4 ? 'ipv4' : 'ipv6') ? null : s
}

/**
 * The default lookup: the offline `geoip-country` database. Loaded on first use, not at import — it
 * reads ~10 MB of data files from its package directory (so it must stay external to the Next bundle,
 * see serverComponentsExternalPackages) and nothing that never reaches this path should pay for that.
 *
 * On Vercel the `.dat` files are not traced into the function, so this lookup always throws there and
 * the caller falls back to unknown. That is by design: on Vercel the `x-vercel-ip-country` header is
 * the source. Do not "fix" it by tracing the files in — ~10 MB per function for nothing.
 */
function geoipCountryLookup(ip: string): string | null {
  const geoip = require('geoip-country') as { lookup(ip: string): { country?: string } | null }
  return geoip.lookup(ip)?.country ?? null
}

/**
 * Country code for a request, or null when it cannot be told (no usable header or IP, a private
 * address, no database entry). `lookup` is injectable; the default is the offline GeoIP database.
 */
export function countryFromHeaders(
  h: HeaderBag,
  lookup: CountryLookup = geoipCountryLookup,
): string | null {
  const edge = h.get('x-vercel-ip-country')?.trim()
  if (edge && /^[A-Za-z]{2}$/.test(edge)) return edge.toUpperCase()

  // Only the address our proxy vouches for (R-049): X-Real-IP, else the rightmost trusted
  // X-Forwarded-For entry. The leftmost entry is whatever the client typed.
  const raw = clientIpFromHeaders(h)
  if (!raw) return null
  const ip = publicIp(raw)
  if (!ip) return null

  try {
    return lookup(ip)?.toUpperCase() || null
  } catch {
    return null
  }
}
