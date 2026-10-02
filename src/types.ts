// ─────────────────────────────────────────────────────────────────────────────
// Core data model
//
// Coordinate system for annotations ("page units"):
//   - Origin at the TOP-LEFT of the page as it is normally displayed
//     (i.e. after the PDF's own /Rotate is applied, before any rotation the
//     grader applies in the viewer).
//   - 1 unit = 1 PDF point (1/72 inch). This is pdf.js `page.getViewport({scale: 1})`.
//   - Independent of zoom, screen DPI, and the viewer's rotate button.
// This makes every annotation resolution-independent and exactly mappable back
// into PDF user space at export time (see lib/exportPdf.ts → toPdfPoint).
// ─────────────────────────────────────────────────────────────────────────────

export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'rectangle'
  | 'ellipse'
  | 'pen'
  | 'arrow'
  | 'text'
  | 'note';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationStyle {
  color: string; // #rrggbb
  opacity: number; // 0..1
  strokeWidth: number; // page units
}

interface AnnotationBase extends AnnotationStyle {
  id: string;
  fileId: string;
  page: number; // 1-based
  type: AnnotationType;
  createdAt: number;
  updatedAt: number;
}

/** highlight / underline / strikethrough / rectangle / ellipse */
export interface RectAnnotation extends AnnotationBase {
  type: 'highlight' | 'underline' | 'strikethrough' | 'rectangle' | 'ellipse';
  rect: Rect;
}

export interface PenAnnotation extends AnnotationBase {
  type: 'pen';
  /** flat list [x0, y0, x1, y1, ...] in page units */
  points: number[];
}

export interface ArrowAnnotation extends AnnotationBase {
  type: 'arrow';
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  /** top-left corner of the text box */
  x: number;
  y: number;
  text: string;
  fontSize: number;
  /**
   * Viewer rotation (deg) active when the text was written. The text is drawn
   * rotated by -rotation around (x, y) so it reads upright in that view.
   */
  rotation?: number;
  /** draw as a text box: border + light background, with padding */
  boxed?: boolean;
  /** fixed outer width in page units → text wraps inside. Omitted = width follows the text. */
  width?: number;
}

export interface NoteAnnotation extends AnnotationBase {
  type: 'note';
  /** top-left corner of the note icon */
  x: number;
  y: number;
  text: string;
}

export type Annotation =
  | RectAnnotation
  | PenAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | NoteAnnotation;

export type GradingStatus = 'not_started' | 'in_progress' | 'graded';

export interface Assignment {
  id: string;
  name: string;
  maxScore: number;
  createdAt: number;
  updatedAt: number;
}

/** One student submission. The PDF bytes live separately (PdfBlobRecord). */
export interface GradedFile {
  id: string;
  assignmentId: string;
  filename: string;
  studentName: string;
  size: number;
  score: number | null;
  maxScore: number;
  status: GradingStatus;
  annotationCount: number;
  pageCount: number | null;
  /** viewer rotation chosen by the grader (0/90/180/270). Not written into the PDF. */
  viewRotation: 0 | 90 | 180 | 270;
  importedAt: number;
  lastModified: number;
}

export interface PdfBlobRecord {
  fileId: string;
  data: Blob;
}

export interface AnnotationDoc {
  fileId: string;
  annotations: Annotation[];
  updatedAt: number;
}

export type ToolId =
  | 'select'
  | 'highlight'
  | 'pen'
  | 'text'
  | 'rectangle'
  | 'ellipse'
  | 'arrow'
  | 'underline'
  | 'strikethrough'
  | 'note'
  | 'eraser';

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

export type SortMode = 'name' | 'status' | 'score';
