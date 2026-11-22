/**
 * Cello Electron main process.
 *
 * Hosts the same R kernel HTTP API as the Vite plugin (`createKernelSession`)
 * on a loopback server, then loads the built Vite UI from `dist/`.
 * Day-to-day development stays `npm run dev` (web + Vite middleware).
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
} from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernelSession } from '../server/rKernelHost.ts'

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url))

/** Repo root in dev; `app.getAppPath()` when packaged (asar / resources/app). */
function appRoot(): string {
  return app.isPackaged ? app.getAppPath() : MODULE_ROOT
}

/** Vite UI build — inside the app package (asar-safe; Node streams it). */
function distDir(): string {
  return path.join(appRoot(), 'dist')
}

function preloadScript(): string {
  // Dev: electron/preload.cjs next to main.ts / main.mjs.
  // Packaged: same folder as main-bundle.mjs (shipped beside the asar entry).
  return path.join(ELECTRON_DIR, 'preload.cjs')
}

/**
 * Packaged installs keep `worker.R` in `resources/kernel/r` (outside asar so
 * Rscript can read it) and install R packages under userData (Program Files
 * is not writable).
 */
function kernelSessionOptions() {
  if (!app.isPackaged) return {}
  return {
    root: appRoot(),
    workerPath: path.join(process.resourcesPath, 'kernel', 'r', 'worker.R'),
    libDir: path.join(app.getPath('userData'), 'r-lib'),
  }
}

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
  const dist = distDir()
  const rawUrl = req.url?.split('?')[0] ?? '/'
  let rel = decodeURIComponent(rawUrl)
  if (rel === '/') rel = '/index.html'
  // Prevent path traversal outside dist.
  const filePath = path.normalize(path.join(dist, rel))
  if (!filePath.startsWith(dist)) {
    sendText(res, 403, 'Forbidden', 'text/plain; charset=utf-8')
    return
  }

  let target = filePath
  if (!(await pathExists(target))) {
    // SPA-style fallback for client routes (none today, but harmless).
    target = path.join(dist, 'index.html')
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
  if (!(await pathExists(path.join(distDir(), 'index.html')))) {
    throw new Error(
      'Missing dist/index.html. Run `npm run build` (or use `npm run desktop`, which builds first).',
    )
  }

  const session = createKernelSession(kernelSessionOptions())
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
let windowShown = false

/** Match BrowserWindow backgroundColor / charcoal shell. */
const WINDOW_CHROME_BG = '#0c0b0a'
const WINDOW_CHROME_FG = '#c8c2b8'
const TITLE_BAR_OVERLAY_HEIGHT = 32

/**
 * Default: true frameless window (`frame: false`) + native overlay min/max/close.
 * Opt out with CELLO_NATIVE_FRAME=1 for the normal OS frame.
 *
 * `#27` used only `titleBarStyle: 'hidden'`, which still left Windows border
 * chrome for some users — `frame: false` (+ `thickFrame: false` on win32)
 * removes the OS frame. Overlay keeps caption buttons without a custom UI.
 */
function nativeFrameRequested(): boolean {
  const raw = String(process.env.CELLO_NATIVE_FRAME ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function windowChromeOptions(): BrowserWindowConstructorOptions {
  if (nativeFrameRequested()) return {}

  // macOS: hidden title bar keeps native traffic lights; do not set frame:false
  // or the lights disappear unless we rebuild them.
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hidden' }
  }

  // Windows / Linux: true frameless + Window Controls Overlay for min/max/close.
  // `#27` only set titleBarStyle/overlay and still left a Windows border for
  // some users — frame:false is required. thickFrame:false drops WS_THICKFRAME.
  const options: BrowserWindowConstructorOptions = {
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: WINDOW_CHROME_BG,
      symbolColor: WINDOW_CHROME_FG,
      height: TITLE_BAR_OVERLAY_HEIGHT,
    },
  }
  if (process.platform === 'win32') {
    options.thickFrame = false
  }
  return options
}

function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return null
  return win
}

function registerWindowIpc() {
  ipcMain.handle('cello:set-content-size', (event, payload: unknown) => {
    const win = windowFromEvent(event)
    if (!win) return { ok: false as const }

    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const width = Math.round(Number(body.width))
    const height = Math.round(Number(body.height))
    if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false as const }
    // Guard absurd sizes from a bad measure.
    if (width < 200 || height < 200 || width > 8000 || height > 8000) {
      return { ok: false as const }
    }

    const [curW, curH] = win.getContentSize()
    if (Math.abs(curW - width) > 1 || Math.abs(curH - height) > 1) {
      win.setContentSize(width, height)
    }
    if (!windowShown) {
      windowShown = true
      win.show()
    }
    return { ok: true as const, width, height }
  })

  ipcMain.handle('cello:window-minimize', (event) => {
    windowFromEvent(event)?.minimize()
    return { ok: true as const }
  })

  ipcMain.handle('cello:window-maximize-toggle', (event) => {
    const win = windowFromEvent(event)
    if (!win) return { ok: false as const }
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return { ok: true as const, maximized: win.isMaximized() }
  })

  ipcMain.handle('cello:window-close', (event) => {
    windowFromEvent(event)?.close()
    return { ok: true as const }
  })
}

async function createWindow(url: string) {
  windowShown = false
  mainWindow = new BrowserWindow({
    // Temporary until the renderer measures the cell cluster and calls setContentSize.
    width: 880,
    height: 640,
    minWidth: 320,
    minHeight: 240,
    show: false,
    backgroundColor: WINDOW_CHROME_BG,
    title: 'Cello',
    autoHideMenuBar: true,
    ...windowChromeOptions(),
    webPreferences: {
      preload: preloadScript(),
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
    windowShown = false
  })

  // If the renderer never reports a size (older UI / failed preload), still show.
  const showFallback = setTimeout(() => {
    if (!windowShown && mainWindow && !mainWindow.isDestroyed()) {
      windowShown = true
      mainWindow.show()
    }
  }, 2500)
  mainWindow.once('closed', () => clearTimeout(showFallback))

  await mainWindow.loadURL(url)
}

let hostUrl: string | null = null

app.whenReady().then(async () => {
  registerWindowIpc()
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
