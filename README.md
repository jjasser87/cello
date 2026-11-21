# Cello

**One cell. Full focus.**

Cello is a minimalist, cell-based development environment. The main window stays on a single active cell; everything else — history, plots, files, environment, data, script flow, console, and an agent — lives behind a thin side ribbon you expand when you need it.

## v0.1

- Dark / charcoal shell with warm cello-wood accents
- No top header chrome — the active cell owns the viewport
- Side ribbon collapsed by default; click a mode to expand (click again / Collapse to return)
- Plain-text scripts with `# %%` (R) or `// %%` (JS) cell markers
- Focused cell editor with rename / reorder / run
- Panels: Cells, Explain, History, Plot, Files, Env, Data, Flow (auto Mermaid-style cell graph), Console, Agent — fixed size, no nested scrollbar chrome (Flow grows with the cell / page scroll)
- **Explain** — per-cell Markdown purpose doc (Purpose / Inputs / Outputs / …) plus feedback comments for focus auditing
- **R kernel** (local process via Vite dev middleware) plus in-browser JavaScript fallback
- `cello.plot` / `cello.table` helpers in both languages
- Native R graphics capture: base `plot()` / printed `ggplot()` appear in Plot (PNG via the R worker)
- Native R table capture: `data.frame` / tibble / `matrix` results (and `cello.table`) appear in Data for that cell
- Plot + data panels auto-expand when a cell produces them
- **History** is code history only (prior cell source); selecting a version restores that source into the cell
- **Plot / Console / Data** each retain prior outputs for the selected cell; selecting an older item restores the code that produced it
- Command palette / settings entry via ⌘/Ctrl+Shift+P (panels, Explain cell, run, language, prefs stub)
- Compact cell nav under the editor: prev/next + Alt+↑/↓ (palette Navigate commands too)
- **Files** ribbon panel — project file tree (not a separate “project cell”); New / Save / Open project from the command palette
- Durable **`.cello`** project file (JSON) for cells, explanations, comments, file tree, and UI selection; autosave uses the same schema in `localStorage`

## Develop (with R)

1. Install R (`r-base` / R.app / etc.) so `Rscript` is on your `PATH` (or set a custom path under **Settings…** in the command palette, or export `CELLO_RSCRIPT`).
2. From the repo:

```bash
npm install
npm run dev
```

On first start the Vite plugin spawns a long-lived R worker and installs `jsonlite` into `kernel/r/.lib/` (gitignored) if needed. Open the app URL Vite prints, leave **Lang** on **R**, and use **Run** / **Run all**.

Kernel helpers in R:

```r
cello.table(sales, "sales")
cello.plot(list(
  title = "Monthly revenue",
  kind = "bar",
  labels = sales$month,
  values = sales$revenue
))
console$log("hello")
```

Native graphics (no helper required) also fill Plot for that cell:

```r
plot(1:10, main = "base plot")

# optional — install ggplot2 yourself if you want ggplot
# install.packages("ggplot2")
library(ggplot2)
ggplot(data.frame(x = 1:5, y = c(2, 4, 3, 5, 4)), aes(x, y)) + geom_line()
```

Native tables (no helper required) fill Data when a cell creates or returns a rectangular object:

```r
sales <- data.frame(month = c("Jan", "Feb"), revenue = c(42, 51))
# or: as.matrix(sales) / tibble::tibble(...) / read.csv(...)
```

If R was built without PNG (or the PNG device cannot open), the cell still runs and Console notes that native plot capture is unavailable. Structured `cello.plot` keeps working either way. Explicit `cello.plot(...)` / `cello.table(...)` in a cell win over native capture from the same cell.

API used by the UI (Vite dev middleware and Electron desktop host):

- `GET /api/kernel/status` (includes `rscriptPath` / `rscriptOverride` when known)
- `POST /api/kernel/config` `{ "rscriptPath": "/path/to/Rscript" | null }` — Settings override; restarts the worker
- `POST /api/kernel/eval` `{ "code", "cellId" }`
- `POST /api/kernel/reset`
- `POST /api/kernel/run-all` `{ "cells": [{ "id", "code" }] }`
- `POST /api/kernel/complete` `{ "code", "cursor" }`

## Desktop (Electron)

The day-to-day development build remains `npm run dev` (Vite + browser). For the desktop shell:

```bash
npm install
npm run desktop
```

That builds the Vite UI into `dist/`, then launches Electron. `npm run desktop` (and `desktop:app`) first run `desktop:install`, which downloads Electron’s binary if `path.txt` / `dist/` are missing.

The Electron main process starts a **loopback-only** HTTP host that:

1. Serves the built UI from `dist/`
2. Runs the same R kernel session as the Vite plugin (`createKernelSession` in `server/rKernelHost.ts`) on `/api/kernel/*`
3. Uses the **machine-installed R** (Settings → R path / `CELLO_RSCRIPT` / PATH)

