export type Money = string
export type Quantity = string

export type SaleStatus =
  | 'draft'
  | 'waiting_for_product'
  | 'pending_approval'
  | 'posted'
  | 'reversed'
  | 'annulled'

export type ExpenseStatus = 'draft' | 'posted' | 'reversed'

export interface SaleItemInput {
  productVariantId: string
  quantity: Quantity
  unitPrice: Money
  discountAmount?: Money
}

export interface CreateSaleInput {
  organizationId: string
  soldAt: string
  managerId?: string
  managerName?: string
  regionId?: string
  channelId?: string
  currency?: string
  negativeMarginReason?: string
  negativeMarginComment?: string
  source?: 'manual' | 'import' | 'assistant'
  sourceRef?: string
  items: SaleItemInput[]
}

export interface SaleLineResult {
  quantity: Quantity
  unitPrice: Money
  discountAmount: Money
  revenueAmount: Money
  unitCost: Money
  costAmount: Money
  grossProfitAmount: Money
  bonusAmount: Money
}

export interface SaleResult {
  id: string
  organizationId: string
  number: string
  status: SaleStatus
  soldAt: string
  currency: string
  revenueTotal: Money
  costTotal: Money
  grossProfitTotal: Money
  discountTotal: Money
  bonusTotal: Money
  regionId?: string | null
  channelId?: string | null
  lines?: Array<SaleLineResult & {
    id: string
    productVariantId: string
    productName: string
    sku: string
    size?: string | null
    color?: string | null
  }>
}

export type ExpenseOperationType =
  | 'operating_expense'
  | 'write_off'
  | 'owner_payment'
  | 'tax'
  | 'capital_expense'
  | 'internal_transfer'
  | 'adjustment'
  | 'depreciation'

export interface CreateExpenseInput {
  organizationId: string
  operationType: ExpenseOperationType
  documentDate: string
  paymentDate?: string
  categoryId: string
  costCenterId?: string
  amount: Money
  currency?: string
  supplier?: string
  documentNumber?: string
  comment?: string
  attachmentPaths?: string[]
  source?: 'manual' | 'import' | 'assistant'
  sourceRef?: string
}

export interface ExpenseResult {
  id: string
  organizationId: string
  status: ExpenseStatus
  operationType: ExpenseOperationType
  documentDate: string
  paymentDate?: string | null
  amount: Money
  currency: string
  affectsPnl: boolean
  affectsCashFlow: boolean
}

export interface PlanLineInput {
  regionId?: string
  channelId?: string
  productId?: string
  managerId?: string
  revenueTarget: Money
  grossProfitTarget: Money
  quantityTarget: Quantity
  averagePriceTarget?: Money
  averageCostTarget?: Money
}

export interface CreatePlanInput {
  organizationId: string
  periodStart: string
  periodEnd: string
  currency?: string
  lines: PlanLineInput[]
}

export interface DashboardSnapshot {
  asOf: string
  filters: {
    organizationId: string
    from: string
    to: string
    regionId?: string
    channelId?: string
  }
  kpis: {
    revenue: Money
    costOfGoods: Money
    grossProfit: Money
    grossMarginPct: string
    expenses: Money
    operatingProfit: Money
    units: Quantity
    salesCount: number
    averageCheck: Money
    planRevenue: Money
    planGrossProfit: Money
  }
  updatedAt: string | null
}

export interface AssistantCitation {
  kind: 'document' | 'metric' | 'sale' | 'expense' | 'plan'
  sourceId: string
  label: string
  locator?: Record<string, unknown>
  excerpt?: string
}

export interface AssistantAnswer {
  conversationId: string
  answer: string
  asOf: string
  citations: AssistantCitation[]
  model: string
  grounded: boolean
}

export interface ActionDraft {
  id: string
  actionType:
    | 'create_sale'
    | 'create_expense'
    | 'create_plan'
    | 'reverse_sale'
    | 'reverse_expense'
    | 'create_product_request'
  payload: Record<string, unknown>
  preview: Record<string, unknown>
  checksum: string
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled' | 'failed'
  expiresAt: string
}
