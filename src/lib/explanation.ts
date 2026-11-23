import type { ExplanationComment } from '../types'

/** Notion-inspired focus-audit fields. Seeded into empty explanations. */
export const EXPLANATION_SECTIONS = [
  'Purpose',
  'Inputs',
  'Outputs',
  'Dependencies',
  'Reasoning',
  'Assumptions',
  'Checks',
  'Caveats',
] as const

export type ExplanationSection = (typeof EXPLANATION_SECTIONS)[number]

/** Default Explain panel mode when opening / focusing a cell. */
export const DEFAULT_EXPLAIN_MODE = 'preview' as const

export type ExplainMode = 'edit' | 'preview'

/** Markdown template used when a cell has no explanation yet. */
export function emptyExplanationTemplate(): string {
  return EXPLANATION_SECTIONS.map((section) => `## ${section}\n\n`).join('').trimEnd() + '\n'
}

/** True when the doc is empty or still only the seeded headings. */
export function isBlankExplanation(text: string | undefined | null): boolean {
  if (!text || !text.trim()) return true
  const stripped = text
    .replace(/^##\s+\w[^\n]*\n*/gm, '')
    .replace(/\s+/g, '')
  return stripped.length === 0
}

/** Return template when missing/blank; otherwise keep the user's Markdown. */
export function ensureExplanation(text?: string | null): string {
  if (!text || isBlankExplanation(text)) return emptyExplanationTemplate()
  return text
}

export function createComment(body: string, author: ExplanationComment['author'] = 'user'): ExplanationComment {
  return {
    id: `cmt_${Math.random().toString(36).slice(2, 9)}`,
    body: body.trim(),
    createdAt: Date.now(),
    author,
  }
}

/**
 * Lightweight Markdown → safe HTML for purpose docs.
 * Supports ATX headings (#–####), paragraphs, unordered lists, fenced code,
 * links, inline code, **bold**, and *italic*. Escapes HTML first so raw tags
 * in explanations cannot inject markup.
 */
export function renderExplanationHtml(markdown: string): string {
  const source = markdown.replace(/\r\n/g, '\n')
  if (!source.trim()) {
    return '<p class="explain-p muted">Empty explanation.</p>'
  }

  const lines = source.split('\n')
  const html: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    const fence = line.match(/^```([\w-]*)\s*$/)
    if (fence) {
      const lang = fence[1]
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1 // closing fence
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
      html.push(
        `<pre class="explain-pre"${langAttr}><code class="explain-code">${escapeHtml(body.join('\n'))}</code></pre>`,
      )
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+?)\s*$/)
    if (heading) {
      const level = Math.min(heading[1].length + 1, 5) // # → h2 … #### → h5
      html.push(`<h${level} class="explain-h">${inlineMd(escapeHtml(heading[2]))}</h${level}>`)
      i += 1
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*[-*]\s+/, '')
        items.push(`<li>${inlineMd(escapeHtml(item))}</li>`)
        i += 1
      }
      html.push(`<ul class="explain-ul">${items.join('')}</ul>`)
      continue
    }

    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      para.push(escapeHtml(lines[i].trim()))
      i += 1
    }
    html.push(`<p class="explain-p">${inlineMd(para.join('<br />'))}</p>`)
  }

  return html.join('\n') || '<p class="explain-p muted">Empty explanation.</p>'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline Markdown on already-escaped text (so tags we emit stay intact). */
function inlineMd(text: string): string {
  // Inline code first so emphasis markers inside backticks stay literal.
  let out = text.replace(/`([^`]+)`/g, '<code class="explain-inline-code">$1</code>')
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, href) => {
    return `<a class="explain-a" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  return out
}
