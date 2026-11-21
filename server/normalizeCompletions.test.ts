import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeCompletions } from './normalizeKernelResult.ts'

describe('normalizeCompletions', () => {
  it('maps object items and prefix', () => {
    const result = normalizeCompletions({
      prefix: 'me',
      items: [
        { label: 'mean', kind: 'function' },
        { label: 'median', kind: 'function' },
        { label: '  ', kind: 'symbol' },
        'sum',
      ],
    })
    assert.equal(result.prefix, 'me')
    assert.deepEqual(result.items, [
      { label: 'mean', kind: 'function' },
      { label: 'median', kind: 'function' },
      { label: 'sum', kind: 'symbol' },
    ])
  })

  it('tolerates missing fields', () => {
    const result = normalizeCompletions({})
    assert.deepEqual(result, { items: [], prefix: '', error: undefined })
  })
})
