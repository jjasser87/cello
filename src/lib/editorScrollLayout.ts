/**
 * Layout contract for the main cell editor writing surface.
 *
 * Height and width stay fixed to the interface (80ch × ribbon track).
 * Extra lines and columns scroll inside `.code-area` — they must not grow
 * the workspace cluster or the Electron window. Scrollbar chrome stays
 * hidden; edge shades cue that more content can be scrolled.
 */
export const EDITOR_SCROLL_LAYOUT = {
  writingWidth: '80ch',
  maxWritingWidth: '80ch',
  frameHeight: 'max(220px, var(--ribbon-track-min))',
  overflow: 'auto',
  whiteSpace: 'pre',
  scrollbarWidth: 'none',
} as const
