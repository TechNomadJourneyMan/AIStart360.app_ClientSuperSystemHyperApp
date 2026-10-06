/**
 * 🔑 Провайдеры и ключи — LLM providers, API keys, models and routes through
 * lib/ai/providers/service.ts ONLY (the same service the GIGA routes use).
 * Permissions — the same as app/api/giga-admin/ai-providers/**:
 *   list, provider card (masked keys, models), routes          agents.view
 *   add / rotate / verify / enable / disable / delete keys,
 *   add / enable / disable / delete providers, models, routes   settings.manage
 * Mutation buttons are shown only to roles holding settings.manage.
 *
 * Keys: the person sends the key as a message while the bot waits for it; the
 * bot DELETES that message first (deleteMessage), then hands the text to the
 * service (encrypted with SECRETS_ENCRYPTION_KEY there) and answers with the
 * masked hint only («••••abcd»). The key never reaches the chat state, the
 * audit log or a reply. If Telegram refuses the deletion, the person is told
 * to delete the message by hand.
 *
 * The service writes its own audit entries (actor kind 'telegram', the staff
 * member's user id) before each change.
 */
import {
  addCredential, deleteCredential, deleteProvider, getProvider, listProviders, listRoutes, rotateCredential,
  setRoute, updateCredential, updateProvider, upsertModel, verifyCredential, createProvider,
  ProviderServiceError, type ProviderActor,
} from '@/lib/ai/providers/service'
import { CAPABILITIES, CHAT_TIERS, PROVIDER_KINDS, type Capability, type ChatTier } from '@/lib/ai/providers/types'
import { cut, dt, esc, usd } from '../ui'
import { can, UUID_RE, type AdminCtx, type AdminEntry, type AdminStep } from './context'

const PERM = 'settings.manage' as const
const VIEW = 'agents.view' as const

export function providerActor(ctx: AdminCtx): ProviderActor {
  return {
    kind: 'telegram',
    id: ctx.principal.userId,
    label: ctx.principal.email ?? (ctx.from.username ? `@${ctx.from.username}` : `tg:${ctx.from.id}`),
    role: ctx.principal.role,
  }
}

function errText(err: unknown): string {
  if (err instanceof ProviderServiceError) return `⚠️ ${esc(err.message)}`
  console.error('[telegram/admin] providers:', err instanceof Error ? err.message.split('\n')[0] : err)
  return '⚠️ Не удалось выполнить действие. Попробуйте позже.'
}

async function attempt(ctx: AdminCtx, fn: () => Promise<void>, back?: [string, ...string[]]): Promise<void> {
  try {
    await fn()
  } catch (err) {
    await ctx.show(errText(err), back ? [[ctx.button('‹ Назад', ...back)]] : [])
  }
}

const TIER_CODE: Record<ChatTier, string> = { light: 'l', standard: 's', premium: 'p' }
const TIER_OF: Record<string, ChatTier | null> = { l: 'light', s: 'standard', p: 'premium', '-': null }
const KIND_LABEL: Record<string, string> = { openai_compatible: 'OpenAI-совместимый', openrouter: 'OpenRouter' }
const CAP_LABEL: Record<Capability, string> = { chat: 'Чат', embeddings: 'Эмбеддинги', rerank: 'Rerank', ocr: 'OCR' }

export async function showProviders(ctx: AdminCtx): Promise<void> {
  await attempt(ctx, async () => {
    const all = await listProviders()
    const lines = ['🔑 <b>Провайдеры и ключи</b>', '']
    for (const p of all) {
      const keys = p.credentials.map((c) => `${c.enabled ? '' : '⏸'}${esc(c.masked)}`).join(', ') || 'нет ключей'
      lines.push(`${p.enabled ? '🟢' : '⏸'} <b>${esc(p.name)}</b> <code>${esc(p.key)}</code> · ${esc(KIND_LABEL[p.kind] ?? p.kind)} · ${keys}${p.daily_budget_usd != null ? ` · бюджет ${usd(p.daily_budget_usd)}/день` : ''}`)
    }
    if (!all.length) lines.push('Провайдеров в базе нет — работает встроенный OpenRouter из env.')
    await ctx.show(lines.join('\n'), [
      ...all.map((p) => [ctx.button(`${p.enabled ? '🟢' : '⏸'} ${cut(p.name, 40)}`, 'pv.c', p.id)]),
      [can(ctx, PERM) ? ctx.button('➕ Добавить провайдера', 'pv.add') : null, ctx.button('🧭 Маршруты моделей', 'rt.l')],
    ])
  })
}

