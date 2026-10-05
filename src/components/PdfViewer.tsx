import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, visibleFiles } from '../store/useStore';
import { getDocument, pinDocument, prefetchDocument, type PDFDocumentProxy } from '../lib/pdfjs';
import type { Annotation } from '../types';
import { rotatedSize, type ViewRotation } from '../lib/util';
import { PdfPage } from './PdfPage';
import { Toolbar } from './Toolbar';
import { openGuide } from './GuideDialog';

interface PageSize {
  w: number;
  h: number;
}

const PAGE_GAP = 14; // px between pages
const PAD = 24; // px around pages
const EMPTY: Annotation[] = [];

export function PdfViewer() {
  const currentId = useStore((s) => s.currentId);
  const file = useStore((s) => s.files.find((f) => f.id === s.currentId));
  const zoom = useStore((s) => s.zoom);
  const zoomMode = useStore((s) => s.zoomMode);
  const annotations = useStore((s) => s.annotations);
  const setPageCount = useStore((s) => s.setPageCount);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<{ id: string; doc: PDFDocumentProxy } | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]));
  const [currentPage, setCurrentPage] = useState(1);
  const rotation = (file?.viewRotation ?? 0) as ViewRotation;

  // ── load document when the selected file changes ────────────────────────
  useEffect(() => {
    if (!currentId) {
      setDoc(null);
      setSizes([]);
      pinDocument(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    pinDocument(currentId);
    getDocument(currentId)
      .then(async (d) => {
        if (cancelled) return;
        // page sizes: first page immediately, the rest progressively
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        const initial = Array.from({ length: d.numPages }, () => ({ w: first.width, h: first.height }));
        setSizes(initial);
        setDoc({ id: currentId, doc: d });
        setCurrentPage(1);
        setVisible(new Set([1, 2]));
        scrollRef.current?.scrollTo({ top: 0 });
        setLoading(false);
        setPageCount(currentId, d.numPages);
        if (d.numPages > 1) {
          const all = await Promise.all(
            Array.from({ length: d.numPages }, (_, i) => d.getPage(i + 1).then((p) => p.getViewport({ scale: 1 }))),
          );
          if (cancelled) return;
          const real = all.map((v) => ({ w: v.width, h: v.height }));
          if (real.some((r, i) => r.w !== initial[i].w || r.h !== initial[i].h)) setSizes(real);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
        setDoc(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId, setPageCount]);

  // prefetch neighbours so Next / Prev is instant
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => {
      const s = useStore.getState();
      const list = visibleFiles(s);
      const i = list.findIndex((f) => f.id === s.currentId);
      if (list[i + 1]) prefetchDocument(list[i + 1].id);
      if (list[i - 1]) prefetchDocument(list[i - 1].id);
    }, 300);
    return () => clearTimeout(t);
  }, [doc]);

  // ── fit width / fit page ─────────────────────────────────────────────────
  const maxDispW = useMemo(() => Math.max(1, ...sizes.map((s) => rotatedSize(s.w, s.h, rotation).w)), [sizes, rotation]);
  const firstDisp = sizes[0] ? rotatedSize(sizes[0].w, sizes[0].h, rotation) : null;

  const applyFit = useCallback(() => {
    const el = scrollRef.current;
    const mode = useStore.getState().zoomMode;
    if (!el || !firstDisp || mode === 'custom') return;
    const availW = el.clientWidth - PAD * 2 - 4;
    const availH = el.clientHeight - PAD * 2;
    let z = availW / maxDispW;
    if (mode === 'fit-page') z = Math.min(z, availH / firstDisp.h);
    z = Math.max(0.25, Math.min(5, Math.round(z * 1000) / 1000));
    if (Math.abs(z - useStore.getState().zoom) > 0.001) useStore.setState({ zoom: z });
  }, [maxDispW, firstDisp]);

  useLayoutEffect(() => {
    applyFit();
  }, [applyFit, zoomMode]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => applyFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyFit]);

  // ── page positions (for scroll tracking + virtualisation) ────────────────
  const offsets = useMemo(() => {
    const out: number[] = [];
    let y = PAD;
    for (const s of sizes) {
      out.push(y);
      y += rotatedSize(s.w, s.h, rotation).h * zoom + PAGE_GAP;
    }
    return out;
  }, [sizes, zoom, rotation]);

  const updateVisibility = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !sizes.length) return;
    const top = el.scrollTop, bottom = top + el.clientHeight;
    const margin = el.clientHeight; // render one screen ahead / behind
    const vis = new Set<number>();
    let cur = 1;
    for (let i = 0; i < offsets.length; i++) {
      const h = rotatedSize(sizes[i].w, sizes[i].h, rotation).h * zoom;
      const pTop = offsets[i], pBot = pTop + h;
      if (pBot >= top - margin && pTop <= bottom + margin) vis.add(i + 1);
      if (pTop <= top + el.clientHeight * 0.4) cur = i + 1;
    }
    setVisible((old) => (old.size === vis.size && [...vis].every((v) => old.has(v)) ? old : vis));
    setCurrentPage(cur);
  }, [offsets, sizes, zoom, rotation]);

  useEffect(() => {
    updateVisibility();
  }, [updateVisibility]);

  const rafRef = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updateVisibility);
  };

  // keep the reading position stable when zoom changes
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && prevZoom.current !== zoom) {
      const ratio = zoom / prevZoom.current;
      // at the very top (e.g. a freshly opened file) stay at the top
      if (el.scrollTop > 0) el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
      el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
    }
    prevZoom.current = zoom;
  }, [zoom]);

  // Ctrl/⌘ + wheel zooms the document (like Chrome's PDF viewer) instead of the whole page
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const s = useStore.getState();
      s.setZoom(s.zoom * Math.exp(-e.deltaY * 0.0025));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const goToPage = useCallback(
    (n: number) => {
      const el = scrollRef.current;
      if (!el || !offsets.length) return;
      const i = Math.max(1, Math.min(offsets.length, n)) - 1;
      el.scrollTo({ top: offsets[i] - PAD / 2 });
    },
    [offsets],
  );

  // expose page navigation to keyboard shortcuts
  useEffect(() => {
    viewerApi.goToPage = goToPage;
    viewerApi.currentPage = currentPage;
    viewerApi.pageCount = sizes.length;
  }, [goToPage, currentPage, sizes.length]);

  // group annotations by page, re-using arrays whose contents did not change (keeps PdfPage memo effective)
  const groupsRef = useRef<Map<number, Annotation[]>>(new Map());
  const byPage = useMemo(() => {
    const next = new Map<number, Annotation[]>();
    for (const a of annotations) {
      let arr = next.get(a.page);
      if (!arr) next.set(a.page, (arr = []));
      arr.push(a);
    }
    for (const [p, arr] of next) {
      const old = groupsRef.current.get(p);
      if (old && old.length === arr.length && old.every((x, i) => x === arr[i])) next.set(p, old);
    }
    groupsRef.current = next;
    return next;
  }, [annotations]);

  const showDoc = doc && doc.id === currentId ? doc : null;

  return (
    <section className="viewer">
      <Toolbar currentPage={currentPage} pageCount={showDoc ? sizes.length : 0} goToPage={goToPage} />
      <div className="viewer-scroll" ref={scrollRef} onScroll={onScroll}>
        {!currentId && <EmptyState />}
        {currentId && error && (
          <div className="viewer-message error">
            <strong>Could not open this PDF.</strong>
            <span>{error}</span>
          </div>
        )}
        {currentId && loading && !showDoc && !error && <div className="viewer-message">Loading…</div>}
        {showDoc && (
          <div className="pages" style={{ padding: `${PAD}px`, gap: `${PAGE_GAP}px` }}>
            {sizes.map((s, i) => (
              <PdfPage
                key={`${showDoc.id}-${i + 1}`}
                doc={showDoc.doc}
                fileId={showDoc.id}
                page={i + 1}
                baseW={s.w}
                baseH={s.h}
                zoom={zoom}
                rotation={rotation}
                visible={visible.has(i + 1)}
                annotations={byPage.get(i + 1) ?? EMPTY}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** imperative handle used by global keyboard shortcuts */
export const viewerApi: { goToPage: (n: number) => void; currentPage: number; pageCount: number } = {
  goToPage: () => {},
  currentPage: 1,
  pageCount: 0,
};

function EmptyState() {
  return (
    <div className="viewer-empty">
      <div className="viewer-empty-card">
        <h2>No submission selected</h2>
        <p>Import student PDFs from the left panel — or drop PDF files or a whole folder anywhere on this window.</p>
        <ol>
          <li>Open folder / select files</li>
          <li>Read &amp; annotate the PDF</li>
          <li>Type the score and press <kbd>Enter</kbd> → next student</li>
        </ol>
        <p className="muted">Everything stays on this computer (browser IndexedDB). Nothing is uploaded.</p>
        <button className="btn" onClick={() => openGuide()}>📖 使用說明</button>
      </div>
    </div>
  );
}
