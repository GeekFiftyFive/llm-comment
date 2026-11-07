import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeAnnotate, type Highlight } from './annotate';
import { api, type Comment, type DocumentInfo, hasToken, type NewComment } from './api';

type Mode = 'rendered' | 'source';
type Selection = Omit<NewComment, 'comment'>;

const MAX_QUOTE = 10_000;

const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Remote images are blocked by the CSP (they could leak data), so show a placeholder instead.
  img: ({ node: _node, alt, src, ...props }) => (
    <span {...props} className="img-placeholder" title={typeof src === 'string' ? src : undefined}>
      [image{alt ? `: ${alt}` : ''}]
    </span>
  ),
};

function lineRangeOf(node: Node, container: HTMLElement): [number, number] | null {
  const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-sl]');
  if (!element || !container.contains(element)) return null;
  return [Number(element.dataset.sl), Number(element.dataset.el)];
}

function readSelection(container: HTMLElement): Selection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const quote = selection.toString().trim();
  if (!quote) return null;
  const range = selection.getRangeAt(0);
  const start = lineRangeOf(range.startContainer, container);
  const end = lineRangeOf(range.endContainer, container);
  if (!start || !end) return null;
  return {
    startLine: Math.min(start[0], end[0]),
    endLine: Math.max(start[1], end[1]),
    quote: quote.slice(0, MAX_QUOTE),
  };
}

function linesLabel({ startLine, endLine }: Selection): string {
  return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
}

function submitOnModEnter(submit: () => void, cancel: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      cancel();
    }
  };
}

function Quote({ text }: { text: string }) {
  return <blockquote className="quote">{text.length > 280 ? `${text.slice(0, 280)}…` : text}</blockquote>;
}

function Composer(props: { selection: Selection; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await props.onSave(text.trim());
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="card composer">
      <div className="card-meta">{linesLabel(props.selection)}</div>
      <Quote text={props.selection.quote} />
      <textarea
        autoFocus
        value={text}
        placeholder="Add a comment…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={submitOnModEnter(save, props.onCancel)}
      />
      <div className="card-actions">
        <button type="button" onClick={props.onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!text.trim() || saving} onClick={save}>
          Comment
        </button>
      </div>
    </div>
  );
}

function CommentCard(props: {
  comment: Comment;
  active: boolean;
  onHover: (id: string | null) => void;
  onReveal: () => void;
  onUpdate: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { comment } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.comment);
  const save = async () => {
    if (!text.trim()) return;
    await props.onUpdate(text.trim());
    setEditing(false);
  };
  const cancel = () => {
    setText(comment.comment);
    setEditing(false);
  };

  return (
    <div
      className={`card${props.active ? ' active' : ''}`}
      onMouseEnter={() => props.onHover(comment.id)}
      onMouseLeave={() => props.onHover(null)}
    >
      <button type="button" className="card-meta link" onClick={props.onReveal}>
        {linesLabel(comment)}
      </button>
      <Quote text={comment.quote} />
      {editing ? (
        <>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={submitOnModEnter(save, cancel)} />
          <div className="card-actions">
            <button type="button" onClick={cancel}>Cancel</button>
            <button type="button" className="primary" disabled={!text.trim()} onClick={save}>Save</button>
          </div>
        </>
      ) : (
        <>
          <p className="comment-text">{comment.comment}</p>
          <div className="card-actions">
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="danger" onClick={props.onDelete}>Delete</button>
          </div>
        </>
      )}
    </div>
  );
}

function SourceView({ content, highlights }: { content: string; highlights: Highlight[] }) {
  const lines = content.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return (
    <pre className="source">
      {lines.map((line, index) => {
        const number = index + 1;
        const hits = highlights.filter((h) => h.startLine <= number && h.endLine >= number);
        const className = ['line', hits.length > 0 && 'hl', hits.some((h) => h.active) && 'hl-active']
          .filter(Boolean)
          .join(' ');
        return (
          <div key={number} className={className} data-sl={number} data-el={number} data-ln={number}>
            {line || '\n'}
          </div>
        );
      })}
    </pre>
  );
}

