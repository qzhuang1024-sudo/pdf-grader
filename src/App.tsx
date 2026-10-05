import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store/useStore';
import { Sidebar } from './components/Sidebar';
import { PdfViewer } from './components/PdfViewer';
import { useShortcuts, SHORTCUTS } from './hooks/useShortcuts';
import { pdfsFromDataTransfer } from './lib/importFiles';
import { GuideDialog } from './components/GuideDialog';

const SIDEBAR_KEY = 'pgw.sidebarWidth';

function readWidth() {
  try {
    const v = parseInt(localStorage.getItem(SIDEBAR_KEY) ?? '', 10);
    return v >= 260 && v <= 640 ? v : 340;
  } catch {
    return 340;
  }
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const initError = useStore((s) => s.initError);
  const busy = useStore((s) => s.busy);
  const toasts = useStore((s) => s.toasts);
  const [width, setWidth] = useState(readWidth);
  const [help, setHelp] = useState(false);
  // user guide: null = closed, string = open at that section
  const [guide, setGuide] = useState<string | null>(null);
  useEffect(() => {
    const open = (e: Event) => setGuide((e as CustomEvent<string | undefined>).detail ?? 'start');
    window.addEventListener('pgw:guide', open);
    return () => window.removeEventListener('pgw:guide', open);
  }, []);
  const filesCount = useStore((s) => s.files.length);
  // first visit with an empty workspace: show the guide once
  useEffect(() => {
    if (!ready || filesCount) return;
    try {
      if (!localStorage.getItem('pgw.guideSeen')) {
        localStorage.setItem('pgw.guideSeen', '1');
        setGuide('start');
      }
    } catch {
      /* ignore */
    }
  }, [ready, filesCount]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  const toggleHelp = useCallback(() => setHelp((h) => !h), []);
  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setHelp(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help]);
  useShortcuts(toggleHelp);

  // ── resizable split ──────────────────────────────────────────────────────
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.max(260, Math.min(640, startW + ev.clientX - startX));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      try {
        localStorage.setItem(SIDEBAR_KEY, String(w));
      } catch {
        /* ignore */
      }
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── drag & drop anywhere ────────────────────────────────────────────────
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current++;
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragOver(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const st = useStore.getState();
    try {
      const { pdfs, unreadableFolders } = await pdfsFromDataTransfer(e.dataTransfer);
      if (unreadableFolders.length)
        st.toast(
          `無法直接讀取拖進來的資料夾（${unreadableFolders.join('、')}）。請改用「Open folder」，或打開資料夾、全選 PDF 後再拖進來。`,
          'error',
        );
      if (pdfs.length) await st.importFiles(pdfs);
      else if (!unreadableFolders.length) st.toast('No PDF files found in what you dropped.', 'info');
    } catch (err) {
      console.error(err);
      st.toast(`Drop failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  };

  if (!ready) return <div className="boot">Loading workspace…</div>;
  if (initError)
    return (
      <div className="boot error">
        <h2>Local storage is not available</h2>
        <p>{initError}</p>
        <p>This app keeps your data in the browser’s IndexedDB. Private / incognito windows or strict privacy settings can block it.</p>
      </div>
    );

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${width}px 6px 1fr` }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={(e) => void onDrop(e)}
    >
      <Sidebar onShowHelp={toggleHelp} />
      <div className="splitter" onPointerDown={onResizeStart} title="Drag to resize" />
      <PdfViewer />

      {dragOver && (
        <div className="drop-overlay">
          <div>Drop PDF files or folders to import</div>
        </div>
      )}
      {busy && (
        <div className="busy-overlay">
          <div className="busy-card"><span className="spinner" />{busy}</div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => useStore.getState().dismissToast(t.id)}>{t.message}</div>
        ))}
      </div>
      {guide !== null && (
        <GuideDialog initial={guide} onClose={() => setGuide(null)} onShowShortcuts={() => setHelp(true)} />
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
            <div className="modal-head">
              <h3>Keyboard shortcuts</h3>
              <button className="link-btn" onClick={() => setHelp(false)}>Close</button>
            </div>
            <table className="shortcut-table">
              <tbody>
                {SHORTCUTS.map(([k, d]) => (
                  <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Single-key shortcuts are ignored while you are typing in a field. Browser shortcuts (Ctrl+F, Ctrl +/−, Ctrl+P …) are left untouched.</p>
          </div>
        </div>
      )}
    </div>
  );
}
