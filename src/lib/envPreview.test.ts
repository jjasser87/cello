import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildJsEnvDetail,
  detailFromPreview,
  detailIsTooLarge,
  normalizeEnvDetail,
  resolveEnvPreviewName,
  toggleEnvPreview,
  truncateText,
} from './envPreview.ts'

describe('toggleEnvPreview', () => {
  it('opens a name when none selected', () => {
    assert.equal(toggleEnvPreview(null, 'x'), 'x')
  })

  it('switches to another name (one open at a time)', () => {
    assert.equal(toggleEnvPreview('x', 'y'), 'y')
  })

  it('collapses when clicking the open name again', () => {
    assert.equal(toggleEnvPreview('x', 'x'), null)
  })
})

describe('resolveEnvPreviewName', () => {
  it('keeps selection when binding still exists', () => {
    assert.equal(resolveEnvPreviewName('df', ['a', 'df', 'n']), 'df')
  })

  it('clears selection when binding disappears', () => {
    assert.equal(resolveEnvPreviewName('gone', ['a', 'b']), null)
  })

  it('leaves null alone', () => {
    assert.equal(resolveEnvPreviewName(null, ['a']), null)
  })
})

describe('buildJsEnvDetail', () => {
  it('scalars and vectors', () => {
    assert.deepEqual(buildJsEnvDetail(42), { form: 'scalar', text: '42' })
    assert.deepEqual(buildJsEnvDetail(true), { form: 'scalar', text: 'true' })
    const vec = buildJsEnvDetail([1, 2, 3])
    assert.equal(vec.form, 'vector')
    if (vec.form === 'vector') {
      assert.deepEqual(vec.values, ['1', '2', '3'])
      assert.equal(vec.truncated, false)
      assert.equal(vec.total, 3)
    }
  })

  it('truncates large vectors with too-large cue', () => {
    const big = Array.from({ length: 100 }, (_, i) => i)
    const detail = buildJsEnvDetail(big)
    assert.equal(detail.form, 'vector')
    if (detail.form === 'vector') {
      assert.equal(detail.values.length, 40)
      assert.equal(detail.truncated, true)
      assert.equal(detail.total, 100)
      assert.equal(detailIsTooLarge(detail), true)
    }
  })

  it('lists object keys', () => {
    const detail = buildJsEnvDetail({ a: 1, b: 'x' })
    assert.equal(detail.form, 'list')
    if (detail.form === 'list') {
      assert.equal(detail.total, 2)
      assert.equal(detail.entries[0]?.name, 'a')
    }
  })

  it('marks oversized strings as too large', () => {
    const detail = buildJsEnvDetail('x'.repeat(3000))
    assert.equal(detail.form, 'summary')
    if (detail.form === 'summary') {
      assert.equal(detail.tooLarge, true)
      assert.ok(detail.text.endsWith('…'))
    }
  })
})

describe('normalizeEnvDetail', () => {
  it('parses table payloads from the kernel', () => {
    const detail = normalizeEnvDetail({
      form: 'table',
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'a' }],
      truncated: false,
      totalRows: 1,
      totalCols: 2,
    })
    assert.equal(detail?.form, 'table')
    if (detail?.form === 'table') {
      assert.deepEqual(detail.columns, ['id', 'name'])
      assert.equal(detail.rows[0]?.id, 1)
    }
  })

  it('returns undefined for unknown forms', () => {
    assert.equal(normalizeEnvDetail({ form: 'nope' }), undefined)
    assert.equal(normalizeEnvDetail(null), undefined)
  })
})

describe('detailFromPreview / truncateText', () => {
  it('falls back to scalar preview text', () => {
    assert.deepEqual(detailFromPreview('1.5', 'number'), {
      form: 'scalar',
      text: '1.5',
    })
    assert.deepEqual(detailFromPreview('function()', 'function'), {
      form: 'function',
      text: 'function()',
    })
  })

  it('truncateText marks overflow', () => {
    assert.deepEqual(truncateText('abc', 10), { text: 'abc', truncated: false })
    assert.deepEqual(truncateText('abcdefghij', 5), { text: 'abcd…', truncated: true })
  })
})
