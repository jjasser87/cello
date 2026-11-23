import { useLayoutEffect, useState, type RefObject } from 'react'
import { canScrollFurther } from '../lib/overflow'

/**
 * Tracks whether a scrollport has more content below the fold so the helper
 * panel can show a bottom fade cue. Mutation/Resize observers keep the cue
 * in sync when panel content changes.
 */
export function useOverflowFade(ref: RefObject<HTMLElement | null>): boolean {
  const [moreBelow, setMoreBelow] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      setMoreBelow(false)
      return
    }

    const update = () => {
      setMoreBelow(canScrollFurther(el))
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(update)
        : null
    mo?.observe(el, { childList: true, subtree: true, characterData: true })

    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [ref])

  return moreBelow
}
