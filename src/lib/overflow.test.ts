import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canScrollFurther } from './overflow.ts'

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
