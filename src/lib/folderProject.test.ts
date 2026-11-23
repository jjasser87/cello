import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ARTIFACTS_DIR,
  MANIFEST_NAME,
  PROJECT_VERSION_FOLDER,
  createFolderManifest,
  parseFolderManifest,
  serializeFolderManifest,
  stringifyFolderManifest,
  folderManifestAsV1,
} from './folderProject.ts'
import { PROJECT_FORMAT } from './projectFile.ts'

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
    assert.equal(text.includes(MANIFEST_NAME) || text.includes('"version": 2'), true)

    const parsed = parseFolderManifest(text)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.project.version, PROJECT_VERSION_FOLDER)
    assert.equal(parsed.project.cells[0].code, 'x <- 1')
    assert.equal(parsed.project.artifactsDir, ARTIFACTS_DIR)
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
