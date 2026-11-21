import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeResult } from './normalizeKernelResult.ts'

describe('normalizeResult plot payloads', () => {
  it('accepts native image plots with data URLs', () => {
    const result = normalizeResult({
      logs: [],
      env: [],
      plot: {
        title: 'Plot',
        kind: 'image',
        imageData: 'data:image/png;base64,aaa',
        labels: [],
        values: [],
        cellId: 'c1',
      },
    })
    assert.equal(result.plot?.kind, 'image')
    assert.equal(result.plot?.imageData, 'data:image/png;base64,aaa')
    assert.deepEqual(result.plot?.labels, [])
    assert.deepEqual(result.plot?.values, [])
    assert.equal(result.plot?.cellId, 'c1')
  })

  it('rejects image plots without a data URL', () => {
    const result = normalizeResult({
      logs: [],
      env: [],
      plot: {
        kind: 'image',
        imageData: 'http://example.com/x.png',
        labels: [],
        values: [],
      },
    })
    assert.equal(result.plot, null)
  })

  it('still accepts structured cello.plot bar/line payloads', () => {
    const result = normalizeResult({
      logs: [],
      env: [],
      plot: {
        title: 'Monthly',
        kind: 'line',
        labels: ['a', 'b'],
        values: [1, 2],
      },
    })
    assert.equal(result.plot?.kind, 'line')
    assert.deepEqual(result.plot?.labels, ['a', 'b'])
    assert.deepEqual(result.plot?.values, [1, 2])
    assert.equal(result.plot?.imageData, undefined)
  })
})
