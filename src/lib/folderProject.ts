/**
 * Folder-as-project (structure B): lean `cello.json` + `.cello/` sidecar.
 *
 * Code primary lives in the manifest. On Save we also mirror cell sources into
 * a real kernel file (e.g. `analysis.R`) so the File panel / disk stay in sync.
 * Run artifacts under `.cello/runs` are opt-in. Polyglot multi-kernel cells are
 * future-only — one `language` per project.
 */
import type { KernelLanguage, PanelId, ProjectMeta } from '../types.ts'
import {
  PROJECT_FORMAT,
  defaultProjectName,
  hydratePersistedCell,
  parseProject,
  serializeProject,
  stringifyProject,
  type CelloProjectV1,
  type PersistedCell,
} from './projectFile.ts'
import { ensureExplanation } from './explanation.ts'

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function defaultScriptPath(language: KernelLanguage): string {
  return language === 'r' ? 'analysis.R' : 'analysis.js'
}

/** Kernel source extensions — adapters add rows here; layout stays language-agnostic. */
const SOURCE_EXTENSIONS: Record<KernelLanguage, readonly string[]> = {
  r: ['.R', '.r'],
  javascript: ['.js', '.mjs', '.cjs'],
}

function starterCells(language: KernelLanguage): PersistedCell[] {
  const id = createId('cell')
  const code =
    language === 'r'
      ? '# %% Untitled\nx <- 1:5\nx\n'
      : '// %% Untitled\nconst x = [1, 2, 3]\nx\n'
  return [
    {
      id,
      name: 'Untitled',
      code,
      explanation: ensureExplanation(''),
      comments: [],
    },
  ]
}

export const MANIFEST_NAME = 'cello.json'
export const SIDECAR_DIR = '.cello'
export const ARTIFACTS_DIR = '.cello'
export const PROJECT_VERSION_FOLDER = 2 as const

/** Lean on-disk manifest (structure B). `files` is omitted — File panel lists disk. */
export type CelloProjectV2 = {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION_FOLDER
  meta: ProjectMeta
  language: KernelLanguage
  /** Relative path hint (active script); not a virtual tree. */
  scriptPath: string
  activeCellId: string
  activePanel: PanelId
  cells: PersistedCell[]
  /** Sidecar directory for histories / runs / ui (default `.cello`). */
  artifactsDir: string
}

export type FolderUiState = {
  activeCellId?: string
  activePanel?: PanelId
  helperDock?: string
  saveOutputs?: boolean
  hideSidecar?: boolean
}

export function isSidecarName(name: string): boolean {
  return name === SIDECAR_DIR || name === '.cello'
}

export function manifestPath(folderRoot: string): string {
  const sep = folderRoot.includes('\\') && !folderRoot.includes('/') ? '\\' : '/'
  return `${folderRoot.replace(/[/\\]+$/, '')}${sep}${MANIFEST_NAME}`
}

export function sidecarPath(folderRoot: string, ...parts: string[]): string {
  const sep = folderRoot.includes('\\') && !folderRoot.includes('/') ? '\\' : '/'
  const root = folderRoot.replace(/[/\\]+$/, '')
  return [root, SIDECAR_DIR, ...parts].join(sep)
}

/** Build a fresh v2 manifest for an empty / new folder project. */
export function createFolderManifest(
  name: string,
  language: KernelLanguage = 'r',
  now = Date.now(),
): CelloProjectV2 {
  const cells = starterCells(language)
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION_FOLDER,
    meta: {
      name: name.trim() || defaultProjectName(),
      createdAt: now,
      updatedAt: now,
    },
    language,
    scriptPath: defaultScriptPath(language),
    activeCellId: cells[0].id,
    activePanel: 'files',
    cells,
    artifactsDir: ARTIFACTS_DIR,
  }
}

/** Serialize live workspace to lean v2 (no fake `files` tree). */
export function serializeFolderManifest(
  state: {
    cells: { id: string; name: string; code: string; explanation?: string; comments?: PersistedCell['comments'] }[]
    activeCellId: string
    activePanel: PanelId
    language: KernelLanguage
    scriptPath: string
    meta: ProjectMeta
  },
  now = Date.now(),
): CelloProjectV2 {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION_FOLDER,
    meta: {
      name: state.meta.name.trim() || defaultProjectName(),
      createdAt: state.meta.createdAt,
      updatedAt: now,
    },
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
    artifactsDir: ARTIFACTS_DIR,
  }
}

export function stringifyFolderManifest(project: CelloProjectV2): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

function normalizeRelPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

