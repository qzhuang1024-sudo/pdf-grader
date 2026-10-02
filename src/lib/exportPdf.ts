import {
  BlendMode,
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFHexString,
  PDFPage,
  PDFString,
  StandardFonts,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
} from 'pdf-lib';
import type { Annotation, GradedFile, TextAnnotation } from '../types';
import { storage } from './storage/IndexedDbAdapter';
import { NOTE_SIZE, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, arrowHead, formatScore } from './util';
import { layoutText } from './textMeasure';

/*
 * Flattening strategy
 * ───────────────────
 * The original PDF bytes are never modified in storage. On export we load a copy
 * with pdf-lib and draw the annotation layer on top of each page:
 *
 *   highlight            → filled polygon, opacity + Multiply blend (text stays readable)
 *   rect / ellipse / pen → vector paths (ellipse as 4 Bézier curves)
 *   underline / strike   → vector lines
 *   arrow                → vector line + head
 *   text                 → rendered to a high-res PNG with the system font and placed as an
 *                          image. This supports Chinese/any script without embedding a 10+ MB CJK font.
 *   sticky note          → a real PDF /Text annotation (comment popup in Acrobat / Chrome / Edge),
 *                          content stored as UTF-16 so Chinese works.
 *   score                → optional stamp in the top-right corner of page 1
 *
 * Annotation coordinates are "page units" (see types.ts). toPdfPoint() maps them to
 * PDF user space, honouring the page's CropBox and /Rotate.
 */

export interface ExportOptions {
  stampScore: boolean;
  /** apply the grader's viewer rotation to the exported page (/Rotate) */
  applyViewRotation: boolean;
}

type Pt = { x: number; y: number };

interface PageGeom {
  x0: number;
  y0: number;
  w: number; // un-rotated box width
  h: number;
  rot: number; // intrinsic /Rotate
}

function pageGeom(page: PDFPage): PageGeom {
  const box = page.getCropBox();
  return { x0: box.x, y0: box.y, w: box.width, h: box.height, rot: ((page.getRotation().angle % 360) + 360) % 360 };
}

/** page units (top-left origin, after /Rotate) → PDF user space */
export function toPdfPoint(g: PageGeom, px: number, py: number): Pt {
  switch (g.rot) {
    case 90:
      return { x: g.x0 + py, y: g.y0 + px };
    case 180:
      return { x: g.x0 + g.w - px, y: g.y0 + py };
    case 270:
      return { x: g.x0 + g.w - py, y: g.y0 + g.h - px };
    default:
      return { x: g.x0 + px, y: g.y0 + g.h - py };
  }
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return rgb(0.8, 0.1, 0.1);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

// Path built in page units, emitted in PDF space through drawSvgPath with y negated
// (drawSvgPath maps svg (sx, sy) → (x + sx, y − sy); with x = y = 0 we get (sx, −sy)).
class PathBuilder {
  private d: string[] = [];
  constructor(private g: PageGeom) {}
  private p(x: number, y: number) {
    const q = toPdfPoint(this.g, x, y);
    return `${q.x.toFixed(3)} ${(-q.y).toFixed(3)}`;
  }
  M(x: number, y: number) { this.d.push(`M ${this.p(x, y)}`); return this; }
  L(x: number, y: number) { this.d.push(`L ${this.p(x, y)}`); return this; }
  Q(cx: number, cy: number, x: number, y: number) { this.d.push(`Q ${this.p(cx, cy)} ${this.p(x, y)}`); return this; }
  C(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.d.push(`C ${this.p(c1x, c1y)} ${this.p(c2x, c2y)} ${this.p(x, y)}`);
    return this;
  }
  Z() { this.d.push('Z'); return this; }
  toString() { return this.d.join(' '); }
}

function rectPath(g: PageGeom, x: number, y: number, w: number, h: number) {
  return new PathBuilder(g).M(x, y).L(x + w, y).L(x + w, y + h).L(x, y + h).Z().toString();
}

function ellipsePath(g: PageGeom, x: number, y: number, w: number, h: number) {
  const k = 0.5522848;
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  return new PathBuilder(g)
    .M(cx + rx, cy)
    .C(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry)
    .C(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy)
    .C(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry)
    .C(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy)
    .Z()
    .toString();
}

function penPdfPath(g: PageGeom, pts: number[]) {
  const n = pts.length / 2;
  const b = new PathBuilder(g).M(pts[0], pts[1]);
  if (n === 1) return b.L(pts[0] + 0.01, pts[1]).toString();
  if (n === 2) return b.L(pts[2], pts[3]).toString();
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    b.Q(x, y, (x + pts[i * 2 + 2]) / 2, (y + pts[i * 2 + 3]) / 2);
  }
  return b.L(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]).toString();
}

