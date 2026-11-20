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

clear_artifacts <- function() {
  .cello_state$logs <- character(0)
  .cello_state$plot <- NULL
  .cello_state$table <- NULL
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

    normalized <- normalize_rows(rows)
    .cello_state$table <- list(
      name = table_name,
      columns = as.list(normalized$columns),
      rows = normalized$rows
    )
    invisible(.cello_state$table)
  }
)

normalize_rows <- function(input) {
  if (is.null(input)) {
    return(list(columns = character(0), rows = list()))
  }

  if (is.data.frame(input)) {
    columns <- names(input)
    if (is.null(columns)) columns <- character(0)
    rows <- lapply(seq_len(nrow(input)), function(i) {
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
    rows <- lapply(seq_len(nrow(input)), function(i) {
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
    rows <- lapply(input, function(item) {
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

run_eval <- function(req) {
  clear_artifacts()
  cell_id <- if (is.null(req$cellId)) "" else as.character(req$cellId)
  code <- if (is.null(req$code)) "" else as.character(req$code)

  err <- NULL
  output_lines <- character(0)

  tryCatch(
    {
      output_lines <- capture.output(
        {
          withCallingHandlers(
            {
              expr <- parse(text = code)
              result <- withVisible(eval(expr, envir = .GlobalEnv, enclos = .GlobalEnv))
              if (isTRUE(result$visible)) {
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

  if (length(output_lines)) {
    .cello_state$logs <- c(.cello_state$logs, output_lines)
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
  stdin_con <- file("stdin", open = "r", blocking = TRUE)
  on.exit(try(close(stdin_con), silent = TRUE), add = TRUE)

  repeat {
    line <- readLines(stdin_con, n = 1L, warn = FALSE)
    if (length(line) == 0L) break
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
