import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from './util';

let ctx: CanvasRenderingContext2D | null = null;

function ensureCtx(fontSize: number) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (ctx) ctx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
  return ctx;
}

function widthOf(s: string, fontSize: number) {
  const c = ensureCtx(fontSize);
  return c ? c.measureText(s).width : s.length * fontSize * 0.6;
}

/** Size of plain (unwrapped, multi-line) text in page units. */
export function measureText(text: string, fontSize: number): { width: number; height: number; lines: string[] } {
  const lines = (text || ' ').split('\n');
  let width = 0;
  for (const l of lines) width = Math.max(width, widthOf(l || ' ', fontSize));
  return { width: Math.ceil(width), height: lines.length * fontSize * TEXT_LINE_HEIGHT, lines };
}

// CJK characters / full-width punctuation may break anywhere; latin words break at spaces.
const TOKEN = /[⺀-鿿豈-﫿＀-￯　-〿]|[^\s⺀-鿿豈-﫿＀-￯　-〿]+\s*|\s+/g;

/** Greedy word-wrap, shared by the viewer and the PDF exporter so both break lines identically. */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of (text || '').split('\n')) {
    const tokens = para.match(TOKEN) ?? [''];
    let line = '';
    for (let tok of tokens) {
      if (widthOf((line + tok).trimEnd(), fontSize) <= maxWidth || !line.trim()) {
        if (!line && widthOf(tok.trimEnd(), fontSize) > maxWidth) {
          // a single very long word: hard-break by characters
          for (const ch of tok) {
            if (line && widthOf(line + ch, fontSize) > maxWidth) {
              out.push(line);
              line = '';
            }
            line += ch;
          }
          continue;
        }
        line += tok;
      } else {
        out.push(line.trimEnd());
        tok = tok.trimStart();
        line = '';
        if (widthOf(tok.trimEnd(), fontSize) > maxWidth) {
          for (const ch of tok) {
            if (line && widthOf(line + ch, fontSize) > maxWidth) {
              out.push(line);
              line = '';
            }
            line += ch;
          }
        } else line = tok;
      }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [''];
}

export interface TextLayout {
  lines: string[];
  pad: number;
  /** outer box size (incl. padding) in page units */
  boxW: number;
  boxH: number;
}

/** Geometry of a text annotation: plain text (auto width) or a text box (border, fixed width → wraps). */
export function layoutText(a: { text: string; fontSize: number; width?: number; boxed?: boolean }): TextLayout {
  const pad = a.boxed ? Math.max(3, Math.round(a.fontSize * 0.35 * 10) / 10) : 0;
  const lh = a.fontSize * TEXT_LINE_HEIGHT;
  if (a.width && a.width > 0) {
    const inner = Math.max(a.fontSize, a.width - 2 * pad);
    const lines = wrapText(a.text, a.fontSize, inner);
    return { lines, pad, boxW: a.width, boxH: lines.length * lh + 2 * pad };
  }
  const m = measureText(a.text, a.fontSize);
  return { lines: m.lines, pad, boxW: m.width + 2 * pad, boxH: m.height + 2 * pad };
}
