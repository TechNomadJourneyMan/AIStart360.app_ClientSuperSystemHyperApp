import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hasMarkdown, parseInline, parseMarkdown, safeHref, stripMarkdown } from '@/lib/survey/markdown'
import {
  applyToolbarAction, continueListOnEnter, insertLink, normalizeUrl, toggleList, toggleWrap, type EditState,
} from '@/lib/survey/markdown-toolbar'
import MarkdownPreview from '@/components/onboarding/MarkdownPreview'

/** «a[b]c» → value with the selection between the brackets (no brackets = caret at «|»). */
function st(marked: string): EditState {
  if (marked.includes('[') && marked.includes(']')) {
    const start = marked.indexOf('[')
    const end = marked.indexOf(']') - 1
    return { value: marked.replace('[', '').replace(']', ''), start, end }
  }
  const at = marked.indexOf('|')
  return { value: marked.replace('|', ''), start: at, end: at }
}
/** The state back as «a[b]c». */
function show(s: EditState | null): string {
  if (!s) return 'null'
  return s.start === s.end
    ? `${s.value.slice(0, s.start)}|${s.value.slice(s.start)}`
    : `${s.value.slice(0, s.start)}[${s.value.slice(s.start, s.end)}]${s.value.slice(s.end)}`
}

describe('toolbar: bold / italic', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(show(toggleWrap(st('Цель: [рост] выручки'), '**', 'жирный текст'))).toBe('Цель: **[рост]** выручки')
    expect(show(applyToolbarAction(st('Цель: [рост] выручки'), 'italic'))).toBe('Цель: _[рост]_ выручки')
  })

  it('no selection → a selected placeholder', () => {
    expect(show(applyToolbarAction(st('Итог: |'), 'bold'))).toBe('Итог: **[жирный текст]**')
  })

  it('spaces around the selection stay outside the markers', () => {
    expect(show(toggleWrap(st('a[ рост ]b'), '**', 'x'))).toBe('a **[рост]** b')
  })

  it('pressing again unwraps (markers outside or inside the selection)', () => {
    expect(show(toggleWrap(st('Цель: **[рост]** выручки'), '**', 'x'))).toBe('Цель: [рост] выручки')
    expect(show(toggleWrap(st('Цель: [**рост**] выручки'), '**', 'x'))).toBe('Цель: [рост] выручки')
  })
})

describe('toolbar: lists', () => {
  it('bulleted list on the selected lines; again removes it', () => {
    const on = toggleList(st('[Первое\nВторое]'), 'ul')
    expect(on.value).toBe('- Первое\n- Второе')
    expect(toggleList(on, 'ul').value).toBe('Первое\nВторое')
  })

  it('numbered list counts lines, skips empty ones, converts a bulleted list', () => {
    expect(toggleList(st('[a\n\nb\nc]'), 'ol').value).toBe('1. a\n\n2. b\n3. c')
    expect(toggleList(st('[- a\n- b]'), 'ol').value).toBe('1. a\n2. b')
  })

  it('the caret line only; an empty line becomes an item with the caret after the marker', () => {
    expect(toggleList(st('x\nвто|рая\ny'), 'ul').value).toBe('x\n- вторая\ny')
    expect(show(toggleList(st('текст\n|'), 'ul'))).toBe('текст\n- |')
  })

  it('Enter continues a list, Enter on an empty item ends it', () => {
    expect(show(continueListOnEnter(st('- один|')))).toBe('- один\n- |')
    expect(show(continueListOnEnter(st('1. один|')))).toBe('1. один\n2. |')
    expect(show(continueListOnEnter(st('- один\n- |')))).toBe('- один\n|')
    expect(continueListOnEnter(st('просто текст|'))).toBeNull()
  })
})

describe('toolbar: link', () => {
  it('the selection becomes the link text; the URL is normalized', () => {
    expect(show(insertLink(st('сайт [компании] тут'), 'example.kz'))).toBe('сайт [[компании]](https://example.kz) тут')
    expect(show(insertLink(st('|'), 'https://a.kz/x?y=1'))).toBe('[[текст ссылки]](https://a.kz/x?y=1)')
    expect(applyToolbarAction(st('|'), 'link')).toBeNull()
  })

  it('unusable URLs are refused', () => {
    expect(insertLink(st('|'), 'javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('просто слово')).toBeNull()
    expect(normalizeUrl('www.kaspi.kz')).toBe('https://www.kaspi.kz')
    expect(normalizeUrl('mailto:a@b.kz')).toBe('mailto:a@b.kz')
  })
})

describe('markdown parse / strip / preview', () => {
  const text = '**Цель**: рост _выручки_ до [плана](https://plan.kz)\n\n- первое\n- второе\n\n1. шаг\n2. шаг'

  it('parses blocks and inline marks', () => {
    const blocks = parseMarkdown(text)
    expect(blocks.map((b) => b.type)).toEqual(['p', 'ul', 'ol'])
    expect(parseInline('**a** _b_ *c* [d](https://x.kz)').map((n) => n.type)).toEqual(['strong', 'text', 'em', 'text', 'em', 'text', 'link'])
  })

  it('plain words with underscores / asterisks inside stay text', () => {
    expect(parseInline('snake_case_name и 2*3*4').every((n) => n.type === 'text')).toBe(true)
  })

  it('unsafe links stay text', () => {
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.type === 'link')).toBe(false)
    expect(safeHref('https://ok.kz')).toBe('https://ok.kz')
    expect(safeHref('data:text/html,x')).toBeNull()
  })

  it('stripMarkdown gives the plain text for the engines / exports', () => {
    expect(stripMarkdown(text)).toBe('Цель: рост выручки до плана\n\n• первое\n• второе\n\n1. шаг\n2. шаг')
    expect(stripMarkdown('Просто ответ 500 000 ₸')).toBe('Просто ответ 500 000 ₸')
    expect(hasMarkdown('Просто ответ')).toBe(false)
    expect(hasMarkdown('- пункт')).toBe(true)
  })

  it('the preview renders elements, escapes HTML and keeps only safe links', () => {
    const html = renderToStaticMarkup(createElement(MarkdownPreview, { text: `${text}\n\n<script>alert(1)</script> [x](javascript:alert(1))` }))
    expect(html).toContain('<strong')
    expect(html).toContain('<em>выручки</em>')
    expect(html).toContain('href="https://plan.kz"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
    expect(html).toMatch(/<ul[^>]*><li>первое<\/li><li>второе<\/li><\/ul>/)
    expect(html).toMatch(/<ol start="1"[^>]*><li>шаг<\/li>/)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript')
    expect(renderToStaticMarkup(createElement(MarkdownPreview, { text: '', emptyText: 'Пусто' }))).toContain('Пусто')
  })
})
