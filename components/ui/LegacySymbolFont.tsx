'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

/** Load the old icon font only on screens that still contain font icons.
 * The shared shell and the account empty states use local SVGs instead.
 */
export function LegacySymbolFont() {
  const pathname = usePathname()
  const [needed, setNeeded] = useState(false)

  useEffect(() => {
    const check = () => setNeeded(!!document.querySelector('.material-symbols-outlined, .material-symbols-filled'))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [pathname])

  return needed ? <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" /> : null
}
