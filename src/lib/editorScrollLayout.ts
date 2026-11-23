/**
 * Layout contract for the main cell editor writing surface.
 *
 * Height and width stay fixed to the interface (80ch × ribbon track).
 * Extra lines and columns scroll inside `.code-area` — they must not grow
 * the workspace cluster or the Electron window.
 */
export const EDITOR_SCROLL_LAYOUT = {
  writingWidth: '80ch',
  maxWritingWidth: '80ch',
  frameHeight: 'max(220px, var(--ribbon-track-min))',
  overflow: 'auto',
  whiteSpace: 'pre',
} as const
