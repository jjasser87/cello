# Cello

**One cell. Full focus.**

Cello is a minimalist, cell-based development environment. The main window stays on a single active cell; everything else — history, plots, files, environment, data, script flow, console, and an agent — lives behind a thin side ribbon you expand when you need it.

## v0

- Dark / charcoal shell with warm cello-wood accents
- No top header chrome — the active cell owns the viewport
- Side ribbon collapsed by default; click a mode to expand (click again / Collapse to return)
- Plain-text scripts with `// %%` cell markers (valid JavaScript comments)
- Focused cell editor with rename / reorder / run
- Panels: Cells, History, Plot, Files, Env, Data, Flow, Console, Agent
- In-browser JavaScript kernel (`console`, `cello.plot`, `cello.table`)
- Plot + data panels auto-expand when a cell produces them
- Local persistence of the working script

## Develop

```bash
npm install
npm run dev
```

```bash
npm run build
```

## Kernel helpers

```js
cello.table(rows, "sales")
cello.plot({ title: "Monthly revenue", labels, values })
console.log("hello")
```

Simple top-level `const` / `let` / `var name =` bindings are rewritten so values persist across cells in the shared kernel.
