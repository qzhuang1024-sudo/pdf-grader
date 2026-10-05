import { create } from 'zustand';
import type {
  Annotation,
  AnnotationStyle,
  Assignment,
  GradedFile,
  Grader,
  SortMode,
  ToolId,
  ZoomMode,
} from '../types';
import { storage } from '../lib/storage/IndexedDbAdapter';
import { nameFromFilename, naturalCompare, uid } from '../lib/util';
import { gradersOf, recomputeFile, scoresOf } from '../lib/graders';
import { forgetDocument } from '../lib/pdfjs';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface ScoreStyle {
  size: 'S' | 'M' | 'L';
  color: string;
  background: string;
}
export const DEFAULT_SCORE_STYLE: ScoreStyle = { size: 'M', color: '#1f2328', background: '#ffffff' };

const DEFAULT_STYLES: Record<ToolId, AnnotationStyle> = {
  select: { color: '#d32f2f', opacity: 1, strokeWidth: 2 },
  eraser: { color: '#d32f2f', opacity: 1, strokeWidth: 2 },
  highlight: { color: '#ffeb3b', opacity: 0.4, strokeWidth: 0 },
  pen: { color: '#d32f2f', opacity: 1, strokeWidth: 2 },
  text: { color: '#d32f2f', opacity: 1, strokeWidth: 14 }, // strokeWidth = font size for text
  rectangle: { color: '#d32f2f', opacity: 1, strokeWidth: 2 },
  ellipse: { color: '#d32f2f', opacity: 1, strokeWidth: 2 },
  arrow: { color: '#d32f2f', opacity: 1, strokeWidth: 2 },
  underline: { color: '#d32f2f', opacity: 1, strokeWidth: 1.5 },
  strikethrough: { color: '#d32f2f', opacity: 1, strokeWidth: 1.5 },
  note: { color: '#f9a825', opacity: 1, strokeWidth: 1 },
};

interface History {
  past: Annotation[][];
  future: Annotation[][];
}
const HISTORY_LIMIT = 200;
/** undo/redo stacks are kept per file for the whole session */
const histories = new Map<string, History>();
function historyFor(fileId: string): History {
  let h = histories.get(fileId);
  if (!h) histories.set(fileId, (h = { past: [], future: [] }));
  return h;
}

interface State {
  ready: boolean;
  initError: string | null;
  assignments: Assignment[];
  assignmentId: string | null;
  files: GradedFile[];
  currentId: string | null;
  annotations: Annotation[];
  canUndo: boolean;
  canRedo: boolean;
  selectedAnnId: string | null;
  editingAnnId: string | null;
  tool: ToolId;
  styles: Record<ToolId, AnnotationStyle>;
  zoom: number;
  zoomMode: ZoomMode;
  sort: SortMode;
  ungradedOnly: boolean;
  /** new text annotations are created as boxed text boxes */
  textBoxed: boolean;
  /** look of the score boxes */
  scoreStyle: ScoreStyle;
  /** bumps when data is reloaded from storage (backup import) so inputs re-sync */
  reloadToken: number;
  /** who is grading on this computer (Grader.id) — stamped on every new annotation */
  activeGraderId: string;
  saveState: SaveState;
  toasts: Toast[];
  busy: string | null;
}

