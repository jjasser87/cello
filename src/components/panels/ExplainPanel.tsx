import { useState } from 'react'
import { renderExplanationHtml } from '../../lib/explanation'
import { formatPanelTimestamp } from '../../lib/formatTimestamp'
import type { WorkspaceApi } from '../../hooks/useWorkspace'
import type { ExplanationComment } from '../../types'

interface ExplainPanelProps {
  api: WorkspaceApi
}

export function ExplainPanel({ api }: ExplainPanelProps) {
  const { activeCell, updateExplanation, addExplanationComment } = api
  // Remount per cell so mode + draft comment reset without an effect.
  return (
    <ExplainPanelBody
      key={activeCell.id}
      cellId={activeCell.id}
      cellName={activeCell.name}
      explanation={activeCell.explanation}
      comments={activeCell.comments ?? []}
      updateExplanation={updateExplanation}
      addExplanationComment={addExplanationComment}
    />
  )
}

function ExplainPanelBody({
  cellId,
  cellName,
  explanation,
  comments,
  updateExplanation,
  addExplanationComment,
}: {
  cellId: string
  cellName: string
  explanation: string
  comments: ExplanationComment[]
  updateExplanation: WorkspaceApi['updateExplanation']
  addExplanationComment: WorkspaceApi['addExplanationComment']
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [draftComment, setDraftComment] = useState('')

  const submitComment = () => {
    const body = draftComment.trim()
    if (!body) return
    addExplanationComment(cellId, body)
    setDraftComment('')
  }

  return (
    <div className="explain-panel">
      <div className="explain-toolbar">
        <div className="explain-mode" role="group" aria-label="Explanation mode">
          <button
            type="button"
            className={mode === 'edit' ? 'is-active' : ''}
            aria-pressed={mode === 'edit'}
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            className={mode === 'preview' ? 'is-active' : ''}
            aria-pressed={mode === 'preview'}
            onClick={() => setMode('preview')}
          >
            Preview
          </button>
        </div>
        <span className="muted small explain-cell-label" title={cellName}>
          {cellName}
        </span>
      </div>

      {mode === 'edit' ? (
        <textarea
          className="explain-editor"
          value={explanation}
          onChange={(event) => updateExplanation(cellId, event.target.value)}
          spellCheck={false}
          aria-label="Cell explanation Markdown"
          placeholder="## Purpose"
        />
      ) : (
        <div
          className="explain-preview"
          // Safe: renderExplanationHtml escapes raw HTML before light Markdown.
          dangerouslySetInnerHTML={{ __html: renderExplanationHtml(explanation) }}
        />
      )}

      <section className="explain-comments" aria-label="Explanation comments">
        <div className="explain-comments-header">
          <h3>Comments</h3>
          <span className="muted small">{comments.length}</span>
        </div>

        {comments.length === 0 ? (
          <p className="muted small explain-comments-empty">
            Leave feedback for focus auditing — later AI loops can read these.
          </p>
        ) : (
          <ul className="explain-comment-list">
            {comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))}
          </ul>
        )}

        <div className="explain-compose">
          <input
            value={draftComment}
            onChange={(event) => setDraftComment(event.target.value)}
            placeholder="Add a comment…"
            aria-label="New explanation comment"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitComment()
              }
            }}
          />
          <button
            type="button"
            className="primary"
            onClick={submitComment}
            disabled={!draftComment.trim()}
            aria-label="Add comment"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  )
}

function CommentItem({ comment }: { comment: ExplanationComment }) {
  return (
    <li className="explain-comment">
      <div className="explain-comment-meta">
        <span className="explain-comment-author">{comment.author}</span>
        <time dateTime={new Date(comment.createdAt).toISOString()}>
          {formatPanelTimestamp(comment.createdAt)}
        </time>
      </div>
      <p className="explain-comment-body">{comment.body}</p>
    </li>
  )
}