async function showProvider(ctx: AdminCtx, id: string): Promise<void> {
  await attempt(ctx, async () => {
    const p = UUID_RE.test(id) ? await getProvider(id) : null
    if (!p) return void (await ctx.show('Провайдер не найден.', [[ctx.button('‹ К списку', 'pv.l')]]))
    const lines = [
      `${p.enabled ? '🟢' : '⏸'} <b>${esc(p.name)}</b> <code>${esc(p.key)}</code>`,
      `Тип: ${esc(KIND_LABEL[p.kind] ?? p.kind)} · адрес: <code>${esc(p.base_url)}</code>`,
      `Бюджет: ${p.daily_budget_usd != null ? `${usd(p.daily_budget_usd)} в день` : 'общий платформенный'}`,
      '',
      `<b>Ключи</b> (${p.credentials.length})`,
      ...p.credentials.map((c) => `${c.enabled ? '🟢' : '⏸'} ${esc(c.label)} ${esc(c.masked)} · ${c.last_verify_ok == null ? 'не проверен' : c.last_verify_ok ? `✅ ${dt(c.last_verified_at)}` : `⚠️ ${esc(cut(c.last_verify_error, 80))}`}`),
      '',
      `<b>Модели</b> (${p.models.length})`,
      ...p.models.slice(0, 12).map((m) => `${m.enabled ? '•' : '⏸'} ${esc(m.model_id)} — ${esc(CAP_LABEL[m.capability] ?? m.capability)}`),
      p.routes.length ? `\n<b>Обслуживает маршруты:</b> ${p.routes.map((r) => `${esc(r.capability)}${r.tier ? `/${esc(r.tier)}` : ''} → ${esc(r.model)}`).join('; ')}` : null,
    ].filter((l): l is string => l !== null)
    const manage = can(ctx, PERM)
    await ctx.show(lines.join('\n'), [
      ...p.credentials.map((c) => [ctx.button(`🔑 ${cut(c.label, 30)} ${c.masked}`, 'cr.c', c.id)]),
      manage ? [ctx.button('➕ Ключ', 'cr.add', p.id), ctx.button('➕ Модель', 'md.add', p.id)] : [],
      manage ? [p.enabled ? ctx.button('⏸ Выключить', 'pv.off', p.id) : ctx.button('▶️ Включить', 'pv.on', p.id), ctx.button('🗑 Удалить', 'pv.del', p.id)] : [],
      [ctx.button('‹ К списку', 'pv.l')],
    ])
  }, ['pv.l'])
}

async function credentialById(id: string) {
  for (const p of await listProviders()) {
    const c = p.credentials.find((x) => x.id === id)
    if (c) return { provider: p, credential: c }
  }
  return null
}

