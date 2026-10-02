import { zip } from 'fflate';
import type { AnnotationDoc, Assignment, GradedFile } from '../types';
import { storage } from './storage/IndexedDbAdapter';
import { buildGradedPdf, gradedFilename, type ExportOptions } from './exportPdf';
import { downloadBlob, formatScore, naturalCompare, statusLabel } from './util';

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'assignment';
}

export function exportCsv(assignment: Assignment, files: GradedFile[]) {
  const rows = [['filename', 'student', 'score', 'max_score', 'status', 'annotations', 'last_modified']];
  for (const f of files.slice().sort((a, b) => naturalCompare(a.filename, b.filename))) {
    rows.push([
      f.filename,
      f.studentName,
      f.score === null ? '' : formatScore(f.score),
      formatScore(f.maxScore),
      statusLabel[f.status],
      String(f.annotationCount),
      new Date(f.lastModified).toISOString(),
    ]);
  }
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  // UTF-8 BOM so Excel opens Chinese names correctly
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${safeName(assignment.name)}_grades.csv`);
}

export async function exportOnePdf(file: GradedFile, opts: ExportOptions) {
  const bytes = await buildGradedPdf(file, opts);
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), gradedFilename(file));
}

export async function exportZip(
  assignment: Assignment,
  files: GradedFile[],
  opts: ExportOptions,
  onProgress: (done: number, total: number) => void,
): Promise<{ ok: number; failed: string[] }> {
  const entries: Record<string, Uint8Array> = {};
  const failed: string[] = [];
  const used = new Set<string>();
  let done = 0;
  for (const f of files.slice().sort((a, b) => naturalCompare(a.filename, b.filename))) {
    try {
      let name = gradedFilename(f);
      for (let k = 2; used.has(name); k++) name = gradedFilename(f).replace(/_graded\.pdf$/, `_${k}_graded.pdf`);
      used.add(name);
      entries[`graded/${name}`] = await buildGradedPdf(f, opts);
    } catch (e) {
      console.error(e);
      failed.push(f.filename);
    }
    onProgress(++done, files.length);
    await new Promise((r) => setTimeout(r, 0)); // keep UI responsive
  }
  const data: Uint8Array = await new Promise((res, rej) =>
    // PDFs are already compressed → store without deflate (much faster)
    zip(entries, { level: 0 }, (err, out) => (err ? rej(err) : res(out))),
  );
  downloadBlob(new Blob([data as BlobPart], { type: 'application/zip' }), `${safeName(assignment.name)}_graded.zip`);
  return { ok: files.length - failed.length, failed };
}

// ─── Backup (grades + annotations, no PDFs) ──────────────────────────────────

interface Backup {
  format: 'pdf-grading-workspace-backup';
  version: 1;
  exportedAt: string;
  assignment: Assignment;
  files: (GradedFile & { annotations: AnnotationDoc['annotations'] })[];
}

export async function exportBackup(assignment: Assignment, files: GradedFile[]) {
  const out: Backup = { format: 'pdf-grading-workspace-backup', version: 1, exportedAt: new Date().toISOString(), assignment, files: [] };
  for (const f of files) {
    const doc = await storage.getAnnotations(f.id);
    out.files.push({ ...f, annotations: doc?.annotations ?? [] });
  }
  downloadBlob(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), `${safeName(assignment.name)}_backup.json`);
}

/**
 * Restore scores + annotations from a backup into the CURRENT assignment, matching by filename
 * (PDFs must already be imported). Returns how many files were matched.
 */
export async function importBackup(json: string, files: GradedFile[]): Promise<{ matched: number; unmatched: string[] }> {
  const data = JSON.parse(json) as Backup;
  if (data?.format !== 'pdf-grading-workspace-backup') throw new Error('Not a PDF Grading Workspace backup file');
  const byName = new Map(files.map((f) => [f.filename, f]));
  const updated: GradedFile[] = [];
  const unmatched: string[] = [];
  for (const b of data.files) {
    const f = byName.get(b.filename);
    if (!f) {
      unmatched.push(b.filename);
      continue;
    }
    const anns = b.annotations.map((a) => ({ ...a, fileId: f.id }));
    await storage.putAnnotations({ fileId: f.id, annotations: anns, updatedAt: Date.now() });
    updated.push({
      ...f,
      studentName: b.studentName,
      score: b.score,
      status: b.status,
      annotationCount: anns.length,
      viewRotation: b.viewRotation ?? 0,
      lastModified: Date.now(),
    });
  }
  await storage.putFiles(updated);
  return { matched: updated.length, unmatched };
}
