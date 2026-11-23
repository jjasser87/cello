# Cello R kernel worker — NDJSON over stdin/stdout.
# Requires jsonlite (installed into kernel/r/.lib by the Node host on first start).

emit_fatal <- function(message) {
  # Minimal JSON without jsonlite so boot failures still parse on the host.
  escaped <- gsub('"', '\\"', message, fixed = TRUE)
  cat(sprintf('{"type":"fatal","error":"%s"}\n', escaped))
  flush(stdout())
  quit(status = 2)
}

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  emit_fatal("jsonlite is required for the Cello R kernel")
}

suppressPackageStartupMessages(library(jsonlite, quietly = TRUE))

.cello_state <- new.env(parent = emptyenv())
.cello_state$logs <- character(0)
.cello_state$plot <- NULL
.cello_state$table <- NULL
.cello_state$native_plotted <- FALSE
.cello_state$last_visible <- NULL
# Cap Data-panel payloads so large frames stay responsive.
.CELLO_MAX_TABLE_ROWS <- 250L

clear_artifacts <- function() {
  .cello_state$logs <- character(0)
  .cello_state$plot <- NULL
  .cello_state$table <- NULL
  .cello_state$native_plotted <- FALSE
  .cello_state$last_visible <- NULL
}

append_log <- function(...) {
  parts <- lapply(list(...), function(x) {
    if (is.null(x)) {
      "NULL"
    } else if (is.atomic(x) && length(x) <= 1) {
      if (length(x) == 0) "" else as.character(x[[1]])
    } else if (is.atomic(x)) {
      paste(as.character(x), collapse = " ")
    } else {
      paste(capture.output(print(x)), collapse = " ")
    }
  })
  line <- paste(unlist(parts), collapse = " ")
  .cello_state$logs <- c(.cello_state$logs, line)
}

# Mirror of JS console helpers for familiar cell code.
console <- list(
  log = function(...) append_log(...),
  warn = function(...) append_log("warn:", ...),
  error = function(...) append_log("error:", ...)
)

cello <- list(
  plot = function(spec = NULL, ..., title = NULL, kind = NULL, labels = NULL, values = NULL) {
    if (!is.null(spec)) {
      if (!is.list(spec)) stop("cello.plot() expects a list/object with labels and values")
      if (!is.null(spec$title)) title <- spec$title
      if (!is.null(spec$kind)) kind <- spec$kind
      if (!is.null(spec$labels)) labels <- spec$labels
      if (!is.null(spec$values)) values <- spec$values
    }
    dots <- list(...)
    if (is.null(labels) && !is.null(dots$labels)) labels <- dots$labels
    if (is.null(values) && !is.null(dots$values)) values <- dots$values
    if (is.null(title) && !is.null(dots$title)) title <- dots$title
    if (is.null(kind) && !is.null(dots$kind)) kind <- dots$kind

    if (is.null(labels) || is.null(values)) {
      stop("cello.plot() requires labels and values")
    }
    labels <- as.character(unlist(labels))
    values <- as.numeric(unlist(values))
    if (length(labels) != length(values)) {
      stop("cello.plot() labels and values must be the same length")
    }
    values[!is.finite(values)] <- 0
    kind <- if (identical(as.character(kind)[1], "line")) "line" else "bar"
    title <- if (is.null(title) || !nzchar(as.character(title)[1])) {
      "Plot"
    } else {
      as.character(title)[1]
    }

    .cello_state$plot <- list(
      title = title,
      kind = kind,
      labels = as.list(labels),
      values = as.list(unname(values))
    )
    invisible(.cello_state$plot)
  },
  table = function(rows, name = "data") {
    table_name <- if (is.null(name) || !nzchar(as.character(name)[1])) {
      "data"
    } else {
      as.character(name)[1]
    }
    assign(table_name, rows, envir = .GlobalEnv)
    set_table_artifact(rows, table_name)
    invisible(.cello_state$table)
  }
)

