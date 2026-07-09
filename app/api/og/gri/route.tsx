/**
 * app/api/og/gri/route.tsx — share-картинка результата GRI (OG-image 1200×630)
 * для соцсетей/мессенджеров.
 *
 * Вход — ТОЛЬКО числа из query (`?score=7.2&s=5,6,7,4,8,6,7`), никаких данных
 * пользователя/БД — утекать нечему. Санитизация — parseOgGriParams
 * (lib/gri/og-params.ts): кламп 0..10, мусор → 0, ровно 7 блоков.
 *
 * ВАЖНО: next/og (satori) не понимает tailwind-классы — только inline-стили,
 * и каждый контейнер с несколькими детьми обязан иметь display:flex.
 */
import { ImageResponse } from 'next/og'
import {
  parseOgGriParams,
  OG_GRI_BLOCK_LABELS,
} from '@/lib/gri/og-params'

export const runtime = 'edge'

const BG = '#0A0B0F'
const TEAL = '#6EFFC0'
const AMBER = '#FBBF24'
const RED = '#EF4444'
const TEXT_DIM = 'rgba(255,255,255,0.55)'
const TEXT_FAINT = 'rgba(255,255,255,0.35)'

/** Цвет зоны: <5 красная, 5–7 жёлтая, 7+ зелёная (как на портале). */
function zoneColor(v: number): string {
  if (v >= 7) return TEAL
  if (v >= 5) return AMBER
  return RED
}

function zoneLabel(v: number): string {
  if (v >= 7) return 'Устойчивая зона'
  if (v >= 5) return 'Зона роста'
  return 'Критическая зона'
}

const BAR_MAX_H = 240 // px — высота бара при оценке 10

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const { score, sections } = parseOgGriParams(searchParams)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: BG,
          backgroundImage:
            'radial-gradient(circle at 85% 15%, rgba(110,255,192,0.10) 0%, rgba(110,255,192,0.00) 45%), radial-gradient(circle at 10% 90%, rgba(110,255,192,0.05) 0%, rgba(110,255,192,0.00) 40%)',
          padding: '56px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Шапка-логотип */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              letterSpacing: 6,
              color: TEAL,
              textTransform: 'uppercase',
            }}
          >
            AIStart360 · GRI Health Check
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 20,
              letterSpacing: 3,
              color: TEXT_FAINT,
              textTransform: 'uppercase',
            }}
          >
            Growth Readiness Index
          </div>
        </div>

        {/* Тело: слева score, справа 7 баров */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 24,
          }}
        >
          {/* Крупный score */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: 380,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 190,
                  fontWeight: 800,
                  lineHeight: 1,
                  color: TEAL,
                }}
              >
                {score.toFixed(1)}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 44,
                  color: TEXT_DIM,
                  marginLeft: 12,
                }}
              >
                /10
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                marginTop: 20,
                fontSize: 26,
                color: '#FFFFFF',
              }}
            >
              Индекс готовности к росту
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginTop: 14,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: zoneColor(score),
                  marginRight: 10,
                }}
              />
              <div
                style={{
                  display: 'flex',
                  fontSize: 22,
                  color: TEXT_DIM,
                }}
              >
                {zoneLabel(score)} · цель 8.5+
              </div>
            </div>
          </div>

          {/* 7 вертикальных баров блоков */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              height: BAR_MAX_H + 90,
              padding: '24px 28px',
              borderRadius: 24,
              border: '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'rgba(255,255,255,0.02)',
            }}
          >
            {sections.map((v, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: 88,
                  marginLeft: i === 0 ? 0 : 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontSize: 22,
                    color: zoneColor(v),
                    marginBottom: 8,
                  }}
                >
                  {v.toFixed(1)}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    width: 44,
                    height: BAR_MAX_H,
                    borderRadius: 10,
                    backgroundColor: 'rgba(255,255,255,0.06)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      width: 44,
                      // минимум 6px, чтобы нулевой блок был визуально заметен
                      height: Math.max(6, Math.round((v / 10) * BAR_MAX_H)),
                      borderRadius: 10,
                      backgroundColor: zoneColor(v),
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    marginTop: 10,
                    fontSize: 17,
                    color: TEXT_DIM,
                  }}
                >
                  {OG_GRI_BLOCK_LABELS[i] ?? ''}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Подвал */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 16,
          }}
        >
          <div style={{ display: 'flex', fontSize: 20, color: TEXT_FAINT }}>
            Самооценка по 7 блокам бизнеса · шкала 0–10
          </div>
          <div style={{ display: 'flex', fontSize: 20, color: TEXT_FAINT }}>
            portal.aistart360.app
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // Картинка — чистая функция от query, можно кэшировать надолго.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
      },
    },
  )
}
