import { memo, useEffect, useRef } from 'react';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import type { Annotation } from '../types';
import { AnnotationLayer } from './AnnotationLayer';
import { rotatedSize, type ViewRotation } from '../lib/util';

interface Props {
  doc: PDFDocumentProxy;
  fileId: string;
  page: number;
  baseW: number;
  baseH: number;
  zoom: number;
  rotation: ViewRotation;
  visible: boolean;
  annotations: Annotation[];
}

const MAX_CANVAS_PIXELS = 16_000_000;

function PdfPageImpl({ doc, fileId, page, baseW, baseH, zoom, rotation, visible, annotations }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const renderedKey = useRef<string>('');
  const disp = rotatedSize(baseW, baseH, rotation);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    if (!visible) {
      // free memory for pages far off-screen
      const t = setTimeout(() => {
        holder.replaceChildren();
        renderedKey.current = '';
      }, 1500);
      return () => clearTimeout(t);
    }
    const dpr = window.devicePixelRatio || 1;
    const key = `${zoom}|${rotation}|${dpr}`;
    if (renderedKey.current === key) return;

    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    // small debounce: while zooming, the old canvas is stretched by CSS until the sharp one is ready
    const delay = renderedKey.current ? 120 : 0;
    const timer = setTimeout(async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        let scale = zoom * dpr;
        const vp0 = p.getViewport({ scale, rotation: (p.rotate + rotation) % 360 });
        const px = vp0.width * vp0.height;
        if (px > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / px);
        const vp = p.getViewport({ scale, rotation: (p.rotate + rotation) % 360 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.className = 'page-canvas';
        task = p.render({ canvas, viewport: vp, annotationMode: 1 /* ENABLE: show existing PDF annotations' appearance */ } as Parameters<typeof p.render>[0]);
        await task.promise;
        if (cancelled) return;
        holder.replaceChildren(canvas);
        renderedKey.current = key;
      } catch (e) {
        if (!cancelled && (e as Error)?.name !== 'RenderingCancelledException') console.warn('render failed', page, e);
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, page, zoom, rotation, visible]);

  return (
    <div className="page" data-page={page} style={{ width: disp.w * zoom, height: disp.h * zoom }}>
      <div ref={holderRef} className="page-canvas-holder" />
      <AnnotationLayer fileId={fileId} page={page} baseW={baseW} baseH={baseH} zoom={zoom} rotation={rotation} annotations={annotations} />
      <div className="page-label">{page}</div>
    </div>
  );
}

export const PdfPage = memo(PdfPageImpl);
