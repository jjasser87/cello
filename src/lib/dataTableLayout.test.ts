import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DATA_TABLE_LAYOUT } from './dataTableLayout.ts'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../index.css')
/** Normalize CRLF so Windows CI matches the same selectors as local LF checkouts. */
const css = readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n')

function ruleBlock(selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'm',
  )
  const match = css.match(pattern)
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

describe('DATA_TABLE_LAYOUT', () => {
  it('prefers content-sized columns with nowrap cells', () => {
    assert.equal(DATA_TABLE_LAYOUT.tableWidth, 'max-content')
    assert.equal(DATA_TABLE_LAYOUT.cellWhiteSpace, 'nowrap')
    assert.equal(DATA_TABLE_LAYOUT.scrollOverflowX, 'auto')
  })
})

describe('data table CSS contract', () => {
  it('sizes .data-table from content, not a forced 100% shrink', () => {
    const block = ruleBlock('.data-table')
    declares(block, 'width', DATA_TABLE_LAYOUT.tableWidth)
    declares(block, 'min-width', DATA_TABLE_LAYOUT.tableMinWidth)
    declares(block, 'table-layout', DATA_TABLE_LAYOUT.tableLayout)
    assert.doesNotMatch(block, /(?<![\w-])width\s*:\s*100%\s*;/)
  })

  it('keeps typical cell strings on one line with a reasonable max width', () => {
    const block = ruleBlock('.data-table th,\n.data-table td')
    // Selector may be written on one or two lines; try both.
    const cellBlock =
      block.trim().length > 0
        ? block
        : ruleBlock('.data-table th, .data-table td')
    declares(cellBlock, 'white-space', DATA_TABLE_LAYOUT.cellWhiteSpace)
    declares(cellBlock, 'max-width', DATA_TABLE_LAYOUT.cellMaxWidth)
  })

  it('scrolls wide tables horizontally inside .table-scroll', () => {
    const block = ruleBlock('.table-scroll')
    declares(block, 'overflow-x', DATA_TABLE_LAYOUT.scrollOverflowX)
  })
})
