'use client'

/**
 * components/assistant/mascot/MascotAvatar.tsx — the cat «Гри» (SVG + Framer Motion).
 *
 * A minimal dark-glassmorphism cat in brand colors: dark body, teal (#6effc0)
 * eyes/collar/tail tip. Poses are driven by the mascot finite state (ТЗ §4.2)
 * through variants on sub-groups (ears, head, paws, sparkle); the idle
 * breathing/blink loops pause under prefers-reduced-motion, when the tab is
 * hidden (`paused`) and in minimized/head-only mode.
 *
 * Pure presentational: no store access — MascotAssistant orchestrates.
 */

import { motion, useReducedMotion } from 'framer-motion'
import type { MascotState } from '@/lib/assistant/mascot/types'

const TEAL = '#6effc0'
const TEAL_DIM = '#00e29e'
const BODY = '#1a1e27'
const BODY_DARK = '#12151c'
const INK = '#0A0B0F'

interface MascotAvatarProps {
  pose: MascotState
  /** Rendered box size in px. */
  size?: number
  /** Freeze all loops (hidden tab, reduced motion is handled internally). */
  paused?: boolean
  /** Head-only chip for the minimized state. */
  headOnly?: boolean
}

// Pose → sub-group variant names (framer propagates via the `animate` prop).
function earVariant(pose: MascotState): string {
  if (pose === 'insight' || pose === 'greeting') return 'perk'
  if (pose === 'error') return 'down'
  return 'rest'
}
function headVariant(pose: MascotState): string {
  if (pose === 'question') return 'tiltRight'
  if (pose === 'loading') return 'tiltLeft'
  if (pose === 'error') return 'droop'
  return 'straight'
}

