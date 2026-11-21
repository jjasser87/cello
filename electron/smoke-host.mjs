/**
 * Headless smoke: loopback host (dist + /api/kernel) without opening a window.
 * Usage: node electron/smoke-host.mjs
 */
import { register } from 'tsx/esm/api'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

register()

const { createKernelSession } = await import('../server/rKernelHost.ts')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const indexHtml = path.join(DIST, 'index.html')

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

if (!(await exists(indexHtml))) {
  console.error('Missing dist/index.html — run npm run build first')
  process.exit(1)
}

const session = createKernelSession()
const server = createServer(async (req, res) => {
  const handled = await session.handleApi(req, res)
  if (handled) return
  const urlPath = req.url?.split('?')[0] ?? '/'
  const file = urlPath === '/' ? indexHtml : path.join(DIST, urlPath)
  if (!(await exists(file))) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  createReadStream(file).pipe(res)
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

const { port } = server.address()
const base = `http://127.0.0.1:${port}`

const ui = await fetch(`${base}/`)
const status = await fetch(`${base}/api/kernel/status`)
const uiText = await ui.text()
const statusJson = await status.json()

console.log(
  JSON.stringify(
    {
      ok: ui.ok && status.ok && uiText.includes('<div id="root"'),
      uiStatus: ui.status,
      kernelStatus: status.status,
      kernel: {
        available: statusJson.available,
        version: statusJson.version,
        message: statusJson.message ?? null,
        rscriptPath: statusJson.rscriptPath ?? null,
      },
      url: `${base}/`,
    },
    null,
    2,
  ),
)

session.stop()
await new Promise((resolve) => server.close(resolve))
process.exit(ui.ok && status.ok ? 0 : 1)