is_tabular <- function(value) {
  if (is.null(value)) return(FALSE)
  # data.frame covers tibbles / data.table; matrices are rectangular too.
  is.data.frame(value) || is.matrix(value)
}

tabular_fingerprint <- function(value) {
  list(
    nrow = as.integer(nrow(value))[1],
    ncol = as.integer(ncol(value))[1],
    class = paste(class(value), collapse = "/")
  )
}

snapshot_tabular_env <- function() {
  out <- list()
  for (name in user_names()) {
    value <- tryCatch(
      get(name, envir = .GlobalEnv, inherits = FALSE),
      error = function(e) NULL
    )
    if (is_tabular(value)) {
      out[[name]] <- tabular_fingerprint(value)
    }
  }
  out
}

# Prefer the last `name <- …` assignment that matches candidates.
# Bare `=` is ignored — it is usually a named argument (data.frame, list, …).
pick_tabular_name <- function(code, candidates) {
  candidates <- as.character(candidates)
  candidates <- candidates[nzchar(candidates)]
  if (length(candidates) == 0L) return(NULL)
  if (length(candidates) == 1L) return(candidates[[1]])

  last_hit <- NULL
  for (name in candidates) {
    # Word-boundary-ish: start or non-name char before the symbol.
    pattern <- paste0("(^|[^A-Za-z0-9._])", name, "\\s*<-")
    hits <- gregexpr(pattern, code, perl = TRUE)[[1]]
    if (!identical(hits[[1]], -1L)) {
      pos <- max(hits)
      if (is.null(last_hit) || pos >= last_hit$pos) {
        last_hit <- list(name = name, pos = pos)
      }
    }
  }
  if (!is.null(last_hit)) return(last_hit$name)
  # Fallback: last candidate in sorted order (stable, deterministic).
  sort(candidates)[[length(candidates)]]
}

set_table_artifact <- function(value, name = "data") {
  table_name <- if (is.null(name) || !nzchar(as.character(name)[1])) {
    "data"
  } else {
    as.character(name)[1]
  }
  normalized <- normalize_rows(value)
  .cello_state$table <- list(
    name = table_name,
    columns = as.list(normalized$columns),
    rows = normalized$rows
  )
  invisible(.cello_state$table)
}

# Capture data.frame / tibble / matrix results without an explicit cello.table().
# Explicit cello.table() always wins (caller checks .cello_state$table is NULL).
capture_native_table <- function(code, visible_value, before_tabular) {
  if (!is.null(visible_value) && is_tabular(visible_value)) {
    # Prefer a GlobalEnv binding that is identical to the visible value.
    match_name <- NULL
    for (name in user_names()) {
      value <- tryCatch(
        get(name, envir = .GlobalEnv, inherits = FALSE),
        error = function(e) NULL
      )
      if (!is.null(value) && identical(value, visible_value)) {
        match_name <- name
        break
      }
    }
    set_table_artifact(visible_value, if (is.null(match_name)) "result" else match_name)
    return(invisible(TRUE))
  }

  after <- snapshot_tabular_env()
  changed <- character(0)
  for (name in names(after)) {
    prev <- before_tabular[[name]]
    if (is.null(prev) || !identical(prev, after[[name]])) {
      changed <- c(changed, name)
    }
  }

  # Include tabular bindings assigned with `<-` in this cell even when the
  # fingerprint is unchanged, so re-running a create/load cell still opens Data.
  assigned <- character(0)
  for (name in names(after)) {
    pattern <- paste0("(^|[^A-Za-z0-9._])", name, "\\s*<-")
    hits <- gregexpr(pattern, code, perl = TRUE)[[1]]
    if (!identical(hits[[1]], -1L)) {
      assigned <- c(assigned, name)
    }
  }

  candidates <- unique(c(changed, assigned))
  if (length(candidates) == 0L) return(invisible(FALSE))

  chosen <- pick_tabular_name(code, candidates)
  if (is.null(chosen)) return(invisible(FALSE))
  value <- tryCatch(
    get(chosen, envir = .GlobalEnv, inherits = FALSE),
    error = function(e) NULL
  )
  if (!is_tabular(value)) return(invisible(FALSE))
  set_table_artifact(value, chosen)
  invisible(TRUE)
}

