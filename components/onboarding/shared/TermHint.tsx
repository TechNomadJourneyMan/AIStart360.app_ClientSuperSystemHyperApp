'use client'

import { useId, useState } from 'react'
import { SURVEY_TERMS, type SurveyTerm } from '@/lib/survey/terms'

/**
 * «(УТП)» after a plain-words question, with the explanation one tap away
 * (works on a phone, unlike a hover tooltip). Lives inside the field's
 * <label>: SurveyFieldLayer drops `[data-term-hint]` parts from the editor title.
 */
export function TermHint({ term }: { term: SurveyTerm }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const text = SURVEY_TERMS[term]
  return (
    <>
      {' '}
      <span className="whitespace-nowrap">
        (<abbr title={text} className="no-underline">{term}</abbr>
        <button
          type="button"
          data-term-hint=""
          aria-expanded={open}
          aria-controls={id}
          aria-label={`Что такое ${term}`}
          onClick={(e) => { e.preventDefault(); setOpen((o) => !o) }}
          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/20 align-middle text-[9px] leading-none text-on-surface-variant hover:border-primary/40 hover:text-primary"
        >
          ?
        </button>)
      </span>
      <span id={id} data-term-hint="" role="note" hidden={!open} className="mt-1 block font-sans normal-case tracking-normal text-[11px] leading-snug text-on-surface-variant/80">
        {text}
      </span>
    </>
  )
}