function stroke(page: PDFPage, path: string, color: string, width: number, opacity: number, cap = LineCapStyle.Round) {
  page.drawSvgPath(path, { x: 0, y: 0, borderColor: hexToRgb(color), borderWidth: width, borderOpacity: opacity, borderLineCap: cap });
}

/** Render a text annotation (plain text or bordered text box, transparent background) into a PNG at 4× resolution. */
async function textToPng(a: TextAnnotation): Promise<{ png: Uint8Array; w: number; h: number }> {
  const L = layoutText(a);
  const S = 4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(L.boxW * S));
  canvas.height = Math.max(1, Math.ceil(L.boxH * S));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(S, S);
  if (a.boxed) {
    // border only — transparent background so the student's work stays visible
    ctx.globalAlpha = a.opacity;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 0.9;
    ctx.strokeRect(0.45, 0.45, L.boxW - 0.9, L.boxH - 0.9);
  }
  ctx.font = `${a.fontSize}px ${TEXT_FONT_FAMILY}`;
  ctx.fillStyle = a.color;
  ctx.globalAlpha = a.opacity;
  ctx.textBaseline = 'top';
  L.lines.forEach((l, i) => ctx.fillText(l, L.pad, L.pad + i * a.fontSize * TEXT_LINE_HEIGHT));
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  return { png: new Uint8Array(await blob.arrayBuffer()), w: L.boxW, h: L.boxH };
}

async function drawAnnotation(pdf: PDFDocument, page: PDFPage, g: PageGeom, a: Annotation) {
  switch (a.type) {
    case 'highlight': {
      const r = a.rect;
      page.drawSvgPath(rectPath(g, r.x, r.y, r.width, r.height), {
        x: 0, y: 0, color: hexToRgb(a.color), opacity: a.opacity, blendMode: BlendMode.Multiply,
      });
      break;
    }
    case 'rectangle':
      stroke(page, rectPath(g, a.rect.x, a.rect.y, a.rect.width, a.rect.height), a.color, a.strokeWidth, a.opacity, LineCapStyle.Projecting);
      break;
    case 'ellipse':
      stroke(page, ellipsePath(g, a.rect.x, a.rect.y, a.rect.width, a.rect.height), a.color, a.strokeWidth, a.opacity);
      break;
    case 'underline':
    case 'strikethrough': {
      const r = a.rect;
      const y = a.type === 'underline' ? r.y + r.height : r.y + r.height / 2;
      stroke(page, new PathBuilder(g).M(r.x, y).L(r.x + r.width, y).toString(), a.color, a.strokeWidth, a.opacity, LineCapStyle.Butt);
      break;
    }
    case 'pen':
      stroke(page, penPdfPath(g, a.points), a.color, a.strokeWidth, a.opacity);
      break;
    case 'arrow': {
      const [p1, tip, p2] = arrowHead(a.from, a.to, a.strokeWidth);
      stroke(page, new PathBuilder(g).M(a.from.x, a.from.y).L(a.to.x, a.to.y).toString(), a.color, a.strokeWidth, a.opacity);
      stroke(page, new PathBuilder(g).M(p1.x, p1.y).L(tip.x, tip.y).L(p2.x, p2.y).toString(), a.color, a.strokeWidth, a.opacity);
      break;
    }
    case 'text': {
      if (!a.text.trim()) break;
      const { png, w, h } = await textToPng(a);
      const img = await pdf.embedPng(png);
      // The image's bottom-left corner in page units: the text box is rotated by −rotation around (x, y)
      const r = (-(a.rotation ?? 0) * Math.PI) / 180;
      const c = Math.cos(r), s = Math.sin(r);
      const bl = { x: a.x - h * s, y: a.y + h * c };
      const q = toPdfPoint(g, bl.x, bl.y);
      // upright in page-unit space means rotated by the page's /Rotate in PDF space
      const angle = (g.rot + (a.rotation ?? 0)) % 360;
      page.drawImage(img, { x: q.x, y: q.y, width: w, height: h, rotate: degrees(angle) });
      break;
    }
    case 'note': {
      const p0 = toPdfPoint(g, a.x, a.y);
      const p1 = toPdfPoint(g, a.x + NOTE_SIZE, a.y + NOTE_SIZE);
      const rect = [Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.max(p0.x, p1.x), Math.max(p0.y, p1.y)];
      const c = hexToRgb(a.color);
      const annot = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: rect,
        Contents: PDFHexString.fromText(a.text || ''),
        T: PDFHexString.fromText('Grader'),
        Name: 'Comment',
        C: [c.red, c.green, c.blue],
        F: 4, // print
        Open: false,
        M: PDFString.fromDate(new Date(a.updatedAt)),
        NM: PDFHexString.fromText(a.id),
      });
      page.node.addAnnot(pdf.context.register(annot));
      break;
    }
  }
}

