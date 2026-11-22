import { useEffect } from 'react'
import {
  getDesktopApi,
  markDesktopDocument,
  measureDesktopFitSize,
} from '../lib/desktop'

export type DesktopFitLayoutKey = {
  sidePanelOpen: boolean
  activePanel: string
  cellId: string
  codeLength: number
}

/**
 * In the Electron shell, keep the OS window content size matched to the
 * editor cluster. Web (`npm run dev`) is unchanged.
 */
export function useDesktopWindowFit(layout: DesktopFitLayoutKey): void {
  const { sidePanelOpen, activePanel, cellId, codeLength } = layout

  useEffect(() => {
    const api = getDesktopApi()
    if (!api) return

    markDesktopDocument()

    let lastW = 0
    let lastH = 0
    let raf = 0
    let disposed = false

    const publish = () => {
      if (disposed) return
      const size = measureDesktopFitSize()
      if (!size) return
      // Ignore 1px jitter from subpixel layout / DPI.
      if (Math.abs(size.width - lastW) <= 1 && Math.abs(size.height - lastH) <= 1) {
        return
      }
      lastW = size.width
      lastH = size.height
      void api.setContentSize(size.width, size.height)
    }

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        publish()
      })
    }

    schedule()
    // Panel open/close animates (~240ms); remeasure after the transition.
    const afterAnim = window.setTimeout(schedule, 280)

    const cluster = document.querySelector('.workspace-cluster')
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null
    if (cluster && observer) observer.observe(cluster)

    const lane = document.querySelector('.workspace-lane')
    if (lane && observer) observer.observe(lane)

    window.addEventListener('resize', schedule)

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.clearTimeout(afterAnim)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [sidePanelOpen, activePanel, cellId, codeLength])
}