normalize_rows <- function(input) {
  if (is.null(input)) {
    return(list(columns = character(0), rows = list()))
  }

  if (is.data.frame(input)) {
    columns <- names(input)
    if (is.null(columns)) columns <- character(0)
    n <- nrow(input)
    if (is.null(n) || is.na(n)) n <- 0L
    take <- seq_len(min(n, .CELLO_MAX_TABLE_ROWS))
    rows <- lapply(take, function(i) {
      row <- list()
      for (col in columns) {
        row[[col]] <- scalarize(input[[col]][[i]])
      }
      row
    })
    return(list(columns = columns, rows = rows))
  }

  if (is.matrix(input)) {
    columns <- colnames(input)
    if (is.null(columns)) columns <- paste0("V", seq_len(ncol(input)))
    n <- nrow(input)
    if (is.null(n) || is.na(n)) n <- 0L
    take <- seq_len(min(n, .CELLO_MAX_TABLE_ROWS))
    rows <- lapply(take, function(i) {
      row <- list()
      for (j in seq_along(columns)) {
        row[[columns[[j]]]] <- scalarize(input[i, j])
      }
      row
    })
    return(list(columns = columns, rows = rows))
  }

  if (is.list(input) && length(input) > 0 && is.list(input[[1]]) && !is.data.frame(input[[1]])) {
    columns <- unique(unlist(lapply(input, names)))
    if (is.null(columns)) columns <- character(0)
    take <- seq_len(min(length(input), .CELLO_MAX_TABLE_ROWS))
    rows <- lapply(input[take], function(item) {
      row <- list()
      for (col in columns) {
        row[[col]] <- scalarize(item[[col]])
      }
      row
    })
    return(list(columns = as.character(columns), rows = rows))
  }

  if (is.atomic(input) || is.list(input)) {
    vals <- as.list(input)
    if (length(vals) > .CELLO_MAX_TABLE_ROWS) {
      vals <- vals[seq_len(.CELLO_MAX_TABLE_ROWS)]
    }
    rows <- lapply(vals, function(v) list(value = scalarize(v)))
    return(list(columns = "value", rows = rows))
  }

  list(columns = character(0), rows = list())
}

scalarize <- function(value) {
  if (is.null(value) || length(value) == 0) return(NULL)
  if (length(value) > 1) return(paste(as.character(value), collapse = ", "))
  if (is.logical(value) || is.numeric(value) || is.character(value)) {
    if (is.na(value)) return(NULL)
    return(unname(value[[1]]))
  }
  paste(as.character(value), collapse = " ")
}

preview_value <- function(value) {
  if (is.null(value)) return(list(kind = "null", preview = "NULL"))
  if (is.function(value)) {
    return(list(kind = "function", preview = "function()"))
  }
  if (is.data.frame(value)) {
    return(list(
      kind = "object",
      preview = sprintf("data.frame(%d × %d)", nrow(value), ncol(value))
    ))
  }
  if (is.matrix(value)) {
    return(list(
      kind = "array",
      preview = sprintf("matrix(%d × %d)", nrow(value), ncol(value))
    ))
  }
  if (is.list(value) && !is.data.frame(value)) {
    nms <- names(value)
    if (is.null(nms)) {
      return(list(kind = "object", preview = sprintf("list(%d)", length(value))))
    }
    shown <- paste(utils::head(nms, 4), collapse = ", ")
    if (length(nms) > 4) shown <- paste0(shown, ", …")
    return(list(kind = "object", preview = paste0("list(", shown, ")")))
  }
  if (is.atomic(value) && length(value) > 1) {
    return(list(
      kind = "array",
      preview = sprintf("%s[%d]", typeof(value), length(value))
    ))
  }
  if (is.numeric(value)) return(list(kind = "number", preview = as.character(value[[1]])))
  if (is.character(value)) {
    return(list(kind = "string", preview = as.character(toJSON(value[[1]], auto_unbox = TRUE))))
  }
  if (is.logical(value)) {
    return(list(kind = "boolean", preview = if (isTRUE(value[[1]])) "TRUE" else "FALSE"))
  }
  list(kind = "string", preview = paste(as.character(value), collapse = " "))
}

