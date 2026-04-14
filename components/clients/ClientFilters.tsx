'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/Input'

export function ClientFilters() {
  const t = useTranslations()
  const [search, setSearch] = useState('')

  return (
    <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-outline-variant/10">
      {/* Search */}
      <div className="flex-1 max-w-sm">
        <Input
          placeholder={t('clients.searchByName')}
          leftIcon="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {/* Industry Filter */}
        <select className="bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface-variant focus:outline-none focus:border-primary/30 transition-colors">
          <option value="">{t('clients.allIndustries')}</option>
          <option>FinTech</option>
          <option>E-commerce</option>
          <option>SaaS</option>
          <option>Healthcare</option>
          <option>Logistics</option>
        </select>

        {/* Status Filter */}
        <select className="bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface-variant focus:outline-none focus:border-primary/30 transition-colors">
          <option value="">{t('clients.allStatuses')}</option>
          <option>Active</option>
          <option>At Risk</option>
          <option>Inactive</option>
        </select>

        {/* GRI Filter */}
        <select className="bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface-variant focus:outline-none focus:border-primary/30 transition-colors">
          <option value="">{t('clients.griAny')}</option>
          <option>Excellent (900+)</option>
          <option>Strong (700–899)</option>
          <option>Developing (500–699)</option>
          <option>Critical (&lt;500)</option>
        </select>

        {/* Sort */}
        <select className="bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface-variant focus:outline-none focus:border-primary/30 transition-colors">
          <option>{t('clients.sortGriDesc')}</option>
          <option>{t('clients.sortGriAsc')}</option>
          <option>{t('clients.sortName')}</option>
          <option>{t('clients.sortDate')}</option>
        </select>
      </div>
    </div>
  )
}
