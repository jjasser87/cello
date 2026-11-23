import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PanelExpandOverlayProps {
  /** Accessible name for the dialog. */
  label: string
  /** Short title shown in the toolbar (left). */
  title?: ReactNode
  /** Optional controls between title and Close (e.g. zoom). */
  toolbar?: ReactNode
  onClose: () => void
  children: ReactNode
}

/**
 * Large modal overlay for ribbon helper panels (Plot / Flow / Data).
 * Works in both Vite web and Electron — portals to document.body so the
 * fixed-size ribbon layout is unchanged when closed.
 */
export function PanelExpandOverlay({
  label,
  title,
  toolbar,
  onClose,
  children,
}: PanelExpandOverlayProps) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return createPortal(
    <div
      className="panel-expand-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="panel-expand-panel">
        <div className="panel-expand-toolbar">
          {title ? <div className="panel-expand-title">{title}</div> : null}
          {toolbar ? <div className="panel-expand-tools">{toolbar}</div> : null}
          <button type="button" className="panel-expand-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="panel-expand-scroll">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

interface PanelExpandButtonProps {
  onClick: () => void
  label?: string
  title?: string
}

/** Compact Expand control aligned with Flow’s preview tools. */
export function PanelExpandButton({
  onClick,
  label = 'Expand',
  title = 'Open in larger window',
}: PanelExpandButtonProps) {
  return (
    <button
      type="button"
      className="panel-expand-btn"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {label}
    </button>
  )
}