# Dot-name wrappers so cells can call cello.plot / cello.table like the JS helpers.
cello.plot <- function(...) cello$plot(...)
cello.table <- function(...) cello$table(...)

# Frozen after worker bootstrap; user Env / Reset only touch names outside this set.
.WORKER_NAMES <- NULL

user_names <- function() {
  names <- ls(envir = .GlobalEnv, all.names = FALSE)
  sort(setdiff(names, .WORKER_NAMES))
}

snapshot_env <- function() {
  lapply(user_names(), function(name) {
    value <- get(name, envir = .GlobalEnv, inherits = FALSE)
    pv <- preview_value(value)
    list(name = name, kind = pv$kind, preview = pv$preview)
  })
}

emit <- function(payload) {
  line <- toJSON(payload, auto_unbox = TRUE, null = "null", digits = NA)
  cat(line, "\n", sep = "")
  flush(stdout())
}

reset_kernel <- function() {
  objs <- user_names()
  if (length(objs)) rm(list = objs, envir = .GlobalEnv)
  clear_artifacts()
}

# R's parse(text=) rejects bare CR. Windows CRLF / old-Mac CR / UTF-8 BOM
# must be normalized before parsing or every multi-line cell fails.
normalize_source <- function(code) {
  if (is.null(code)) return("")
  text <- paste(as.character(code), collapse = "\n")
  # Strip UTF-8 BOM (U+FEFF) if present.
  if (nzchar(text) && identical(substr(text, 1L, 1L), "\ufeff")) {
    text <- substr(text, 2L, nchar(text, type = "chars"))
  }
  text <- gsub("\r\n", "\n", text, fixed = TRUE)
  text <- gsub("\r", "\n", text, fixed = TRUE)
  text
}

# Soft-open a PNG device for base plot() / ggplot print / lattice / etc.
# Returns the temp file path on success, or NULL when graphics are unavailable.
open_native_plot_device <- function() {
  if (!isTRUE(capabilities("png"))) {
    append_log("Native plot capture unavailable: R was built without PNG support.")
    return(NULL)
  }

  plot_file <- tempfile(fileext = ".png")
  opened <- FALSE
  err_msg <- NULL

  if (isTRUE(capabilities("cairo"))) {
    tryCatch(
      {
        grDevices::png(
          filename = plot_file,
          width = 720,
          height = 480,
          res = 96,
          type = "cairo",
          bg = "white"
        )
        opened <- TRUE
      },
      error = function(e) {
        err_msg <<- conditionMessage(e)
      }
    )
  }

  if (!opened) {
    tryCatch(
      {
        grDevices::png(
          filename = plot_file,
          width = 720,
          height = 480,
          res = 96,
          bg = "white"
        )
        opened <- TRUE
      },
      error = function(e) {
        err_msg <<- conditionMessage(e)
      }
    )
  }

  if (!opened) {
    append_log(paste(
      "Native plot capture unavailable:",
      if (is.null(err_msg)) "could not open PNG device" else err_msg
    ))
    unlink(plot_file)
    return(NULL)
  }

  plot_file
}

mark_native_plotted <- function(...) {
  .cello_state$native_plotted <- TRUE
  invisible(NULL)
}

install_plot_hooks <- function() {
  list(
    plot.new = getHook("plot.new"),
    grid.newpage = getHook("grid.newpage")
  )
}

