/**
 * FS-level regression: existing folder project (cello.json present, no analysis.R)
 * must get an R source file when Save's write plan is applied to disk.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  MANIFEST_NAME,
  parseFolderManifest,
  planFolderSaveWrites,
  stringifyFolderManifest,
} from './folderProject.ts'
import { planSidecarWrites } from './folderSidecar.ts'
import type { WorkspaceState } from '../types.ts'

async function applyWrites(
  root: string,
  files: { relativePath: string; contents: string }[],
): Promise<void> {
  for (const file of files) {
    const abs = path.join(root, ...file.relativePath.split('/'))
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, file.contents, 'utf8')
  }
}

describe('folder Save writes (existing project, no analysis.R yet)', () => {
  it('creates analysis.R beside an existing cello.json on Save', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cello-existing-save-'))
    try {
      const priorManifest = {
        format: 'cello-project' as const,
        version: 2 as const,
        meta: { name: 'cello test', createdAt: 1, updatedAt: 1 },
        language: 'r' as const,
        scriptPath: 'cello.json',
        activeCellId: 'cell_a',
        activePanel: 'files' as const,
        cells: [
          {
            id: 'cell_a',
            name: 'Load',
            code: 'x <- 1:5',
            explanation: '',
            comments: [],
          },
        ],
        artifactsDir: '.cello',
      }
      await writeFile(
        path.join(root, MANIFEST_NAME),
        stringifyFolderManifest(priorManifest),
        'utf8',
      )

      const loaded = parseFolderManifest(
        await readFile(path.join(root, MANIFEST_NAME), 'utf8'),
      )
      assert.equal(loaded.ok, true)
      if (!loaded.ok) return

      const state = {
        cells: loaded.project.cells.map((cell) => ({
          ...cell,
          status: 'idle' as const,
        })),
        activeCellId: loaded.project.activeCellId,
        activePanel: loaded.project.activePanel,
        language: loaded.project.language,
        scriptPath: loaded.project.scriptPath,
        meta: loaded.project.meta,
        history: [],
        historyIndex: -1,
        plots: [],
        tables: [],
        consoleEntries: [],
        activePlotId: null,
        activeTableId: null,
        activeConsoleId: null,
        env: [],
        consoleLines: [],
        files: [],
        projectRoot: root,
        filesSource: 'disk' as const,
        saveOutputs: false,
        hideSidecar: true,
        flowMermaid: null,
        sidePanelOpen: true,
        helperDock: 'right' as const,
        kernelStatus: {
          available: false,
          version: null,
          message: null,
          rscriptPath: null,
          rscriptOverride: null,
        },
      } satisfies WorkspaceState

      const planned = planFolderSaveWrites(state)
      const sidecar = planSidecarWrites(state)
      await applyWrites(root, [...planned.files, ...sidecar.files])

      const scriptText = await readFile(path.join(root, 'analysis.R'), 'utf8')
      assert.match(scriptText, /x <- 1:5/)
      assert.match(scriptText, /# %% Load/)

      const savedManifest = parseFolderManifest(
        await readFile(path.join(root, MANIFEST_NAME), 'utf8'),
      )
      assert.equal(savedManifest.ok, true)
      if (!savedManifest.ok) return
      assert.equal(savedManifest.project.scriptPath, 'analysis.R')
      assert.equal(savedManifest.project.cells[0].code, 'x <- 1:5')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
