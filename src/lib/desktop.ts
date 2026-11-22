/**
 * Desktop (Electron) helpers. No-ops in the browser (`npm run dev`).
 */

export type CelloDesktopApi = {
  isDesktop: true
  setContentSize: (width: number, height: number) => Promise<unknown>
  minimize: () => Promise<unknown>
  maximizeToggle: () => Promise<unknown>
  close: () => Promise<unknown>
}

declare global {
  interface Window {
    celloDesktop?: CelloDesktopApi
  }
}

export function getDesktopApi(): CelloDesktopApi | null {
  if (typeof window === 'undefined') return null
  const api = window.celloDesktop
  return api?.isDesktop ? api : null
}

export function isDesktopShell(): boolean {
  return getDesktopApi() !== null
}

/** Mark <html> so CSS can drop 100vh fill and hug content in the desktop shell. */
export function markDesktopDocument(): void {
  if (!isDesktopShell()) return
  if (typeof document === 'undefined') return
  document.documentElement.classList.add('is-desktop')
}

/**
 * Measure the editor cluster (+ workspace padding + title drag strip) so the
 * OS window can hug the cell and grow/shrink with ribbon panels.
 */
export function measureDesktopFitSize(): { width: number; height: number } | null {
  if (typeof document === 'undefined') return null
  const cluster = document.querySelector('.workspace-cluster')
  if (!(cluster instanceof HTMLElement)) return null

  const clusterRect = cluster.getBoundingClientRect()
  const workspace = document.querySelector('.workspace')
  let padX = 0
  let padY = 0
  if (workspace instanceof HTMLElement) {
    const styles = getComputedStyle(workspace)
    padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0)
    padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
  }

  const drag = document.querySelector('.window-chrome-drag')
  const dragH =
    drag instanceof HTMLElement ? drag.getBoundingClientRect().height : 0

  // ceil avoids subpixel clipping under DPI scaling.
  const width = Math.ceil(clusterRect.width + padX)
  const height = Math.ceil(dragH + clusterRect.height + padY)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < 200 || height < 200) return null
  return { width, height }
}