interface Actions {
  init(): Promise<void>;
  // assignments
  switchAssignment(id: string): Promise<void>;
  createAssignment(name: string): Promise<void>;
  renameAssignment(name: string): void;
  setMaxScore(max: number): void;
  /** replace the grader list of the current assignment (count, names, max scores) */
  setGraders(graders: Grader[]): void;
  deleteAssignment(): Promise<void>;
  // files
  importFiles(files: File[]): Promise<void>;
  selectFile(id: string): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  removeFile(id: string): Promise<void>;
  /** re-read files + current annotations from storage (after a backup restore) */
  reload(): Promise<void>;
  setGraderScore(graderId: string, score: number | null): void;
  setActiveGrader(graderId: string): void;
  setScoreStyle(patch: Partial<ScoreStyle>): void;
  setStudentName(name: string): void;
  setPageCount(fileId: string, n: number): void;
  rotateView(delta: 90 | -90): void;
  // annotations
  addAnnotation(a: Annotation): void;
  updateAnnotation(id: string, patch: Partial<Annotation>, opts?: { history?: boolean }): void;
  replaceAnnotation(a: Annotation): void;
  removeAnnotation(id: string): void;
  clearPageAnnotations(): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  setEditing(id: string | null): void;
  // ui
  setTool(t: ToolId): void;
  setToolStyle(t: ToolId, patch: Partial<AnnotationStyle>): void;
  setZoom(z: number): void;
  setZoomMode(m: ZoomMode): void;
  setSort(s: SortMode): void;
  setUngradedOnly(v: boolean): void;
  setTextBoxed(v: boolean): void;
  toast(message: string, kind?: Toast['kind']): void;
  dismissToast(id: string): void;
  setBusy(msg: string | null): void;
  // persistence
  flush(): Promise<void>;
}

export type Store = State & Actions;

// ─── autosave machinery ─────────────────────────────────────────────────────
const dirtyFiles = new Set<string>();
const dirtyAnnotations = new Map<string, Annotation[]>();
let dirtyAssignment = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
const SAVE_DELAY = 350;
let initOnce: Promise<void> | null = null;

