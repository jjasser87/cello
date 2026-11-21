import type {
  ExplanationComment,
  KernelLanguage,
  PanelId,
  ProjectFile,
  ProjectMeta,
  WorkspaceState,
} from '../types.ts'
import { ensureExplanation } from './explanation.ts'

export type { ProjectMeta }

export const PROJECT_FORMAT = 'cello-project' as const
export const PROJECT_VERSION = 1 as const
export const PROJECT_EXTENSION = '.cello'

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function defaultScriptPath(language: KernelLanguage): string {
  return language === 'r' ? 'analysis.R' : 'analysis.js'
}

export type PersistedCell = {
  id: string
  name: string
  code: string
  explanation?: string
  comments?: ExplanationComment[]
}

/** Durable on-disk / downloadable project document. */
export interface CelloProjectV1 {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  meta: ProjectMeta
  language: KernelLanguage
  scriptPath: string
  activeCellId: string
  activePanel: PanelId
  cells: PersistedCell[]
  files: ProjectFile[]
}

export type CelloProject = CelloProjectV1

const PANEL_IDS: PanelId[] = [
  'cells',
  'explain',
  'history',
  'plot',
  'files',
  'env',
  'data',
  'structure',
  'ai',
  'console',
]

export function defaultProjectName(): string {
  return 'project'
}

export function defaultProjectFiles(
  name = defaultProjectName(),
  language: KernelLanguage = 'r',
): ProjectFile[] {
  const script = defaultScriptPath(language)
  const sibling =
    language === 'r'
      ? { id: createId('file'), name: 'analysis.js', kind: 'file' as const }
      : { id: createId('file'), name: 'analysis.R', kind: 'file' as const }

  return [
    {
      id: createId('folder'),
      name: name.trim() || defaultProjectName(),
      kind: 'folder',
      children: [
        { id: createId('file'), name: script, kind: 'file' },
        sibling,
        { id: createId('file'), name: 'README.md', kind: 'file' },
        {
          id: createId('folder'),
          name: 'data',
          kind: 'folder',
          children: [
            { id: createId('file'), name: 'sales.csv', kind: 'file' },
            { id: createId('file'), name: 'notes.txt', kind: 'file' },
          ],
        },
      ],
    },
  ]
}

