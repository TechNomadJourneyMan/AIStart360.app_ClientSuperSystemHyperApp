'use client'

/**
 * Render a modal / sheet into document.body. A `position: fixed` overlay
 * inside an element with `backdrop-filter` / `transform` (our glass cards) is
 * positioned against that element, not the viewport — it ends up clipped
 * behind the content.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? createPortal(children, document.body) : null
}
