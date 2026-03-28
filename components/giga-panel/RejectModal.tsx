'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertTriangle } from 'lucide-react'

interface RejectModalProps {
  isOpen: boolean
  requestId: string
  userName: string
  onConfirm: (id: string, reason: string) => void
  onClose: () => void
}

export function RejectModal({ isOpen, requestId, userName, onConfirm, onClose }: RejectModalProps) {
  const [reason, setReason] = useState('')

  const handleConfirm = () => {
    if (!reason.trim()) return
    onConfirm(requestId, reason.trim())
    setReason('')
    onClose()
  }

  const handleClose = () => {
    setReason('')
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2
              bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl
              shadow-black/50 p-6"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/20
                  flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={17} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Отклонить заявку</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{userName}</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="text-slate-600 hover:text-slate-300 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-slate-400 mb-2">
                Причина отклонения <span className="text-red-400">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Укажите причину, которая будет отправлена пользователю..."
                rows={4}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08]
                  text-sm text-slate-200 placeholder:text-slate-600
                  focus:outline-none focus:border-red-500/40 focus:ring-1 focus:ring-red-500/20
                  resize-none transition-all"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium
                  text-slate-400 bg-white/[0.05] border border-white/[0.08]
                  hover:bg-white/[0.08] transition-all"
              >
                Отмена
              </button>
              <motion.button
                onClick={handleConfirm}
                disabled={!reason.trim()}
                whileHover={reason.trim() ? { scale: 1.02 } : {}}
                whileTap={reason.trim() ? { scale: 0.98 } : {}}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                  bg-red-500/20 border border-red-500/30 text-red-300
                  hover:bg-red-500/30 hover:border-red-500/50
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-all"
              >
                Отклонить
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
