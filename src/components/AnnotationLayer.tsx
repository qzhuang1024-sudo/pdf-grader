import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, ArrowAnnotation, NoteAnnotation, PenAnnotation, RectAnnotation, TextAnnotation, ToolId } from '../types';
import { useStore } from '../store/useStore';
import {
  NOTE_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  arrowHead,
  baseToDisplay,
  displayToBase,
  normRect,
  penPath,
  rotatedSize,
  rotationTransform,
  simplifyPoints,
  translateAnnotation,
  uid,
  type ViewRotation,
} from '../lib/util';
import { layoutText } from '../lib/textMeasure';

interface Props {
  fileId: string;
  page: number;
  baseW: number;
  baseH: number;
  zoom: number;
  rotation: ViewRotation;
  annotations: Annotation[];
}

type Draft =
  | { kind: 'rect'; type: RectAnnotation['type']; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'pen'; points: number[] }
  | { kind: 'arrow'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'textbox'; x0: number; y0: number; x1: number; y1: number }
  | null;

interface Editor {
  mode: 'text' | 'note';
  annId: string | null; // null → creating a new one
  x: number;
  y: number;
  text: string;
  rotation: number;
  boxed?: boolean;
  width?: number;
}

/** at most one inline editor open across all pages */
let openEditors = 0;

const r2 = (v: number) => Math.round(v * 100) / 100;

const RECT_TOOLS: ToolId[] = ['highlight', 'underline', 'strikethrough', 'rectangle', 'ellipse'];