If you already have a fresh `dist/`:

```bash
npm run desktop:app
```

### npm install scripts (Electron / esbuild)

npm 12+ blocks dependency install scripts unless they are listed in `package.json` `allowScripts`. Cello commits approvals for **electron** (required — downloads the desktop binary) and **esbuild** (used by Vite/tsx). With that field present, a normal `npm install` should run Electron’s postinstall.

`npm run desktop:install` (also hooked as `predesktop`) repairs a missing binary: it clears `ELECTRON_SKIP_BINARY_DOWNLOAD` for the child, re-runs `electron/install.js`, and on Windows falls back to re-extracting the cached zip with PowerShell `Expand-Archive` when extract-zip leaves `electron.exe` / `path.txt` missing.

If you still see allowScripts warnings, or `desktop:install` / `npm run desktop` fails, use the recovery steps below.

**PowerShell (Windows):**

```powershell
Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue
npm install-scripts approve --no-allow-scripts-pin electron esbuild
Remove-Item -Recurse -Force node_modules\electron -ErrorAction SilentlyContinue
npm install
npm run desktop:install
npm run desktop
```

If `desktop:install` still reports a missing binary, extract the cached zip manually:

```powershell
$zip = Get-ChildItem -Recurse "$env:LOCALAPPDATA\electron\Cache\electron-v*-win32-*.zip" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
New-Item -ItemType Directory -Force node_modules\electron\dist | Out-Null
Expand-Archive -LiteralPath $zip.FullName -DestinationPath node_modules\electron\dist -Force
Set-Content -Path node_modules\electron\path.txt -Value 'electron.exe' -NoNewline
npm run desktop
```

If GitHub releases are blocked, set a mirror first: `$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"`.

**bash / zsh:**

```bash
unset ELECTRON_SKIP_BINARY_DOWNLOAD
npm install-scripts approve --no-allow-scripts-pin electron esbuild
rm -rf node_modules/electron
npm install
npm run desktop:install
npm run desktop
```

Installers / auto-update are not in this slice yet.

## Develop (JS-only fallback)

If R is not installed, switch **Lang** to **JS**. The in-browser kernel still runs `console`, `cello.plot`, and `cello.table`. Console will note that the R kernel is unavailable. Vite itself does not require bash or R to start — `Rscript` is found via a Node PATH walk (Windows-safe).

```bash
npm install
npm run test:server
npm run dev
npm run build
```

Cell source is normalized (CRLF → LF, strip BOM) before R `parse()`, so Windows line endings in the editor do not break eval.

## Explanations & persistence

Each code cell carries a Markdown **explanation** (seeded with focus-audit headings when empty) and a list of **comments** (`id`, `body`, `createdAt`, `author`).

### `.cello` project file

Durable save format: a JSON document with `"format": "cello-project"` / `"version": 1`. It stores:

- `meta` (project name + timestamps)
- `language`, `scriptPath`, `activeCellId`, `activePanel`
- `cells[]` (code + explanation + comments)
- `files[]` (project tree shown in the Files ribbon)

Autosave writes the same payload to `localStorage` (`cello.workspace.v1`; v0 payloads migrate on load). Runtime plots / tables / env / history are not persisted — they rebuild on run. Flow graphs are derived from cells (no separate Mermaid blob).

Command palette (`⌘/Ctrl+Shift+P`): **New project**, **Save project…** (downloads `name.cello`), **Open project…**.

Plain-text script export (`⇩`) remains code-only with `# %%` / `// %%` markers — explanations are **not** embedded in `.R` / `.js` files.

Open **Explain** from the ribbon (`Ex`), the ¶ toolbar icon, or the command palette (“Explain cell” / “Go to Explain”). Open **Files** from the ribbon (`Fi`) or palette (“Go to Files”).


## Architecture (short)

- Browser / Electron UI talks to `/api/kernel/*` when language is R.
- `server/rKernelHost.ts` owns one `Rscript` child running `kernel/r/worker.R` — Vite plugin in `npm run dev`, Electron main in `npm run desktop`.
- The worker keeps a shared `.GlobalEnv`, streams printed output into Console, and returns Env / Plot / Data payloads as JSON.
- During each eval the worker opens a temporary PNG device (cairo when available) and, if `plot.new` / `grid.newpage` fire, returns `kind: "image"` with a `data:image/png;base64,…` payload for the Plot panel.
- After each eval, if `cello.table` was not called, the worker auto-captures a visible or newly assigned `data.frame` / tibble / `matrix` into the Data payload for that cell.

See the project note at `docs/r-kernel-v1.md` in the Cello agent store for the v1 plan and deferred items.
