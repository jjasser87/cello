# Cello

**One cell. Full focus.**

Cello is a minimalist, cell-based development environment. The main window stays on a single active cell; everything else — history, plots, files, environment, data, script flow, and an agent — lives in a contextual side panel you open when you need it.

## v0

- Plain-text scripts with `# %%` cell markers (easy to version-control and open elsewhere)
- Focused cell editor with rename / reorder / run
- Contextual right panel: Cells, History (red/green diffs), Plot, Files, Env, Data, Flow, Agent
- In-browser JavaScript kernel for exploratory runs (`console`, `cello.plot`, `cello.table`)
- Plot + data panels auto-activate when a cell produces them
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

Top-level `const` / `let` / `var` bindings are rewritten so values persist across cells in the shared kernel.
