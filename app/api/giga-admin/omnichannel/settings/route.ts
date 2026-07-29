export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getGigaActor, isGigaSuperAdmin } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  listDevelopmentAdminSettings,
  setDevelopmentEquipmentFlowEnabled,
  shouldUseDevelopmentAdminPostgres,
  updateDevelopmentAdminSetting,
} from '@/lib/omnichannel/development-admin-postgres'
import { getMetaConfigurationHealth } from '@/lib/omnichannel/meta-client'
import { getWhatsAppWebBridgeConfigurationHealth } from '@/lib/omnichannel/whatsapp-web-client'
import { getOmnichannelAutoReplyReadiness } from '@/lib/omnichannel/auto-reply-readiness'
import { createServiceClient } from '@/lib/supabase-service'

const updateSchema = z
  .object({
    channel: z.enum(['instagram', 'whatsapp']),
    enabled: z.boolean().optional(),
    mode: z.enum(['off', 'draft', 'auto']).optional(),
    business_context: z.string().trim().max(8_000).nullable().optional(),
    equipment_flow_enabled: z.boolean().optional(),
    confidence_threshold: z.number().min(0.5).max(1).optional(),
    reply_delay_seconds: z.number().int().min(0).max(86_400).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'channel'),
    'At least one setting must be supplied',
  )
  .superRefine((value, ctx) => {
    if (value.equipment_flow_enabled === undefined) return
    const mixedFields = Object.keys(value).filter(
      (key) => key !== 'channel' && key !== 'equipment_flow_enabled',
    )
    if (mixedFields.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['equipment_flow_enabled'],
        message: 'Equipment flow toggle must be sent as a separate settings update',
      })
    }
  })

const settingColumns =
  'channel, enabled, mode, business_context, automation_config, confidence_threshold, reply_delay_seconds, updated_at'

