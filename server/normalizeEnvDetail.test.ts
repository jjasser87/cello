import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeResult } from './normalizeKernelResult.ts'

describe('normalizeResult env detail', () => {
  it('preserves truncated detail on env bindings', () => {
    const result = normalizeResult({
      logs: [],
      plot: null,
      table: null,
      env: [
        {
          name: 'xs',
          kind: 'array',
          preview: 'double[100]',
          detail: {
            form: 'vector',
            values: ['1', '2'],
            truncated: true,
            total: 100,
          },
        },
        {
          name: 'n',
          kind: 'number',
          preview: '3',
          detail: { form: 'scalar', text: '3' },
        },
      ],
    })

    assert.equal(result.env.length, 2)
    assert.equal(result.env[0]?.name, 'xs')
    assert.deepEqual(result.env[0]?.detail, {
      form: 'vector',
      values: ['1', '2'],
      truncated: true,
      total: 100,
    })
    assert.deepEqual(result.env[1]?.detail, { form: 'scalar', text: '3' })
  })

  it('allows bindings without detail', () => {
    const result = normalizeResult({
      logs: [],
      env: [{ name: 'a', kind: 'number', preview: '1' }],
    })
    assert.equal(result.env[0]?.detail, undefined)
  })
})
