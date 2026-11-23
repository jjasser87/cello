/**
 * Fixture: AI-style custom Flow chart (test 4) with subgraphs, styling,
 * dotted reasoning arrows, and invisible layout links — features the old
 * lightweight renderer dropped or mangled.
 */
export const TEST4_FLOW_MERMAID = `flowchart TD
  subgraph prep [Data prep]
    direction TB
    n_cell_load["1. Load<br/>libraries"]
    n_cell_data["2. Create<br/>random data"]
    n_cell_load --> n_cell_data
  end

  subgraph model [Model]
    direction TB
    n_cell_frame["3. Build<br/>data frame"]
    n_cell_fit["4. Fit<br/>model"]
    n_cell_frame --> n_cell_fit
  end

  subgraph plots [Plots]
    direction TB
    n_cell_box["5. Boxplot"]
    n_cell_hist["6. Histogram"]
  end

  n_cell_data --> n_cell_frame
  n_cell_data -.->|salaries, emp_ids| n_cell_frame
  n_cell_frame -.->|df| n_cell_fit
  n_cell_fit -.->|model| n_cell_box
  n_cell_fit -.->|model| n_cell_hist
  n_cell_frame -.->|df| n_cell_box
  n_cell_frame -.->|df| n_cell_hist

  %% Invisible links keep subgraph columns aligned in the panel.
  n_cell_load ~~~ n_cell_frame
  n_cell_frame ~~~ n_cell_box

  classDef current stroke:#c48a3a,stroke-width:2px,color:#f2ebe3
  classDef idle fill:#121212,stroke:#8b5a2b,color:#f2ebe3
  class n_cell_fit current
  class n_cell_load,n_cell_data,n_cell_frame,n_cell_box,n_cell_hist idle
  style prep fill:#0a0a0a,stroke:#8b5a2b,color:#e0a84a
  style model fill:#0a0a0a,stroke:#8b5a2b,color:#e0a84a
  style plots fill:#0a0a0a,stroke:#8b5a2b,color:#e0a84a
`

export function test4FlowMermaidFeatures(source = TEST4_FLOW_MERMAID) {
  return {
    hasSubgraph: /subgraph\s+\w+/i.test(source),
    hasStyle: /^\s*style\s+/m.test(source) || /^\s*classDef\s+/m.test(source),
    hasDottedArrow: /-\.->/.test(source),
    hasInvisibleLink: /~~~/.test(source),
    hasBrBreak: /<br\s*\/?>/i.test(source),
  }
}
