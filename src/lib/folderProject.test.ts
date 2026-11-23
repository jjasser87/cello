import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ARTIFACTS_DIR,
  MANIFEST_NAME,
  PROJECT_VERSION_FOLDER,
  createFolderManifest,
  isKernelSourcePath,
  parseFolderManifest,
  planScriptSourcePath,
  resolveScriptMirrorPath,
  serializeFolderManifest,
  stringifyFolderManifest,
  folderManifestAsV1,
} from './folderProject.ts'
import { PROJECT_FORMAT } from './projectFile.ts'
import { cellsToScript } from './script.ts'

describe('folder project (structure B)', () => {
  it('creates a lean v2 manifest without a fake files tree', () => {
    const doc = createFolderManifest('sales', 'r', 100)
    assert.equal(doc.format, PROJECT_FORMAT)
    assert.equal(doc.version, PROJECT_VERSION_FOLDER)
    assert.equal(doc.meta.name, 'sales')
    assert.equal(doc.language, 'r')
    assert.equal(doc.artifactsDir, ARTIFACTS_DIR)
    assert.equal(doc.cells.length > 0, true)
    assert.equal('files' in doc, false)
  })

  it('round-trips serialize → parse', () => {
    const doc = serializeFolderManifest({
      cells: [
        {
          id: 'cell_a',
          name: 'Load',
          code: 'x <- 1',
          explanation: '## Purpose\n\nLoad\n',
          comments: [],
        },
      ],
      activeCellId: 'cell_a',
      activePanel: 'files',
      language: 'r',
      scriptPath: 'analysis.R',
      meta: { name: 'demo', createdAt: 10, updatedAt: 10 },
    }, 99)

    const text = stringifyFolderManifest(doc)
    assert.equal(text.includes('"version": 2'), true)
    assert.match(text, /"code": "x <- 1"/)
    assert.match(text, /"name": "Load"/)
    assert.match(text, /"explanation"/)

    const parsed = parseFolderManifest(text)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.project.version, PROJECT_VERSION_FOLDER)
    assert.equal(parsed.project.cells[0].code, 'x <- 1')
    assert.equal(parsed.project.cells[0].name, 'Load')
    assert.equal(parsed.project.artifactsDir, ARTIFACTS_DIR)
  })

  it('plans R script mirror path + cellsToScript contents for Save (regression)', () => {
    const cells = [
      { name: 'Load', code: 'x <- 1:3' },
      { name: 'Plot', code: 'plot(x)' },
    ]
    const relativePath = planScriptSourcePath({
      language: 'r',
      scriptPath: 'analysis.R',
    })
    const contents = cellsToScript(cells, 'r')
    assert.equal(relativePath, 'analysis.R')
    assert.match(contents, /# %% Load/)
    assert.match(contents, /x <- 1:3/)
    assert.match(contents, /# %% Plot/)
    assert.match(contents, /plot\(x\)/)
  })

  it('resolves script mirror path without overwriting non-source or sidecar paths', () => {
    assert.equal(resolveScriptMirrorPath('analysis.R', 'r'), 'analysis.R')
    assert.equal(resolveScriptMirrorPath('src/load.r', 'r'), 'src/load.r')
    assert.equal(resolveScriptMirrorPath('data/sales.csv', 'r'), 'analysis.R')
    assert.equal(resolveScriptMirrorPath(MANIFEST_NAME, 'r'), 'analysis.R')
    assert.equal(resolveScriptMirrorPath('.cello/ui.json', 'r'), 'analysis.R')
    assert.equal(isKernelSourcePath('analysis.R', 'r'), true)
    assert.equal(isKernelSourcePath('notes.txt', 'r'), false)
  })

  it('migrates v1 .cello documents into v2 folder shape', () => {
    const v1 = {
      format: PROJECT_FORMAT,
      version: 1,
      meta: { name: 'legacy', createdAt: 1, updatedAt: 1 },
      language: 'r',
      scriptPath: 'analysis.R',
      activeCellId: 'cell_1',
      activePanel: 'cells',
      cells: [{ id: 'cell_1', name: 'A', code: '1 + 1' }],
      files: [
        {
          id: 'folder_1',
          name: 'legacy',
          kind: 'folder',
          children: [{ id: 'file_1', name: 'analysis.R', kind: 'file' }],
        },
      ],
    }
    const parsed = parseFolderManifest(JSON.stringify(v1))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.project.version, PROJECT_VERSION_FOLDER)
    assert.equal(parsed.project.meta.name, 'legacy')
    const asV1 = folderManifestAsV1(parsed.project)
    assert.equal(asV1.files.length, 0)
  })
})
