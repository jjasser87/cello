import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeRSource } from './normalizeRSource.ts'

describe('normalizeRSource', () => {
  it('leaves LF-only source unchanged', () => {
    assert.equal(normalizeRSource('1+1\nprint("hi")\n'), '1+1\nprint("hi")\n')
  })

  it('converts CRLF to LF so R parse can accept the source', () => {
    assert.equal(normalizeRSource('1+1\r\nprint("hi")\r\n'), '1+1\nprint("hi")\n')
  })

  it('converts bare CR to LF', () => {
    assert.equal(normalizeRSource('1+1\rprint("hi")'), '1+1\nprint("hi")')
  })

  it('strips a leading UTF-8 BOM', () => {
    assert.equal(normalizeRSource('\uFEFF1+1'), '1+1')
  })

  it('strips BOM and normalizes CRLF together', () => {
    assert.equal(normalizeRSource('\uFEFFx <- 1\r\ny <- 2\r\n'), 'x <- 1\ny <- 2\n')
  })
})
