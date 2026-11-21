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
 * Supports ## headings, paragraphs, unordered lists, and **bold**.
 * Escapes HTML so raw tags in explanations cannot inject markup.
 */
export function renderExplanationHtml(markdown: string): string {
  const escaped = escapeHtml(markdown.replace(/\r\n/g, '\n'))
  const blocks = escaped.split(/\n{2,}/)
  const html: string[] = []

  for (const raw of blocks) {
    const block = raw.trim()
    if (!block) continue

    const heading = block.match(/^##\s+(.+)$/)
    if (heading && !block.includes('\n')) {
      html.push(`<h3 class="explain-h">${inlineMd(heading[1])}</h3>`)
      continue
    }

    const lines = block.split('\n')
    if (lines.every((line) => /^\s*[-*]\s+/.test(line) || line.trim() === '')) {
      const items = lines
        .filter((line) => line.trim())
        .map((line) => `<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
        .join('')
      html.push(`<ul class="explain-ul">${items}</ul>`)
      continue
    }

    html.push(`<p class="explain-p">${inlineMd(lines.join('<br />'))}</p>`)
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

function inlineMd(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}
