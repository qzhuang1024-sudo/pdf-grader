import { zip } from 'fflate';
import type { AnnotationDoc, Assignment, GradedFile, Grader } from '../types';
import { storage } from './storage/IndexedDbAdapter';
import { buildGradedPdf, gradedFilename, type ExportOptions } from './exportPdf';
import { downloadBlob, formatScore, nameFromFilename, naturalCompare, statusLabel } from './util';
import { gradersOf, recomputeFile, scoresOf } from './graders';

/** e.g. "2026-10-04 02:20:15" in the computer's own time zone (Excel recognises this as a date-time) */
function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'assignment';
}

export function exportCsv(assignment: Assignment, files: GradedFile[]) {
  const graders = gradersOf(assignment);
  const multi = graders.length > 1;
  // with several graders: one column per grader + the total in "score"
  const graderCols = multi ? graders.map((g) => `${g.name} (/${formatScore(g.maxScore)})`) : [];
  const rows = [['filename', 'student', ...graderCols, 'score', 'max_score', 'status', 'annotations', 'last_modified']];
  for (const f of files.slice().sort((a, b) => naturalCompare(a.filename, b.filename))) {
    const sc = scoresOf(f);
    rows.push([
      f.filename,
      f.studentName,
      ...(multi ? graders.map((g) => (sc[g.id] === null || sc[g.id] === undefined ? '' : formatScore(sc[g.id]))) : []),
      f.score === null ? '' : formatScore(f.score),
      formatScore(f.maxScore),
      statusLabel[f.status],
      String(f.annotationCount),
      formatLocalTime(f.lastModified),
    ]);
  }
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  // UTF-8 BOM so Excel opens Chinese names correctly
  downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `${safeName(assignment.name)}_grades.csv`);
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
//
// Multi-grader workflow: every grader imports the same PDFs, grades in their own slot
// ("Grader 2" fills slot 2 …), then sends "Save backup" to the coordinator, who merges
// all backups with "Import / merge backup". Slots are matched by position (g1, g2, …).

interface Backup {
  format: 'pdf-grading-workspace-backup';
  version: 1 | 2;
  exportedAt: string;
  assignment: Assignment;
  files: (GradedFile & { annotations: AnnotationDoc['annotations'] })[];
}

export async function exportBackup(assignment: Assignment, files: GradedFile[]) {
  const out: Backup = {
    format: 'pdf-grading-workspace-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    assignment: { ...assignment, graders: gradersOf(assignment) },
    files: [],
  };
  for (const f of files) {
    const doc = await storage.getAnnotations(f.id);
    out.files.push({ ...f, scores: scoresOf(f), annotations: doc?.annotations ?? [] });
  }
  downloadBlob(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), `${safeName(assignment.name)}_backup.json`);
}

export interface MergeResult {
  matched: number;
  unmatched: string[];
  /** slots where this computer already had a DIFFERENT score (kept or overwritten depending on onConflict) */
  overwritten: number;
  scoresImported: number;
  annotationsAdded: number;
  gradersAdded: number;
}

/**
 * MERGE a backup into the CURRENT assignment (PDFs must already be imported; files are matched by filename):
 *  - scores: every non-empty grader slot in the backup is copied into the same slot here
 *    (empty slots in the backup never erase scores here); slots this assignment does not have yet are added
 *  - annotations: union by annotation id (if both sides have the same one, the newer edit wins)
 *  - student name: taken from the backup only if it was renamed there and not here
 */
export interface MergeOptions {
  /** only count what would change, write nothing */
  dryRun?: boolean;
  /** when a slot here already has a DIFFERENT score: 'keep' (default, protects existing grades) or 'overwrite' */
  onConflict?: 'keep' | 'overwrite';
  /**
   * Import ONE slot of the backup into ONE slot here (e.g. the backup's "Grader 1" → our "李助教").
   * Annotations made by that grader (or without an author) are re-attributed to `to`.
   * Without it, all slots are merged by position (g1 → g1, g2 → g2 …).
   */
  slotMap?: { from: string; to: string };
  /** default true */
  includeAnnotations?: boolean;
}

export interface BackupInfo {
  fileName: string;
  assignmentName: string;
  exportedAt: string;
  graders: Grader[];
  /** how many submissions have a score in each slot of the backup */
  scoredPerSlot: Record<string, number>;
  files: number;
  annotations: number;
}

