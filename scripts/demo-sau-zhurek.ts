/**
 * Demo script: populates DB as if vip.roman.101@gmail.com went through
 * the full medical onboarding for Sau Zhurek clinic. Runs the same pipeline
 * the production endpoint runs, just server-side with service-role key.
 */

import fs from 'fs'
import path from 'path'
import { Client } from 'pg'

// Import our own libs
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
  const USER_EMAIL = 'vip.roman.101@gmail.com'
  const CLINIC_NAME = 'Sau Zhurek (демо)'
  const FILE_PATH = '/Users/admin/Downloads/drive-download-20260420T234211Z-3-001/Журек/Клиенты_Журек.xls'

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL!

  // 1. Find the user
  const pg = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await pg.connect()
  const userRes = await pg.query(`SELECT id FROM public.profiles WHERE email=$1`, [USER_EMAIL])
  const userId = userRes.rows[0]?.id
  if (!userId) throw new Error('user not found')
  console.log('User:', userId)

  // 2. Set vertical=medical
  await pg.query(`UPDATE public.profiles SET vertical='medical' WHERE id=$1`, [userId])
  console.log('✓ vertical set to medical')

  // 3. Skip company — prod schema is Prisma-style (no user_id), set company_id=null on documents
  const companyId: string | null = null
  console.log('⓿ companies row skipped (Prisma-style schema in prod, no user_id column)')

  // 4. Upload file to Storage
  const fileBuf = fs.readFileSync(FILE_PATH)
  const filename = path.basename(FILE_PATH)
  const objectPath = `${userId}/medical/${Date.now()}_${filename.replace(/[^\w.\-]/g, '_')}`
  const ab = new ArrayBuffer(fileBuf.byteLength)
  new Uint8Array(ab).set(fileBuf)
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/documents/${objectPath}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/vnd.ms-excel',
        'x-upsert': 'true',
      },
      body: new Blob([ab], { type: 'application/vnd.ms-excel' }),
    },
  )
  if (!uploadRes.ok) throw new Error(`upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  console.log('✓ file uploaded:', objectPath)

  // 5. Create documents row (delete old patient_base for clean demo)
  await pg.query(
    `DELETE FROM public.documents WHERE user_id=$1 AND doc_type='patient_base'`,
    [userId],
  )
  const docIns = await pg.query(
    `INSERT INTO public.documents (user_id, company_id, file_name, file_url, file_size, mime_type, doc_type)
     VALUES ($1, $2, $3, $4, $5, 'application/vnd.ms-excel', 'patient_base') RETURNING id`,
    [userId, companyId, filename, objectPath, fileBuf.length],
  )
  const docId = docIns.rows[0].id
  console.log('✓ document row created:', docId)

  // 6. Run segmentation + bundles + audit
  const { segmentPatients } = await import('../lib/rfm-segmentation')
  const { computeBundles } = await import('../lib/clinic-bundles')
  const { auditRevenueLosses } = await import('../lib/revenue-audit')

  const seg = segmentPatients(fileBuf, filename)
  if (!seg) throw new Error('segmentation failed — file unreadable or missing phone column')
  console.log(`✓ segmented ${seg.patients.length} patients; total LTV ${(seg.totals.total_ltv_kzt / 1_000_000).toFixed(1)}M ₸`)
  console.log(`  Avg check: ${seg.totals.avg_check_kzt.toLocaleString('ru-RU')} ₸`)
  console.log(`  Active (≤90d): ${seg.totals.active_last_90d}`)
  console.log(`  Sleeping (>180d): ${seg.totals.sleeping_180d_plus}`)
  console.log(`  Dead leads: ${seg.totals.dead_leads}`)
  console.log('  Segments:')
  for (const s of seg.summary) {
    console.log(`    S${s.priority} ${s.label.padEnd(25)} ${String(s.count).padStart(5)} | ${(s.total_ltv_kzt / 1_000_000).toFixed(2)}M ₸`)
  }

  const bundles = computeBundles(seg)
  console.log('  Bundles:')
  for (const b of bundles) {
    console.log(`    #${b.priority} ${b.label.padEnd(48)} +${(b.estimated_revenue_kzt / 1_000_000).toFixed(2)}M ₸/мес`)
  }

  const audit = auditRevenueLosses(seg, bundles)
  console.log(`  Total losses: ${(audit.total_loss_kzt / 1_000_000).toFixed(1)}M ₸/мес`)

  // 7. Wipe + insert
  await pg.query(`DELETE FROM public.patient_segments WHERE client_id=$1`, [userId])
  await pg.query(`DELETE FROM public.growth_bundles WHERE client_id=$1`, [userId])
  await pg.query(`DELETE FROM public.revenue_losses WHERE client_id=$1`, [userId])

  // patient_segments batch insert
  if (seg.patients.length > 0) {
    const values: unknown[] = []
    const placeholders: string[] = []
    seg.patients.forEach((p, i) => {
      const base = i * 9
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`)
      values.push(userId, p.patient_hash, p.display_name, p.recency_days, p.frequency, p.monetary_kzt, p.segment, p.priority, docId)
    })
    // Chunked insert — PG has 65k param limit
    const CHUNK = 500
    for (let i = 0; i < seg.patients.length; i += CHUNK) {
      const chunk = seg.patients.slice(i, i + CHUNK)
      const vals: unknown[] = []
      const ph: string[] = []
      chunk.forEach((p, j) => {
        const base = j * 9
        ph.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`)
        vals.push(userId, p.patient_hash, p.display_name, p.recency_days, p.frequency, p.monetary_kzt, p.segment, p.priority, docId)
      })
      await pg.query(
        `INSERT INTO public.patient_segments (client_id, patient_hash, display_name, recency_days, frequency, monetary_kzt, segment, priority, source_document_id) VALUES ${ph.join(',')}
         ON CONFLICT (client_id, patient_hash) DO NOTHING`,
        vals,
      )
    }
  }
  console.log('✓ patient_segments inserted')

  // growth_bundles
  for (const b of bundles) {
    await pg.query(
      `INSERT INTO public.growth_bundles (client_id, bundle_key, target_segments, target_patient_count, estimated_conversion, estimated_revenue_kzt, priority, complexity, effect_timeline, trigger_description, script_preview)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [userId, b.key, b.target_segments, b.target_patient_count, b.estimated_conversion, b.estimated_revenue_kzt, b.priority, b.complexity, b.effect_timeline, b.trigger_description, b.script_preview],
    )
  }
  console.log('✓ growth_bundles inserted')

  // revenue_losses
  for (const l of audit.losses) {
    await pg.query(
      `INSERT INTO public.revenue_losses (client_id, loss_key, estimated_loss_kzt, severity, source_data, linked_bundle_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, l.key, l.estimated_loss_kzt, l.severity, l.source_data, l.linked_bundle_key],
    )
  }
  console.log('✓ revenue_losses inserted')

  await pg.end()
  console.log('\n🎉 Demo data populated. User should now see dashboard at:')
  console.log('   https://aistart360.vercel.app/client/dashboard-medical')
}

main().catch((e) => { console.error(e); process.exit(1) })