restore_plot_hooks <- function(previous) {
  setHook("plot.new", previous$plot.new, "replace")
  setHook("grid.newpage", previous$grid.newpage, "replace")
}

encode_native_plot <- function(plot_file) {
  if (is.null(plot_file) || !isTRUE(.cello_state$native_plotted)) {
    return(NULL)
  }
  if (!file.exists(plot_file)) return(NULL)
  info <- file.info(plot_file)
  if (is.na(info$size) || info$size < 32) return(NULL)

  raw <- tryCatch(
    readBin(plot_file, what = "raw", n = info$size),
    error = function(e) NULL
  )
  if (is.null(raw) || length(raw) == 0) return(NULL)

  b64 <- tryCatch(jsonlite::base64_enc(raw), error = function(e) NULL)
  if (is.null(b64) || !nzchar(b64)) return(NULL)
  # jsonlite wraps base64; newlines break data: URLs in the browser.
  b64 <- gsub("[\r\n[:space:]]", "", b64)

  list(
    title = "Plot",
    kind = "image",
    imageData = paste0("data:image/png;base64,", b64),
    labels = list(),
    values = list()
  )
}

# —— Completions (v1) ————————————————————————————————————————————————
# Prefer utils rcompgen for `$` / `::` / search-path symbols; soft-fallback
# to .GlobalEnv + attached package names when internals are unavailable.

extract_line_at_cursor <- function(code, cursor) {
  if (!nzchar(code)) {
    return(list(line = "", end = 0L, start = 0L))
  }
  cursor <- as.integer(cursor)
  if (is.na(cursor) || cursor < 0L) cursor <- 0L
  n <- nchar(code, type = "chars")
  if (cursor > n) cursor <- n

  before <- substr(code, 1L, cursor)
  after <- if (cursor < n) substr(code, cursor + 1L, n) else ""

  line_start <- gregexpr("\n", before, fixed = TRUE)[[1]]
  if (identical(line_start[[1]], -1L)) {
    start <- 0L
  } else {
    start <- max(line_start)
  }
  line_before <- if (start == 0L) before else substr(before, start + 1L, cursor)

  line_end_m <- regexpr("\n", after, fixed = TRUE)[[1]]
  line_after <- if (identical(line_end_m, -1L)) after else substr(after, 1L, line_end_m - 1L)

  list(
    line = paste0(line_before, line_after),
    end = nchar(line_before, type = "chars"),
    start = start
  )
}

guess_prefix <- function(line, end) {
  before <- substr(line, 1L, end)
  m <- regexpr("([A-Za-z.][A-Za-z0-9._]*|)$", before, perl = TRUE)
  if (identical(m[[1]], -1L)) return("")
  substr(before, m[[1]], end)
}

attached_names <- function(prefix = "") {
  names <- character(0)
  for (env_name in search()) {
    objs <- tryCatch(ls(env_name, all.names = FALSE), error = function(e) character(0))
    names <- c(names, objs)
  }
  names <- unique(c(user_names(), names))
  if (nzchar(prefix)) {
    names <- names[startsWith(names, prefix)]
  }
  sort(names)
}

member_names <- function(expr_text, prefix = "") {
  value <- tryCatch(
    eval(parse(text = expr_text), envir = .GlobalEnv, enclos = .GlobalEnv),
    error = function(e) NULL
  )
  if (is.null(value)) return(character(0))
  nms <- tryCatch({
    if (is.environment(value)) {
      ls(value, all.names = FALSE)
    } else if (is.data.frame(value) || is.list(value)) {
      names(value)
    } else if (is.atomic(value) && !is.null(names(value))) {
      names(value)
    } else {
      character(0)
    }
  }, error = function(e) character(0))
  if (is.null(nms)) nms <- character(0)
  nms <- as.character(nms)
  if (nzchar(prefix)) nms <- nms[startsWith(nms, prefix)]
  sort(unique(nms[nzchar(nms)]))
}