/** Read a backup without changing anything (for the "which grader is this?" dialog). */
export function inspectBackup(json: string, fileName: string): BackupInfo {
  const data = JSON.parse(json) as Backup;
  if (data?.format !== 'pdf-grading-workspace-backup') throw new Error(`${fileName}: not a PDF Grading Workspace backup file`);
  const graders = gradersOf(data.assignment);
  const scoredPerSlot: Record<string, number> = {};
  for (const g of graders) scoredPerSlot[g.id] = 0;
  let annotations = 0;
  for (const f of data.files) {
    const sc = scoresOf(f);
    for (const g of graders) if (sc[g.id] !== null && sc[g.id] !== undefined) scoredPerSlot[g.id]++;
    annotations += f.annotations?.length ?? 0;
  }
  return {
    fileName,
    assignmentName: data.assignment?.name ?? '',
    exportedAt: data.exportedAt,
    graders,
    scoredPerSlot,
    files: data.files.length,
    annotations,
  };
}

export async function importBackup(json: string, assignment: Assignment, files: GradedFile[], opts: MergeOptions = {}): Promise<MergeResult> {
  const { dryRun = false, onConflict = 'keep', slotMap, includeAnnotations = true } = opts;
  const data = JSON.parse(json) as Backup;
  if (data?.format !== 'pdf-grading-workspace-backup') throw new Error('Not a PDF Grading Workspace backup file');

  // grader slots: keep ours, add any extra slots the backup has
  const ours = gradersOf(assignment);
  const theirs = gradersOf(data.assignment);
  // a slot that was never set up here ("Grader N") takes the name + max score from the backup
  const isDefault = (g: Grader) => /^Grader \d+$/.test(g.name);
  // (with an explicit slot mapping the grader list here is left exactly as it is)
  const graders = slotMap ? [...ours] : ours.map((g) => {
    const t = theirs.find((x) => x.id === g.id);
    return t && isDefault(g) && !isDefault(t) ? { ...t } : g;
  });
  if (!slotMap) for (const g of theirs) if (!graders.some((x) => x.id === g.id)) graders.push({ ...g });
  const gradersAdded = graders.length - ours.length;
  const changed = gradersAdded > 0 || graders.some((g, i) => g !== ours[i]);
  if (changed && !dryRun) {
    await storage.putAssignment({
      ...assignment,
      graders,
      maxScore: graders.reduce((a, g) => a + g.maxScore, 0),
      updatedAt: Date.now(),
    });
  }

  const byName = new Map(files.map((f) => [f.filename, f]));
  const updated: GradedFile[] = [];
  const unmatched: string[] = [];
  let overwritten = 0, scoresImported = 0, annotationsAdded = 0;

  for (const b of data.files) {
    const f = byName.get(b.filename);
    if (!f) {
      unmatched.push(b.filename);
      continue;
    }
    // scores
    const scores = { ...scoresOf(f) };
    const all = scoresOf(b);
    const incoming: Record<string, number | null> = slotMap ? { [slotMap.to]: all[slotMap.from] ?? null } : all;
    for (const [gid, v] of Object.entries(incoming)) {
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      const conflict = scores[gid] !== null && scores[gid] !== undefined && scores[gid] !== v;
      if (conflict) {
        overwritten++;
        if (onConflict === 'keep') continue;
      }
      if (scores[gid] !== v) scoresImported++;
      scores[gid] = v;
    }
    // annotations: union by id
    const local = (await storage.getAnnotations(f.id))?.annotations ?? [];
    const merged = new Map(local.map((a) => [a.id, a]));
    const theirAnns = !includeAnnotations ? [] : (b.annotations ?? []).map((a) =>
      slotMap && (!a.author || a.author === slotMap.from) ? { ...a, author: slotMap.to } : a,
    );
    for (const a of theirAnns) {
      const mine = merged.get(a.id);
      if (!mine) {
        merged.set(a.id, { ...a, fileId: f.id });
        annotationsAdded++;
      } else if ((a.updatedAt ?? 0) > (mine.updatedAt ?? 0) || (slotMap && !mine.author)) {
        merged.set(a.id, { ...a, fileId: f.id });
      }
    }
    const anns = [...merged.values()];
    if (!dryRun) await storage.putAnnotations({ fileId: f.id, annotations: anns, updatedAt: Date.now() });

    const defaultName = nameFromFilename(f.filename);
    const studentName = f.studentName === defaultName && b.studentName && b.studentName !== defaultName ? b.studentName : f.studentName;
    updated.push(recomputeFile({ ...f, studentName, scores, lastModified: Date.now() }, graders, anns.length));
  }
  if (!dryRun) await storage.putFiles(updated);
  return { matched: updated.length, unmatched, overwritten, scoresImported, annotationsAdded, gradersAdded };
}