export function projectFileName(metaName: string): string {
  const base = (metaName.trim() || defaultProjectName())
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return `${base || 'project'}${PROJECT_EXTENSION}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeComments(raw: unknown): ExplanationComment[] {
  if (!Array.isArray(raw)) return []
  const out: ExplanationComment[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || typeof item.body !== 'string') continue
    if (typeof item.createdAt !== 'number') continue
    const author =
      typeof item.author === 'string' && item.author.length > 0 ? item.author : 'user'
    out.push({ id: item.id, body: item.body, createdAt: item.createdAt, author })
  }
  return out
}

function normalizeCell(raw: unknown): PersistedCell | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.code !== 'string') {
    return null
  }
  return {
    id: raw.id,
    name: raw.name,
    code: raw.code,
    explanation: typeof raw.explanation === 'string' ? raw.explanation : undefined,
    comments: normalizeComments(raw.comments),
  }
}

function normalizeFileNode(raw: unknown): ProjectFile | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  if (raw.kind !== 'file' && raw.kind !== 'folder') return null
  const node: ProjectFile = { id: raw.id, name: raw.name, kind: raw.kind }
  if (raw.kind === 'folder') {
    const children = Array.isArray(raw.children)
      ? raw.children.map(normalizeFileNode).filter((n): n is ProjectFile => n !== null)
      : []
    node.children = children
  }
  return node
}

function normalizeMeta(raw: unknown, files: ProjectFile[]): ProjectMeta {
  const now = Date.now()
  const rootName = files[0]?.name?.trim() || defaultProjectName()
  if (!isRecord(raw)) {
    return { name: rootName, createdAt: now, updatedAt: now }
  }
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : rootName,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

function normalizeLanguage(raw: unknown, scriptPath: string): KernelLanguage {
  if (raw === 'r' || raw === 'javascript') return raw
  if (scriptPath.toLowerCase().endsWith('.r')) return 'r'
  if (scriptPath.toLowerCase().endsWith('.js')) return 'javascript'
  return 'r'
}

function normalizePanel(raw: unknown): PanelId {
  return typeof raw === 'string' && PANEL_IDS.includes(raw as PanelId)
    ? (raw as PanelId)
    : 'cells'
}

/**
 * Parse a `.cello` document (string or already-parsed JSON).
 * Accepts v1 envelopes and legacy v0 localStorage payloads.
 */
export function parseProject(
  input: string | unknown,
): { ok: true; project: CelloProjectV1 } | { ok: false; error: string } {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input) as unknown
    } catch {
      return { ok: false, error: 'Invalid JSON' }
    }
  }
  if (!isRecord(data)) return { ok: false, error: 'Project root must be an object' }

  // Legacy localStorage v0 (no format field) — migrate in place.
  if (data.format == null && Array.isArray(data.cells)) {
    return { ok: true, project: migrateLegacyPayload(data) }
  }

  if (data.format !== PROJECT_FORMAT) {
    return { ok: false, error: `Unknown project format: ${String(data.format)}` }
  }
  if (data.version !== 1) {
    return { ok: false, error: `Unsupported project version: ${String(data.version)}` }
  }

  const cells = Array.isArray(data.cells)
    ? data.cells.map(normalizeCell).filter((c): c is PersistedCell => c !== null)
    : []
  if (cells.length === 0) {
    return { ok: false, error: 'Project must include at least one cell' }
  }

  const filesRaw = Array.isArray(data.files) ? data.files : []
  let files = filesRaw.map(normalizeFileNode).filter((n): n is ProjectFile => n !== null)
  if (files.length === 0) {
    files = defaultProjectFiles(
      typeof data.meta === 'object' &&
        data.meta !== null &&
        'name' in data.meta &&
        typeof (data.meta as { name: unknown }).name === 'string'
        ? (data.meta as { name: string }).name
        : defaultProjectName(),
      normalizeLanguage(data.language, typeof data.scriptPath === 'string' ? data.scriptPath : ''),
    )
  }

  const scriptPath =
    typeof data.scriptPath === 'string' && data.scriptPath.trim()
      ? data.scriptPath
      : defaultScriptPath(normalizeLanguage(data.language, ''))
  const language = normalizeLanguage(data.language, scriptPath)
  const activeCellId =
    typeof data.activeCellId === 'string' && cells.some((c) => c.id === data.activeCellId)
      ? data.activeCellId
      : cells[0].id

  const meta = normalizeMeta(data.meta, files)
  // Keep root folder name aligned with meta.name.
  if (files[0]?.kind === 'folder' && files[0].name !== meta.name) {
    files = [{ ...files[0], name: meta.name }, ...files.slice(1)]
  }

  return {
    ok: true,
    project: {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      meta,
      language,
      scriptPath,
      activeCellId,
      activePanel: normalizePanel(data.activePanel),
      cells,
      files,
    },
  }
}

function migrateLegacyPayload(data: Record<string, unknown>): CelloProjectV1 {
  const cells = Array.isArray(data.cells)
    ? data.cells.map(normalizeCell).filter((c): c is PersistedCell => c !== null)
    : []
  const scriptPath =
    typeof data.scriptPath === 'string' && data.scriptPath.trim()
      ? data.scriptPath
      : defaultScriptPath(normalizeLanguage(data.language, ''))
  const language = normalizeLanguage(data.language, scriptPath)
  const safeCells =
    cells.length > 0
      ? cells
      : [
          {
            id: createId('cell'),
            name: 'Untitled',
            code: '',
            explanation: ensureExplanation(''),
            comments: [],
          },
        ]
  const files = defaultProjectFiles(defaultProjectName(), language)
  const now = Date.now()
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    meta: { name: defaultProjectName(), createdAt: now, updatedAt: now },
    language,
    scriptPath,
    activeCellId:
      typeof data.activeCellId === 'string' &&
      safeCells.some((c) => c.id === data.activeCellId)
        ? data.activeCellId
        : safeCells[0].id,
    activePanel: normalizePanel(data.activePanel),
    cells: safeCells,
    files,
  }
}

/** Build a v1 project document from live workspace state. */
export function serializeProject(
  state: Pick<
    WorkspaceState,
    'cells' | 'activeCellId' | 'activePanel' | 'language' | 'scriptPath' | 'files'
  > & { meta?: ProjectMeta },
  now = Date.now(),
): CelloProjectV1 {
  const rootName = state.files[0]?.name?.trim() || defaultProjectName()
  const meta: ProjectMeta = {
    name: state.meta?.name?.trim() || rootName,
    createdAt: state.meta?.createdAt ?? now,
    updatedAt: now,
  }
  const files =
    state.files[0]?.kind === 'folder' && state.files[0].name !== meta.name
      ? [{ ...state.files[0], name: meta.name }, ...state.files.slice(1)]
      : state.files.length > 0
        ? state.files
        : defaultProjectFiles(meta.name, state.language)

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    meta,
    language: state.language,
    scriptPath: state.scriptPath,
    activeCellId: state.activeCellId,
    activePanel: state.activePanel,
    cells: state.cells.map(({ id, name, code, explanation, comments }) => ({
      id,
      name,
      code,
      explanation: explanation ?? ensureExplanation(''),
      comments: comments ?? [],
    })),
    files,
  }
}

export function stringifyProject(project: CelloProjectV1): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

export function hydratePersistedCell(cell: PersistedCell): {
  id: string
  name: string
  code: string
  explanation: string
  comments: ExplanationComment[]
  status: 'idle'
} {
  return {
    id: cell.id,
    name: cell.name,
    code: cell.code,
    explanation: ensureExplanation(cell.explanation),
    comments: Array.isArray(cell.comments) ? cell.comments : [],
    status: 'idle',
  }
}

/** Immutable helpers for the project file tree. */
export function renameFileNode(
  nodes: ProjectFile[],
  id: string,
  name: string,
): ProjectFile[] {
  const trimmed = name.trim()
  if (!trimmed) return nodes
  return nodes.map((node) => {
    if (node.id === id) return { ...node, name: trimmed }
    if (node.children) {
      return { ...node, children: renameFileNode(node.children, id, trimmed) }
    }
    return node
  })
}

export function addFileChild(
  nodes: ProjectFile[],
  parentId: string,
  kind: 'file' | 'folder',
  name: string,
): ProjectFile[] {
  const trimmed = name.trim()
  if (!trimmed) return nodes
  const child: ProjectFile = {
    id: createId(kind === 'folder' ? 'folder' : 'file'),
    name: trimmed,
    kind,
    ...(kind === 'folder' ? { children: [] } : {}),
  }
  return nodes.map((node) => {
    if (node.id === parentId && node.kind === 'folder') {
      return { ...node, children: [...(node.children ?? []), child] }
    }
    if (node.children) {
      return { ...node, children: addFileChild(node.children, parentId, kind, trimmed) }
    }
    return node
  })
}

export function deleteFileNode(nodes: ProjectFile[], id: string): ProjectFile[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) =>
      node.children
        ? { ...node, children: deleteFileNode(node.children, id) }
        : node,
    )
}

export function findFileNode(nodes: ProjectFile[], id: string): ProjectFile | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findFileNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Path relative to the project root folder (root name omitted).
 * Root folder itself returns `""`; missing id returns `null`.
 */
export function pathFromRoot(nodes: ProjectFile[], id: string): string | null {
  const walk = (list: ProjectFile[], parts: string[]): string | null => {
    for (const node of list) {
      const here = [...parts, node.name]
      if (node.id === id) return here.join('/')
      if (node.children) {
        const found = walk(node.children, here)
        if (found !== null) return found
      }
    }
    return null
  }

  if (nodes[0]?.id === id) return ''
  if (!nodes[0]?.children) return null
  // Skip the root folder name so scriptPath stays like `analysis.R` / `data/notes.txt`.
  return walk(nodes[0].children, [])
}
