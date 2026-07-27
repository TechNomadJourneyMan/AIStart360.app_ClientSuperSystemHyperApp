import type { SalesAccessContext } from './access'
import { query, withTransaction } from './database'
import { DomainError } from './errors'
import { writeAudit, writeOutbox } from './events'

export async function createProductWithVariant(
  input: {
    organizationId: string
    name: string
    category?: string
    sku: string
    barcode?: string
    size?: string
    color?: string
    availability?: 'available' | 'unavailable' | 'unknown'
    costAmount: string
    priceAmount: string
    currency?: string
    validFrom: string
    costReason: string
    supplier?: string
  },
  access: SalesAccessContext,
  request?: Request,
) {
  return withTransaction(async (client) => {
    const duplicate = await client.query(
      `SELECT id FROM product_variants
       WHERE organization_id = $1
         AND (sku = $2 OR ($3::text IS NOT NULL AND barcode = $3))
       LIMIT 1`,
      [input.organizationId, input.sku, input.barcode ?? null],
    )
    if (duplicate.rowCount) {
      throw new DomainError('PRODUCT_VARIANT_DUPLICATE', 'Артикул или штрихкод уже используется', 409)
    }
    const product = await client.query<{ id: string }>(
      `INSERT INTO products (organization_id, name, category)
       VALUES ($1,$2,$3) RETURNING id`,
      [input.organizationId, input.name, input.category ?? null],
    )
    const variant = await client.query<{ id: string }>(
      `INSERT INTO product_variants (
         organization_id, product_id, sku, barcode, size, color, availability
       ) VALUES ($1,$2::uuid,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        input.organizationId,
        product.rows[0].id,
        input.sku,
        input.barcode ?? null,
        input.size ?? null,
        input.color ?? null,
        input.availability ?? 'available',
      ],
    )
    const cost = await client.query<{ id: string }>(
      `INSERT INTO product_cost_versions (
         organization_id, product_variant_id, amount, currency, base_amount,
         valid_from, reason, source, supplier, created_by
       ) VALUES ($1,$2::uuid,$3,$4,$3,$5::timestamptz,$6,'manual',$7,$8)
       RETURNING id`,
      [
        input.organizationId,
        variant.rows[0].id,
        input.costAmount,
        input.currency ?? 'KZT',
        input.validFrom,
        input.costReason,
        input.supplier ?? null,
        access.actorId,
      ],
    )
    const price = await client.query<{ id: string }>(
      `INSERT INTO product_price_versions (
         organization_id, product_variant_id, amount, currency, valid_from, created_by
       ) VALUES ($1,$2::uuid,$3,$4,$5::timestamptz,$6)
       RETURNING id`,
      [
        input.organizationId,
        variant.rows[0].id,
        input.priceAmount,
        input.currency ?? 'KZT',
        input.validFrom,
        access.actorId,
      ],
    )
    const result = {
      productId: product.rows[0].id,
      variantId: variant.rows[0].id,
      costVersionId: cost.rows[0].id,
      priceVersionId: price.rows[0].id,
      sku: input.sku,
    }
    await writeAudit(client, {
      access,
      entityType: 'product_variant',
      entityId: result.variantId,
      action: 'product.created',
      reason: input.costReason,
      after: result,
      request,
    })
    await writeOutbox(client, {
      access,
      eventType: 'product.created',
      entityType: 'product_variant',
      entityId: result.variantId,
      payload: { sku: input.sku },
    })
    return result
  })
}

export async function searchProducts(input: {
  organizationId: string
  q: string
  limit?: number
}) {
  const normalized = input.q.trim()
  const rows = await query<{
    id: string
    product_id: string
    product_name: string
    sku: string
    barcode: string | null
    size: string | null
    color: string | null
    availability: string
    recommended_price: string | null
    current_cost: string | null
  }>(
    `SELECT
       v.id, p.id AS product_id, p.name AS product_name, v.sku, v.barcode,
       v.size, v.color, v.availability,
       price.amount::text AS recommended_price,
       cost.base_amount::text AS current_cost
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN LATERAL (
       SELECT amount FROM product_price_versions
       WHERE product_variant_id = v.id AND valid_from <= now()
         AND (valid_to IS NULL OR valid_to > now())
       ORDER BY valid_from DESC LIMIT 1
     ) price ON true
     LEFT JOIN LATERAL (
       SELECT base_amount FROM product_cost_versions
       WHERE product_variant_id = v.id AND valid_from <= now()
         AND (valid_to IS NULL OR valid_to > now())
       ORDER BY valid_from DESC LIMIT 1
     ) cost ON true
     WHERE v.organization_id = $1 AND v.archived_at IS NULL AND p.archived_at IS NULL
       AND (
         $2 = '' OR v.sku ILIKE '%' || $2 || '%' OR v.barcode = $2
         OR p.name ILIKE '%' || $2 || '%' OR v.size ILIKE '%' || $2 || '%'
         OR v.color ILIKE '%' || $2 || '%'
       )
     ORDER BY
       CASE WHEN v.sku = $2 OR v.barcode = $2 THEN 0
            WHEN v.sku ILIKE $2 || '%' THEN 1
            WHEN p.name ILIKE $2 || '%' THEN 2 ELSE 3 END,
       p.name, v.sku
     LIMIT $3`,
    [input.organizationId, normalized, Math.min(input.limit ?? 20, 100)],
  )
  return rows
}

export async function createProductRequest(
  input: {
    organizationId: string
    saleId?: string
    sku?: string
    barcode?: string
    name?: string
    size?: string
    color?: string
    photoPaths?: string[]
    comment?: string
  },
  access: SalesAccessContext,
  request?: Request,
) {
  return withTransaction(async (client) => {
    const settings = await client.query<{ product_request_sla_hours: number }>(
      `SELECT product_request_sla_hours
       FROM organization_sales_settings WHERE organization_id = $1`,
      [input.organizationId],
    )
    const hours = settings.rows[0]?.product_request_sla_hours ?? 24
    const inserted = await client.query<{ id: string; sla_deadline: Date }>(
      `INSERT INTO product_requests (
         organization_id, sale_id, requested_by, sku, barcode, name,
         size, color, photo_paths, comment, sla_deadline
       ) VALUES (
         $1,$2::uuid,$3,$4,$5,$6,$7,$8,$9::text[],$10,now() + ($11 || ' hours')::interval
       ) RETURNING id, sla_deadline`,
      [
        input.organizationId,
        input.saleId ?? null,
        access.actorId,
        input.sku ?? null,
        input.barcode ?? null,
        input.name ?? null,
        input.size ?? null,
        input.color ?? null,
        input.photoPaths ?? [],
        input.comment ?? null,
        hours,
      ],
    )
    if (input.saleId) {
      await client.query(
        `UPDATE sales SET status = 'waiting_for_product', version = version + 1
         WHERE id = $1::uuid AND organization_id = $2 AND status = 'draft'`,
        [input.saleId, input.organizationId],
      )
    }
    const record = {
      id: inserted.rows[0].id,
      status: 'new',
      slaDeadline: inserted.rows[0].sla_deadline.toISOString(),
    }
    await writeAudit(client, {
      access,
      entityType: 'product_request',
      entityId: record.id,
      action: 'product.requested',
      after: record,
      request,
    })
    await writeOutbox(client, {
      access,
      eventType: 'product.request.created',
      entityType: 'product_request',
      entityId: record.id,
      payload: { saleId: input.saleId },
    })
    return record
  })
}

export async function resolveProductRequest(
  input: {
    organizationId: string
    requestId: string
    productVariantId: string
    comment?: string
  },
  access: SalesAccessContext,
  request?: Request,
) {
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string
      sale_id: string | null
    }>(
      `UPDATE product_requests pr
       SET status = 'resolved', resolved_variant_id = $3::uuid,
           comment = COALESCE($4, comment), resolved_at = now(), updated_at = now()
       WHERE pr.id = $1::uuid AND pr.organization_id = $2
         AND pr.status IN ('new', 'in_review')
         AND EXISTS (
           SELECT 1 FROM product_variants pv
           WHERE pv.id = $3::uuid AND pv.organization_id = $2
             AND pv.archived_at IS NULL
         )
       RETURNING id, sale_id`,
      [input.requestId, input.organizationId, input.productVariantId, input.comment ?? null],
    )
    if (!result.rows[0]) {
      throw new DomainError('PRODUCT_REQUEST_NOT_RESOLVABLE', 'Заявка или вариант товара не найден', 404)
    }
    if (result.rows[0].sale_id) {
      await client.query(
        `UPDATE sales SET status = 'draft', version = version + 1
         WHERE id = $1::uuid AND status = 'waiting_for_product'`,
        [result.rows[0].sale_id],
      )
    }
    await writeAudit(client, {
      access,
      entityType: 'product_request',
      entityId: input.requestId,
      action: 'product.request.resolved',
      reason: input.comment,
      after: { productVariantId: input.productVariantId },
      request,
    })
    await writeOutbox(client, {
      access,
      eventType: 'product.request.resolved',
      entityType: 'product_request',
      entityId: input.requestId,
      payload: {
        productVariantId: input.productVariantId,
        saleId: result.rows[0].sale_id,
      },
    })
    return {
      id: input.requestId,
      status: 'resolved',
      productVariantId: input.productVariantId,
      saleId: result.rows[0].sale_id,
    }
  })
}

export async function createCostVersion(
  input: {
    organizationId: string
    productVariantId: string
    amount: string
    currency?: string
    baseAmount: string
    validFrom: string
    validTo?: string
    reason: string
    source?: string
    supplier?: string
    batchNumber?: string
    attachmentPath?: string
  },
  access: SalesAccessContext,
  request?: Request,
) {
  return withTransaction(async (client) => {
    const variant = await client.query(
      `SELECT id FROM product_variants WHERE id = $1::uuid AND organization_id = $2`,
      [input.productVariantId, input.organizationId],
    )
    if (!variant.rowCount) throw new DomainError('PRODUCT_VARIANT_NOT_FOUND', 'Вариант товара не найден', 404)

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO product_cost_versions (
         organization_id, product_variant_id, amount, currency, base_amount,
         valid_from, valid_to, reason, source, supplier, batch_number,
         attachment_path, created_by
       ) VALUES (
         $1,$2::uuid,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11,$12,$13
       ) RETURNING id`,
      [
        input.organizationId,
        input.productVariantId,
        input.amount,
        input.currency ?? 'KZT',
        input.baseAmount,
        input.validFrom,
        input.validTo ?? null,
        input.reason,
        input.source ?? null,
        input.supplier ?? null,
        input.batchNumber ?? null,
        input.attachmentPath ?? null,
        access.actorId,
      ],
    )
    await writeAudit(client, {
      access,
      entityType: 'cost_version',
      entityId: inserted.rows[0].id,
      action: 'cost.version.created',
      reason: input.reason,
      after: input,
      request,
    })
    await writeOutbox(client, {
      access,
      eventType: 'cost.version.created',
      entityType: 'cost_version',
      entityId: inserted.rows[0].id,
      payload: { productVariantId: input.productVariantId, validFrom: input.validFrom },
    })
    return { id: inserted.rows[0].id }
  })
}