async function stampScore(pdf: PDFDocument, page: PDFPage, g: PageGeom, file: GradedFile) {
  if (file.score === null) return;
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const label = `${formatScore(file.score)} / ${formatScore(file.maxScore)}`;
  const size = 20;
  const tw = font.widthOfTextAtSize(label, size);
  // page units: top-right corner of the page as displayed
  const pw = g.rot === 90 || g.rot === 270 ? g.h : g.w;
  const boxW = tw + 20, boxH = size + 14;
  const x = pw - boxW - 24, y = 24;
  stroke(page, rectPath(g, x, y, boxW, boxH), '#d32f2f', 1.5, 1);
  const q = toPdfPoint(g, x + 10, y + boxH - 10);
  page.drawText(label, { x: q.x, y: q.y, size, font, color: rgb(0.83, 0.18, 0.18), rotate: degrees(g.rot) });
}

/** Produce the graded PDF bytes for one submission. The stored original is untouched. */
export async function buildGradedPdf(file: GradedFile, opts: ExportOptions): Promise<Uint8Array> {
  const blob = await storage.getPdf(file.id);
  if (!blob) throw new Error(`PDF data missing for ${file.filename}`);
  const pdf = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
  const doc = await storage.getAnnotations(file.id);
  const anns = doc?.annotations ?? [];
  const pages = pdf.getPages();

  const byPage = new Map<number, Annotation[]>();
  for (const a of anns) {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page)!.push(a);
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const g = pageGeom(page);
    const list = byPage.get(i + 1) ?? [];
    const needsScore = i === 0 && opts.stampScore && file.score !== null;
    if (list.length || needsScore) {
      // (pdf-lib wraps the original content streams in q … Q before our first drawing operator)
      page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
      for (const a of list) await drawAnnotation(pdf, page, g, a);
      // stamp in the orientation the page will finally be shown in (incl. the grader's view rotation)
      const finalRot = opts.applyViewRotation ? (g.rot + (file.viewRotation ?? 0)) % 360 : g.rot;
      if (needsScore) await stampScore(pdf, page, { ...g, rot: finalRot }, file);
      page.pushOperators(popGraphicsState());
    }
    if (opts.applyViewRotation && file.viewRotation) page.setRotation(degrees((g.rot + file.viewRotation) % 360));
  }

  pdf.setModificationDate(new Date());
  return pdf.save({ useObjectStreams: true });
}

export function gradedFilename(file: GradedFile) {
  return file.filename.replace(/\.pdf$/i, '') + '_graded.pdf';
}