/** True when `relativePath` looks like a kernel source file for `language`. */
export function isKernelSourcePath(
  relativePath: string,
  language: KernelLanguage,
): boolean {
  const base = normalizeRelPath(relativePath).split('/').pop() ?? ''
  if (!base || base === MANIFEST_NAME) return false
  const lower = base.toLowerCase()
  return SOURCE_EXTENSIONS[language].some((ext) => lower.endsWith(ext.toLowerCase()))
}

/**
 * Where Save should mirror cell sources on disk.
 * Prefers the active `scriptPath` when it is a kernel source file; otherwise the
 * language default (`analysis.R` / `analysis.js`). Never targets the manifest or sidecar.
 */
export function resolveScriptMirrorPath(
  scriptPath: string,
  language: KernelLanguage,
): string {
  const normalized = normalizeRelPath(scriptPath)
  if (
    !normalized ||
    normalized === MANIFEST_NAME ||
    normalized === SIDECAR_DIR ||
    normalized.startsWith(`${SIDECAR_DIR}/`)
  ) {
    return defaultScriptPath(language)
  }
  if (isKernelSourcePath(normalized, language)) {
    return normalized
  }
  return defaultScriptPath(language)
}

/**
 * Relative path for the real on-disk source file written alongside lean `cello.json`.
 * Callers supply contents via `cellsToScript` (same as Export).
 */
export function planScriptSourcePath(state: {
  language: KernelLanguage
  scriptPath: string
}): string {
  return resolveScriptMirrorPath(state.scriptPath, state.language)
}

/**
 * Parse `cello.json` (v2) or a legacy `.cello` / v1 document into a v2 folder manifest.
 * Virtual `files` from v1 are dropped — disk listing replaces them.
 * Cell `code` / names / explanations / comments are required durable authoring state.
 */
export function parseFolderManifest(
  input: string | unknown,
): { ok: true; project: CelloProjectV2 } | { ok: false; error: string } {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input) as unknown
    } catch {
      return { ok: false, error: 'Invalid JSON' }
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'Project root must be an object' }
  }
  const record = data as Record<string, unknown>

  // Prefer dedicated v2 path when version is 2.
  // Coerce to v1 for the shared cell/meta parser; never invent a fake files tree
  // into the returned v2 (File panel lists disk).
  if (record.format === PROJECT_FORMAT && record.version === PROJECT_VERSION_FOLDER) {
    const parsed = parseProject({
      ...record,
      version: 1,
      // Empty files → parseProject would invent a demo tree; pass a minimal root
      // so cells/code round-trip without polluting the folder project.
      files: [
        {
          id: 'folder_root',
          name:
            typeof record.meta === 'object' &&
            record.meta !== null &&
            'name' in record.meta &&
            typeof (record.meta as { name: unknown }).name === 'string'
              ? (record.meta as { name: string }).name
              : 'project',
          kind: 'folder',
          children: [],
        },
      ],
    })
    if (!parsed.ok) return parsed
    if (parsed.project.cells.some((cell) => typeof cell.code !== 'string')) {
      return { ok: false, error: 'Folder project cells must include code strings' }
    }
    return { ok: true, project: v1ToV2(parsed.project, record) }
  }

  const parsed = parseProject(data)
  if (!parsed.ok) return parsed
  return { ok: true, project: v1ToV2(parsed.project, record) }
}

function v1ToV2(project: CelloProjectV1, raw: Record<string, unknown>): CelloProjectV2 {
  const artifactsDir =
    typeof raw.artifactsDir === 'string' && raw.artifactsDir.trim()
      ? raw.artifactsDir.trim()
      : ARTIFACTS_DIR
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION_FOLDER,
    meta: project.meta,
    language: project.language,
    scriptPath: project.scriptPath,
    activeCellId: project.activeCellId,
    activePanel: project.activePanel,
    cells: project.cells,
    artifactsDir,
  }
}

/** Convert v2 → v1 shape for workspace hydrate helpers that still expect files[]. */
export function folderManifestAsV1(project: CelloProjectV2): CelloProjectV1 {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    meta: project.meta,
    language: project.language,
    scriptPath: project.scriptPath,
    activeCellId: project.activeCellId,
    activePanel: project.activePanel,
    cells: project.cells,
    files: [],
  }
}

export function hydrateFolderCells(project: CelloProjectV2) {
  return project.cells.map((cell) => hydratePersistedCell(cell))
}

/** Re-export serialize helpers used when saving a downloadable .cello from memory mode. */
export { serializeProject, stringifyProject }
