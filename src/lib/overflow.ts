/**
 * Whether a scrollport still has content below the visible fold.
 * Used for the helper-panel bottom fade cue.
 */
export function canScrollFurther(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  epsilon = 1,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight > epsilon
}
