'use client'

import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  iconOnly?: boolean
  priority?: boolean
  href?: string
}

export function Logo({ 
  className, 
  iconOnly = false, 
  priority = true,
  href = '/' 
}: LogoProps) {
  return (
    <Link 
      href={href} 
      className={cn("inline-flex items-center gap-2 select-none active:scale-[0.98] transition-transform", className)}
    >
      {iconOnly ? (
        <Image
          src="/logo-icon.svg"
          alt="AIStart360 Icon"
          width={32}
          height={32}
          className="w-auto h-8 flex-shrink-0"
          priority={priority}
        />
      ) : (
        <Image
          src="/logo.svg"
          alt="AIStart360 Logo"
          width={148}
          height={27}
          className="w-auto h-7 flex-shrink-0"
          priority={priority}
        />
      )}
    </Link>
  )
}
