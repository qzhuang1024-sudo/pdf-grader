import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from './util';

let ctx: CanvasRenderingContext2D | null = null;

/** Size of a (multi-line) text annotation in page units. Shared by viewer + exporter. */
export function measureText(text: string, fontSize: number): { width: number; height: number; lines: string[] } {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  const lines = (text || ' ').split('\n');
  let width = 0;
  if (ctx) {
    ctx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
    for (const l of lines) width = Math.max(width, ctx.measureText(l || ' ').width);
  } else {
    width = Math.max(...lines.map((l) => l.length)) * fontSize * 0.6;
  }
  return { width: Math.ceil(width), height: lines.length * fontSize * TEXT_LINE_HEIGHT, lines };
}
