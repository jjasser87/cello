/**
 * Project filesystem bridge — Electron IPC when desktop; limited web fallback.
 */
import { getDesktopApi, type CelloDesktopApi } from './desktop'
import type { ProjectFile } from '../types'
import { isSidecarName, MANIFEST_NAME } from './folderProject'

export type DiskEntry = {
  name: string
  kind: 'file' | 'folder'
  /** Path relative to the project folder root (posix-ish `/`). */
  path: string
  children?: DiskEntry[]
}

export type OpenFolderResult =
  | { ok: true; root: string; manifestText: string | null; created: boolean }
  | { ok: false; error: string; cancelled?: boolean }

function desktop(): CelloDesktopApi | null {
  return getDesktopApi()
}

export function canOpenFolderNative(): boolean {
  return Boolean(desktop()?.openFolder)
}

/** Native folder picker + ensure cello.json exists (creates stub when missing). */
export async function openProjectFolder(): Promise<OpenFolderResult> {
  const api = desktop()
  if (!api?.openFolder) {
    return {
      ok: false,
      error: 'Open folder requires the Cello desktop app (Electron).',
    }
  }
  const picked = await api.openFolder()
  if (!picked || !picked.ok) {
    if (picked && 'cancelled' in picked && picked.cancelled) {
      return { ok: false, error: 'Cancelled', cancelled: true }
    }
    return { ok: false, error: picked?.error ?? 'Could not open folder' }
  }
  return {
    ok: true,
    root: picked.root,
    manifestText: picked.manifestText ?? null,
    created: Boolean(picked.created),
  }
}

export async function listProjectFolder(
  root: string,
  options?: { showSidecar?: boolean; maxDepth?: number },
): Promise<{ ok: true; entries: DiskEntry[] } | { ok: false; error: string }> {
  const api = desktop()
  if (!api?.listFolder) {
    return { ok: false, error: 'Folder listing requires the desktop app.' }
  }
  const result = await api.listFolder(root, {
    showSidecar: options?.showSidecar ?? false,
    maxDepth: options?.maxDepth ?? 6,
  })
  if (!result?.ok) {
    return { ok: false, error: result?.error ?? 'List failed' }
  }
  return { ok: true, entries: result.entries ?? [] }
}

export async function writeProjectText(
  absolutePath: string,
  contents: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = desktop()
  if (!api?.writeTextFile) {
    return { ok: false, error: 'Writing project files requires the desktop app.' }
  }
  const result = await api.writeTextFile(absolutePath, contents)
  if (!result?.ok) return { ok: false, error: result?.error ?? 'Write failed' }
  return { ok: true }
}

export async function readProjectText(
  absolutePath: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const api = desktop()
  if (!api?.readTextFile) {
    return { ok: false, error: 'Reading project files requires the desktop app.' }
  }
  const result = await api.readTextFile(absolutePath)
  if (!result?.ok) return { ok: false, error: result?.error ?? 'Read failed' }
  return { ok: true, text: result.text ?? '' }
}

export async function setKernelProjectCwd(
  cwd: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = desktop()
  if (api?.setProjectCwd) {
    const result = await api.setProjectCwd(cwd)
    if (!result?.ok) return { ok: false, error: result?.error ?? 'Could not set project cwd' }
    return { ok: true }
  }
  // Web / Vite host: POST to kernel API.
  try {
    const res = await fetch('/api/kernel/cwd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Convert a disk listing into the ProjectFile tree the Files panel already renders. */
export function diskEntriesToProjectFiles(
  folderName: string,
  entries: DiskEntry[],
  options?: { showSidecar?: boolean },
): ProjectFile[] {
  const showSidecar = options?.showSidecar ?? false
  const filtered = entries.filter((entry) => showSidecar || !isSidecarName(entry.name))

  const toNode = (entry: DiskEntry): ProjectFile => {
    if (entry.kind === 'folder') {
      return {
        id: `disk:${entry.path || entry.name}`,
        name: entry.name,
        kind: 'folder',
        children: (entry.children ?? [])
          .filter((child) => showSidecar || !isSidecarName(child.name))
          .map(toNode),
      }
    }
    return {
      id: `disk:${entry.path}`,
      name: entry.name,
      kind: 'file',
    }
  }

  return [
    {
      id: 'disk:',
      name: folderName,
      kind: 'folder',
      children: filtered.map(toNode),
    },
  ]
}

export function joinProjectPath(root: string, relative: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const base = root.replace(/[/\\]+$/, '')
  const rel = relative.replace(/^[/\\]+/, '').replace(/\\/g, sep)
  return rel ? `${base}${sep}${rel}` : base
}

export function folderDisplayName(root: string): string {
  const cleaned = root.replace(/[/\\]+$/, '')
  const parts = cleaned.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || MANIFEST_NAME
}
