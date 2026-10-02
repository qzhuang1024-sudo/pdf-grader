import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { storage } from './storage/IndexedDbAdapter';

/*
 * PDF.js setup that works both over http AND from a double-clicked file:// page.
 *
 * - The worker is started from a blob: URL when the bundle inlined it as a data: URL
 *   (portable build), otherwise from its normal asset URL.
 * - CMaps (needed for CJK PDFs whose fonts are not embedded), standard fonts and the
 *   JPEG2000/colour-management wasm are bundled with the app and loaded through
 *   custom factories, so pdf.js never needs network access.
 */

type Loader = () => Promise<string>;
const cmapLoaders = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?url',
  import: 'default',
}) as Record<string, Loader>;
const fontLoaders = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  query: '?url',
  import: 'default',
}) as Record<string, Loader>;
const wasmLoaders = import.meta.glob('/node_modules/pdfjs-dist/wasm/*.{wasm,js}', {
  query: '?url',
  import: 'default',
}) as Record<string, Loader>;

async function loadBytes(loaders: Record<string, Loader>, dir: string, filename: string): Promise<Uint8Array> {
  const loader = loaders[`/node_modules/pdfjs-dist/${dir}/${filename}`];
  if (!loader) throw new Error(`Bundled pdf.js resource not found: ${dir}/${filename}`);
  const url = await loader();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${dir}/${filename}`);
  return new Uint8Array(await res.arrayBuffer());
}

class BundledCMapReaderFactory {
  async fetch({ name }: { name: string }) {
    return { cMapData: await loadBytes(cmapLoaders, 'cmaps', `${name}.bcmap`), isCompressed: true };
  }
}
class BundledStandardFontDataFactory {
  async fetch({ filename }: { filename: string }) {
    return loadBytes(fontLoaders, 'standard_fonts', filename);
  }
}
class BundledWasmFactory {
  async fetch({ filename }: { filename: string }) {
    return loadBytes(wasmLoaders, 'wasm', filename);
  }
}

let workerReady: Promise<void> | null = null;
function ensureWorker(): Promise<void> {
  if (!workerReady) {
    workerReady = (async () => {
      const url: string = workerUrl;
      if (url.startsWith('data:')) {
        // Portable single-file build opened from file://: Chrome refuses *module* workers from
        // blob: URLs there, but classic workers are fine. The pdf.js worker is an ES module whose
        // only module-specific syntax is the trailing export and one import.meta.url → rewrite it.
        const src = (await (await fetch(url)).text())
          .replace(/export\s*\{\s*WorkerMessageHandler\s*\};?\s*$/, '')
          .replace(/import\.meta\.url/g, 'self.location.href');
        const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(blobUrl);
      } else {
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
      }
    })();
  }
  return workerReady;
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  await ensureWorker();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    // non-default factories → pdf.js fetches these on the main thread through our loaders
    CMapReaderFactory: BundledCMapReaderFactory,
    StandardFontDataFactory: BundledStandardFontDataFactory,
    WasmFactory: BundledWasmFactory,
    cMapUrl: 'bundled/',
    cMapPacked: true,
    standardFontDataUrl: 'bundled/',
    wasmUrl: 'bundled/',
    useWorkerFetch: false,
    isEvalSupported: false,
    enableXfa: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  return task.promise;
}

// ─── Small LRU of open documents: current ± neighbours, so Next/Prev is instant ───

interface CacheEntry {
  promise: Promise<PDFDocumentProxy>;
  lastUsed: number;
}
const MAX_OPEN_DOCS = 3;
const cache = new Map<string, CacheEntry>();
let pinned: string | null = null;

/** The document currently on screen is never evicted. */
export function pinDocument(fileId: string | null) {
  pinned = fileId;
}

export function getDocument(fileId: string): Promise<PDFDocumentProxy> {
  const hit = cache.get(fileId);
  if (hit) {
    hit.lastUsed = performance.now();
    return hit.promise;
  }
  const promise = (async () => {
    const blob = await storage.getPdf(fileId);
    if (!blob) throw new Error('PDF data not found in local storage');
    return openPdf(await blob.arrayBuffer());
  })();
  cache.set(fileId, { promise, lastUsed: performance.now() });
  promise.catch(() => cache.delete(fileId));
  evict(fileId);
  return promise;
}

/** Keep `keep` ids, evict least recently used beyond the limit. */
function evict(protect: string) {
  if (cache.size <= MAX_OPEN_DOCS) return;
  const entries = [...cache.entries()].filter(([id]) => id !== protect && id !== pinned).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  while (cache.size > MAX_OPEN_DOCS && entries.length) {
    const [id, e] = entries.shift()!;
    cache.delete(id);
    e.promise.then((d) => d.destroy()).catch(() => {});
  }
}

export function prefetchDocument(fileId: string) {
  if (!cache.has(fileId)) {
    getDocument(fileId).catch(() => {});
  }
}

export function forgetDocument(fileId: string) {
  const e = cache.get(fileId);
  if (e) {
    cache.delete(fileId);
    e.promise.then((d) => d.destroy()).catch(() => {});
  }
}

export type { PDFDocumentProxy };
