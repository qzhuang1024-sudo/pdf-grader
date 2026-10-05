import type { Annotation, GradedFile, GradingStatus, Rect } from '../types';

export function uid(prefix = ''): string {
  const r = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return prefix + r;
}

export function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

/** student name guess: filename without extension */
export function nameFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, '').trim();
}

export function deriveStatus(score: number | null, annotationCount: number): GradingStatus {
  if (score !== null && Number.isFinite(score)) return 'graded';
  if (annotationCount > 0) return 'in_progress';
  return 'not_started';
}

export const statusLabel: Record<GradingStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  graded: 'Graded',
};

export function formatScore(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function average(files: GradedFile[]): number | null {
  // only fully graded submissions (with several graders, a half-filled total would drag the average down)
  const s = files.filter((f) => f.status === 'graded' && f.score !== null).map((f) => f.score as number);
  if (!s.length) return null;
  return s.reduce((a, b) => a + b, 0) / s.length;
}

// ─── Viewer rotation (grader-chosen, display only) ──────────────────────────
// Page units (base) → displayed units, for a page of base size W×H.
export type ViewRotation = 0 | 90 | 180 | 270;

export function rotatedSize(w: number, h: number, r: ViewRotation) {
  return r === 90 || r === 270 ? { w: h, h: w } : { w, h };
}

/** SVG transform that maps base page units into the rotated display box. */
export function rotationTransform(w: number, h: number, r: ViewRotation): string {
  switch (r) {
    case 0:
      return '';
    case 90:
      return `matrix(0 1 -1 0 ${h} 0)`; // (x,y) → (h - y, x)
    case 180:
      return `matrix(-1 0 0 -1 ${w} ${h})`; // (x,y) → (w - x, h - y)
    case 270:
      return `matrix(0 -1 1 0 0 ${w})`; // (x,y) → (y, w - x)
  }
}

/** displayed (rotated) units → base page units */
export function displayToBase(dx: number, dy: number, w: number, h: number, r: ViewRotation) {
  switch (r) {
    case 0:
      return { x: dx, y: dy };
    case 90:
      return { x: dy, y: h - dx };
    case 180:
      return { x: w - dx, y: h - dy };
    case 270:
      return { x: w - dy, y: dx };
  }
}

/** base page units → displayed (rotated) units */
export function baseToDisplay(x: number, y: number, w: number, h: number, r: ViewRotation) {
  switch (r) {
    case 0:
      return { x, y };
    case 90:
      return { x: h - y, y: x };
    case 180:
      return { x: w - x, y: h - y };
    case 270:
      return { x: y, y: w - x };
  }
}

// ─── Annotation geometry helpers ────────────────────────────────────────────

export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  const now = Date.now();
  switch (a.type) {
    case 'pen':
      return { ...a, points: a.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)), updatedAt: now };
    case 'arrow':
      return {
        ...a,
        from: { x: a.from.x + dx, y: a.from.y + dy },
        to: { x: a.to.x + dx, y: a.to.y + dy },
        updatedAt: now,
      };
    case 'text':
    case 'note':
      return { ...a, x: a.x + dx, y: a.y + dy, updatedAt: now };
    default:
      return { ...a, rect: { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy }, updatedAt: now };
  }
}

/** Ramer–Douglas–Peucker simplification on a flat [x,y,...] list */
export function simplifyPoints(pts: number[], tolerance: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const ax = pts[s * 2], ay = pts[s * 2 + 1], bx = pts[e * 2], by = pts[e * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const px = pts[i * 2], py = pts[i * 2 + 1];
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      const d = qx * qx + qy * qy;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2 && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** smooth SVG path through points using quadratic midpoints */
export function penPath(pts: number[]): string {
  const n = pts.length / 2;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]} ${pts[1]} l0.01 0`;
  if (n === 2) return `M${pts[0]} ${pts[1]} L${pts[2]} ${pts[3]}`;
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    const mx = (x + pts[i * 2 + 2]) / 2, my = (y + pts[i * 2 + 3]) / 2;
    d += ` Q${r2(x)} ${r2(y)} ${r2(mx)} ${r2(my)}`;
  }
  d += ` L${pts[(n - 1) * 2]} ${pts[(n - 1) * 2 + 1]}`;
  return d;
}

function r2(v: number) {
  return Math.round(v * 100) / 100;
}

export function arrowHead(from: { x: number; y: number }, to: { x: number; y: number }, strokeWidth: number) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const len = Math.max(8, strokeWidth * 4);
  const spread = Math.PI / 7;
  const p1 = { x: to.x - len * Math.cos(ang - spread), y: to.y - len * Math.sin(ang - spread) };
  const p2 = { x: to.x - len * Math.cos(ang + spread), y: to.y - len * Math.sin(ang + spread) };
  return [p1, to, p2] as const;
}

export const TEXT_FONT_FAMILY =
  `"Segoe UI", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", system-ui, sans-serif`;
export const TEXT_LINE_HEIGHT = 1.25;
export const NOTE_SIZE = 18;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
