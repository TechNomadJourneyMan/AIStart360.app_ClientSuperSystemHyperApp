'use client'

import { useState, useEffect, useCallback } from 'react'

interface ExpertNote {
  note: string
  updated_at: string
}

interface ExpertNotesPanelProps {
  blockId: string
  blockLabel: string
  userId: string
  userRole: string | null
  initialNote?: string
}

const EXPERT_ROLES = ['super_admin', 'admin', 'manager', 'analyst']

export default function ExpertNotesPanel({
  blockId,
  blockLabel,
  userId,
  userRole,
  initialNote,
}: ExpertNotesPanelProps) {
  const [note, setNote] = useState(initialNote ?? '')
  const [savedNote, setSavedNote] = useState(initialNote ?? '')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const isExpert = userRole ? EXPERT_ROLES.includes(userRole) : false
  const hasChanges = note !== savedNote

  const handleSave = useCallback(async () => {
    if (!hasChanges || saving) return
    setSaving(true)
    setSaveStatus('idle')

    try {
      const res = await fetch('/api/v1/gri/expert-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          block: blockId,
          note: note,
        }),
      })

      const json = await res.json()
      if (json.ok) {
        setSavedNote(note)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2500)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }, [blockId, hasChanges, note, saving, userId])

  // If there's no note and user is not an expert, don't render anything
  if (!isExpert && !savedNote) return null

  return (
    <div className="mt-4 border-t border-white/[0.04] pt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-sm text-secondary/70">edit_note</span>
        <p className="text-[10px] font-mono text-secondary/70 uppercase tracking-widest">
          Expert Notes &mdash; {blockLabel}
        </p>
      </div>

      {isExpert ? (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`Expert analysis for ${blockLabel}...`}
            rows={4}
            className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-secondary/40 transition-colors resize-y min-h-[80px]"
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              {saveStatus === 'saved' && (
                <span className="text-xs text-primary font-mono flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  Saved
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-xs text-error font-mono flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">error</span>
                  Save failed
                </span>
              )}
              {hasChanges && saveStatus === 'idle' && (
                <span className="text-xs text-on-surface-variant/50 font-mono">
                  Unsaved changes
                </span>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className={`flex items-center gap-1.5 text-xs font-mono px-4 py-1.5 rounded-lg transition-all ${
                hasChanges
                  ? 'text-[#003824] bg-gradient-to-r from-primary to-[#00e29e] hover:scale-[0.98] font-bold'
                  : 'text-on-surface-variant/40 bg-surface-container border border-white/[0.06] cursor-not-allowed'
              }`}
            >
              <span className="material-symbols-outlined text-sm">
                {saving ? 'sync' : 'save'}
              </span>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        // Read-only view for non-expert users
        <div className="bg-surface-container rounded-xl px-4 py-3">
          <p className="text-sm text-on-surface whitespace-pre-wrap leading-relaxed">
            {savedNote}
          </p>
        </div>
      )}
    </div>
  )
}
