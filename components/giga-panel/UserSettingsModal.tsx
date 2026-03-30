'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, LayoutDashboard, CheckSquare, Square } from 'lucide-react'
import { ALL_WIDGETS, type GigaUser } from '@/stores/gigaPanel.store'

interface UserSettingsModalProps {
  isOpen: boolean
  user: GigaUser | null
  onSave: (userId: string, widgets: string[]) => void
  onClose: () => void
}

export function UserSettingsModal({ isOpen, user, onSave, onClose }: UserSettingsModalProps) {
  const [selectedWidgets, setSelectedWidgets] = useState<string[]>([])

  useEffect(() => {
    if (user) {
      setSelectedWidgets(user.widgets.length > 0 ? user.widgets : ALL_WIDGETS.map((w) => w.id))
    }
  }, [user])

  const toggleWidget = (id: string) => {
    setSelectedWidgets((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id],
    )
  }

  const handleSave = () => {
    if (!user) return
    onSave(user.id, selectedWidgets)
    onClose()
  }

  const handleSelectAll = () => setSelectedWidgets(ALL_WIDGETS.map((w) => w.id))
  const handleClearAll = () => setSelectedWidgets([])

  return (
    <AnimatePresence>
      {isOpen && user && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2
              bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl shadow-black/50 p-6"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20
                  flex items-center justify-center flex-shrink-0">
                  <LayoutDashboard size={17} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Настройки дашборда</h3>
                  <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[220px]">
                    {user.name ?? user.email}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Description */}
            <p className="text-xs text-slate-500 mb-4">
              Выберите виджеты, которые будут отображаться на дашборде пользователя.
              Скрытые виджеты можно включить обратно в любой момент.
            </p>

            {/* Quick actions */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                  text-slate-400 bg-white/[0.05] border border-white/[0.07]
                  hover:text-slate-200 hover:bg-white/[0.08] transition-all"
              >
                <CheckSquare size={12} />
                Все
              </button>
              <button
                onClick={handleClearAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                  text-slate-400 bg-white/[0.05] border border-white/[0.07]
                  hover:text-slate-200 hover:bg-white/[0.08] transition-all"
              >
                <Square size={12} />
                Снять все
              </button>
              <span className="ml-auto text-xs text-slate-600 self-center">
                {selectedWidgets.length} / {ALL_WIDGETS.length}
              </span>
            </div>

            {/* Widget grid */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              {ALL_WIDGETS.map((widget) => {
                const isSelected = selectedWidgets.includes(widget.id)
                return (
                  <motion.button
                    key={widget.id}
                    onClick={() => toggleWidget(widget.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`
                      flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left
                      text-sm font-medium transition-all border
                      ${isSelected
                        ? 'bg-blue-500/15 border-blue-500/25 text-blue-300'
                        : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:text-slate-300'
                      }
                    `}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0
                      ${isSelected ? 'text-blue-400' : 'text-slate-600'}`}>
                      {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                    </div>
                    <span className="text-xs">{widget.label}</span>
                  </motion.button>
                )
              })}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium
                  text-slate-400 bg-white/[0.05] border border-white/[0.08]
                  hover:bg-white/[0.08] transition-all"
              >
                Отмена
              </button>
              <motion.button
                onClick={handleSave}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                  bg-blue-500/20 border border-blue-500/30 text-blue-300
                  hover:bg-blue-500/30 hover:border-blue-500/50 transition-all"
              >
                Сохранить
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
