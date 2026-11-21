import { useMemo, useState } from 'react'
import type { WorkspaceApi } from '../../hooks/useWorkspace'
import { pathFromRoot } from '../../lib/projectFile'
import type { ProjectFile } from '../../types'

interface FilesPanelProps {
  api: WorkspaceApi
}

export function FilesPanel({ api }: FilesPanelProps) {
  const { state } = api
  const root = state.files[0]
  const [draftName, setDraftName] = useState<string | null>(null)

  const projectName = state.meta.name || root?.name || 'project'

  return (
    <div className="file-tree">
      <div className="file-project-head">
        {draftName !== null ? (
          <input
            className="file-project-name-input"
            value={draftName}
            aria-label="Project name"
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={() => {
              api.renameProject(draftName)
              setDraftName(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                api.renameProject(draftName)
                setDraftName(null)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraftName(null)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="file-project-name"
            title="Rename project"
            onClick={() => setDraftName(projectName)}
          >
            {projectName}
          </button>
        )}
        <span className="muted small mono file-ext-badge">.cello</span>
      </div>

      <p className="muted small file-script-line">
        Active script: <code>{state.scriptPath}</code>
      </p>

      {root ? (
        <FileNode
          node={root}
          depth={0}
          isRoot
          activePath={state.scriptPath}
          api={api}
          defaultOpen
        />
      ) : (
        <div className="empty-state">No project files yet.</div>
      )}
    </div>
  )
}

function FileNode({
  node,
  depth,
  isRoot,
  activePath,
  api,
  defaultOpen = false,
}: {
  node: ProjectFile
  depth: number
  isRoot?: boolean
  activePath: string
  api: WorkspaceApi
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen || depth < 2)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(node.name)
  const [adding, setAdding] = useState<'file' | 'folder' | null>(null)
  const [addName, setAddName] = useState('')

  const nodePath = useMemo(
    () => pathFromRoot(api.state.files, node.id),
    [api.state.files, node.id],
  )
  const isActive = node.kind === 'file' && nodePath === activePath

  const commitRename = () => {
    api.renameProjectFile(node.id, draft)
    setRenaming(false)
  }

  const commitAdd = () => {
    if (!adding) return
    api.addProjectFile(node.id, adding, addName || (adding === 'folder' ? 'folder' : 'untitled.txt'))
    setAdding(null)
    setAddName('')
    setOpen(true)
  }

  return (
    <div className={`file-node depth-${Math.min(depth, 4)}${isActive ? ' is-active' : ''}`}>
      <div className="file-row" style={{ paddingLeft: depth ? depth * 12 : 0 }}>
        {node.kind === 'folder' ? (
          <button
            type="button"
            className="file-twist"
            aria-expanded={open}
            aria-label={open ? 'Collapse folder' : 'Expand folder'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="file-twist is-leaf" aria-hidden>
            ·
          </span>
        )}

        {renaming ? (
          <input
            className="file-rename-input"
            value={draft}
            aria-label={`Rename ${node.kind}`}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(node.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={`file-label${isActive ? ' is-active' : ''}${isRoot ? ' is-root' : ''}`}
            onClick={() => {
              if (node.kind === 'folder') {
                setOpen((v) => !v)
                return
              }
              api.selectProjectFile(node.id)
            }}
            onDoubleClick={() => {
              setDraft(node.name)
              setRenaming(true)
            }}
            title={
              node.kind === 'file'
                ? `Set active script · double-click to rename`
                : `Double-click to rename`
            }
          >
            {node.name}
          </button>
        )}

        <div className="file-ops">
          {node.kind === 'folder' ? (
            <>
              <button
                type="button"
                title="New file"
                aria-label="New file"
                onClick={() => {
                  setAdding('file')
                  setAddName('')
                  setOpen(true)
                }}
              >
                +
              </button>
              <button
                type="button"
                title="New folder"
                aria-label="New folder"
                onClick={() => {
                  setAdding('folder')
                  setAddName('')
                  setOpen(true)
                }}
              >
                ▤
              </button>
            </>
          ) : null}
          {!isRoot ? (
            <button
              type="button"
              title="Delete"
              aria-label={`Delete ${node.name}`}
              onClick={() => api.deleteProjectFile(node.id)}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      {adding && node.kind === 'folder' ? (
        <div className="file-add-row" style={{ paddingLeft: (depth + 1) * 12 }}>
          <span className="muted small">{adding === 'folder' ? 'folder' : 'file'}</span>
          <input
            className="file-rename-input"
            value={addName}
            placeholder={adding === 'folder' ? 'folder-name' : 'name.ext'}
            aria-label={`New ${adding} name`}
            autoFocus
            onChange={(event) => setAddName(event.target.value)}
            onBlur={() => {
              if (addName.trim()) commitAdd()
              else setAdding(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitAdd()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setAdding(null)
              }
            }}
          />
        </div>
      ) : null}

      {node.kind === 'folder' && open && node.children && node.children.length > 0 ? (
        <div className="file-children">
          {node.children.map((child) => (
            <FileNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              api={api}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
