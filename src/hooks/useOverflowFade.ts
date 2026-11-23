import { useLayoutEffect, useState, type RefObject } from 'react'
import { canScrollFurther, canScrollFurtherRight } from '../lib/overflow'

export interface OverflowCues {
  moreBelow: boolean
  moreRight: boolean
}

/**
 * Tracks whether a scrollport has more content below / to the right of the
 * fold so panels and the editor can show edge shade cues instead of scrollbar
 * chrome. Mutation/Resize observers keep the cues in sync when DOM content
 * changes; pass `contentKey` for value-driven surfaces (e.g. a textarea).
 */
export function useOverflowFade(
  ref: RefObject<HTMLElement | null>,
  contentKey?: string | number,
): OverflowCues {
  const [cues, setCues] = useState<OverflowCues>({
    moreBelow: false,
    moreRight: false,
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      setCues({ moreBelow: false, moreRight: false })
      return
    }

    const update = () => {
      setCues({
        moreBelow: canScrollFurther(el),
        moreRight: canScrollFurtherRight(el),
      })
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
  }, [ref, contentKey])

  return cues
}
