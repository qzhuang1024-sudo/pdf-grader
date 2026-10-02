import { useEffect, useMemo, useRef, useState } from 'react';
import { currentAssignment, useStore, visibleFiles } from '../store/useStore';
import { pdfsFromFileList } from '../lib/importFiles';
import { average, formatScore, statusLabel } from '../lib/util';
import { exportBackup, exportCsv, exportOnePdf, exportZip, importBackup } from '../lib/exporters';
import type { GradedFile, SortMode } from '../types';
import { Icon } from './Icons';
import { storage } from '../lib/storage/IndexedDbAdapter';
import { forgetDocument } from '../lib/pdfjs';

export const scoreInputRef: { current: HTMLInputElement | null } = { current: null };

export function Sidebar({ onShowHelp }: { onShowHelp: () => void }) {
  return (
    <aside className="sidebar">
      <AssignmentHeader />
      <ImportBar />
      <FileList />
      <ScoreCard />
      <ProgressAndExport />
      <SidebarFooter onShowHelp={onShowHelp} />
    </aside>
  );
}

// ─── assignment ────────────────────────────────────────────────────────────

function AssignmentHeader() {
  const assignments = useStore((s) => s.assignments);
  const assignment = useStore(currentAssignment);
  const { switchAssignment, createAssignment, renameAssignment, setMaxScore, deleteAssignment } = useStore.getState();
  const [renaming, setRenaming] = useState(false);
  const [maxInput, setMaxInput] = useState('100');
  useEffect(() => setMaxInput(String(assignment?.maxScore ?? 100)), [assignment?.id, assignment?.maxScore]);

  if (!assignment) return null;
  return (
    <div className="sb-section assignment">
      <div className="sb-label-row">
        <span className="sb-label">Assignment</span>
        <div className="sb-mini-actions">
          <button className="link-btn" title="Rename assignment" onClick={() => setRenaming(true)}><Icon.edit /></button>
          <button className="link-btn" title="New assignment"
            onClick={() => void createAssignment(`Assignment ${assignments.length + 1}`).then(() => setRenaming(true))}>
            <Icon.plus />
          </button>
          <button className="link-btn danger" title="Delete this assignment (and its PDFs) from this browser"
            onClick={() => {
              if (confirm(`Delete "${assignment.name}" with all its PDFs, scores and annotations from this browser?\n\nThis cannot be undone. Export grades / backup first if needed.`))
                void deleteAssignment();
            }}>
            <Icon.trash />
          </button>
        </div>
      </div>
      {renaming ? (
        <input
          className="assignment-name-input"
          autoFocus
          defaultValue={assignment.name}
          onBlur={(e) => {
            renameAssignment(e.target.value.trim() || assignment.name);
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
      ) : assignments.length > 1 ? (
        <select className="assignment-select" value={assignment.id} onChange={(e) => void switchAssignment(e.target.value)}>
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      ) : (
        <div className="assignment-name" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{assignment.name}</div>
      )}
      <label className="max-score">
        Max score
        <input
          inputMode="decimal"
          value={maxInput}
          onChange={(e) => setMaxInput(e.target.value)}
          onBlur={() => {
            const v = parseFloat(maxInput);
            if (v > 0) setMaxScore(v);
            else setMaxInput(String(assignment.maxScore));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
    </div>
  );
}

// ─── import ────────────────────────────────────────────────────────────────

function ImportBar() {
  const importFiles = useStore((s) => s.importFiles);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pdfs = pdfsFromFileList(e.target.files);
    if (e.target.files?.length && !pdfs.length) useStore.getState().toast('No PDF files found in the selection.', 'info');
    void importFiles(pdfs);
    e.target.value = '';
  };
  return (
    <div className="sb-section import-bar">
      <button className="btn" onClick={() => folderRef.current?.click()} title="Import every PDF in a folder (and its sub-folders)">
        <Icon.folder /> Open folder
      </button>
      <button className="btn" onClick={() => filesRef.current?.click()} title="Select one or more PDF files">
        <Icon.file /> Select files
      </button>
      <input ref={filesRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={onPick} />
      <input ref={folderRef} type="file" hidden onChange={onPick}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
    </div>
  );
}

// ─── file list ─────────────────────────────────────────────────────────────

function StatusIcon({ f }: { f: GradedFile }) {
  if (f.status === 'graded') return <span className="st st-graded" title="Graded"><Icon.check /></span>;
  if (f.status === 'in_progress') return <span className="st st-progress" title="In progress">●</span>;
  return <span className="st st-new" title="Not started">○</span>;
}

function FileList() {
  const files = useStore((s) => s.files);
  const sort = useStore((s) => s.sort);
  const ungradedOnly = useStore((s) => s.ungradedOnly);
  const currentId = useStore((s) => s.currentId);
  const { selectFile, setSort, setUngradedOnly, removeFile } = useStore.getState();
  const list = useMemo(() => visibleFiles({ files, sort, ungradedOnly, currentId }), [files, sort, ungradedOnly, currentId]);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  return (
    <div className="sb-section file-list-section">
      <div className="sb-label-row">
        <span className="sb-label">Submissions <span className="count">{files.length}</span></span>
        <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)} title="Sort">
          <option value="name">Sort: filename</option>
          <option value="status">Sort: status</option>
          <option value="score">Sort: score</option>
        </select>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={ungradedOnly} onChange={(e) => setUngradedOnly(e.target.checked)} />
        Show ungraded only
      </label>
      {files.length === 0 ? (
        <div className="drop-hint">Drop PDF files or a folder here<br /><span className="muted">or use the buttons above</span></div>
      ) : (
        <ul className="file-list" role="listbox" aria-label="Submissions">
          {list.map((f) => (
            <li
              key={f.id}
              ref={f.id === currentId ? activeRef : undefined}
              className={`file-item ${f.id === currentId ? 'active' : ''} status-${f.status}`}
              role="option"
              aria-selected={f.id === currentId}
              onClick={() => void selectFile(f.id)}
              title={f.filename}
            >
              <StatusIcon f={f} />
              <span className="fname">{f.filename}</span>
              <span className="fscore">{formatScore(f.score)}</span>
              <button
                className="remove-btn"
                title="Remove from this assignment"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Remove "${f.filename}" (and its score + annotations) from this assignment?`)) void removeFile(f.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── score card ────────────────────────────────────────────────────────────

function ScoreCard() {
  const file = useStore((s) => s.files.find((f) => f.id === s.currentId));
  const files = useStore((s) => s.files);
  const sort = useStore((s) => s.sort);
  const ungradedOnly = useStore((s) => s.ungradedOnly);
  const currentId = useStore((s) => s.currentId);
  const { setScore, setStudentName, next, prev, flush } = useStore.getState();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setValue(file?.score === null || file?.score === undefined ? '' : formatScore(file.score));
    setInvalid(false);
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => visibleFiles({ files, sort, ungradedOnly, currentId }), [files, sort, ungradedOnly, currentId]);
  const idx = list.findIndex((f) => f.id === currentId);

  if (!file) {
    return (
      <div className="sb-section score-card empty">
        <span className="muted">Select a submission to grade.</span>
      </div>
    );
  }

  const onChange = (raw: string) => {
    setValue(raw);
    const t = raw.trim().replace(',', '.');
    if (t === '') {
      setInvalid(false);
      setScore(null);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > file.maxScore) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setScore(Math.round(n * 100) / 100);
  };

  const goNext = async () => {
    await flush();
    await next();
  };

  return (
    <div className="sb-section score-card">
      <div className="student-row">
        <input
          className="student-name"
          value={file.studentName}
          onChange={(e) => setStudentName(e.target.value)}
          title="Student name (defaults to the filename)"
          aria-label="Student name"
        />
        <span className={`status-pill ${file.status}`}>{statusLabel[file.status]}</span>
      </div>
      <div className="file-meta" title={file.filename}>
        {file.filename}
        {file.pageCount ? ` · ${file.pageCount} page${file.pageCount > 1 ? 's' : ''}` : ''}
        {idx >= 0 ? ` · ${idx + 1} of ${list.length}` : ''}
      </div>

      <label className="score-label" htmlFor="score-input">Score</label>
      <div className={`score-row ${invalid ? 'invalid' : ''}`}>
        <input
          id="score-input"
          ref={(el) => {
            scoreInputRef.current = el;
          }}
          className="score-input"
          inputMode="decimal"
          autoComplete="off"
          placeholder="—"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !invalid) {
              e.preventDefault();
              void goNext();
            } else if (e.key === 'Escape') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-invalid={invalid}
        />
        <span className="score-max">/ {formatScore(file.maxScore)}</span>
      </div>
      <div className="score-hint">
        {invalid ? `Enter a number between 0 and ${formatScore(file.maxScore)}` : <>Press <kbd>Enter</kbd> to save &amp; open the next student</>}
      </div>

      <div className="nav-row">
        <button className="btn" onClick={() => void prev()} disabled={idx <= 0} title="Previous student (P)">
          <Icon.chevLeft /> Previous
        </button>
        <button className="btn primary" onClick={() => void goNext()} disabled={idx < 0 || idx >= list.length - 1} title="Save & next student (N)">
          Next <Icon.chevRight />
        </button>
      </div>
    </div>
  );
}

// ─── progress + export ─────────────────────────────────────────────────────

function ProgressAndExport() {
  const files = useStore((s) => s.files);
  const assignment = useStore(currentAssignment);
  const currentId = useStore((s) => s.currentId);
  const { flush, setBusy, toast, reload } = useStore.getState();
  const [stamp, setStamp] = useState(true);
  const [open, setOpen] = useState(false);
  const backupRef = useRef<HTMLInputElement>(null);

  const graded = files.filter((f) => f.status === 'graded').length;
  const inProgress = files.filter((f) => f.status === 'in_progress').length;
  const avg = average(files);
  const pct = files.length ? (graded / files.length) * 100 : 0;

  const opts = { stampScore: stamp, applyViewRotation: true };

  const run = async (label: string, fn: () => Promise<void>) => {
    await flush();
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sb-section progress-export">
      <div className="progress-row">
        <span><strong>{graded}</strong> / {files.length} graded</span>
        <span className="muted">Average: <strong>{avg === null ? '—' : avg.toFixed(1)}</strong></span>
      </div>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      {inProgress > 0 && <div className="muted small">{inProgress} in progress (annotated, no score yet)</div>}

      <button className={`export-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <Icon.download /> Export <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && assignment && (
        <div className="export-panel">
          <button className="btn block" disabled={!files.length} onClick={() => void run('Exporting CSV…', async () => exportCsv(assignment, files))}>
            Grades (CSV)
          </button>
          <button className="btn block" disabled={!currentId}
            onClick={() => void run('Building graded PDF…', async () => {
              const f = useStore.getState().files.find((x) => x.id === currentId);
              if (f) await exportOnePdf(f, opts);
            })}>
            Current graded PDF
          </button>
          <button className="btn block" disabled={!files.length}
            onClick={() => void run('Building ZIP…', async () => {
              const res = await exportZip(assignment, useStore.getState().files, opts, (d, t) => setBusy(`Building graded PDFs… ${d} / ${t}`));
              if (res.failed.length) toast(`ZIP created, but ${res.failed.length} file(s) failed: ${res.failed.join(', ')}`, 'error');
              else toast(`ZIP created with ${res.ok} graded PDFs.`, 'success');
            })}>
            All graded PDFs (ZIP)
          </button>
          <label className="checkbox-row">
            <input type="checkbox" checked={stamp} onChange={(e) => setStamp(e.target.checked)} />
            Stamp score on page 1
          </label>
          <div className="export-sub">
            <span className="muted small">Backup (scores + annotations, no PDFs)</span>
            <div className="row-2">
              <button className="btn small" disabled={!files.length} onClick={() => void run('Exporting backup…', () => exportBackup(assignment, files))}>Save backup</button>
              <button className="btn small" disabled={!files.length} onClick={() => backupRef.current?.click()}>Restore…</button>
            </div>
            <input ref={backupRef} type="file" accept=".json,application/json" hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void run('Restoring backup…', async () => {
                  const res = await importBackup(await f.text(), useStore.getState().files);
                  await reload();
                  toast(`Restored ${res.matched} file(s)` + (res.unmatched.length ? ` · ${res.unmatched.length} not found in this assignment` : ''), 'success');
                });
              }} />
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function SidebarFooter({ onShowHelp }: { onShowHelp: () => void }) {
  const saveState = useStore((s) => s.saveState);
  const files = useStore((s) => s.files);
  const assignments = useStore((s) => s.assignments);
  const [usage, setUsage] = useState<{ pdfBytes: number; fileCount: number; assignmentCount: number } | null>(null);
  const label = { saved: 'All changes saved locally', pending: 'Saving…', saving: 'Saving…', error: 'Save failed — retrying' }[saveState];

  // recount whenever files are added / removed (in any assignment)
  useEffect(() => {
    let alive = true;
    storage.usage().then((u) => alive && setUsage(u)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [files.length, assignments.length]);

  const clearAll = async () => {
    const u = usage;
    const msg =
      `清除所有資料？\n\n將永久刪除這個工具存在瀏覽器裡的全部內容：` +
      (u ? `\n・${u.assignmentCount} 個作業、${u.fileCount} 份 PDF（${formatBytes(u.pdfBytes)}）` : '') +
      `\n・所有分數與標註\n\n你電腦上的原始 PDF 檔不受影響。\n此動作無法復原，需要的話請先 Export 成績 / 備份。`;
    if (!confirm(msg)) return;
    const st = useStore.getState();
    st.setBusy('正在清除所有資料…');
    try {
      await st.flush();
      for (const f of st.files) forgetDocument(f.id);
      await storage.clearAll();
      try {
        localStorage.removeItem('pgw.sidebarWidth');
      } catch {
        /* ignore */
      }
      location.reload();
    } catch (e) {
      st.setBusy(null);
      st.toast(`清除失敗：${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  return (
    <div className="sb-footer">
      <div className="sb-footer-row">
        <span className={`save-dot ${saveState}`} />
        <span className="save-label">{label}</span>
        <span style={{ flex: 1 }} />
        <button className="link-btn" onClick={onShowHelp} title="Keyboard shortcuts (?)">
          <Icon.keyboard /> Shortcuts
        </button>
      </div>
      <div className="sb-footer-row">
        <span className="storage-usage" title={usage ? `${usage.assignmentCount} 個作業 · ${usage.fileCount} 份 PDF（存在本機瀏覽器 IndexedDB）` : ''}>
          目前占用 <strong>{usage ? formatBytes(usage.pdfBytes) : '…'}</strong>
          {usage ? <span className="muted">（{usage.fileCount} 份 PDF）</span> : null}
        </span>
        <span style={{ flex: 1 }} />
        <button className="link-btn danger" onClick={() => void clearAll()} disabled={!usage || (!usage.fileCount && usage.assignmentCount <= 1)}
          title="永久刪除本工具存在瀏覽器裡的所有 PDF、分數與標註">
          <Icon.trash /> 清除所有資料
        </button>
      </div>
    </div>
  );
}