export function App() {
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [mode, setMode] = useState<Mode>('rendered');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(hasToken ? null : 'This page needs the link printed by llm-comment.');
  const [finished, setFinished] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasToken) return;
    Promise.all([api.document(), api.comments()])
      .then(([doc, file]) => {
        setDoc(doc);
        setComments(file.comments);
        setFinished(file.status === 'done');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const guard = useCallback(async (action: () => Promise<void>) => {
    try {
      setError(null);
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.startLine - b.startLine || a.createdAt.localeCompare(b.createdAt)),
    [comments],
  );

  const highlights = useMemo<Highlight[]>(() => {
    const list = comments.map((c) => ({ startLine: c.startLine, endLine: c.endLine, active: c.id === activeId }));
    if (selection) list.push({ ...selection, active: true });
    return list;
  }, [comments, activeId, selection]);

  const rehypePlugins = useMemo<Options['rehypePlugins']>(() => [[rehypeAnnotate, { highlights }]], [highlights]);

  const onMouseUp = () => {
    if (!documentRef.current) return;
    const next = readSelection(documentRef.current);
    if (next) setSelection(next);
  };

  const reveal = (comment: Comment) => {
    const elements = documentRef.current?.querySelectorAll<HTMLElement>('[data-sl]') ?? [];
    const target = [...elements].find(
      (el) => Number(el.dataset.sl) <= comment.endLine && Number(el.dataset.el) >= comment.startLine,
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const addComment = (text: string) =>
    guard(async () => {
      if (!selection) return;
      const created = await api.add({ ...selection, comment: text });
      setComments((list) => [...list, created]);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    });

  const finish = () =>
    guard(async () => {
      await api.done();
      setFinished(true);
    });

  if (finished) {
    return (
      <main className="finished">
        <h1>Review finished</h1>
        <p>
          {comments.length} comment{comments.length === 1 ? '' : 's'} saved. You can close this tab and go back to your
          agent.
        </p>
      </main>
    );
  }

  return (
    <div className="layout">
      <header className="toolbar">
        <strong className="title">llm-comment</strong>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={mode === 'rendered'} onClick={() => setMode('rendered')}>Rendered</button>
          <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>Source</button>
        </div>
        <span className="spacer" />
        <span className="count">{comments.length} comment{comments.length === 1 ? '' : 's'}</span>
        <button type="button" className="primary" disabled={!doc} onClick={finish}>Finish review</button>
      </header>

      {error && <div className="error" role="alert">{error}</div>}

      <main className="document" ref={documentRef} onMouseUp={onMouseUp}>
        {!doc ? (
          !error && <p className="muted">Loading…</p>
        ) : mode === 'rendered' ? (
          <article className="markdown">
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={markdownComponents}>
              {doc.content}
            </Markdown>
          </article>
        ) : (
          <SourceView content={doc.content} highlights={highlights} />
        )}
      </main>

      <aside className="sidebar">
        {selection && (
          <Composer
            key={`${selection.startLine}-${selection.endLine}-${selection.quote}`}
            selection={selection}
            onSave={addComment}
            onCancel={() => setSelection(null)}
          />
        )}
        {sorted.length === 0 && !selection && (
          <p className="muted hint">Select text in the document to leave a comment.</p>
        )}
        {sorted.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            active={comment.id === activeId}
            onHover={setActiveId}
            onReveal={() => reveal(comment)}
            onUpdate={(text) =>
              guard(async () => {
                const updated = await api.update(comment.id, text);
                setComments((list) => list.map((c) => (c.id === updated.id ? updated : c)));
              })
            }
            onDelete={() =>
              guard(async () => {
                await api.remove(comment.id);
                setComments((list) => list.filter((c) => c.id !== comment.id));
              })
            }
          />
        ))}
      </aside>
    </div>
  );
}