async function showCredential(ctx: AdminCtx, id: string): Promise<void> {
  await attempt(ctx, async () => {
    const found = UUID_RE.test(id) ? await credentialById(id) : null
    if (!found) return void (await ctx.show('Ключ не найден.', [[ctx.button('‹ К списку', 'pv.l')]]))
    const { provider: p, credential: c } = found
    const lines = [
      `🔑 <b>${esc(c.label)}</b> ${esc(c.masked)} · ${esc(p.name)}`,
      `Состояние: ${c.enabled ? '🟢 включён' : '⏸ выключен'}`,
      `Проверка: ${c.last_verify_ok == null ? 'не проводилась' : c.last_verify_ok ? `✅ ${dt(c.last_verified_at)}` : `⚠️ ${esc(cut(c.last_verify_error, 200))} (${dt(c.last_verified_at)})`}`,
      `Создан ${dt(c.created_at)}${c.rotated_at ? ` · заменён ${dt(c.rotated_at)}` : ''}`,
    ]
    const manage = can(ctx, PERM)
    await ctx.show(lines.join('\n'), [
      manage ? [ctx.button('✅ Проверить', 'cr.vf', c.id), ctx.button('🔄 Заменить ключ', 'cr.rot', c.id)] : [],
      manage ? [c.enabled ? ctx.button('⏸ Выключить', 'cr.off', c.id) : ctx.button('▶️ Включить', 'cr.on', c.id), ctx.button('🗑 Удалить', 'cr.del', c.id)] : [],
      [ctx.button('‹ К провайдеру', 'pv.c', p.id)],
    ])
  }, ['pv.l'])
}

async function showRoutes(ctx: AdminCtx): Promise<void> {
  await attempt(ctx, async () => {
    const routes = await listRoutes()
    const slot = (cap: Capability, tier: ChatTier | null) => routes.find((r) => r.capability === cap && (r.tier ?? null) === tier)
    const slots: Array<[Capability, ChatTier | null]> = [
      ...CHAT_TIERS.map((t) => ['chat', t] as [Capability, ChatTier]),
      ...CAPABILITIES.filter((c) => c !== 'chat').map((c) => [c, null] as [Capability, null]),
    ]
    const lines = ['🧭 <b>Маршруты моделей</b> (возможность / уровень → модель)', '']
    for (const [cap, tier] of slots) {
      const r = slot(cap, tier)
      lines.push(`${CAP_LABEL[cap]}${tier ? ` · ${tier}` : ''} → ${r ? `${esc(r.providerKey)}/${esc(r.modelId)}${r.providerEnabled && r.modelEnabled ? '' : ' ⚠️ выключено'}` : '<i>встроенный (env)</i>'}`)
    }
    await ctx.show(lines.join('\n'), [
      ...(can(ctx, PERM) ? slots.map(([cap, tier]) => [ctx.button(`✏️ ${CAP_LABEL[cap]}${tier ? ` · ${tier}` : ''}`, 'rt.c', cap, tier ? TIER_CODE[tier] : '-')]) : []),
      [ctx.button('‹ Провайдеры', 'pv.l')],
    ])
  })
}

async function pickRouteModel(ctx: AdminCtx, cap: string, tierCode: string): Promise<void> {
  if (!(CAPABILITIES as readonly string[]).includes(cap) || !(tierCode in TIER_OF)) return
  await attempt(ctx, async () => {
    const candidates = (await listProviders()).flatMap((p) => p.models
      .filter((m) => m.capability === cap && m.enabled && p.enabled)
      .map((m) => ({ id: m.id, label: `${p.key}/${m.model_id}` })))
    const tier = TIER_OF[tierCode]
    await ctx.show(`🧭 ${CAP_LABEL[cap as Capability]}${tier ? ` · ${tier}` : ''}: выберите модель${candidates.length ? '' : '\n\nПодходящих включённых моделей нет — добавьте модель в карточке провайдера.'}`, [
      ...candidates.slice(0, 12).map((m) => [ctx.button(cut(m.label, 50), 'rt.s', cap, tierCode, m.id)]),
      [ctx.button('↩️ Вернуть встроенный (env)', 'rt.s', cap, tierCode, '-')],
      [ctx.button('‹ Маршруты', 'rt.l')],
    ])
  }, ['rt.l'])
}