package_exports <- function(pkg, prefix = "", triple = FALSE) {
  if (!nzchar(pkg)) return(character(0))
  nms <- tryCatch({
    if (isTRUE(triple)) {
      ls(asNamespace(pkg), all.names = FALSE)
    } else {
      getNamespaceExports(pkg)
    }
  }, error = function(e) character(0))
  nms <- as.character(nms)
  if (nzchar(prefix)) nms <- nms[startsWith(nms, prefix)]
  sort(unique(nms[nzchar(nms)]))
}

classify_completion <- function(name) {
  if (!exists(name, envir = .GlobalEnv, inherits = TRUE)) {
    return("symbol")
  }
  value <- tryCatch(
    get(name, envir = .GlobalEnv, inherits = TRUE),
    error = function(e) NULL
  )
  if (is.null(value)) return("symbol")
  if (is.function(value)) return("function")
  if (is.data.frame(value) || is.list(value)) return("object")
  if (is.atomic(value) && length(value) > 1) return("array")
  "binding"
}

complete_manual <- function(line, end) {
  before <- substr(line, 1L, end)

  # pkg:::name or pkg::name
  m_ns <- regexec(
    "([A-Za-z.][A-Za-z0-9.]*)(::{1,3})([A-Za-z.][A-Za-z0-9._]*)?$",
    before,
    perl = TRUE
  )[[1]]
  if (!identical(m_ns[[1]], -1L)) {
    pkg <- substr(before, m_ns[[2]], m_ns[[2]] + attr(m_ns, "match.length")[[2]] - 1L)
    op <- substr(before, m_ns[[3]], m_ns[[3]] + attr(m_ns, "match.length")[[3]] - 1L)
    token_len <- attr(m_ns, "match.length")[[4]]
    token <- if (is.na(token_len) || token_len <= 0L) {
      ""
    } else {
      substr(before, m_ns[[4]], m_ns[[4]] + token_len - 1L)
    }
    items <- package_exports(pkg, token, triple = identical(op, ":::"))
    return(list(prefix = token, items = items, kind = "namespace"))
  }

  # obj$member
  m_dollar <- regexec(
    "([A-Za-z.][A-Za-z0-9._]*)\\$([A-Za-z.][A-Za-z0-9._]*)?$",
    before,
    perl = TRUE
  )[[1]]
  if (!identical(m_dollar[[1]], -1L)) {
    obj <- substr(
      before,
      m_dollar[[2]],
      m_dollar[[2]] + attr(m_dollar, "match.length")[[2]] - 1L
    )
    token_len <- attr(m_dollar, "match.length")[[3]]
    token <- if (is.na(token_len) || token_len <= 0L) {
      ""
    } else {
      substr(before, m_dollar[[3]], m_dollar[[3]] + token_len - 1L)
    }
    items <- member_names(obj, token)
    return(list(prefix = token, items = items, kind = "member"))
  }

  token <- guess_prefix(line, end)
  items <- attached_names(token)
  list(prefix = token, items = items, kind = "symbol")
}

complete_rcompgen <- function(line, end) {
  ns <- asNamespace("utils")
  assign_line <- get(".assignLinebuffer", envir = ns)
  assign_end <- get(".assignEnd", envir = ns)
  guess <- get(".guessTokenFromLine", envir = ns)
  complete_tok <- get(".completeToken", envir = ns)
  retrieve <- get(".retrieveCompletions", envir = ns)
  comp_env <- get(".CompletionEnv", envir = ns)

  assign_line(line)
  assign_end(as.integer(end))
  guess()
  complete_tok()
  comps <- retrieve()
  token <- tryCatch(comp_env$token, error = function(e) "")
  if (is.null(token) || length(token) == 0L || is.na(token[[1]])) token <- ""
  else token <- as.character(token[[1]])
  list(prefix = token, items = as.character(comps), kind = "rcompgen")
}

