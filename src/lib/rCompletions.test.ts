import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BASE_R_SYMBOLS,
  localCompletions,
  tokenBeforeCursor,
} from './rCompletions.ts'

describe('tokenBeforeCursor', () => {
  it('finds a plain identifier prefix', () => {
    const code = 'mean(x) + da'
    const at = code.length
    assert.deepEqual(tokenBeforeCursor(code, at), { prefix: 'da', trigger: 'ident' })
  })

  it('detects dollar member context', () => {
    const code = 'sales$'
    assert.deepEqual(tokenBeforeCursor(code, code.length), {
      prefix: '',
      trigger: 'dollar',
    })
    assert.deepEqual(tokenBeforeCursor('sales$pr', 8), {
      prefix: 'pr',
      trigger: 'dollar',
    })
  })

  it('detects namespace :: context', () => {
    assert.deepEqual(tokenBeforeCursor('jsonlite::', 10), {
      prefix: '',
      trigger: 'ns',
    })
    assert.deepEqual(tokenBeforeCursor('stats::lm', 9), {
      prefix: 'lm',
      trigger: 'ns',
    })
  })
})

describe('localCompletions', () => {
  it('filters env bindings and base symbols by prefix', () => {
    const result = localCompletions('me', 2, [
      { name: 'mean_sales', kind: 'number', preview: '1' },
      { name: 'other', kind: 'string', preview: '"x"' },
    ])
    const labels = result.items.map((item) => item.label)
    assert.ok(labels.includes('mean_sales'))
    assert.ok(labels.includes('mean'))
    assert.ok(labels.includes('median'))
    assert.ok(!labels.includes('other'))
    assert.equal(result.fromKernel, false)
  })

  it('returns empty for dollar context without a kernel', () => {
    const result = localCompletions('df$', 3, [
      { name: 'df', kind: 'object', preview: 'data.frame' },
    ])
    assert.deepEqual(result.items, [])
  })

  it('exposes a non-empty base symbol list', () => {
    assert.ok(BASE_R_SYMBOLS.length > 40)
    assert.ok(BASE_R_SYMBOLS.includes('data.frame'))
  })
})
