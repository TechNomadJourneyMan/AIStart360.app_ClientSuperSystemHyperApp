'use client'

/**
 * components/assistant/mascot/MascotAvatar.tsx — the cat «Гри» v2.
 *
 * Cuter build (big eyes with double highlights, peach blush, heart nose,
 * rounded ears, bell collar, toe-bean front paws) + an idle-life layer on top
 * of the functional poses (ТЗ v1.1):
 *
 *   pose      — functional state (idle/greeting/hint/question/insight/loading/error)
 *   behavior  — idle-life overlay while the mascot has nothing to say:
 *               'walk' (leg cycle + bob), 'sleep' (closed eyes + Zzz),
 *               'rub' (rocking against the screen edge + heart)
 *
 * A busy pose always wins over behavior. All loops stop under
 * prefers-reduced-motion, `paused` (hidden tab / scrolling) and in head-only
 * mode. Facing/flip while walking is the parent's job (scaleX on the wrapper).
 *
 * Pure presentational: no store access — MascotAssistant orchestrates.
 */

import { motion, useReducedMotion } from 'framer-motion'
import type { MascotCharacterId } from '@/lib/assistant/mascot/characters'
import type { MascotBehaviorVisual, MascotState } from '@/lib/assistant/mascot/types'

const TEAL = '#6effc0'
const TEAL_DIM = '#00e29e'
const INK = '#0A0B0F'
const BLUSH = '#ff9d8a'

export type MascotColorId = 'ginger' | 'graphite' | 'snow' | 'cocoa'

/** Fur/feather palettes. «Рыжий» is the product default. */
export const MASCOT_PALETTES: Record<
  MascotColorId,
  { light: string; body: string; dark: string; stroke: string; detail: string; detailSoft: string }
> = {
  ginger: {
    light: '#f5a95f', body: '#ec8a33', dark: '#cf6d1d',
    stroke: 'rgba(0,0,0,0.22)', detail: 'rgba(60,30,5,0.55)', detailSoft: 'rgba(60,30,5,0.4)',
  },
  graphite: {
    light: '#232834', body: '#1a1e27', dark: '#12151c',
    stroke: 'rgba(255,255,255,0.09)', detail: 'rgba(255,255,255,0.32)', detailSoft: 'rgba(255,255,255,0.15)',
  },
  snow: {
    light: '#f6f8fa', body: '#e2e7ee', dark: '#c6cfda',
    stroke: 'rgba(0,0,0,0.14)', detail: 'rgba(30,40,55,0.5)', detailSoft: 'rgba(30,40,55,0.35)',
  },
  cocoa: {
    light: '#8a5a3b', body: '#6f462c', dark: '#54331e',
    stroke: 'rgba(0,0,0,0.2)', detail: 'rgba(255,235,220,0.4)', detailSoft: 'rgba(255,235,220,0.25)',
  },
}

/** Per-skin geometry switches — everything else (poses, loops) is shared. */
const CHAR_CFG: Record<
  MascotCharacterId,
  {
    ears: 'cat' | 'dog' | 'capy' | 'tufts'
    nose: 'heart' | 'dog' | 'capy' | 'beak'
    tail: 'cat' | 'dog' | 'none' | 'feathers'
    whiskers: 'long' | 'short' | 'none'
    eyeRings: boolean
    /** Baseline eyelid droop (capybara zen). */
    lidScale: number
    irisRx: number
    irisRy: number
  }
> = {
  cat: { ears: 'cat', nose: 'heart', tail: 'cat', whiskers: 'long', eyeRings: false, lidScale: 1, irisRx: 5.2, irisRy: 6.3 },
  dog: { ears: 'dog', nose: 'dog', tail: 'dog', whiskers: 'none', eyeRings: false, lidScale: 1, irisRx: 5.2, irisRy: 6.3 },
  capybara: { ears: 'capy', nose: 'capy', tail: 'none', whiskers: 'short', eyeRings: false, lidScale: 0.85, irisRx: 4.6, irisRy: 5.4 },
  owl: { ears: 'tufts', nose: 'beak', tail: 'feathers', whiskers: 'none', eyeRings: true, lidScale: 1, irisRx: 6, irisRy: 6.4 },
}

interface MascotAvatarProps {
  pose: MascotState
  /** Skin: cat Гри (default) / dog Арчи / capybara Капи / owl Ума. */
  character?: MascotCharacterId
  /** Fur/feather color (settings.color); ginger is the default. */
  color?: MascotColorId
  /** Idle-life overlay; ignored while a busy pose is active. */
  behavior?: MascotBehaviorVisual
  /** Rendered box size in px. */
  size?: number
  /** Freeze all loops (hidden tab; reduced motion is handled internally). */
  paused?: boolean
  /** Head-only chip for the minimized state. */
  headOnly?: boolean
}