export const useStore = create<Store>()((set, get) => {
  function scheduleSave() {
    set({ saveState: 'pending' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), SAVE_DELAY);
  }

  function patchFile(id: string, patch: Partial<GradedFile>) {
    set((s) => ({
      files: s.files.map((f) => (f.id === id ? { ...f, ...patch, lastModified: Date.now() } : f)),
    }));
    dirtyFiles.add(id);
    scheduleSave();
  }

  function commitAnnotations(next: Annotation[], pushHistory = true) {
    const { currentId, annotations, files } = get();
    if (!currentId) return;
    const h = historyFor(currentId);
    if (pushHistory) {
      h.past.push(annotations);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
      h.future = [];
    }
    const file = files.find((f) => f.id === currentId);
    set({ annotations: next, canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
    dirtyAnnotations.set(currentId, next);
    if (file) {
      const r = recomputeFile(file, currentGraders(), next.length);
      patchFile(currentId, { annotationCount: next.length, status: r.status });
    } else scheduleSave();
  }

  function currentGraders(): Grader[] {
    const s = get();
    return gradersOf(s.assignments.find((a) => a.id === s.assignmentId));
  }

  async function loadFiles(assignmentId: string) {
    const graders = gradersOf(get().assignments.find((a) => a.id === assignmentId));
    // older records (single score) are upgraded on the fly to per-grader scores
    const files = (await storage.listFiles(assignmentId)).map((f) => recomputeFile(f, graders));
    const savedGrader = await storage.getSetting<string>(`activeGrader:${assignmentId}`);
    set({ files, activeGraderId: graders.some((g) => g.id === savedGrader) ? savedGrader! : graders[0].id });
    const last = await storage.getSetting<string>(`lastFile:${assignmentId}`);
    const first = last && files.some((f) => f.id === last) ? last : sortFiles(files, get().sort)[0]?.id;
    set({ currentId: null, annotations: [] });
    if (first) await get().selectFile(first);
  }

  return {
    ready: false,
    initError: null,
    assignments: [],
    assignmentId: null,
    files: [],
    currentId: null,
    annotations: [],
    canUndo: false,
    canRedo: false,
    selectedAnnId: null,
    editingAnnId: null,
    tool: 'select',
    styles: DEFAULT_STYLES,
    zoom: 1,
    zoomMode: 'fit-width',
    sort: 'name',
    ungradedOnly: false,
    textBoxed: true,
    scoreStyle: DEFAULT_SCORE_STYLE,
    reloadToken: 0,
    activeGraderId: 'g1',
    saveState: 'saved',
    toasts: [],
    busy: null,

    async init() {
      if (initOnce) return initOnce;
      initOnce = (async () => {
      try {
        await storage.init();
        let assignments = await storage.listAssignments();
        if (!assignments.length) {
          const a: Assignment = { id: uid('asg_'), name: 'Assignment 1', maxScore: 100, createdAt: Date.now(), updatedAt: Date.now() };
          await storage.putAssignment(a);
          assignments = [a];
        }
        assignments.sort((a, b) => a.createdAt - b.createdAt);
        const savedStyles = await storage.getSetting<Partial<Record<ToolId, AnnotationStyle>>>('toolStyles');
        const sort = (await storage.getSetting<SortMode>('sort')) ?? 'name';
        const textBoxed = (await storage.getSetting<boolean>('textBoxed')) ?? true;
        const scoreStyle = { ...DEFAULT_SCORE_STYLE, ...(await storage.getSetting<Partial<ScoreStyle>>('scoreStyle')) };
        set({ textBoxed, scoreStyle });
        const lastAsg = await storage.getSetting<string>('lastAssignment');
        const assignmentId = assignments.some((a) => a.id === lastAsg) ? lastAsg! : assignments[0].id;
        set({ assignments, assignmentId, styles: { ...DEFAULT_STYLES, ...savedStyles }, sort });
        await loadFiles(assignmentId);
        set({ ready: true });
      } catch (e) {
        console.error(e);
        set({ initError: e instanceof Error ? e.message : String(e), ready: true });
      }
      })();
      return initOnce;
    },

    async switchAssignment(id) {
      if (id === get().assignmentId) return;
      await get().flush();
      set({ assignmentId: id, files: [], currentId: null, annotations: [] });
      void storage.setSetting('lastAssignment', id);
      await loadFiles(id);
    },

    async createAssignment(name) {
      const a: Assignment = { id: uid('asg_'), name: name || 'Untitled assignment', maxScore: 100, createdAt: Date.now(), updatedAt: Date.now() };
      await storage.putAssignment(a);
      set((s) => ({ assignments: [...s.assignments, a] }));
      await get().switchAssignment(a.id);
    },

    renameAssignment(name) {
      const { assignmentId } = get();
      set((s) => ({ assignments: s.assignments.map((a) => (a.id === assignmentId ? { ...a, name, updatedAt: Date.now() } : a)) }));
      dirtyAssignment = true;
      scheduleSave();
    },

    setMaxScore(max) {
      if (!(max > 0)) return;
      const g = currentGraders();
      if (g.length !== 1) return; // with several graders the total is the sum of their max scores
      get().setGraders([{ ...g[0], maxScore: max }]);
    },

    setGraders(graders) {
      const { assignmentId } = get();
      if (!assignmentId || !graders.length) return;
      const total = graders.reduce((a, g) => a + g.maxScore, 0);
      set((s) => ({
        assignments: s.assignments.map((a) => (a.id === assignmentId ? { ...a, graders, maxScore: total, updatedAt: Date.now() } : a)),
        files: s.files.map((f) => recomputeFile(f, graders)),
        activeGraderId: graders.some((g) => g.id === s.activeGraderId) ? s.activeGraderId : graders[0].id,
      }));
      get().files.forEach((f) => dirtyFiles.add(f.id));
      dirtyAssignment = true;
      // grader settings are rare and important → save right away instead of waiting for autosave
      void get().flush();
    },

    async deleteAssignment() {
      const { assignmentId, assignments, files } = get();
      if (!assignmentId) return;
      await get().flush();
      files.forEach((f) => forgetDocument(f.id));
      await storage.deleteAssignment(assignmentId);
      let rest = assignments.filter((a) => a.id !== assignmentId);
      if (!rest.length) {
        const a: Assignment = { id: uid('asg_'), name: 'Assignment 1', maxScore: 100, createdAt: Date.now(), updatedAt: Date.now() };
        await storage.putAssignment(a);
        rest = [a];
      }
      set({ assignments: rest, assignmentId: null });
      await get().switchAssignment(rest[0].id);
    },

    async importFiles(incoming) {
      const { assignmentId, files, assignments } = get();
      if (!assignmentId || !incoming.length) return;
      const max = assignments.find((a) => a.id === assignmentId)?.maxScore ?? 100;
      const existing = new Set(files.map((f) => `${f.filename}::${f.size}`));
      const added: GradedFile[] = [];
      let skipped = 0;
      set({ busy: `Importing ${incoming.length} PDF(s)…` });
      try {
        for (const file of incoming) {
          const key = `${file.name}::${file.size}`;
          if (existing.has(key)) {
            skipped++;
            continue;
          }
          existing.add(key);
          const rec: GradedFile = {
            id: uid('f_'),
            assignmentId,
            filename: file.name,
            studentName: nameFromFilename(file.name),
            size: file.size,
            score: null,
            scores: Object.fromEntries(gradersOf(assignments.find((a) => a.id === assignmentId)).map((g) => [g.id, null])),
            maxScore: max,
            status: 'not_started',
            annotationCount: 0,
            pageCount: null,
            viewRotation: 0,
            importedAt: Date.now(),
            lastModified: Date.now(),
          };
          // store an immutable copy of the original bytes
          await storage.putPdf(rec.id, new Blob([await file.arrayBuffer()], { type: 'application/pdf' }));
          added.push(rec);
        }
        await storage.putFiles(added);
      } catch (e) {
        get().toast(`Import failed: ${e instanceof Error ? e.message : e}`, 'error');
      } finally {
        set({ busy: null });
      }
      set((s) => ({ files: [...s.files, ...added] }));
      const msg = `Imported ${added.length} PDF${added.length === 1 ? '' : 's'}` + (skipped ? ` · ${skipped} duplicate(s) skipped` : '');
      get().toast(msg, added.length ? 'success' : 'info');
      if (!get().currentId && added.length) {
        const first = sortFiles(get().files, get().sort)[0];
        if (first) await get().selectFile(first.id);
      }
    },

    async selectFile(id) {
      const { currentId } = get();
      if (id === currentId) return;
      await get().flush();
      const doc = await storage.getAnnotations(id);
      const h = historyFor(id);
      set({
        currentId: id,
        annotations: doc?.annotations ?? [],
        selectedAnnId: null,
        editingAnnId: null,
        canUndo: h.past.length > 0,
        canRedo: h.future.length > 0,
      });
      const aid = get().assignmentId;
      if (aid) void storage.setSetting(`lastFile:${aid}`, id);
    },

    async next() {
      const list = visibleFiles(get());
      const i = list.findIndex((f) => f.id === get().currentId);
      if (i >= 0 && i < list.length - 1) await get().selectFile(list[i + 1].id);
      else if (i === list.length - 1) get().toast('This is the last file in the list.', 'info');
    },

    async prev() {
      const list = visibleFiles(get());
      const i = list.findIndex((f) => f.id === get().currentId);
      if (i > 0) await get().selectFile(list[i - 1].id);
    },

    async removeFile(id) {
      await get().flush();
      const list = visibleFiles(get());
      const i = list.findIndex((f) => f.id === id);
      forgetDocument(id);
      histories.delete(id);
      await storage.deleteFile(id);
      set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
      if (get().currentId === id) {
        set({ currentId: null, annotations: [] });
        const rest = list.filter((f) => f.id !== id);
        const nextFile = rest[Math.min(i, rest.length - 1)];
        if (nextFile) await get().selectFile(nextFile.id);
      }
    },

    async reload() {
      const { assignmentId, currentId } = get();
      if (!assignmentId) return;
      await get().flush();
      const assignments = (await storage.listAssignments()).sort((a, b) => a.createdAt - b.createdAt);
      const graders = gradersOf(assignments.find((a) => a.id === assignmentId));
      const files = (await storage.listFiles(assignmentId)).map((f) => recomputeFile(f, graders));
      const doc = currentId ? await storage.getAnnotations(currentId) : null;
      histories.clear();
      set((s) => ({
        assignments, files, annotations: doc?.annotations ?? [], canUndo: false, canRedo: false, selectedAnnId: null,
        reloadToken: s.reloadToken + 1,
      }));
    },

    setGraderScore(graderId, score) {
      const { currentId, files } = get();
      const f = files.find((x) => x.id === currentId);
      if (!f) return;
      const scores = { ...scoresOf(f) };
      if (scores[graderId] === score) return;
      scores[graderId] = score;
      const r = recomputeFile({ ...f, scores }, currentGraders());
      patchFile(f.id, { scores: r.scores, score: r.score, status: r.status, maxScore: r.maxScore });
    },

    setScoreStyle(patch) {
      const scoreStyle = { ...get().scoreStyle, ...patch };
      set({ scoreStyle });
      void storage.setSetting('scoreStyle', scoreStyle);
    },

    setStudentName(name) {
      const { currentId } = get();
      if (currentId) patchFile(currentId, { studentName: name });
    },

    setPageCount(fileId, n) {
      const f = get().files.find((x) => x.id === fileId);
      if (f && f.pageCount !== n) {
        set((s) => ({ files: s.files.map((x) => (x.id === fileId ? { ...x, pageCount: n } : x)) }));
        dirtyFiles.add(fileId);
        scheduleSave();
      }
    },

    rotateView(delta) {
      const { currentId, files } = get();
      const f = files.find((x) => x.id === currentId);
      if (!f) return;
      const r = (((f.viewRotation + delta) % 360) + 360) % 360;
      patchFile(f.id, { viewRotation: r as GradedFile['viewRotation'] });
    },

    addAnnotation(a) {
      const author = a.author ?? get().activeGraderId;
      commitAnnotations([...get().annotations, { ...a, author }]);
    },

    setActiveGrader(graderId) {
      const { assignmentId } = get();
      set({ activeGraderId: graderId });
      if (assignmentId) void storage.setSetting(`activeGrader:${assignmentId}`, graderId);
    },

    updateAnnotation(id, patch, opts) {
      const next = get().annotations.map((a) => (a.id === id ? ({ ...a, ...patch, updatedAt: Date.now() } as Annotation) : a));
      commitAnnotations(next, opts?.history !== false);
    },

    replaceAnnotation(a) {
      commitAnnotations(get().annotations.map((x) => (x.id === a.id ? a : x)));
    },

    removeAnnotation(id) {
      const { annotations, selectedAnnId, editingAnnId, activeGraderId } = get();
      const target = annotations.find((a) => a.id === id);
      if (!target) return;
      const graders = currentGraders();
      if (graders.length > 1 && target.author && target.author !== activeGraderId) {
        const who = graders.find((g) => g.id === target.author)?.name ?? '其他批改者';
        if (!confirm(`這個標註是「${who}」畫的。\n確定要刪除其他批改者的標註嗎？`)) return;
      }
      commitAnnotations(annotations.filter((a) => a.id !== id));
      if (selectedAnnId === id) set({ selectedAnnId: null });
      if (editingAnnId === id) set({ editingAnnId: null });
    },

    clearPageAnnotations() {
      /* reserved for future "clear page" action */
    },

    undo() {
      const { currentId, annotations } = get();
      if (!currentId) return;
      const h = historyFor(currentId);
      const prev = h.past.pop();
      if (!prev) return;
      h.future.push(annotations);
      set({ selectedAnnId: null, editingAnnId: null });
      commitAnnotations(prev, false);
    },

    redo() {
      const { currentId, annotations } = get();
      if (!currentId) return;
      const h = historyFor(currentId);
      const nxt = h.future.pop();
      if (!nxt) return;
      h.past.push(annotations);
      set({ selectedAnnId: null, editingAnnId: null });
      commitAnnotations(nxt, false);
    },

    select(id) {
      set({ selectedAnnId: id });
    },

    setEditing(id) {
      set({ editingAnnId: id });
    },

    setTool(tool) {
      set({ tool, selectedAnnId: null, editingAnnId: null });
    },

    setToolStyle(t, patch) {
      const styles = { ...get().styles, [t]: { ...get().styles[t], ...patch } };
      set({ styles });
      void storage.setSetting('toolStyles', styles);
    },

    setZoom(z) {
      set({ zoom: Math.max(0.25, Math.min(5, z)), zoomMode: 'custom' });
    },

    setZoomMode(m) {
      set({ zoomMode: m });
    },

    setSort(sort) {
      set({ sort });
      void storage.setSetting('sort', sort);
    },

    setTextBoxed(v) {
      set({ textBoxed: v });
      void storage.setSetting('textBoxed', v);
    },

    setUngradedOnly(v) {
      set({ ungradedOnly: v });
    },

    toast(message, kind = 'info') {
      const id = uid('t_');
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3000);
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    setBusy(msg) {
      set({ busy: msg });
    },

    async flush() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (saving) await saving; // serialise
      if (!dirtyFiles.size && !dirtyAnnotations.size && !dirtyAssignment) {
        if (get().saveState !== 'error') set({ saveState: 'saved' });
        return;
      }
      const s = get();
      const fileRecs = s.files.filter((f) => dirtyFiles.has(f.id));
      const anns = [...dirtyAnnotations.entries()];
      const asg = dirtyAssignment ? s.assignments.find((a) => a.id === s.assignmentId) : undefined;
      dirtyFiles.clear();
      dirtyAnnotations.clear();
      dirtyAssignment = false;
      set({ saveState: 'saving' });
      saving = (async () => {
        try {
          await storage.putFiles(fileRecs);
          for (const [fileId, annotations] of anns) await storage.putAnnotations({ fileId, annotations, updatedAt: Date.now() });
          if (asg) await storage.putAssignment(asg);
          set({ saveState: dirtyFiles.size || dirtyAnnotations.size ? 'pending' : 'saved' });
        } catch (e) {
          console.error('save failed', e);
          // put things back so the next flush retries
          fileRecs.forEach((f) => dirtyFiles.add(f.id));
          anns.forEach(([k, v]) => !dirtyAnnotations.has(k) && dirtyAnnotations.set(k, v));
          if (asg) dirtyAssignment = true;
          set({ saveState: 'error' });
          get().toast(`Autosave failed: ${e instanceof Error ? e.message : e}`, 'error');
        } finally {
          saving = null;
        }
      })();
      await saving;
    },
  };
});

// ─── selectors ──────────────────────────────────────────────────────────────

const statusOrder = { not_started: 0, in_progress: 1, graded: 2 } as const;

export function sortFiles(files: GradedFile[], sort: SortMode): GradedFile[] {
  const arr = files.slice();
  if (sort === 'name') arr.sort((a, b) => naturalCompare(a.filename, b.filename));
  else if (sort === 'status')
    arr.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || naturalCompare(a.filename, b.filename));
  else arr.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || naturalCompare(a.filename, b.filename));
  return arr;
}

/** files in the order shown in the list (respects sort + "ungraded only"; the current file always stays visible) */
export function visibleFiles(s: Pick<State, 'files' | 'sort' | 'ungradedOnly' | 'currentId'>): GradedFile[] {
  const sorted = sortFiles(s.files, s.sort);
  return s.ungradedOnly ? sorted.filter((f) => f.status !== 'graded' || f.id === s.currentId) : sorted;
}

export function currentFile(s: State): GradedFile | undefined {
  return s.files.find((f) => f.id === s.currentId);
}

export function currentAssignment(s: State): Assignment | undefined {
  return s.assignments.find((a) => a.id === s.assignmentId);
}

// Save whenever the tab is hidden / closed (best effort; autosave already ran ≤350 ms ago)
if (typeof window !== 'undefined') {
  const flushNow = () => void useStore.getState().flush();
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
}
