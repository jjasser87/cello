/**
 * Cello Electron main process.
 *
 * Hosts the same R kernel HTTP API as the Vite plugin (`createKernelSession`)
 * on a loopback server, then loads the built Vite UI from `dist/`.
 * Day-to-day development stays `npm run dev` (web + Vite middleware).
 */
import { app, BrowserWindow, shell } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernelSession } from '../server/rKernelHost.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function sendText(res: ServerResponse, status: number, body: string, type: string) {
  res.statusCode = status
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

async function serveDist(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawUrl = req.url?.split('?')[0] ?? '/'
  let rel = decodeURIComponent(rawUrl)
  if (rel === '/') rel = '/index.html'
  // Prevent path traversal outside dist.
  const filePath = path.normalize(path.join(DIST, rel))
  if (!filePath.startsWith(DIST)) {
    sendText(res, 403, 'Forbidden', 'text/plain; charset=utf-8')
    return
  }

  let target = filePath
  if (!(await pathExists(target))) {
    // SPA-style fallback for client routes (none today, but harmless).
    target = path.join(DIST, 'index.html')
    if (!(await pathExists(target))) {
      sendText(
        res,
        404,
        'UI build missing. Run `npm run build` before `npm run desktop`.',
        'text/plain; charset=utf-8',
      )
      return
    }
  } else {
    const info = await stat(target)
    if (info.isDirectory()) {
      target = path.join(target, 'index.html')
      if (!(await pathExists(target))) {
        sendText(res, 404, 'Not found', 'text/plain; charset=utf-8')
        return
      }
    }
  }

  const ext = path.extname(target).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', ext === '.html' ? 'no-store' : 'public, max-age=3600')
  createReadStream(target).pipe(res)
}

async function startHost(): Promise<{ url: string; close: () => Promise<void> }> {
  if (!(await pathExists(path.join(DIST, 'index.html')))) {
    throw new Error(
      'Missing dist/index.html. Run `npm run build` (or use `npm run desktop`, which builds first).',
    )
  }

  const session = createKernelSession()
  void session.ensureStarted().catch(() => {
    /* status endpoint surfaces the reason */
  })

  const server = createServer(async (req, res) => {
    try {
      const handled = await session.handleApi(req, res)
      if (handled) return
      await serveDist(req, res)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        sendText(res, 500, message, 'text/plain; charset=utf-8')
      } else {
        res.end()
      }
    }
  })

  const preferred = Number(process.env.CELLO_DESKTOP_PORT || '')
  const port = Number.isFinite(preferred) && preferred > 0 ? preferred : 0

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Loopback only — machine R stays local; no LAN bind.
    server.listen(port, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind desktop host on 127.0.0.1')
  }
  const url = `http://127.0.0.1:${address.port}/`
  console.log(`[cello-desktop] host ${url}`)

  const close = async () => {
    session.stop()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  }

  return { url, close }
}

let mainWindow: BrowserWindow | null = null
let closeHost: (() => Promise<void>) | null = null

async function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#0c0b0a',
    title: 'Cello',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  await mainWindow.loadURL(url)
}

let hostUrl: string | null = null

app.whenReady().then(async () => {
  try {
    const host = await startHost()
    closeHost = host.close
    hostUrl = host.url
    await createWindow(host.url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cello-desktop]', message)
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && hostUrl) {
      void createWindow(hostUrl)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  const closer = closeHost
  closeHost = null
  hostUrl = null
  if (closer) {
    void closer().catch(() => {
      /* ignore shutdown races */
    })
  }
})
