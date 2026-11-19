import type { PanelId } from '../types'

const ITEMS: { id: PanelId; label: string; hint: string }[] = [
  { id: 'cells', label: 'Cells', hint: 'Order & focus' },
  { id: 'history', label: 'History', hint: 'Diffs & runs' },
  { id: 'plot', label: 'Plot', hint: 'Charts' },
  { id: 'files', label: 'Files', hint: 'Project tree' },
  { id: 'env', label: 'Env', hint: 'Bindings' },
  { id: 'data', label: 'Data', hint: 'Tables' },
  { id: 'structure', label: 'Flow', hint: 'Script structure' },
  { id: 'ai', label: 'Agent', hint: 'Ask with context' },
]

interface TopNavProps {
  active: PanelId
  expanded: boolean
  onSelect: (id: PanelId) => void
  onToggleExpand: () => void
}

export function TopNav({ active, expanded, onSelect, onToggleExpand }: TopNavProps) {
  return (
    <header className={`top-nav ${expanded ? 'is-expanded' : ''}`}>
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden>
          <span />
        </div>
        <div>
          <div className="brand-name">Cello</div>
          <div className="brand-tag">One cell. Full focus.</div>
        </div>
      </div>

      <nav className="mode-rail" aria-label="Workspace options">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mode-chip ${active === item.id ? 'is-active' : ''}`}
            onClick={() => {
              onSelect(item.id)
              if (!expanded) onToggleExpand()
            }}
            title={item.hint}
          >
            <span className="mode-label">{item.label}</span>
            <span className="mode-hint">{item.hint}</span>
          </button>
        ))}
      </nav>

      <button
        type="button"
        className="expand-toggle"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        title="Expand navigation"
      >
        {expanded ? 'Collapse' : 'Expand'}
      </button>
    </header>
  )
}
