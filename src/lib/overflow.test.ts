import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canScrollFurther, canScrollFurtherRight } from './overflow.ts'

describe('canScrollFurther', () => {
  it('is false when content fits', () => {
    assert.equal(
      canScrollFurther({ scrollHeight: 200, scrollTop: 0, clientHeight: 200 }),
      false,
    )
  })

  it('is true when content extends below the fold', () => {
    assert.equal(
      canScrollFurther({ scrollHeight: 400, scrollTop: 0, clientHeight: 200 }),
      true,
    )
  })

  it('is false when scrolled to the bottom', () => {
    assert.equal(
      canScrollFurther({ scrollHeight: 400, scrollTop: 200, clientHeight: 200 }),
      false,
    )
  })

  it('ignores 1px subpixel remainder', () => {
    assert.equal(
      canScrollFurther({ scrollHeight: 201, scrollTop: 0, clientHeight: 200 }),
      false,
    )
  })
})

describe('canScrollFurtherRight', () => {
  it('is false when content fits horizontally', () => {
    assert.equal(
      canScrollFurtherRight({ scrollWidth: 200, scrollLeft: 0, clientWidth: 200 }),
      false,
    )
  })

  it('is true when content extends past the right edge', () => {
    assert.equal(
      canScrollFurtherRight({ scrollWidth: 400, scrollLeft: 0, clientWidth: 200 }),
      true,
    )
  })

  it('is false when scrolled to the right edge', () => {
    assert.equal(
      canScrollFurtherRight({ scrollWidth: 400, scrollLeft: 200, clientWidth: 200 }),
      false,
    )
  })

  it('ignores 1px subpixel remainder', () => {
    assert.equal(
      canScrollFurtherRight({ scrollWidth: 201, scrollLeft: 0, clientWidth: 200 }),
      false,
    )
  })
})
