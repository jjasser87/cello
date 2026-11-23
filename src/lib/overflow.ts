/**
 * Whether a scrollport still has content below the visible fold.
 * Used for helper-panel and editor bottom fade cues.
 */
export function canScrollFurther(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  epsilon = 1,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight > epsilon
}

/**
 * Whether a scrollport still has content past the right edge.
 * Used for the editor horizontal overflow shade.
 */
export function canScrollFurtherRight(
  el: { scrollWidth: number; scrollLeft: number; clientWidth: number },
  epsilon = 1,
): boolean {
  return el.scrollWidth - el.scrollLeft - el.clientWidth > epsilon
}
