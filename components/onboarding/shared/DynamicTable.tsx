'use client'

import React, { useCallback } from 'react'

interface Column {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  options?: { value: string; label: string }[]
}

interface DynamicTableProps {
  columns: Column[]
  rows: Record<string, unknown>[]
  onChange: (rows: Record<string, unknown>[]) => void
  minRows?: number
}

export function DynamicTable({
  columns,
  rows,
  onChange,
  minRows = 1,
}: DynamicTableProps) {
  const addRow = useCallback(() => {
    const empty: Record<string, unknown> = {}
    columns.forEach((col) => {
      empty[col.key] = col.type === 'number' ? 0 : ''
    })
    onChange([...rows, empty])
  }, [columns, rows, onChange])

  const removeRow = useCallback(
    (index: number) => {
      if (rows.length <= minRows) return
      onChange(rows.filter((_, i) => i !== index))
    },
    [rows, minRows, onChange]
  )

  const updateCell = useCallback(
    (rowIndex: number, key: string, value: unknown) => {
      const updated = rows.map((row, i) =>
        i === rowIndex ? { ...row, [key]: value } : row
      )
      onChange(updated)
    },
    [rows, onChange]
  )

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="hidden sm:grid gap-2 px-1" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr) 36px` }}>
        {columns.map((col) => (
          <span
            key={col.key}
            className="text-xs font-mono text-on-surface-variant uppercase tracking-wider"
          >
            {col.label}
          </span>
        ))}
        <span />
      </div>

      {/* Rows */}
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className="grid gap-2 items-center"
          style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr) 36px` }}
        >
          {columns.map((col) => (
            <div key={col.key}>
              {/* Mobile label */}
              <span className="sm:hidden block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-1">
                {col.label}
              </span>

              {col.type === 'select' ? (
                <select
                  value={(row[col.key] as string) ?? ''}
                  onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none"
                >
                  <option value="">--</option>
                  {col.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={col.type}
                  value={(row[col.key] as string | number) ?? ''}
                  onChange={(e) =>
                    updateCell(
                      rowIdx,
                      col.key,
                      col.type === 'number'
                        ? Number(e.target.value) || 0
                        : e.target.value
                    )
                  }
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                />
              )}
            </div>
          ))}

          {/* Remove button */}
          <button
            type="button"
            onClick={() => removeRow(rowIdx)}
            disabled={rows.length <= minRows}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-white/[0.08] text-on-surface-variant hover:text-red-400 hover:border-red-400/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            title="Delete row"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      ))}

      {/* Add row */}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-dashed border-white/[0.12] text-xs font-medium text-on-surface-variant hover:text-primary hover:border-primary/30 transition-all"
      >
        <span className="material-symbols-outlined text-sm">add</span>
        Add Row
      </button>
    </div>
  )
}