run_complete <- function(req) {
  code <- normalize_source(if (is.null(req$code)) "" else req$code)
  cursor <- if (is.null(req$cursor)) {
    nchar(code, type = "chars")
  } else {
    as.integer(req$cursor)
  }
  if (length(cursor) != 1L || is.na(cursor)) {
    cursor <- nchar(code, type = "chars")
  }

  loc <- extract_line_at_cursor(code, cursor)
  result <- tryCatch(
    complete_rcompgen(loc$line, loc$end),
    error = function(e) NULL
  )
  if (is.null(result)) {
    result <- complete_manual(loc$line, loc$end)
  } else if (length(result$items) == 0L) {
    # rcompgen sometimes returns empty for GlobalEnv-only prefixes; merge manual.
    manual <- complete_manual(loc$line, loc$end)
    if (length(manual$items)) {
      result$items <- unique(c(result$items, manual$items))
      if (!nzchar(result$prefix)) result$prefix <- manual$prefix
    }
  }

  # Cap payload — editor only shows a short list.
  items <- unique(as.character(result$items))
  items <- items[nzchar(items)]
  if (length(items) > 80L) items <- items[seq_len(80L)]

  prefix <- if (is.null(result$prefix)) "" else as.character(result$prefix)[[1]]
  list(
    type = "completions",
    id = req$id,
    prefix = prefix,
    items = lapply(items, function(label) {
      list(label = label, kind = classify_completion(label))
    }),
    error = NULL
  )
}

run_eval <- function(req) {
  clear_artifacts()
  cell_id <- if (is.null(req$cellId)) "" else as.character(req$cellId)
  code <- normalize_source(if (is.null(req$code)) "" else req$code)

  err <- NULL
  output_lines <- character(0)
  plot_file <- NULL
  previous_hooks <- NULL
  before_tabular <- snapshot_tabular_env()

  tryCatch(
    {
      plot_file <- open_native_plot_device()
      if (!is.null(plot_file)) {
        previous_hooks <- install_plot_hooks()
        setHook("plot.new", mark_native_plotted, "append")
        setHook("grid.newpage", mark_native_plotted, "append")
      }

      output_lines <- capture.output(
        {
          withCallingHandlers(
            {
              expr <- parse(text = code, encoding = "UTF-8")
              result <- withVisible(eval(expr, envir = .GlobalEnv, enclos = .GlobalEnv))
              if (isTRUE(result$visible)) {
                # Keep off .GlobalEnv — <<- would leak a user binding.
                .cello_state$last_visible <- result$value
                print(result$value)
              }
            },
            message = function(m) {
              append_log(conditionMessage(m))
              invokeRestart("muffleMessage")
            },
            warning = function(w) {
              append_log(paste("warning:", conditionMessage(w)))
              invokeRestart("muffleWarning")
            }
          )
        },
        type = "output"
      )
    },
    error = function(e) {
      err <<- conditionMessage(e)
    }
  )

  # Close the capture device before restoring hooks / reading the PNG.
  if (!is.null(plot_file)) {
    while (grDevices::dev.cur() > 1L) {
      try(grDevices::dev.off(), silent = TRUE)
    }
  }
  if (!is.null(previous_hooks)) {
    restore_plot_hooks(previous_hooks)
  }

  if (length(output_lines)) {
    .cello_state$logs <- c(.cello_state$logs, output_lines)
  }

  # Explicit cello.plot() wins; otherwise surface native graphics as an image.
  if (is.null(.cello_state$plot)) {
    native <- encode_native_plot(plot_file)
    if (!is.null(native)) {
      .cello_state$plot <- native
    }
  }
  if (!is.null(plot_file)) {
    unlink(plot_file)
  }

  # Explicit cello.table() wins; otherwise auto-capture data.frame / tibble / matrix.
  if (is.null(.cello_state$table) && is.null(err)) {
    tryCatch(
      capture_native_table(code, .cello_state$last_visible, before_tabular),
      error = function(e) invisible(FALSE)
    )
  }

  plot <- .cello_state$plot
  if (!is.null(plot)) {
    plot$cellId <- cell_id
  }
  table <- .cello_state$table
  if (!is.null(table)) {
    table$cellId <- cell_id
  }

  list(
    type = "result",
    id = req$id,
    logs = as.list(.cello_state$logs),
    plot = plot,
    table = table,
    env = snapshot_env(),
    error = err
  )
}