export function MascotAvatar({ pose, size = 84, paused = false, headOnly = false }: MascotAvatarProps) {
  const reduced = useReducedMotion()
  const animate = !reduced && !paused

  const svgOrigin = { transformBox: 'fill-box', transformOrigin: 'center' } as const

  const eyes =
    pose === 'error' ? { scaleY: 0.45 } : pose === 'loading' ? { scaleY: 0.7 } : { scaleY: 1 }

  return (
    <svg
      viewBox={headOnly ? '28 14 64 60' : '0 0 120 120'}
      width={size}
      height={size}
      role="img"
      aria-hidden
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="gri-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BODY} />
          <stop offset="100%" stopColor={BODY_DARK} />
        </linearGradient>
        <radialGradient id="gri-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.55" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
        </radialGradient>
      </defs>

      {!headOnly && (
        <>
          {/* Tail — behind the body, teal tip; gentle sway in idle. */}
          <motion.g
            style={svgOrigin}
            animate={animate ? { rotate: [0, 3, 0, -2, 0] } : { rotate: 0 }}
            transition={animate ? { duration: 6, repeat: Infinity, ease: 'easeInOut' } : undefined}
          >
            <path
              d="M86 96 Q108 90 105 68"
              fill="none"
              stroke={BODY}
              strokeWidth="8"
              strokeLinecap="round"
            />
            <circle cx="105" cy="66" r="5" fill={TEAL_DIM} opacity="0.9" />
          </motion.g>

          {/* Body with breathing loop. */}
          <motion.g
            style={svgOrigin}
            animate={animate ? { scaleY: [1, 1.02, 1] } : { scaleY: 1 }}
            transition={animate ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
          >
            <ellipse cx="60" cy="88" rx="31" ry="25" fill="url(#gri-body)" stroke="rgba(255,255,255,0.08)" />
            <ellipse cx="60" cy="94" rx="16" ry="11" fill="rgba(255,255,255,0.035)" />
          </motion.g>

          {/* Front paws. */}
          <ellipse cx="48" cy="110" rx="8" ry="4.5" fill={BODY_DARK} stroke="rgba(255,255,255,0.06)" />
          <ellipse cx="72" cy="110" rx="8" ry="4.5" fill={BODY_DARK} stroke="rgba(255,255,255,0.06)" />
        </>
      )}

      {/* Head group (tilts by pose). */}
      <motion.g
        style={svgOrigin}
        variants={{
          straight: { rotate: 0, y: 0 },
          tiltRight: { rotate: 9, y: 0 },
          tiltLeft: { rotate: -7, y: 1 },
          droop: { rotate: 3, y: 3 },
        }}
        animate={headVariant(pose)}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        {/* Ears */}
        <motion.path
          d="M39 40 L34 15 Q47 19 52 30 Z"
          fill="url(#gri-body)"
          stroke="rgba(255,255,255,0.08)"
          style={{ transformBox: 'fill-box', transformOrigin: 'bottom center' }}
          variants={{ rest: { rotate: 0 }, perk: { rotate: -8 }, down: { rotate: -30 } }}
          animate={earVariant(pose)}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        />
        <motion.path
          d="M81 40 L86 15 Q73 19 68 30 Z"
          fill="url(#gri-body)"
          stroke="rgba(255,255,255,0.08)"
          style={{ transformBox: 'fill-box', transformOrigin: 'bottom center' }}
          variants={{ rest: { rotate: 0 }, perk: { rotate: 8 }, down: { rotate: 30 } }}
          animate={earVariant(pose)}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        />
        <path d="M41 36 L38 22 Q45 25 48 31 Z" fill={TEAL} opacity="0.22" />
        <path d="M79 36 L82 22 Q75 25 72 31 Z" fill={TEAL} opacity="0.22" />

        {/* Face */}
        <circle cx="60" cy="50" r="27" fill="url(#gri-body)" stroke="rgba(255,255,255,0.08)" />

        {/* Eyes: soft glow + teal iris + dark pupil slit; blink loop. */}
        <ellipse cx="50" cy="50" rx="9" ry="9" fill="url(#gri-glow)" />
        <ellipse cx="70" cy="50" rx="9" ry="9" fill="url(#gri-glow)" />
        <motion.g
          style={svgOrigin}
          animate={
            animate && pose !== 'error' && pose !== 'loading'
              ? { scaleY: [1, 1, 0.08, 1] }
              : eyes
          }
          transition={
            animate && pose !== 'error' && pose !== 'loading'
              ? { duration: 0.5, times: [0, 0.9, 0.95, 1], repeat: Infinity, repeatDelay: 3.8 }
              : { duration: 0.25 }
          }
        >
          <ellipse cx="50" cy="50" rx="4.6" ry="5.6" fill={TEAL} />
          <ellipse cx="70" cy="50" rx="4.6" ry="5.6" fill={TEAL} />
          <ellipse cx="50" cy="50.5" rx="1.7" ry="3.6" fill={INK} />
          <ellipse cx="70" cy="50.5" rx="1.7" ry="3.6" fill={INK} />
          <circle cx="51.4" cy="47.8" r="1" fill="#eafff5" opacity="0.9" />
          <circle cx="71.4" cy="47.8" r="1" fill="#eafff5" opacity="0.9" />
        </motion.g>

        {/* Nose + mouth + whiskers */}
        <path d="M57.6 59 L62.4 59 L60 62.4 Z" fill={TEAL_DIM} opacity="0.85" />
        <path d="M56 65 Q60 68 64 65" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.4" strokeLinecap="round" />
        <g stroke="rgba(255,255,255,0.13)" strokeWidth="1.2" strokeLinecap="round">
          <path d="M30 52 L42 53" />
          <path d="M31 59 L42 57" />
          <path d="M90 52 L78 53" />
          <path d="M89 59 L78 57" />
        </g>

        {/* Insight sparkle near the right ear. */}
        <motion.path
          d="M92 20 L94 26 L100 28 L94 30 L92 36 L90 30 L84 28 L90 26 Z"
          fill={TEAL}
          style={svgOrigin}
          initial={false}
          animate={
            pose === 'insight'
              ? { opacity: [0, 1, 0.6, 1], scale: [0.6, 1.15, 0.95, 1] }
              : { opacity: 0, scale: 0.6 }
          }
          transition={{ duration: 0.9 }}
        />
      </motion.g>

      {!headOnly && (
        <>
          {/* Collar — the brand accent. */}
          <path d="M42 71 Q60 80 78 71 L78 76 Q60 85 42 76 Z" fill={TEAL} opacity="0.9" />
          <circle cx="60" cy="80" r="2.6" fill="#eafff5" />

          {/* Waving paw (greeting). */}
          <motion.g
            style={{ transformBox: 'fill-box', transformOrigin: 'bottom center' }}
            initial={false}
            animate={
              pose === 'greeting'
                ? { opacity: 1, rotate: animate ? [0, -24, 8, -24, 0] : -12 }
                : { opacity: 0, rotate: 0 }
            }
            transition={pose === 'greeting' && animate ? { duration: 1.6, repeat: 2 } : { duration: 0.2 }}
          >
            <ellipse cx="92" cy="72" rx="6.4" ry="11" fill={BODY} stroke="rgba(255,255,255,0.1)" />
            <ellipse cx="92" cy="64" rx="5" ry="4" fill={BODY} />
          </motion.g>

          {/* Thinking paw at the chin (loading). */}
          <motion.g
            initial={false}
            animate={pose === 'loading' ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
            transition={{ duration: 0.25 }}
          >
            <ellipse cx="73" cy="67" rx="5.6" ry="7.5" fill={BODY} stroke="rgba(255,255,255,0.1)" />
          </motion.g>
        </>
      )}
    </svg>
  )
}
