import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { calculatePointA } from '../lib/point-a-engine'
import type { DiagnosticAiAnalysis } from '../types/onboarding'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name}`)
  return value
}

const email = requiredEnv('DEMO_OWNER_EMAIL')
const password = requiredEnv('DEMO_OWNER_PASSWORD')
const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
if (password.length < 12) {
  throw new Error('DEMO_OWNER_PASSWORD must be at least 12 characters')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const answers: Record<string, unknown> = {
  s1_company_name: 'Qadam Growth Demo',
  s1_founded_at: '2021-04-15',
  s1_industry: 'Ритейл / E-commerce',
  s1_stage: 'Growth',
  s1_employee_count: 28,
  s1_regions: ['Алматы', 'Астана'],
  s1_business_model: 'B2C',
  s1_contact_name: 'Алия Садыкова',
  s1_contact_position: 'Основатель',
  s1_contact_phone: '+7 700 000 00 00',
  s1_contact_email: email,
  s2_revenue_2023: 128_000_000,
  s2_revenue_2024: 164_000_000,
  s2_revenue_2025: 201_000_000,
  s2_new_clients_2023: 1540,
  s2_new_clients_2024: 1960,
  s2_new_clients_2025: 2280,
  s2_repeat_clients_2023: 410,
  s2_repeat_clients_2024: 620,
  s2_repeat_clients_2025: 780,
  s2_avg_check: 38_500,
  s2_gross_margin: 42,
  s2_cac: 9_800,
  s2_ltv: 31_500,
  s2_debt_load: 'moderate',
  s2_knows_breakeven: true,
  s3_has_crm: 'excel',
  s3_products_description: 'Одежда и экипировка для активного отдыха с продажами в магазинах и онлайн.',
  s3_product_count: 86,
  s3_flagship_product: 'Зимний комплект Qadam Pro',
  s3_deals_2023: 3320,
  s3_deals_2024: 4260,
  s3_deals_2025: 4920,
  s3_rejections_2023: 720,
  s3_rejections_2024: 930,
  s3_rejections_2025: 1180,
  s3_deal_cycle_days: 5,
  s3_promo_channels: ['Instagram', 'Google Ads', 'Партнёры / Реферальная программа'],
  s3_has_loyalty: true,
  s4_dept_count: 5,
  s4_has_org_chart: true,
  s4_management_method: 'kpi',
  s4_has_regular_meetings: true,
  s4_reporting_tool: 'excel',
  s4_task_manager: 'trello',
  s4_has_dept_kpi: false,
  s5_target_audience: 'Городские жители 25–45 лет, которым нужна практичная экипировка для зимы и путешествий.',
  s5_audience_segments: ['Физические лица (B2C)', 'Малый бизнес (SMB)'],
  s5_top_regions: ['Алматы', 'Астана'],
  s5_marketing_channels: ['SMM (соцсети)', 'Контекстная реклама', 'Партнёрский маркетинг'],
  s5_marketing_budget_pct: 8,
  s5_has_competitor_analysis: false,
  s5_competitor_1: 'Outdoor Market',
  s5_competitor_2: 'Nomad Gear',
  s5_competitor_3: '',
  s5_usp: 'Подбор экипировки под климат Казахстана и быстрая доставка из локального наличия.',
  s6_main_pain: 'Продажи растут, но управленческая отчётность собирается вручную и решения принимаются с опозданием.',
  s6_goal_12months: 'Увеличить выручку на 35 процентов без пропорционального роста операционных расходов.',
  s6_goal_3years: 'Создать национальную сеть и довести онлайн-канал до половины общей выручки.',
  s6_growth_blockers: ['Процессы / Операции', 'Маркетинг / Продажи', 'Технологии / IT'],
  s6_expectations: 'Получить прозрачные приоритеты и систему еженедельного контроля выполнения.',
}

async function findOrCreateUser() {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) throw listError
  const existing = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...existing.user_metadata,
        full_name: 'Алия Садыкова',
        organization: 'Qadam Growth Demo',
        role: 'owner',
        status: 'approved',
      },
    })
    if (error || !data.user) throw error ?? new Error('Failed to update demo user')
    return data.user
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: 'Алия Садыкова',
      organization: 'Qadam Growth Demo',
      role: 'owner',
      status: 'approved',
    },
  })
  if (error || !data.user) throw error ?? new Error('Failed to create demo user')
  return data.user
}

async function main() {
  const user = await findOrCreateUser()
  const now = new Date().toISOString()

  const { error: profileError } = await admin.from('profiles').upsert({
    id: user.id,
    email,
    full_name: 'Алия Садыкова',
    organization: 'Qadam Growth Demo',
    position: 'Основатель',
    role: 'owner',
    status: 'approved',
    approved_at: now,
  }, { onConflict: 'id' })
  if (profileError) throw profileError

  const { data: existingCompany, error: companyReadError } = await admin
    .from('companies')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (companyReadError) throw companyReadError

  const companyPayload = {
    name: 'Qadam Growth Demo',
    industry: 'Ритейл / E-commerce',
    stage: 'Growth',
    employee_count: 28,
    founded_at: '2021-04-15',
    business_model: 'B2C',
    regions: ['Алматы', 'Астана'],
    contact_name: 'Алия Садыкова',
    contact_position: 'Основатель',
    contact_phone: '+7 700 000 00 00',
    contact_email: email,
    updated_at: now,
  }
  const companyMutation = existingCompany
    ? admin.from('companies').update(companyPayload).eq('id', existingCompany.id).select('id').single()
    : admin.from('companies').insert({ user_id: user.id, ...companyPayload }).select('id').single()
  const { data: company, error: companyError } = await companyMutation
  if (companyError || !company) throw companyError ?? new Error('Failed to create demo company')

  const surveyRows = Object.entries(answers).map(([questionKey, value]) => ({
    user_id: user.id,
    company_id: company.id,
    step: Number(questionKey.slice(1, 2)),
    question_key: questionKey,
    answer: { value },
    answered_at: now,
  }))
  const { error: surveyError } = await admin
    .from('survey_answers')
    .upsert(surveyRows, { onConflict: 'user_id,question_key' })
  if (surveyError) throw surveyError

  const pointA = calculatePointA(answers)
  await admin.from('diagnostics').update({ is_current: false }).eq('user_id', user.id)

  const analysis: DiagnosticAiAnalysis = {
    executive_summary:
      `Компания находится на стадии роста с индексом ${pointA.overall_score}/100. ` +
      'Главная задача пилота — заменить ручной управленческий контроль регулярным циклом данных, решений и ответственных.',
    strengths: Object.entries(pointA.blocks)
      .filter(([, block]) => block.score >= 60)
      .slice(0, 3)
      .map(([area, block]) => `${area}: ${Math.round(block.score)}/100 по данным анкеты.`),
    risks: pointA.risks.slice(0, 4).map((risk) => ({
      title: risk.text,
      impact: risk.impact,
      evidence: [`Направление: ${risk.area}`, `Уровень: ${risk.level}`],
    })),
    action_plan: [
      {
        action: 'Зафиксировать единый еженедельный набор управленческих показателей',
        owner: 'Основатель и финансовый менеджер',
        timeline: '14 дней',
        expected_result: 'Решения принимаются на одной версии данных без ручной сверки нескольких файлов.',
        evidence: ['Отчётность сейчас собирается вручную', 'Рост выручки требует регулярного контроля'],
      },
      {
        action: 'Перенести в CRM этапы сделки и причины отказов',
        owner: 'Руководитель продаж',
        timeline: '30 дней',
        expected_result: 'Станет видна конверсия и потери по каждому этапу продаж.',
        evidence: ['Сейчас используется Excel', 'Число отказов растёт вместе с объёмом сделок'],
      },
      {
        action: 'Ввести KPI подразделений и владельцев показателей',
        owner: 'Операционный директор',
        timeline: '45 дней',
        expected_result: 'Каждое отклонение получает ответственного и срок исправления.',
        evidence: ['KPI отделов заполнены не полностью', 'Компания управляется по общему KPI'],
      },
    ],
    questions: pointA.data_gaps.slice(0, 4).map((gap) => `${gap.field}: ${gap.impact}`),
    source: 'rules',
  }

  const { error: diagnosticError } = await admin.from('diagnostics').insert({
    user_id: user.id,
    company_id: company.id,
    overall_score: pointA.overall_score,
    health_index: pointA.health_index,
    stage: pointA.stage,
    finance_score: pointA.blocks.finance,
    marketing_score: pointA.blocks.marketing,
    operations_score: pointA.blocks.operations,
    strategy_score: pointA.blocks.strategy,
    sales_score: pointA.blocks.sales,
    risks: pointA.risks,
    insights: pointA.insights,
    quick_wins: pointA.quick_wins,
    data_gaps: pointA.data_gaps,
    is_current: true,
    ai_status: 'fallback',
    ai_analysis: analysis,
    ai_model: 'deterministic-rules-v1',
    ai_generated_at: now,
  })
  if (diagnosticError) throw diagnosticError

  const { error: progressError } = await admin.from('onboarding_progress').upsert({
    user_id: user.id,
    company_id: company.id,
    current_step: 6,
    completed_steps: [1, 2, 3, 4, 5, 6],
    draft_answers: answers,
    completed_at: now,
    saved_at: now,
  }, { onConflict: 'user_id' })
  if (progressError) throw progressError

  const { error: approvalError } = await admin.from('approval_requests').upsert({
    user_id: user.id,
    company_id: company.id,
    request_type: 'registration',
    status: 'approved',
    priority: 'medium',
    source: 'pilot_seed',
    payload: { name: 'Алия Садыкова', email, company: 'Qadam Growth Demo' },
    reviewed_at: now,
  }, { onConflict: 'request_type,user_id' })
  if (approvalError) throw approvalError

  console.log(`Pilot demo is ready for ${email}`)
  console.log(`Point A score: ${pointA.overall_score}/100`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