.WORKER_NAMES <- ls(envir = .GlobalEnv, all.names = TRUE)

emit(list(
  type = "ready",
  language = "r",
  version = paste(R.version$major, R.version$minor, sep = ".")
))

local({
  # Explicit UTF-8 so Windows system code pages don't reinterpret NDJSON bytes.
  stdin_con <- tryCatch(
    file("stdin", open = "r", blocking = TRUE, encoding = "UTF-8"),
    error = function(e) file("stdin", open = "r", blocking = TRUE)
  )
  on.exit(try(close(stdin_con), silent = TRUE), add = TRUE)

  repeat {
    line <- readLines(stdin_con, n = 1L, warn = FALSE, encoding = "UTF-8")
    if (length(line) == 0L) break
    # Defend against BOM on the first protocol line (some Windows pipes).
    if (identical(substr(line, 1L, 1L), "\ufeff")) {
      line <- substr(line, 2L, nchar(line, type = "chars"))
    }
    if (!nzchar(line)) next

    req <- tryCatch(fromJSON(line, simplifyVector = FALSE), error = function(e) NULL)
    if (is.null(req) || is.null(req$op)) {
      emit(list(
        type = "result",
        id = NULL,
        error = "invalid request",
        logs = list(),
        plot = NULL,
        table = NULL,
        env = list()
      ))
      next
    }

    if (identical(req$op, "ping")) {
      emit(list(type = "pong", id = req$id))
      next
    }

    # Lightweight working-directory change for Open folder (structure B).
    # Must NOT go through run_eval — that opens a PNG device and has hung
    # Rscript on Windows (STATUS_APPLICATION_HANG / exit 3489660927).
    if (identical(req$op, "cwd")) {
      target <- if (is.null(req$path) || !nzchar(as.character(req$path)[1])) {
        NULL
      } else {
        as.character(req$path)[1]
      }
      err <- NULL
      if (!is.null(target)) {
        tryCatch(
          setwd(target),
          error = function(e) {
            err <<- conditionMessage(e)
          }
        )
      }
      cwd_now <- tryCatch(
        normalizePath(getwd(), winslash = "/", mustWork = FALSE),
        error = function(e) getwd()
      )
      emit(list(
        type = "result",
        id = req$id,
        logs = list(),
        plot = NULL,
        table = NULL,
        env = list(),
        error = err,
        cwd = cwd_now
      ))
      next
    }

    if (identical(req$op, "reset")) {
      reset_kernel()
      emit(list(
        type = "result",
        id = req$id,
        logs = list("Kernel cleared."),
        plot = NULL,
        table = NULL,
        env = list(),
        error = NULL
      ))
      next
    }

    if (identical(req$op, "eval")) {
      result <- tryCatch(
        run_eval(req),
        error = function(e) {
          list(
            type = "result",
            id = req$id,
            logs = as.list(.cello_state$logs),
            plot = .cello_state$plot,
            table = .cello_state$table,
            env = snapshot_env(),
            error = conditionMessage(e)
          )
        }
      )
      emit(result)
      next
    }

    if (identical(req$op, "complete")) {
      result <- tryCatch(
        run_complete(req),
        error = function(e) {
          list(
            type = "completions",
            id = req$id,
            prefix = "",
            items = list(),
            error = conditionMessage(e)
          )
        }
      )
      emit(result)
      next
    }

    emit(list(
      type = "result",
      id = req$id,
      error = paste("unknown op:", req$op),
      logs = list(),
      plot = NULL,
      table = NULL,
      env = list()
    ))
  }
})
