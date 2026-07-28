// Verifies literal internal links against the Next.js App Router tree.
// Dynamic/template destinations are intentionally left to browser tests.

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const appRoot = path.join(root, 'app')
const scanRoots = ['app', 'components', 'lib'].map((entry) => path.join(root, entry))
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function routeFromFile(file) {
  const relative = path.relative(appRoot, path.dirname(file))
  const segments = relative
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
  return `/${segments.join('/')}`.replace(/\/+$/, '') || '/'
}

function routePattern(route) {
  const segments = route.split('/').filter(Boolean).map((segment) => {
    if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '(?:/.*)?'
    if (/^\[\.\.\..+\]$/.test(segment)) return '/.+'
    if (/^\[.+\]$/.test(segment)) return '/[^/]+'
    return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
  })
  return new RegExp(`^${segments.join('') || '/'}(?:/)?$`)
}

const routeFiles = walk(appRoot).filter((file) => (
  /(?:^|\/)(?:page\.(?:ts|tsx|js|jsx)|route\.(?:ts|tsx|js|jsx))$/.test(file)
  && !file.includes(`${path.sep}api${path.sep}`)
))
const routes = [...new Set(routeFiles.map(routeFromFile))]
const patterns = routes.map((route) => ({ route, pattern: routePattern(route) }))

const publicFiles = new Set(
  walk(path.join(root, 'public')).map((file) => `/${path.relative(path.join(root, 'public'), file).split(path.sep).join('/')}`),
)

const literalPatterns = [
  /\bhref\s*=\s*["'](\/[^"'#]*)["']/g,
  /\bhref\s*:\s*["'](\/[^"'#]*)["']/g,
  /\b(?:push|replace|redirect)\(\s*["'](\/[^"'#]*)["']/g,
]

const missing = []
for (const file of scanRoots.flatMap(walk).filter((entry) => sourceExtensions.has(path.extname(entry)))) {
  const source = fs.readFileSync(file, 'utf8')
  for (const expression of literalPatterns) {
    expression.lastIndex = 0
    let match
    while ((match = expression.exec(source))) {
      const raw = match[1]
      const target = raw.split('?')[0].replace(/\/+$/, '') || '/'
      if (
        target.startsWith('/api/')
        || target.startsWith('/_next/')
        || target.startsWith('/auth/')
        || publicFiles.has(target)
      ) {
        continue
      }
      if (patterns.some(({ pattern }) => pattern.test(target))) continue
      const line = source.slice(0, match.index).split('\n').length
      missing.push({
        target: raw,
        source: `${path.relative(root, file)}:${line}`,
      })
    }
  }
}

const uniqueMissing = [...new Map(
  missing.map((item) => [`${item.target}\0${item.source}`, item]),
).values()]

console.log(`Routes: ${routes.length}`)
console.log(`Literal internal transitions checked: ${missing.length === 0 ? 'all resolved' : 'failures found'}`)
if (uniqueMissing.length > 0) {
  for (const item of uniqueMissing) {
    console.error(`MISSING ${item.target} <- ${item.source}`)
  }
  process.exitCode = 1
}
