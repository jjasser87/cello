import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { EDITOR_SCROLL_LAYOUT } from './editorScrollLayout.ts'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../index.css')
/** Normalize CRLF so Windows CI matches the same selectors as local LF checkouts. */
const css = readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n')
const cellEditorPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../components/CellEditor.tsx',
)
const cellEditor = readFileSync(cellEditorPath, 'utf8')

function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Exact selector only — skip shared groups like ".code-highlight,\n.code-area".
  const exact = new RegExp(`(?<!,)\\s*\\n${escaped}\\s*\\{([^}]*)\\}`, 'm')
  const match = css.match(exact)
  assert.ok(match, `expected CSS rule for ${selector}`)
  return match[1] ?? ''
}

function declares(block: string, property: string, value: string) {
  const re = new RegExp(
    `${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${value.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    )}\\s*;`,
  )
  assert.match(block, re, `expected ${property}: ${value}`)
}

describe('EDITOR_SCROLL_LAYOUT', () => {
  it('keeps an 80ch writing surface with internal overflow scroll', () => {
    assert.equal(EDITOR_SCROLL_LAYOUT.writingWidth, '80ch')
    assert.equal(EDITOR_SCROLL_LAYOUT.maxWritingWidth, '80ch')
    assert.equal(EDITOR_SCROLL_LAYOUT.overflow, 'auto')
    assert.equal(EDITOR_SCROLL_LAYOUT.whiteSpace, 'pre')
  })
})

describe('editor scroll CSS contract', () => {
  it('fixes .code-area height and scrolls overflow inside the editor', () => {
    const block = ruleBlock('.code-area')
    declares(block, 'width', EDITOR_SCROLL_LAYOUT.writingWidth)
    declares(block, 'max-width', EDITOR_SCROLL_LAYOUT.maxWritingWidth)
    declares(block, 'height', EDITOR_SCROLL_LAYOUT.frameHeight)
    declares(block, 'max-height', EDITOR_SCROLL_LAYOUT.frameHeight)
    declares(block, 'overflow', EDITOR_SCROLL_LAYOUT.overflow)
  })

  it('keeps long lines on one row so horizontal scroll is available', () => {
    const shared = ruleBlock('.code-highlight,\n.code-area')
    const block =
      shared.trim().length > 0 ? shared : ruleBlock('.code-highlight, .code-area')
    declares(block, 'white-space', EDITOR_SCROLL_LAYOUT.whiteSpace)
  })
})

describe('CellEditor auto-grow guard', () => {
  it('does not set textarea height from scrollHeight', () => {
    assert.doesNotMatch(cellEditor, /scrollHeight/)
    assert.doesNotMatch(cellEditor, /style\.height\s*=/)
  })
})