/** A message carrying a key: delete it first, then store through the service, answer with the mask. */
async function receiveSecret(ctx: AdminCtx, state: Record<string, unknown>): Promise<void> {
  const secret = ctx.text
  const deleted = await ctx.deleteIncoming()
  await ctx.clearState()
  const warn = deleted ? '' : '\n\n⚠️ Не удалось удалить сообщение с ключом — удалите его вручную.'
  try {
    const actor = providerActor(ctx)
    const cred = state.mode === 'rotate'
      ? await rotateCredential(actor, String(state.credentialId), secret)
      : await addCredential(actor, String(state.providerId), `Telegram ${dt(ctx.deps.now())}`, secret)
    await ctx.reply(`✅ Ключ сохранён: <b>${esc(cred.label)}</b> ${esc(cred.masked)}${warn}`, {
      inline_keyboard: [[ctx.button('✅ Проверить', 'cr.vf', cred.id), ctx.button('🔑 Карточка ключа', 'cr.c', cred.id)].filter((b): b is NonNullable<typeof b> => Boolean(b))],
    })
  } catch (err) {
    await ctx.reply(`${errText(err)}${warn}`)
  }
}

export const providerSteps: Record<string, AdminStep> = {
  cred_secret: { perm: PERM, run: (ctx, state) => receiveSecret(ctx, state) },
  pv_add_name: {
    perm: PERM,
    async run(ctx) {
      const name = ctx.text.slice(0, 80)
      if (!name) return
      await ctx.setState({ step: 'pv_add_key', name })
      await ctx.reply('2/4. Ключ провайдера — латиница в нижнем регистре, цифры, _ и - (например <code>together</code>):')
    },
  },
  pv_add_key: {
    perm: PERM,
    async run(ctx, state) {
      const key = ctx.text.trim().toLowerCase()
      if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(key)) return void (await ctx.reply('Ключ: латиница в нижнем регистре, цифры, _ и -, 2–40 символов. Ещё раз или /cancel.'))
      await ctx.setState({ step: 'pv_add_url', name: state.name, key })
      await ctx.reply('3/4. Базовый адрес API (https://…/v1):')
    },
  },
  pv_add_url: {
    perm: PERM,
    async run(ctx, state) {
      const baseUrl = ctx.text.trim().slice(0, 300)
      if (!/^https:\/\//i.test(baseUrl)) return void (await ctx.reply('Нужен адрес https://… Ещё раз или /cancel.'))
      await ctx.setState({ step: 'pv_add_kind', name: state.name, key: state.key, baseUrl })
      await ctx.reply('4/4. Тип API:', {
        inline_keyboard: PROVIDER_KINDS
          .map((k) => ctx.button(KIND_LABEL[k] ?? k, 'pv.k', k))
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
          .map((b) => [b]),
      })
    },
  },
  md_add_id: {
    perm: PERM,
    async run(ctx, state) {
      const modelId = ctx.text.trim().slice(0, 200)
      if (!/^[\w.:/@+-]+$/.test(modelId)) return void (await ctx.reply('Id модели: латиница, цифры и . : / @ + - _. Ещё раз или /cancel.'))
      await ctx.setState({ step: 'md_add_cap', providerId: state.providerId, modelId })
      await ctx.reply(`Возможность модели <code>${esc(modelId)}</code>:`, {
        inline_keyboard: CAPABILITIES
          .map((c) => ctx.button(CAP_LABEL[c], 'md.cap', c))
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
          .map((b) => [b]),
      })
    },
  },
}

