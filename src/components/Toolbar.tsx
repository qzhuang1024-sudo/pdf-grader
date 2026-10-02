import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { ToolId } from '../types';
import { Icon } from './Icons';

const TOOLS: { id: ToolId; label: string; key: string }[] = [
  { id: 'select', label: 'Select / move', key: 'V' },
  { id: 'highlight', label: 'Highlight', key: 'H' },
  { id: 'pen', label: 'Pen', key: 'D' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'rectangle', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', label: 'Circle / ellipse', key: 'O' },
  { id: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'underline', label: 'Underline', key: 'U' },
  { id: 'strikethrough', label: 'Strikethrough', key: 'K' },
  { id: 'note', label: 'Sticky note / comment', key: 'C' },
  { id: 'eraser', label: 'Eraser (click or drag over annotations)', key: 'E' },
];

const COLORS = ['#d32f2f', '#1565c0', '#2e7d32', '#212121', '#ef6c00', '#8e24aa'];
const HIGHLIGHT_COLORS = ['#ffeb3b', '#7cf27c', '#7fd3ff', '#ff9fd0', '#ffb74d', '#d1d5db'];
const WIDTHS = [1, 2, 3.5];
const FONT_SIZES = [10, 14, 18, 24];

interface Props {
  currentPage: number;
  pageCount: number;
  goToPage: (n: number) => void;
}

export function Toolbar({ currentPage, pageCount, goToPage }: Props) {
  const zoom = useStore((s) => s.zoom);
  const zoomMode = useStore((s) => s.zoomMode);
  const tool = useStore((s) => s.tool);
  const styles = useStore((s) => s.styles);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const selected = useStore((s) => s.annotations.find((a) => a.id === s.selectedAnnId));
  const hasFile = useStore((s) => !!s.currentId);
  const { setZoom, setZoomMode, setTool, setToolStyle, undo, redo, rotateView, updateAnnotation, removeAnnotation } = useStore.getState();

  const [pageInput, setPageInput] = useState(String(currentPage));
  useEffect(() => setPageInput(String(currentPage)), [currentPage]);

  // the style controls edit the selected annotation if there is one, else the active tool's default
  const styleTarget: ToolId = selected ? (selected.type as ToolId) : tool;
  const style = selected ?? styles[styleTarget];
  const isHighlight = styleTarget === 'highlight';
  const palette = isHighlight ? HIGHLIGHT_COLORS : COLORS;
  const showStyle = styleTarget !== 'select' && styleTarget !== 'eraser';
  const isText = styleTarget === 'text';
  const currentSize = selected?.type === 'text' ? selected.fontSize : style.strokeWidth;

  const setColor = (color: string) => {
    if (selected) updateAnnotation(selected.id, { color });
    setToolStyle(styleTarget, { color });
  };
  const setSize = (v: number) => {
    if (selected) updateAnnotation(selected.id, selected.type === 'text' ? { fontSize: v } : { strokeWidth: v });
    setToolStyle(styleTarget, { strokeWidth: v });
  };

  return (
    <div className="toolbar" role="toolbar">
      <div className="tb-group">
        <button className="icon-btn" title="Zoom out (−)" onClick={() => setZoom(zoom / 1.15)} disabled={!hasFile}><Icon.zoomOut /></button>
        <button className="zoom-label" title="Reset to 100%" onClick={() => setZoom(1)} disabled={!hasFile}>{Math.round(zoom * 100)}%</button>
        <button className="icon-btn" title="Zoom in (+)" onClick={() => setZoom(zoom * 1.15)} disabled={!hasFile}><Icon.zoomIn /></button>
        <button className={`icon-btn ${zoomMode === 'fit-width' ? 'active' : ''}`} title="Fit width (W)" onClick={() => setZoomMode('fit-width')} disabled={!hasFile}><Icon.fitWidth /></button>
        <button className={`icon-btn ${zoomMode === 'fit-page' ? 'active' : ''}`} title="Fit page (F)" onClick={() => setZoomMode('fit-page')} disabled={!hasFile}><Icon.fitPage /></button>
        <button className="icon-btn" title="Rotate view 90° (Shift+R)" onClick={() => rotateView(90)} disabled={!hasFile}><Icon.rotate /></button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button className="icon-btn" title="Previous page (PageUp)" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}><Icon.chevUp /></button>
        <form
          className="page-input"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(pageInput, 10);
            if (n) goToPage(n);
            (document.activeElement as HTMLElement)?.blur();
          }}
        >
          <input value={pageInput} onChange={(e) => setPageInput(e.target.value)} aria-label="Page number" disabled={!pageCount} />
          <span>/ {pageCount || '–'}</span>
        </form>
        <button className="icon-btn" title="Next page (PageDown)" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= pageCount}><Icon.chevDown /></button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group tools">
        {TOOLS.map((t) => {
          const I = Icon[t.id];
          return (
            <button key={t.id} className={`icon-btn tool ${tool === t.id ? 'active' : ''}`} title={`${t.label} (${t.key})`}
              onClick={() => setTool(t.id)} aria-pressed={tool === t.id}>
              <I />
            </button>
          );
        })}
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button className="icon-btn" title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}><Icon.undo /></button>
        <button className="icon-btn" title="Redo (Ctrl+Shift+Z / Ctrl+Y)" onClick={redo} disabled={!canRedo}><Icon.redo /></button>
        <button className="icon-btn" title="Delete selected annotation (Delete)" onClick={() => selected && removeAnnotation(selected.id)} disabled={!selected}><Icon.trash /></button>
      </div>

      <div className="tb-sep" />
      {/* always rendered (hidden when not applicable) so the toolbar never changes size while you work */}
      <div className="tb-group style-group" style={{ visibility: showStyle ? 'visible' : 'hidden' }}
        title={selected ? 'Changes apply to the selected annotation' : 'Style for new annotations'}>
        {palette.map((c) => (
          <button key={c} className={`swatch ${style.color.toLowerCase() === c ? 'active' : ''}`} style={{ background: c }}
            title={c} onClick={() => setColor(c)} />
        ))}
        <select className="size-select" value={currentSize} onChange={(e) => setSize(parseFloat(e.target.value))}
          title={isText ? 'Font size' : 'Line width'}
          style={{ visibility: showStyle && styleTarget !== 'highlight' && styleTarget !== 'note' ? 'visible' : 'hidden' }}>
          {(isText ? FONT_SIZES : WIDTHS).map((w) => (
            <option key={w} value={w}>{isText ? `${w} pt` : `${w} px`}</option>
          ))}
          {!(isText ? FONT_SIZES : WIDTHS).includes(currentSize) && <option value={currentSize}>{currentSize}</option>}
        </select>
      </div>
    </div>
  );
}