function AnnotationLayerImpl({ fileId, page, baseW, baseH, zoom, rotation, annotations }: Props) {
  const tool = useStore((s) => s.tool);
  const styles = useStore((s) => s.styles);
  const selectedAnnId = useStore((s) => s.selectedAnnId);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [drag, setDrag] = useState<{ id: string; sx: number; sy: number; dx: number; dy: number } | null>(null);
  const [resize, setResize] = useState<{ id: string; sx: number; sy: number; startW: number; w: number } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  const disp = rotatedSize(baseW, baseH, rotation);
  const hitW = Math.max(8 / zoom, 4);

  const toBase = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      const dx = (clientX - r.left) / zoom;
      const dy = (clientY - r.top) / zoom;
      const p = displayToBase(dx, dy, baseW, baseH, rotation);
      return { x: Math.max(0, Math.min(baseW, p.x)), y: Math.max(0, Math.min(baseH, p.y)) };
    },
    [zoom, baseW, baseH, rotation],
  );

  // keep global editor counter in sync
  useEffect(() => {
    if (!editor) return;
    openEditors++;
    return () => {
      openEditors--;
    };
  }, [!!editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── commit helpers ─────────────────────────────────────────────────────────
  const commitEditor = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    editorRef.current = null;
    setEditor(null);
    const st = useStore.getState();
    const text = ed.text.replace(/\s+$/, '');
    if (ed.annId) {
      const existing = st.annotations.find((a) => a.id === ed.annId);
      if (!existing) return;
      if (!text && existing.type === 'text') st.removeAnnotation(ed.annId);
      else if ((existing as TextAnnotation | NoteAnnotation).text !== text) st.updateAnnotation(ed.annId, { text } as Partial<Annotation>);
    } else if (text) {
      const now = Date.now();
      const style = st.styles[ed.mode];
      const base = { id: uid('ann_'), fileId, page, createdAt: now, updatedAt: now, color: style.color, opacity: style.opacity };
      if (ed.mode === 'text') {
        st.addAnnotation({
          ...base, type: 'text', x: r2(ed.x), y: r2(ed.y), text, fontSize: style.strokeWidth, strokeWidth: 0, rotation: ed.rotation,
          ...(ed.boxed ? { boxed: true } : {}), ...(ed.width ? { width: r2(ed.width) } : {}),
        });
      } else {
        st.addAnnotation({ ...base, type: 'note', x: r2(ed.x), y: r2(ed.y), text, strokeWidth: 1 });
      }
    }
  }, [fileId, page]);

  // close editor when file/tool changes
  useEffect(() => () => commitEditor(), [commitEditor]);

  /** open the inline editor for a new text annotation after a click or a drag with the Text tool */
  const openTextEditor = (d: { x0: number; y0: number; x1: number; y1: number }) => {
    const st = useStore.getState();
    const fs = st.styles.text.strokeWidth;
    const boxed = st.textBoxed;
    // work in display (view) coordinates so "width" is horizontal for the reader
    const a = baseToDisplay(d.x0, d.y0, baseW, baseH, rotation);
    const b = baseToDisplay(d.x1, d.y1, baseW, baseH, rotation);
    const dragW = Math.abs(b.x - a.x);
    let left: number, top: number, width: number | undefined;
    if (dragW * zoom >= 24) {
      left = Math.min(a.x, b.x);
      top = Math.min(a.y, b.y);
      width = dragW;
    } else {
      // click: first line vertically centred on the click
      const pad = boxed ? Math.max(3, fs * 0.35) : 0;
      left = a.x - pad;
      top = a.y - fs * 0.6 - pad;
    }
    const anchor = displayToBase(left, top, baseW, baseH, rotation);
    setEditor({ mode: 'text', annId: null, x: anchor.x, y: anchor.y, text: '', rotation, boxed, width });
  };

  // ── pointer handling ───────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const st = useStore.getState();
    const p = toBase(e.clientX, e.clientY);
    const target = (e.target as Element).closest('[data-ann-id]') as SVGElement | null;
    const annId = target?.dataset.annId ?? null;

    if (openEditors > 0) {
      // first click outside an open editor just closes it (blur commits)
      return;
    }

    if (tool === 'select') {
      const handle = (e.target as Element).closest('[data-resize-for]') as SVGElement | null;
      if (handle) {
        const t = st.annotations.find((x) => x.id === handle.dataset.resizeFor);
        if (t?.type === 'text') {
          e.preventDefault();
          svgRef.current!.setPointerCapture(e.pointerId);
          const w = layoutText(t).boxW;
          setResize({ id: t.id, sx: p.x, sy: p.y, startW: w, w });
        }
        return;
      }
      if (annId) {
        st.select(annId);
        const a = st.annotations.find((x) => x.id === annId);
        if (a?.type === 'note') {
          setEditor({ mode: 'note', annId, x: a.x, y: a.y, text: a.text, rotation: 0 });
          e.preventDefault();
          return;
        }
        svgRef.current!.setPointerCapture(e.pointerId);
        setDrag({ id: annId, sx: p.x, sy: p.y, dx: 0, dy: 0 });
      } else {
        st.select(null);
      }
      return;
    }

    if (tool === 'eraser') {
      if (annId) st.removeAnnotation(annId);
      svgRef.current!.setPointerCapture(e.pointerId);
      setDraft(null);
      return;
    }

    e.preventDefault();
    if (tool === 'text') {
      // click → text grows with what you type; drag → text box of that width (text wraps)
      svgRef.current!.setPointerCapture(e.pointerId);
      setDraft({ kind: 'textbox', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    if (tool === 'note') {
      setEditor({ mode: 'note', annId: null, x: p.x - NOTE_SIZE / 2, y: p.y - NOTE_SIZE / 2, text: '', rotation: 0 });
      return;
    }

    svgRef.current!.setPointerCapture(e.pointerId);
    if (RECT_TOOLS.includes(tool)) {
      setDraft({ kind: 'rect', type: tool as RectAnnotation['type'], x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    } else if (tool === 'pen') {
      setDraft({ kind: 'pen', points: [p.x, p.y] });
    } else if (tool === 'arrow') {
      setDraft({ kind: 'arrow', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === 'eraser') {
      if (e.buttons !== 1) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-ann-id]') as SVGElement | null;
      const id = el?.dataset.annId;
      if (id) useStore.getState().removeAnnotation(id);
      return;
    }
    if (resize) {
      const p = toBase(e.clientX, e.clientY);
      const t = useStore.getState().annotations.find((x) => x.id === resize.id) as TextAnnotation | undefined;
      if (!t) return;
      // project the pointer movement onto the text's own x-axis (works in any rotation)
      const r = (-(t.rotation ?? 0) * Math.PI) / 180;
      const along = (p.x - resize.sx) * Math.cos(r) + (p.y - resize.sy) * Math.sin(r);
      setResize({ ...resize, w: Math.max(t.fontSize * 2.5, resize.startW + along) });
      return;
    }
    if (drag) {
      const p = toBase(e.clientX, e.clientY);
      setDrag({ ...drag, dx: p.x - drag.sx, dy: p.y - drag.sy });
      return;
    }
    if (!draft) return;
    const p = toBase(e.clientX, e.clientY);
    if (draft.kind === 'pen') {
      const n = draft.points.length;
      const lx = draft.points[n - 2], ly = draft.points[n - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * zoom < 1.5) return;
      setDraft({ kind: 'pen', points: [...draft.points, p.x, p.y] });
    } else {
      setDraft({ ...draft, x1: p.x, y1: p.y });
    }
  };

  const onPointerUp = () => {
    const st = useStore.getState();
    if (resize) {
      if (Math.abs(resize.w - resize.startW) > 0.5) st.updateAnnotation(resize.id, { width: r2(resize.w) } as Partial<Annotation>);
      setResize(null);
      return;
    }
    if (drag) {
      const a = st.annotations.find((x) => x.id === drag.id);
      if (a && Math.hypot(drag.dx, drag.dy) > 0.5) st.replaceAnnotation(translateAnnotation(a, drag.dx, drag.dy));
      setDrag(null);
      return;
    }
    if (!draft) return;
    if (draft.kind === 'textbox') {
      openTextEditor(draft);
      setDraft(null);
      return;
    }
    const now = Date.now();
    const base = { id: uid('ann_'), fileId, page, createdAt: now, updatedAt: now };
    if (draft.kind === 'rect') {
      const style = st.styles[draft.type];
      const r0 = normRect(draft.x0, draft.y0, draft.x1, draft.y1);
      const r = { x: r2(r0.x), y: r2(r0.y), width: r2(r0.width), height: r2(r0.height) };
      const lineLike = draft.type === 'underline' || draft.type === 'strikethrough';
      if (r.width * zoom >= 4 && (lineLike || r.height * zoom >= 4)) {
        st.addAnnotation({ ...base, ...style, type: draft.type, rect: r });
      }
    } else if (draft.kind === 'pen') {
      const style = st.styles.pen;
      const pts = simplifyPoints(draft.points, 0.35 / Math.max(zoom, 0.5));
      st.addAnnotation({ ...base, ...style, type: 'pen', points: pts.map((v) => Math.round(v * 100) / 100) });
    } else if (draft.kind === 'arrow') {
      const style = st.styles.arrow;
      if (Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) * zoom >= 6) {
        st.addAnnotation({ ...base, ...style, type: 'arrow', from: { x: r2(draft.x0), y: r2(draft.y0) }, to: { x: r2(draft.x1), y: r2(draft.y1) } });
      }
    }
    setDraft(null);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'select') return;
    // pointer capture during the click makes e.target the <svg>, so hit-test explicitly
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-ann-id]') as SVGElement | null;
    const id = target?.dataset.annId;
    const a = id ? useStore.getState().annotations.find((x) => x.id === id) : undefined;
    if (a?.type === 'text')
      setEditor({ mode: 'text', annId: a.id, x: a.x, y: a.y, text: a.text, rotation: a.rotation ?? 0, boxed: a.boxed, width: a.width });
  };

  // ── rendering ──────────────────────────────────────────────────────────────
  const interactive = tool === 'select' || tool === 'eraser';
  const draftStyle = styles[tool];

  let draftEl: React.ReactNode = null;
  if (draft?.kind === 'rect') {
    const r = normRect(draft.x0, draft.y0, draft.x1, draft.y1);
    draftEl = renderRectLike({ type: draft.type, rect: r, ...draftStyle } as RectAnnotation, 0);
  } else if (draft?.kind === 'pen') {
    draftEl = (
      <path d={penPath(draft.points)} fill="none" stroke={draftStyle.color} strokeOpacity={draftStyle.opacity}
        strokeWidth={draftStyle.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    );
  } else if (draft?.kind === 'textbox') {
    const r = normRect(draft.x0, draft.y0, draft.x1, draft.y1);
    draftEl = r.width * zoom >= 24 || r.height * zoom >= 24 ? (
      <rect x={r.x} y={r.y} width={r.width} height={r.height} fill="none" stroke="#1a73e8" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
    ) : null;
  } else if (draft?.kind === 'arrow') {
    draftEl = renderArrow({ from: { x: draft.x0, y: draft.y0 }, to: { x: draft.x1, y: draft.y1 }, ...draftStyle } as ArrowAnnotation, 0);
  }

  const editing = editor?.annId;
  const withResize = (a: Annotation): Annotation =>
    resize && a.id === resize.id && a.type === 'text' ? { ...a, width: resize.w } : a;
  const selRaw = annotations.find((a) => a.id === selectedAnnId);
  const sel = selRaw ? withResize(selRaw) : undefined;

  return (
    <>
      <svg
        ref={svgRef}
        className={`ann-layer tool-${tool} ${interactive ? 'interactive' : 'drawing'}`}
        width={disp.w * zoom}
        height={disp.h * zoom}
        viewBox={`0 0 ${disp.w} ${disp.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <g transform={rotationTransform(baseW, baseH, rotation)}>
          {annotations.map((a) =>
            a.id === editing && a.type === 'text' ? null : (
              <g
                key={a.id}
                data-ann-id={a.id}
                className="ann"
                transform={drag?.id === a.id ? `translate(${drag.dx} ${drag.dy})` : undefined}
              >
                {renderAnnotation(withResize(a), hitW)}
              </g>
            ),
          )}
          {sel && !editing && (
            <g transform={drag?.id === sel.id ? `translate(${drag.dx} ${drag.dy})` : undefined} pointerEvents="none">
              <SelectionBox a={sel} zoom={zoom} />
              {sel.type === 'text' && tool === 'select' && <ResizeHandle a={sel} zoom={zoom} />}
            </g>
          )}
          {draftEl && <g pointerEvents="none">{draftEl}</g>}
        </g>
      </svg>
      {editor && (
        <InlineEditor
          editor={editor}
          setEditor={setEditor}
          commit={commitEditor}
          baseW={baseW}
          baseH={baseH}
          zoom={zoom}
          rotation={rotation}
        />
      )}
    </>
  );
}

export const AnnotationLayer = memo(AnnotationLayerImpl);

// ─── shape renderers (all coordinates in page units) ──────────────────────────

function renderRectLike(a: RectAnnotation, hitW: number) {
  const { x, y, width: w, height: h } = a.rect;
  switch (a.type) {
    case 'highlight':
      return <rect x={x} y={y} width={w} height={h} fill={a.color} fillOpacity={a.opacity} style={{ mixBlendMode: 'multiply' }} />;
    case 'rectangle':
      return (
        <>
          {hitW > 0 && <rect x={x} y={y} width={w} height={h} className="hit" strokeWidth={Math.max(hitW, a.strokeWidth)} />}
          <rect x={x} y={y} width={w} height={h} fill="none" stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.strokeWidth} />
        </>
      );
    case 'ellipse':
      return (
        <>
          {hitW > 0 && <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} className="hit" strokeWidth={Math.max(hitW, a.strokeWidth)} />}
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.strokeWidth} />
        </>
      );
    case 'underline':
    case 'strikethrough': {
      const ly = a.type === 'underline' ? y + h : y + h / 2;
      return (
        <>
          {hitW > 0 && <rect x={x} y={y} width={w} height={Math.max(h, hitW)} className="hit-fill" />}
          <line x1={x} y1={ly} x2={x + w} y2={ly} stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.strokeWidth} strokeLinecap="butt" />
        </>
      );
    }
  }
}

function renderArrow(a: ArrowAnnotation, hitW: number) {
  const [p1, tip, p2] = arrowHead(a.from, a.to, a.strokeWidth);
  return (
    <>
      {hitW > 0 && <line x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} className="hit" strokeWidth={Math.max(hitW, a.strokeWidth)} />}
      <line x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.strokeWidth} strokeLinecap="round" />
      <polyline points={`${p1.x},${p1.y} ${tip.x},${tip.y} ${p2.x},${p2.y}`} fill="none" stroke={a.color} strokeOpacity={a.opacity}
        strokeWidth={a.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function renderPen(a: PenAnnotation, hitW: number) {
  const d = penPath(a.points);
  return (
    <>
      {hitW > 0 && <path d={d} className="hit" strokeWidth={Math.max(hitW, a.strokeWidth)} />}
      <path d={d} fill="none" stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function renderText(a: TextAnnotation) {
  const L = layoutText(a);
  const r = a.rotation ?? 0;
  const lh = a.fontSize * TEXT_LINE_HEIGHT;
  return (
    <g transform={r ? `rotate(${-r} ${a.x} ${a.y})` : undefined}>
      {/* transparent background: invisible fill only for grabbing it with the Select tool */}
      <rect x={a.x} y={a.y} width={L.boxW} height={L.boxH} className="hit-fill" />
      {a.boxed && (
        <rect x={a.x} y={a.y} width={L.boxW} height={L.boxH} fill="none"
          stroke={a.color} strokeOpacity={a.opacity} strokeWidth={0.9} />
      )}
      <text x={a.x + L.pad} y={a.y + L.pad} fill={a.color} fillOpacity={a.opacity} fontSize={a.fontSize}
        style={{ fontFamily: TEXT_FONT_FAMILY, whiteSpace: 'pre' }} dominantBaseline="text-before-edge">
        {L.lines.map((l, i) => (
          <tspan key={i} x={a.x + L.pad} dy={i === 0 ? 0 : lh}>{l || ' '}</tspan>
        ))}
      </text>
    </g>
  );
}

/** corners of a text box in page units, accounting for its rotation around (x, y) */
export function textCorners(a: TextAnnotation) {
  const L = layoutText(a);
  const r = (-(a.rotation ?? 0) * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e6) / 1e6, s = Math.round(Math.sin(r) * 1e6) / 1e6;
  return [
    [0, 0], [L.boxW, 0], [L.boxW, L.boxH], [0, L.boxH],
  ].map(([dx, dy]) => ({ x: a.x + dx * c - dy * s, y: a.y + dx * s + dy * c }));
}

/** drag handle on the right edge of a selected text box → change its width (text re-wraps) */
function ResizeHandle({ a, zoom }: { a: TextAnnotation; zoom: number }) {
  const [, tr, br] = textCorners(a);
  const cx = (tr.x + br.x) / 2, cy = (tr.y + br.y) / 2;
  const w = 6 / zoom, h = 16 / zoom;
  const r = a.rotation ?? 0;
  return (
    <rect data-resize-for={a.id} className="resize-handle" pointerEvents="all"
      x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={2 / zoom}
      transform={r ? `rotate(${-r} ${cx} ${cy})` : undefined}
      fill="#fff" stroke="#1a73e8" strokeWidth={1.2 / zoom}>
      <title>Drag to change the text box width</title>
    </rect>
  );
}

function renderNote(a: NoteAnnotation) {
  const s = NOTE_SIZE;
  return (
    <g>
      <title>{a.text || '(empty comment)'}</title>
      <rect x={a.x} y={a.y} width={s} height={s} rx={2.5} fill={a.color} stroke="#5d4037" strokeOpacity={0.55} strokeWidth={0.8} />
      <path d={`M${a.x + 4} ${a.y + 5.5}h10M${a.x + 4} ${a.y + 9}h10M${a.x + 4} ${a.y + 12.5}h6`} stroke="#4e342e" strokeWidth={1.1} strokeLinecap="round" />
    </g>
  );
}

function renderAnnotation(a: Annotation, hitW: number) {
  switch (a.type) {
    case 'pen':
      return renderPen(a, hitW);
    case 'arrow':
      return renderArrow(a, hitW);
    case 'text':
      return renderText(a);
    case 'note':
      return renderNote(a);
    default:
      return renderRectLike(a, hitW);
  }
}

export function annotationBounds(a: Annotation) {
  switch (a.type) {
    case 'pen': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < a.points.length; i += 2) {
        x0 = Math.min(x0, a.points[i]); x1 = Math.max(x1, a.points[i]);
        y0 = Math.min(y0, a.points[i + 1]); y1 = Math.max(y1, a.points[i + 1]);
      }
      const p = a.strokeWidth / 2;
      return { x: x0 - p, y: y0 - p, width: x1 - x0 + 2 * p, height: y1 - y0 + 2 * p };
    }
    case 'arrow':
      return normRect(a.from.x, a.from.y, a.to.x, a.to.y);
    case 'text': {
      const pts = textCorners(a);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return normRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    case 'note':
      return { x: a.x, y: a.y, width: NOTE_SIZE, height: NOTE_SIZE };
    default:
      return a.rect;
  }
}

function SelectionBox({ a, zoom }: { a: Annotation; zoom: number }) {
  const b = annotationBounds(a);
  const pad = 3 / zoom;
  return (
    <rect x={b.x - pad} y={b.y - pad} width={b.width + 2 * pad} height={b.height + 2 * pad} fill="none"
      stroke="#1a73e8" strokeWidth={1.2 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
  );
}

// ─── inline text / comment editor (HTML overlay) ────────────────────────────

function InlineEditor({
  editor, setEditor, commit, baseW, baseH, zoom, rotation,
}: {
  editor: Editor;
  setEditor: (e: Editor | null) => void;
  commit: () => void;
  baseW: number;
  baseH: number;
  zoom: number;
  rotation: ViewRotation;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const styles = useStore((s) => s.styles);
  const annotations = useStore((s) => s.annotations);
  const removeAnnotation = useStore((s) => s.removeAnnotation);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const existing = editor.annId ? annotations.find((a) => a.id === editor.annId) : undefined;
  const pos = baseToDisplay(editor.x, editor.y, baseW, baseH, rotation);
  const update = (text: string) => setEditor({ ...editor, text });
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      commit();
    }
  };

  if (editor.mode === 'text') {
    const fs = (existing as TextAnnotation | undefined)?.fontSize ?? styles.text.strokeWidth;
    const color = existing?.color ?? styles.text.color;
    const L = layoutText({ text: editor.text + (editor.width ? '' : 'M'), fontSize: fs, width: editor.width, boxed: editor.boxed });
    const minW = editor.width ? editor.width * zoom : Math.max(80, L.boxW * zoom + 12);
    return (
      <textarea
        ref={ref}
        className={`text-editor ${editor.boxed ? 'boxed' : ''} ${editor.width ? 'fixed-width' : ''}`}
        value={editor.text}
        placeholder="Type…"
        onChange={(e) => update(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          left: pos.x * zoom,
          top: pos.y * zoom,
          fontSize: fs * zoom,
          lineHeight: TEXT_LINE_HEIGHT,
          fontFamily: TEXT_FONT_FAMILY,
          color,
          borderColor: editor.boxed ? color : undefined,
          padding: editor.boxed ? L.pad * zoom : undefined,
          width: minW,
          height: Math.max(L.boxH, fs * TEXT_LINE_HEIGHT + 2 * L.pad) * zoom + (editor.boxed ? 0 : 6),
        }}
      />
    );
  }

  // note / comment popup
  return (
    <div
      className="note-popup"
      style={{ left: (pos.x + NOTE_SIZE + 4) * zoom, top: pos.y * zoom }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) commit();
      }}
    >
      <div className="note-popup-head">Comment</div>
      <textarea ref={ref} value={editor.text} onChange={(e) => update(e.target.value)} onKeyDown={onKeyDown} rows={4} placeholder="Write a comment for the student…" />
      <div className="note-popup-actions">
        {editor.annId && (
          <button
            className="btn small danger"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const id = editor.annId!;
              setEditor(null);
              removeAnnotation(id);
            }}
          >
            Delete
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn small primary" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
          Done
        </button>
      </div>
    </div>
  );
}