export const providerEntries: Record<string, AdminEntry> = {
  'pv.l': { perm: VIEW, run: (ctx) => showProviders(ctx) },
  'pv.c': { perm: VIEW, run: (ctx, [id]) => showProvider(ctx, id) },
  'cr.c': { perm: VIEW, run: (ctx, [id]) => showCredential(ctx, id) },
  'rt.l': { perm: VIEW, run: (ctx) => showRoutes(ctx) },
  'rt.c': { perm: PERM, run: (ctx, [cap, tier]) => pickRouteModel(ctx, cap, tier) },
  'rt.s': {
    perm: PERM,
    async run(ctx, [cap, tier, modelId]) {
      if (!(CAPABILITIES as readonly string[]).includes(cap) || !(tier in TIER_OF)) return
      const what = `${CAP_LABEL[cap as Capability]}${TIER_OF[tier] ? ` · ${TIER_OF[tier]}` : ''}`
      await ctx.confirm(modelId === '-'
        ? `↩️ Вернуть маршрут «${esc(what)}» на встроенный (env)?`
        : `🧭 Направить «${esc(what)}» на выбранную модель? Все новые вызовы пойдут через неё.`, 'rt.s', [cap, tier, modelId])
    },
  },
  'pv.add': {
    perm: PERM,
    async run(ctx) {
      await ctx.setState({ step: 'pv_add_name' })
      await ctx.reply('➕ Новый провайдер. 1/4. Название (например «Together AI») или /cancel:')
    },
  },
  'pv.k': {
    perm: PERM,
    async run(ctx, [kind]) {
      const st = await ctx.getState()
      if (!st || st.step !== 'pv_add_kind' || !(PROVIDER_KINDS as readonly string[]).includes(kind)) {
        return void (await ctx.toast('Шаг устарел — начните заново.', true))
      }
      await ctx.clearState()
      await attempt(ctx, async () => {
        const row = await createProvider(providerActor(ctx), {
          key: String(st.key), name: String(st.name), baseUrl: String(st.baseUrl), kind: kind as (typeof PROVIDER_KINDS)[number],
        })
        await ctx.show(`✅ Провайдер <b>${esc(row.name)}</b> добавлен. Добавьте ключ и модели.`, [
          [ctx.button('🔑 Добавить ключ', 'cr.add', row.id), ctx.button('Карточка', 'pv.c', row.id)],
        ])
      }, ['pv.l'])
    },
  },
  'md.add': {
    perm: PERM,
    async run(ctx, [providerId]) {
      if (!UUID_RE.test(providerId)) return
      await ctx.setState({ step: 'md_add_id', providerId })
      await ctx.reply('➕ Id модели у провайдера (например <code>meta-llama/Llama-3.3-70B-Instruct</code>) или /cancel:')
    },
  },
  'md.cap': {
    perm: PERM,
    async run(ctx, [cap]) {
      const st = await ctx.getState()
      if (!st || st.step !== 'md_add_cap' || !(CAPABILITIES as readonly string[]).includes(cap)) {
        return void (await ctx.toast('Шаг устарел — начните заново.', true))
      }
      await ctx.clearState()
      await attempt(ctx, async () => {
        const m = await upsertModel(providerActor(ctx), { providerId: String(st.providerId), modelId: String(st.modelId), capability: cap as Capability })
        await ctx.show(`✅ Модель <code>${esc(m.model_id)}</code> (${esc(CAP_LABEL[m.capability])}) добавлена. Назначить её можно в «Маршрутах».`, [
          [ctx.button('🧭 Маршруты', 'rt.l'), ctx.button('‹ К провайдеру', 'pv.c', m.provider_id)],
        ])
      }, ['pv.l'])
    },
  },
  'cr.add': {
    perm: PERM,
    async run(ctx, [providerId]) {
      if (!UUID_RE.test(providerId)) return
      await ctx.setState({ step: 'cred_secret', mode: 'add', providerId }, 10)
      await ctx.reply('🔑 Отправьте API-ключ одним сообщением. Я удалю сообщение сразу после чтения и покажу только последние 4 символа. /cancel — отмена.')
    },
  },
  'cr.rot': {
    perm: PERM,
    async run(ctx, [id]) {
      if (!UUID_RE.test(id)) return
      await ctx.setState({ step: 'cred_secret', mode: 'rotate', credentialId: id }, 10)
      await ctx.reply('🔄 Отправьте НОВЫЙ ключ одним сообщением. Сообщение будет удалено сразу после чтения. /cancel — отмена.')
    },
  },
  'cr.vf': {
    perm: PERM,
    async run(ctx, [id]) {
      if (!UUID_RE.test(id)) return
      await ctx.toast('Проверяю…')
      await attempt(ctx, async () => {
        const r = await verifyCredential(providerActor(ctx), id, { fetchImpl: ctx.deps.fetchImpl })
        const how = r.checkedWith === 'chat' ? 'чат (1 токен)' : r.checkedWith === 'embeddings' ? 'эмбеддинг' : 'список моделей'
        await ctx.show(r.ok
          ? `✅ Ключ ${esc(r.credential.masked)} работает — проверено: ${how}${r.model ? `, модель ${esc(r.model)}` : ''}.`
          : `⚠️ Ключ ${esc(r.credential.masked)} не прошёл проверку (${how}): ${esc(cut(r.error, 300))}`,
        [[ctx.button('‹ К ключу', 'cr.c', id)]])
      }, ['cr.c', id])
    },
  },
  'cr.on': {
    perm: PERM,
    run: (ctx, [id]) => attempt(ctx, async () => {
      await updateCredential(providerActor(ctx), id, { enabled: true })
      await showCredential(ctx, id)
    }, ['pv.l']),
  },
  'cr.off': {
    perm: PERM,
    run: (ctx, [id]) => ctx.confirm('⏸ Выключить ключ? Вызовы через него прекратятся.', 'cr.off', [id]),
  },
  'cr.del': {
    perm: PERM,
    run: (ctx, [id]) => ctx.confirm('🗑 Удалить ключ безвозвратно? Модели, привязанные к нему, перейдут на общий ключ провайдера.', 'cr.del', [id]),
  },
  'pv.on': {
    perm: PERM,
    run: (ctx, [id]) => attempt(ctx, async () => {
      await updateProvider(providerActor(ctx), id, { enabled: true })
      await showProvider(ctx, id)
    }, ['pv.l']),
  },
  'pv.off': {
    perm: PERM,
    run: (ctx, [id]) => ctx.confirm('⏸ Выключить провайдера? Его маршруты перестанут работать (вызовы пойдут на встроенный маршрут).', 'pv.off', [id]),
  },
  'pv.del': {
    perm: PERM,
    run: (ctx, [id]) => ctx.confirm('🗑 Удалить провайдера вместе с ключами, моделями и маршрутами? Это необратимо.', 'pv.del', [id]),
  },
}