const BUSY_POSES: MascotState[] = ['greeting', 'hint', 'question', 'insight', 'loading', 'error']

function earVariant(pose: MascotState, sleeping: boolean): string {
  if (sleeping) return 'sleepy'
  if (pose === 'insight' || pose === 'greeting') return 'perk'
  if (pose === 'error') return 'down'
  return 'rest'
}
function headVariant(pose: MascotState, sleeping: boolean): string {
  if (sleeping) return 'sleepy'
  if (pose === 'question') return 'tiltRight'
  if (pose === 'loading') return 'tiltLeft'
  if (pose === 'error') return 'droop'
  return 'straight'
}

export function MascotAvatar({
  pose,
  character = 'cat',
  color = 'ginger',
  behavior = null,
  size = 84,
  paused = false,
  headOnly = false,
}: MascotAvatarProps) {
  const cfg = CHAR_CFG[character] ?? CHAR_CFG.cat
  const pal = MASCOT_PALETTES[color] ?? MASCOT_PALETTES.ginger
  const bodyFill = `url(#gri-body-${color})`
  const reduced = useReducedMotion()
  const animate = !reduced && !paused

  const busy = BUSY_POSES.includes(pose)
  const effective: MascotBehaviorVisual = busy || headOnly ? null : behavior
  const sleeping = effective === 'sleep'
  const walking = effective === 'walk' && animate
  const rubbing = effective === 'rub' && animate

  const svgOrigin = { transformBox: 'fill-box', transformOrigin: 'center' } as const

  const eyesSquint =
    pose === 'error' ? { scaleY: 0.45 } : pose === 'loading' ? { scaleY: 0.7 } : { scaleY: 1 }
  const blinkLoop = animate && !sleeping && pose !== 'error' && pose !== 'loading'

  return (
    <svg
      viewBox={headOnly ? '26 12 68 62' : '0 0 122 120'}
      width={size}
      height={size}
      role="img"
      aria-hidden
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`gri-body-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={pal.body} />
          <stop offset="100%" stopColor={pal.dark} />
        </linearGradient>
        <radialGradient id="gri-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.5" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Root inner group — the rub rock is applied to the whole cat. */}
      <motion.g
        style={svgOrigin}
        animate={rubbing ? { rotate: [-5, 7, -5, 7, -4], x: [0, 6, 0, 6, 0] } : { rotate: 0, x: 0 }}
        transition={rubbing ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
      >
        {!headOnly && (
          <>
            {/* Tail — per skin; sways gently, wags while walking, still in sleep. */}
            {cfg.tail !== 'none' && (
              <motion.g
                style={svgOrigin}
                animate={
                  walking
                    ? { rotate: cfg.tail === 'dog' ? [-8, 14, -8] : [-4, 9, -4] }
                    : animate && !sleeping
                      ? { rotate: cfg.tail === 'dog' ? [0, 6, 0, -4, 0] : [0, 3, 0, -2, 0] }
                      : { rotate: sleeping ? -6 : 0 }
                }
                transition={
                  walking
                    ? { duration: cfg.tail === 'dog' ? 0.7 : 1.1, repeat: Infinity, ease: 'easeInOut' }
                    : animate && !sleeping
                      ? { duration: cfg.tail === 'dog' ? 2.6 : 6, repeat: Infinity, ease: 'easeInOut' }
                      : { duration: 0.4 }
                }
              >
                {cfg.tail === 'cat' && (
                  <>
                    <path d="M87 95 Q110 89 106 66" fill="none" stroke={pal.body} strokeWidth="8.5" strokeLinecap="round" />
                    <circle cx="106" cy="64" r="5.6" fill={TEAL_DIM} opacity="0.95" />
                  </>
                )}
                {cfg.tail === 'dog' && (
                  <>
                    <path d="M87 94 Q103 88 102 74" fill="none" stroke={pal.body} strokeWidth="10" strokeLinecap="round" />
                    <circle cx="102" cy="72" r="5" fill={TEAL_DIM} opacity="0.95" />
                  </>
                )}
                {cfg.tail === 'feathers' && (
                  <g stroke={pal.light} strokeWidth="6" strokeLinecap="round">
                    <path d="M88 96 L101 88" />
                    <path d="M88 99 L103 95" />
                    <path d="M87 102 L101 102" stroke={TEAL_DIM} strokeWidth="5" opacity="0.7" />
                  </g>
                )}
              </motion.g>
            )}

            {/* Body — breathing (slow in sleep), bobbing while walking. */}
            <motion.g
              style={svgOrigin}
              animate={
                walking
                  ? { y: [0, -2, 0], scaleY: 1 }
                  : animate
                    ? { scaleY: sleeping ? [0.96, 0.985, 0.96] : [1, 1.02, 1], y: sleeping ? 3 : 0 }
                    : { scaleY: sleeping ? 0.96 : 1, y: sleeping ? 3 : 0 }
              }
              transition={
                walking
                  ? { duration: 0.42, repeat: Infinity, ease: 'easeInOut' }
                  : animate
                    ? { duration: sleeping ? 5 : 3.6, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.4 }
              }
            >
              <ellipse cx="60" cy="88" rx="31" ry="25" fill={bodyFill} stroke={pal.stroke} />
              <ellipse cx="60" cy="95" rx="17" ry="11" fill="rgba(255,255,255,0.045)" />
            </motion.g>

            {/* Paws: two pairs — they step while walking, tuck in sleep. */}
            <motion.g
              animate={walking ? { y: [0, -3.5, 0], x: [0, 1.5, 0] } : { y: 0, x: 0, opacity: sleeping ? 0 : 1 }}
              transition={walking ? { duration: 0.42, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
            >
              <ellipse cx="46" cy="110" rx="8.5" ry="5" fill={pal.dark} stroke={pal.stroke} />
              {/* toe beans */}
              <g stroke={pal.detailSoft} strokeWidth="1" strokeLinecap="round">
                <path d="M43 110 L43 112" />
                <path d="M46.5 110.5 L46.5 112.5" />
                <path d="M50 110 L50 112" />
              </g>
            </motion.g>
            <motion.g
              animate={walking ? { y: [-3.5, 0, -3.5], x: [1.5, 0, 1.5] } : { y: 0, x: 0, opacity: sleeping ? 0 : 1 }}
              transition={walking ? { duration: 0.42, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
            >
              <ellipse cx="74" cy="110" rx="8.5" ry="5" fill={pal.dark} stroke={pal.stroke} />
              <g stroke={pal.detailSoft} strokeWidth="1" strokeLinecap="round">
                <path d="M71 110 L71 112" />
                <path d="M74.5 110.5 L74.5 112.5" />
                <path d="M78 110 L78 112" />
              </g>
            </motion.g>
          </>
        )}

        {/* Head group (tilts by pose; nods lower in sleep). */}
        <motion.g
          style={svgOrigin}
          variants={{
            straight: { rotate: 0, y: 0 },
            tiltRight: { rotate: 9, y: 0 },
            tiltLeft: { rotate: -7, y: 1 },
            droop: { rotate: 3, y: 3 },
            sleepy: { rotate: 5, y: 5 },
          }}
          animate={headVariant(pose, sleeping)}
          transition={{ type: 'spring', stiffness: 240, damping: 20 }}
        >
          {/* Ears — per skin (cat triangles / dog lobes / capy buttons / owl tufts). */}
          {(() => {
            const EAR_D: Record<string, { left: string; right: string }> = {
              cat: {
                left: 'M40 39 Q33 20 36 15 Q49 17 53 29 Q46 35 40 39 Z',
                right: 'M80 39 Q87 20 84 15 Q71 17 67 29 Q74 35 80 39 Z',
              },
              dog: {
                left: 'M42 30 Q28 30 30 50 Q38 56 46 46 Q45 34 42 30 Z',
                right: 'M78 30 Q92 30 90 50 Q82 56 74 46 Q75 34 78 30 Z',
              },
              capy: {
                left: 'M42 28 Q40 19 47 20 Q52 22 50 29 Q46 31 42 28 Z',
                right: 'M78 28 Q80 19 73 20 Q68 22 70 29 Q74 31 78 28 Z',
              },
              tufts: {
                left: 'M42 32 L38 16 Q48 19 51 29 Z',
                right: 'M78 32 L82 16 Q72 19 69 29 Z',
              },
            }
            const d = EAR_D[cfg.ears]
            const amp = cfg.ears === 'dog' ? 0.5 : 1
            return (
              <>
                <motion.path
                  d={d.left}
                  fill={bodyFill}
                  stroke={pal.stroke}
                  style={{ transformBox: 'fill-box', transformOrigin: 'bottom center' }}
                  variants={{
                    rest: { rotate: 0 },
                    perk: { rotate: -8 * amp },
                    down: { rotate: -30 * amp },
                    sleepy: { rotate: -14 * amp },
                  }}
                  animate={earVariant(pose, sleeping)}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                />
                <motion.path
                  d={d.right}
                  fill={bodyFill}
                  stroke={pal.stroke}
                  style={{ transformBox: 'fill-box', transformOrigin: 'bottom center' }}
                  variants={{
                    rest: { rotate: 0 },
                    perk: { rotate: 8 * amp },
                    down: { rotate: 30 * amp },
                    sleepy: { rotate: 14 * amp },
                  }}
                  animate={earVariant(pose, sleeping)}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                />
                {cfg.ears === 'cat' && (
                  <>
                    <path d="M41 34 Q38 23 39 20 Q46 23 49 30 Z" fill={TEAL} opacity="0.2" />
                    <path d="M79 34 Q82 23 81 20 Q74 23 71 30 Z" fill={TEAL} opacity="0.2" />
                  </>
                )}
                {cfg.ears === 'tufts' && (
                  <g stroke={TEAL} strokeWidth="1.2" opacity="0.45" strokeLinecap="round">
                    <path d="M41 26 L39 19" />
                    <path d="M79 26 L81 19" />
                  </g>
                )}
              </>
            )
          })()}

          {/* Face */}
          <circle cx="60" cy="50" r="27.5" fill={bodyFill} stroke={pal.stroke} />

          {/* Blush cheeks */}
          <ellipse cx="42" cy="58" rx="5" ry="3" fill={BLUSH} opacity="0.15" />
          <ellipse cx="78" cy="58" rx="5" ry="3" fill={BLUSH} opacity="0.15" />

          {/* Eyes: glow + iris + pupil + double highlight; closed arcs in sleep. */}
          {sleeping ? (
            <g stroke={TEAL_DIM} strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.85">
              <path d="M44 51 Q50 55.5 56 51" />
              <path d="M64 51 Q70 55.5 76 51" />
            </g>
          ) : (
            <>
              <ellipse cx="50" cy="50" rx="9.5" ry="9.5" fill="url(#gri-glow)" />
              <ellipse cx="70" cy="50" rx="9.5" ry="9.5" fill="url(#gri-glow)" />
              {cfg.eyeRings && (
                <g fill="none" stroke="#eafff5" strokeWidth="1.4" opacity="0.35">
                  <circle cx="50" cy="50" r="8.6" />
                  <circle cx="70" cy="50" r="8.6" />
                </g>
              )}
              <motion.g
                style={svgOrigin}
                animate={
                  blinkLoop
                    ? { scaleY: [cfg.lidScale, cfg.lidScale, 0.08, cfg.lidScale] }
                    : { scaleY: eyesSquint.scaleY * cfg.lidScale }
                }
                transition={
                  blinkLoop
                    ? { duration: 0.5, times: [0, 0.9, 0.95, 1], repeat: Infinity, repeatDelay: 3.6 }
                    : { duration: 0.25 }
                }
              >
                <ellipse cx="50" cy="50" rx={cfg.irisRx} ry={cfg.irisRy} fill={TEAL} />
                <ellipse cx="70" cy="50" rx={cfg.irisRx} ry={cfg.irisRy} fill={TEAL} />
                <ellipse cx="50" cy="50.6" rx={cfg.eyeRings ? 2.6 : 1.9} ry={cfg.eyeRings ? 3.2 : 4} fill={INK} />
                <ellipse cx="70" cy="50.6" rx={cfg.eyeRings ? 2.6 : 1.9} ry={cfg.eyeRings ? 3.2 : 4} fill={INK} />
                <circle cx="51.8" cy="47.4" r="1.25" fill="#eafff5" opacity="0.95" />
                <circle cx="71.8" cy="47.4" r="1.25" fill="#eafff5" opacity="0.95" />
                <circle cx="48.6" cy="52.4" r="0.7" fill="#eafff5" opacity="0.6" />
                <circle cx="68.6" cy="52.4" r="0.7" fill="#eafff5" opacity="0.6" />
              </motion.g>
            </>
          )}

          {/* Muzzle / nose / beak per skin + smile + whiskers */}
          {cfg.nose === 'capy' && (
            <>
              <rect x="48" y="55" width="24" height="14" rx="7" fill={pal.light} stroke={pal.stroke} />
              <ellipse cx="55.5" cy="60" rx="1.6" ry="2.2" fill={INK} />
              <ellipse cx="64.5" cy="60" rx="1.6" ry="2.2" fill={INK} />
            </>
          )}
          {cfg.nose === 'heart' && (
            <path
              d="M60 59.4 C58.6 57.6 56.4 58.4 56.4 60 C56.4 61.4 58.4 62.6 60 63.6 C61.6 62.6 63.6 61.4 63.6 60 C63.6 58.4 61.4 57.6 60 59.4 Z"
              fill={TEAL_DIM}
              opacity="0.9"
            />
          )}
          {cfg.nose === 'dog' && (
            <>
              <ellipse cx="60" cy="60.5" rx="4.6" ry="3.4" fill={INK} stroke="rgba(255,255,255,0.22)" />
              <circle cx="58.6" cy="59.4" r="1" fill="#eafff5" opacity="0.5" />
            </>
          )}
          {cfg.nose === 'beak' && (
            <path d="M60 56 L65 60.5 L60 67 L55 60.5 Z" fill={TEAL_DIM} opacity="0.95" stroke="rgba(0,0,0,0.3)" />
          )}
          {cfg.nose !== 'beak' && (
            <path
              d={
                sleeping
                  ? 'M56.5 66.5 Q60 68 63.5 66.5'
                  : cfg.nose === 'capy'
                    ? 'M56 64.5 Q60 66.5 64 64.5'
                    : 'M55 65.5 Q57.5 68.3 60 66.3 Q62.5 68.3 65 65.5'
              }
              fill="none"
              stroke={pal.detail}
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          )}
          {cfg.whiskers !== 'none' && (
            <g stroke={pal.detailSoft} strokeWidth="1.2" strokeLinecap="round" fill="none">
              {cfg.whiskers === 'long' ? (
                <>
                  <path d="M28 51 Q36 52 42 53" />
                  <path d="M29 59 Q37 58 42 56.5" />
                  <path d="M92 51 Q84 52 78 53" />
                  <path d="M91 59 Q83 58 78 56.5" />
                </>
              ) : (
                <>
                  <path d="M34 55 Q40 55.5 45 56" />
                  <path d="M86 55 Q80 55.5 75 56" />
                </>
              )}
            </g>
          )}

          {/* Insight sparkle near the right ear. */}
          <motion.path
            d="M93 19 L95 25 L101 27 L95 29 L93 35 L91 29 L85 27 L91 25 Z"
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
            {/* Collar with a tiny bell. */}
            <path d="M41 71 Q60 81 79 71 L79 76.5 Q60 86.5 41 76.5 Z" fill={TEAL} opacity="0.92" />
            <circle cx="60" cy="81" r="3.2" fill="#eafff5" />
            <circle cx="60" cy="81" r="1.1" fill={TEAL_DIM} />

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
              <ellipse cx="93" cy="72" rx="6.6" ry="11" fill={pal.body} stroke={pal.stroke} />
              <ellipse cx="93" cy="63.5" rx="5.2" ry="4.2" fill={pal.body} />
              <g stroke={pal.detailSoft} strokeWidth="1" strokeLinecap="round">
                <path d="M90.6 61.5 L90.6 63.5" />
                <path d="M93 61 L93 63" />
                <path d="M95.4 61.5 L95.4 63.5" />
              </g>
            </motion.g>

            {/* Thinking paw at the chin (loading). */}
            <motion.g
              initial={false}
              animate={pose === 'loading' ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: 0.25 }}
            >
              <ellipse cx="73" cy="67" rx="5.8" ry="7.6" fill={pal.body} stroke={pal.stroke} />
            </motion.g>

            {/* Zzz while sleeping. */}
            {sleeping && (
              <g fontFamily="inherit" fontWeight="700" fill={TEAL} aria-hidden>
                {[0, 1, 2].map((i) => (
                  <motion.text
                    key={i}
                    x={88 + i * 8}
                    y={40 - i * 10}
                    fontSize={9 + i * 3}
                    initial={{ opacity: 0, y: 6 }}
                    animate={animate ? { opacity: [0, 0.9, 0], y: [6, -6, -14] } : { opacity: 0.6 }}
                    transition={
                      animate
                        ? { duration: 2.8, repeat: Infinity, delay: i * 0.7, ease: 'easeOut' }
                        : undefined
                    }
                  >
                    z
                  </motion.text>
                ))}
              </g>
            )}

            {/* A little heart while rubbing. */}
            <motion.path
              d="M97 46 C95 43.4 91.6 44.6 91.6 47 C91.6 49.2 94.6 51 97 52.8 C99.4 51 102.4 49.2 102.4 47 C102.4 44.6 99 43.4 97 46 Z"
              fill={BLUSH}
              initial={false}
              animate={rubbing ? { opacity: [0, 0.9, 0], y: [0, -8, -14], scale: [0.7, 1, 0.9] } : { opacity: 0 }}
              transition={rubbing ? { duration: 2.4, repeat: Infinity, ease: 'easeOut' } : { duration: 0.2 }}
              style={svgOrigin}
            />
          </>
        )}
      </motion.g>
    </svg>
  )
}