export async function GET(req: NextRequest) {
  if (!(await isGigaSuperAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (shouldUseDevelopmentAdminPostgres()) {
    try {
      return NextResponse.json({
        settings: await listDevelopmentAdminSettings(),
        configuration: getMetaConfigurationHealth(),
      })
    } catch {
      return NextResponse.json({ error: 'Не удалось загрузить настройки inbox' }, { status: 500 })
    }
  }

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('omnichannel_settings')
    .select(settingColumns)
    .order('channel')

  if (error) {
    return NextResponse.json({ error: 'Не удалось загрузить настройки inbox' }, { status: 500 })
  }

  return NextResponse.json({
    settings: data ?? [],
    configuration: getMetaConfigurationHealth(),
  })
}

export async function PATCH(req: NextRequest) {
  const actor = await getGigaActor(req)
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Некорректные настройки' },
      { status: 400 },
    )
  }

  const { channel, equipment_flow_enabled: equipmentFlowEnabled, ...patch } = parsed.data
  let data: Record<string, unknown> | null = null
  const developmentPostgres = shouldUseDevelopmentAdminPostgres()
  const needsAutoReadinessCheck = equipmentFlowEnabled === undefined && (
    patch.enabled !== undefined
    || patch.mode !== undefined
    || patch.business_context !== undefined
  )

  if (needsAutoReadinessCheck) {
    let current: Record<string, unknown> | null = null
    try {
      if (developmentPostgres) {
        current = (await listDevelopmentAdminSettings()).find(
          (setting) => setting.channel === channel,
        ) as Record<string, unknown> | undefined ?? null
      } else {
        const lookup = await createServiceClient()
          .from('omnichannel_settings')
          .select(settingColumns)
          .eq('channel', channel)
          .maybeSingle()
        if (lookup.error) throw lookup.error
        current = lookup.data as Record<string, unknown> | null
      }
    } catch {
      return NextResponse.json(
        { error: 'Не удалось проверить готовность канала' },
        { status: 500 },
      )
    }
    if (!current) {
      return NextResponse.json({ error: 'Настройки канала не найдены' }, { status: 404 })
    }

    const nextEnabled = patch.enabled ?? (current.enabled === true)
    const nextMode = (patch.mode ?? current.mode) as 'off' | 'draft' | 'auto'
    const nextBusinessContext = patch.business_context !== undefined
      ? patch.business_context
      : typeof current.business_context === 'string'
        ? current.business_context
        : null
    const meta = getMetaConfigurationHealth()
    const readiness = getOmnichannelAutoReplyReadiness({
      channel,
      enabled: nextEnabled,
      mode: nextMode,
      businessContext: nextBusinessContext,
      metaConfigured: meta[channel].configured,
      whatsAppWebConfigured: channel === 'whatsapp'
        ? getWhatsAppWebBridgeConfigurationHealth().configured
        : false,
    })
    const activatesAuto = nextEnabled && nextMode === 'auto' && (
      patch.mode === 'auto'
      || patch.enabled === true
      || patch.business_context !== undefined
    )
    if (activatesAuto && !readiness.ready) {
      return NextResponse.json({
        error: readiness.missing.includes('business_context')
          ? 'Для автоответов сначала заполните проверенную базу ответов канала'
          : 'Для автоответов сначала подключите и проверьте канал',
        code: 'omnichannel_auto_not_ready',
        missing: readiness.missing,
      }, { status: 409 })
    }
  }

  if (developmentPostgres) {
    try {
      data = equipmentFlowEnabled !== undefined
        ? await setDevelopmentEquipmentFlowEnabled(channel, equipmentFlowEnabled)
        : await updateDevelopmentAdminSetting(channel, {
            ...patch,
            ...(patch.business_context !== undefined
              ? { business_context: patch.business_context || null }
              : {}),
          })
    } catch {
      return NextResponse.json(
        {
          error: equipmentFlowEnabled !== undefined
            ? 'Не удалось переключить сценарий экипировки'
            : 'Не удалось сохранить настройки inbox',
        },
        { status: 500 },
      )
    }
  } else {
    const sb = createServiceClient()
    if (equipmentFlowEnabled !== undefined) {
      const result = await sb
        .rpc('set_omnichannel_equipment_flow_enabled', {
          p_channel: channel,
          p_enabled: equipmentFlowEnabled,
        })
        .select(settingColumns)
        .maybeSingle()

      if (result.error) {
        return NextResponse.json(
          { error: 'Не удалось переключить сценарий экипировки' },
          { status: 500 },
        )
      }
      data = result.data as Record<string, unknown> | null
    } else {
      const normalizedPatch = {
        ...patch,
        ...(patch.business_context !== undefined
          ? { business_context: patch.business_context || null }
          : {}),
      }
      const result = await sb
        .from('omnichannel_settings')
        .update(normalizedPatch)
        .eq('channel', channel)
        .select(settingColumns)
        .single()

      if (result.error) {
        return NextResponse.json({ error: 'Не удалось сохранить настройки inbox' }, { status: 500 })
      }
      data = result.data as Record<string, unknown>
    }
  }

  if (!data && equipmentFlowEnabled !== undefined) {
    return NextResponse.json(
      { error: 'Сценарий недоступен: примените миграцию 062 или исправьте его конфигурацию' },
      { status: 409 },
    )
  }
  if (!data) {
    return NextResponse.json({ error: 'Настройки канала не найдены' }, { status: 404 })
  }

  await logAudit({
    entityType: 'system',
    entityId: `omnichannel:${channel}`,
    action: equipmentFlowEnabled !== undefined
      ? 'omnichannel.equipment_flow_toggled'
      : 'omnichannel.settings_changed',
    performedBy: actor.id,
    diff: {
      after: equipmentFlowEnabled !== undefined
        ? { equipment_flow_enabled: equipmentFlowEnabled }
        : {
            ...patch,
            ...(patch.business_context !== undefined
              ? { business_context: patch.business_context ? '[updated]' : null }
              : {}),
          },
      actorKind: actor.kind,
    },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ setting: data })
}