export const providerConfirmed: Record<string, AdminEntry> = {
  'cr.off': {
    perm: PERM,
    run: (ctx, [id]) => attempt(ctx, async () => {
      await updateCredential(providerActor(ctx), id, { enabled: false })
      await showCredential(ctx, id)
    }, ['pv.l']),
  },
  'cr.del': {
    perm: PERM,
    run: (ctx, [id]) => attempt(ctx, async () => {
      await deleteCredential(providerActor(ctx), id)
      await ctx.show('🗑 Ключ удалён.', [[ctx.button('‹ Провайдеры', 'pv.l')]])
    }, ['pv.l']),
  },
  'pv.off': {
    perm: PERM,
    run: (ctx, [id]) => attempt(ctx, async () => {
      await updateProvider(providerActor(ctx), id, { enabled: false })
      await showProvider(ctx, id)
    }, ['pv.l']),
  },
  'pv.del': {
    perm: PERM,
    run: (ctx, [id]) => attempt(ctx, async () => {
      await deleteProvider(providerActor(ctx), id)
      await ctx.show('🗑 Провайдер удалён.', [[ctx.button('‹ Провайдеры', 'pv.l')]])
    }, ['pv.l']),
  },
  'rt.s': {
    perm: PERM,
    run: (ctx, [cap, tier, modelId]) => attempt(ctx, async () => {
      await setRoute(providerActor(ctx), cap as Capability, TIER_OF[tier] ?? null, modelId === '-' ? null : modelId)
      await showRoutes(ctx)
    }, ['rt.l']),
  },
}
