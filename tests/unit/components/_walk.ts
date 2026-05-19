/**
 * Tiny structural walker for React element trees produced by calling
 * components directly (no react-dom rendering — vitest is in node env
 * and @testing-library/react is not installed).
 */
import type { ReactElement, ReactNode } from 'react'

export interface WalkNode {
  type: unknown
  typeName: string
  props: Record<string, unknown>
  children: WalkNode[]
}

function typeName(type: unknown): string {
  if (typeof type === 'string') return type
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string }
    return fn.displayName || fn.name || 'AnonymousComponent'
  }
  if (type && typeof type === 'object') {
    const t = type as {
      displayName?: string
      render?: { displayName?: string; name?: string }
      type?: unknown
    }
    if (t.displayName) return t.displayName
    if (t.render) return t.render.displayName || t.render.name || 'ForwardRef'
    if (t.type) return typeName(t.type)
    return 'Object'
  }
  return 'Unknown'
}

function isReactElement(value: unknown): value is ReactElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    // React elements expose `$$typeof` plus `type` + `props`
    'type' in value &&
    'props' in value
  )
}

export function walk(node: ReactNode): WalkNode | null {
  if (!isReactElement(node)) return null
  const el = node as ReactElement
  const rawProps = (el.props ?? {}) as Record<string, unknown>
  const children: WalkNode[] = []
  const childrenProp = rawProps.children as ReactNode | ReactNode[] | undefined
  const list = Array.isArray(childrenProp)
    ? (childrenProp as ReactNode[])
    : childrenProp !== undefined
      ? [childrenProp]
      : []
  for (const child of list) {
    if (Array.isArray(child)) {
      for (const c of child) {
        const w = walk(c)
        if (w) children.push(w)
      }
    } else {
      const w = walk(child)
      if (w) children.push(w)
    }
  }
  return {
    type: el.type,
    typeName: typeName(el.type),
    props: rawProps,
    children,
  }
}

/**
 * Flatten the walked tree into a single array of nodes (DFS).
 */
export function flatten(root: WalkNode | null): WalkNode[] {
  if (!root) return []
  const out: WalkNode[] = [root]
  for (const c of root.children) out.push(...flatten(c))
  return out
}

/**
 * Collect all string text leaves from a React node (recursive).
 */
export function collectText(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join(' ')
  if (isReactElement(node)) {
    const childProp = (node.props as { children?: ReactNode }).children
    return collectText(childProp ?? null)
  }
  return ''
}

/**
 * Concatenate all className strings found anywhere in the tree.
 */
export function allClassNames(root: WalkNode | null): string {
  return flatten(root)
    .map((n) => {
      const cls = n.props.className
      return typeof cls === 'string' ? cls : ''
    })
    .join(' ')
}

/**
 * Find first descendant whose typeName matches the predicate or string.
 */
export function findByType(
  root: WalkNode | null,
  match: string | ((name: string) => boolean)
): WalkNode | null {
  for (const n of flatten(root)) {
    const ok = typeof match === 'string' ? n.typeName === match : match(n.typeName)
    if (ok) return n
  }
  return null
}

/**
 * Concatenated full text of the tree.
 */
export function allText(root: WalkNode | null): string {
  if (!root) return ''
  return flatten(root)
    .map((n) => {
      const cp = n.props.children
      if (typeof cp === 'string' || typeof cp === 'number') return String(cp)
      return ''
    })
    .join(' ')
}
