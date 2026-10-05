import { useEffect, useMemo, useRef, useState } from 'react';
import { currentAssignment, useStore, visibleFiles } from '../store/useStore';
import { pdfsFromFileList } from '../lib/importFiles';
import { average, formatScore, statusLabel } from '../lib/util';
import { exportBackup, exportCsv, exportOnePdf, exportZip, importBackup, inspectBackup, type BackupInfo, type MergeOptions } from '../lib/exporters';
import { BackupImportDialog, type ImportChoice } from './BackupImportDialog';
import { openGuide } from './GuideDialog';
import type { GradedFile, Grader, SortMode } from '../types';
import { MAX_GRADERS, defaultGrader, gradersOf, scoresOf } from '../lib/graders';
import { Icon } from './Icons';
import { storage } from '../lib/storage/IndexedDbAdapter';
import { forgetDocument } from '../lib/pdfjs';

export const scoreInputRef: { current: HTMLInputElement | null } = { current: null };
/** hidden <input type=file> for backup .json files (lives in the export/import section) */
const backupInputRef: { current: HTMLInputElement | null } = { current: null };

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
  const { switchAssignment, createAssignment, renameAssignment, deleteAssignment } = useStore.getState();
  const [renaming, setRenaming] = useState(false);

  if (!assignment) return null;
  return (
    <div className="sb-section assignment">
      <div className="sb-label-row">
        <span className="sb-label">Assignment</span>
        <div className="sb-mini-actions">
          <button className="link-btn guide-btn" title="使用說明" onClick={() => openGuide()}>?</button>
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
      <GraderSettings />
    </div>
  );
}

// ─── graders (multi-person grading) ───────────────────────────────────────

function GraderSettings() {
  const assignment = useStore(currentAssignment);
  const files = useStore((s) => s.files);
  const { setGraders, setMaxScore } = useStore.getState();
  const graders = gradersOf(assignment);
  const [open, setOpen] = useState(false);
  const [maxInput, setMaxInput] = useState('100');
  useEffect(() => setMaxInput(String(assignment?.maxScore ?? 100)), [assignment?.id, assignment?.maxScore]);
  if (!assignment) return null;

  const changeCount = (n: number) => {
    if (n === graders.length) return;
    if (n < graders.length) {
      const removed = graders.slice(n);
      const used = files.filter((f) => removed.some((g) => (scoresOf(f)[g.id] ?? null) !== null)).length;
      if (used && !confirm(`${removed.map((g) => g.name).join('、')} 已經有 ${used} 份作業的分數。\n減少批改者人數會把這些分數從總分中移除（資料仍保留，之後再加回人數會恢復）。要繼續嗎？`))
        return;
      setGraders(graders.slice(0, n));
    } else {
      const add = Array.from({ length: n - graders.length }, (_, k) => defaultGrader(graders.length + k, graders[graders.length - 1]?.maxScore ?? 100));
      setGraders([...graders, ...add]);
      setOpen(true);
    }
  };
  const patch = (i: number, p: Partial<Grader>) => setGraders(graders.map((g, j) => (j === i ? { ...g, ...p } : g)));

  return (
    <div className="grader-settings">
      <div className="grader-row-head">
        <label className="max-score">
          批改者
          <select value={graders.length} onChange={(e) => changeCount(parseInt(e.target.value, 10))} title="Number of graders / score boxes">
            {Array.from({ length: MAX_GRADERS }, (_, i) => (
              <option key={i} value={i + 1}>{i + 1} 人</option>
            ))}
          </select>
        </label>
        {graders.length === 1 ? (
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
        ) : (
          <button className="link-btn" onClick={() => setOpen(!open)} title="Names and max score of each grader">
            總分滿分 {formatScore(assignment.maxScore)} · 設定 {open ? '▾' : '▸'}
          </button>
        )}
      </div>
      {graders.length > 1 && open && (
        <div className="grader-list">
          {graders.map((g, i) => (
            <div key={g.id} className="grader-edit-row">
              <span className="grader-idx">{i + 1}</span>
              <input className="grader-name-input" defaultValue={g.name} aria-label={`Grader ${i + 1} name`}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== g.name && patch(i, { name: e.target.value.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              <span className="muted small">滿分</span>
              <input className="grader-max-input" inputMode="decimal" defaultValue={formatScore(g.maxScore)} aria-label={`Grader ${i + 1} max score`}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (v > 0 && v !== g.maxScore) patch(i, { maxScore: v });
                  else e.target.value = formatScore(g.maxScore);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            </div>
          ))}
          <div className="muted small"><button className="link-btn inline" onClick={() => openGuide('multi')}>多人批改說明 ›</button> 總分 = 各批改者分數加總。每位批改者填自己那一格，再用 Export and Import → Save backup 交給彙整的人；彙整的人用「匯入 Backup（.json）」匯入。</div>
        </div>
      )}
    </div>
  );
}

// ─── import ────────────────────────────────────────────────────────────────

function ImportBar() {
  const importFiles = useStore((s) => s.importFiles);
  const hasFiles = useStore((s) => s.files.length > 0);
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
      <button className="link-btn import-backup-link" disabled={!hasFiles} onClick={() => backupInputRef.current?.click()}
        title={hasFiles ? '匯入其他批改者的 backup（.json），合併分數與標註' : '先匯入 PDF，才能匯入 backup'}>
        <Icon.file /> 匯入 Backup（.json）— 其他批改者的成績
      </button>
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

const SCORE_PRESETS: { name: string; color: string; background: string }[] = [
  { name: '預設', color: '#1f2328', background: '#ffffff' },
  { name: '紅筆', color: '#c62828', background: '#ffffff' },
  { name: '藍筆', color: '#1565c0', background: '#ffffff' },
  { name: '螢光黃', color: '#1f2328', background: '#fff59d' },
  { name: '淺綠', color: '#1b5e20', background: '#e8f5e9' },
  { name: '深色', color: '#ffffff', background: '#1f4e79' },
];

function ScoreAppearance() {
  const st = useStore((s) => s.scoreStyle);
  const setScoreStyle = useStore((s) => s.setScoreStyle);
  const [open, setOpen] = useState(false);
  return (
    <div className="score-appearance">
      <button className="link-btn" onClick={() => setOpen(!open)} title="分數格字體大小與顏色" aria-expanded={open}>Aa</button>
      {open && (
        <div className="score-appearance-pop" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <div className="pop-row">
            <span className="muted small">大小</span>
            <div className="seg">
              {(['S', 'M', 'L'] as const).map((z) => (
                <button key={z} className={st.size === z ? 'on' : ''} onClick={() => setScoreStyle({ size: z })}>
                  {{ S: '小', M: '中', L: '大' }[z]}
                </button>
              ))}
            </div>
          </div>
          <div className="pop-row presets">
            {SCORE_PRESETS.map((p) => (
              <button key={p.name} className={`preset ${st.color === p.color && st.background === p.background ? 'on' : ''}`}
                style={{ color: p.color, background: p.background }} onClick={() => setScoreStyle({ color: p.color, background: p.background })}
                title={p.name}>
                87
              </button>
            ))}
          </div>
          <div className="pop-row">
            <label className="color-pick">文字 <input type="color" value={st.color} onChange={(e) => setScoreStyle({ color: e.target.value })} /></label>
            <label className="color-pick">背景 <input type="color" value={st.background} onChange={(e) => setScoreStyle({ background: e.target.value })} /></label>
            <span style={{ flex: 1 }} />
            <button className="link-btn" onClick={() => setOpen(false)}>完成</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard() {
  const file = useStore((s) => s.files.find((f) => f.id === s.currentId));
  const files = useStore((s) => s.files);
  const sort = useStore((s) => s.sort);
  const ungradedOnly = useStore((s) => s.ungradedOnly);
  const currentId = useStore((s) => s.currentId);
  const reloadToken = useStore((s) => s.reloadToken);
  const assignment = useStore(currentAssignment);
  const scoreStyle = useStore((s) => s.scoreStyle);
  const activeGraderId = useStore((s) => s.activeGraderId);
  const { setGraderScore, setStudentName, next, prev, flush, setActiveGrader } = useStore.getState();
  const graders = gradersOf(assignment);
  // other graders' boxes are locked; unlocking needs a confirmation and lasts until you switch student
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const graderKey = graders.map((g) => g.id).join(',');
  const [values, setValues] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const sc = file ? scoresOf(file) : {};
    const v: Record<string, string> = {};
    for (const g of graders) v[g.id] = sc[g.id] === null || sc[g.id] === undefined ? '' : formatScore(sc[g.id]);
    setValues(v);
    setInvalid({});
    setUnlocked({});
  }, [file?.id, reloadToken, graderKey, activeGraderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => visibleFiles({ files, sort, ungradedOnly, currentId }), [files, sort, ungradedOnly, currentId]);
  const idx = list.findIndex((f) => f.id === currentId);

  if (!file) {
    return (
      <div className="sb-section score-card empty">
        <span className="muted">Select a submission to grade.</span>
      </div>
    );
  }

  const multi = graders.length > 1;

  const unlock = (g: Grader) => {
    const cur = scoresOf(file)[g.id];
    const has = cur !== null && cur !== undefined;
    if (confirm(`這是「${g.name}」的分數格${has ? `（目前 ${formatScore(cur)} 分）` : ''}。\n\n確定要修改其他批改者的成績嗎？`)) {
      setUnlocked((u) => ({ ...u, [g.id]: true }));
      setTimeout(() => document.getElementById(`score-input-${graders.indexOf(g)}`)?.focus(), 0);
    }
  };

  const onChange = (gid: string, max: number, raw: string) => {
    if (multi && gid !== activeGraderId && !unlocked[gid]) return;
    setValues((v) => ({ ...v, [gid]: raw }));
    const t = raw.trim().replace(',', '.');
    if (t === '') {
      setInvalid((x) => ({ ...x, [gid]: false }));
      setGraderScore(gid, null);
      return;
    }
    const n = Number(t);
    const bad = !Number.isFinite(n) || n < 0 || n > max;
    setInvalid((x) => ({ ...x, [gid]: bad }));
    if (!bad) setGraderScore(gid, Math.round(n * 100) / 100);
  };

  const goNext = async () => {
    await flush();
    await next();
  };

  const anyInvalid = graders.find((g) => invalid[g.id]);
  const sizeClass = `size-${scoreStyle.size}`;
  const boxStyle = { color: scoreStyle.color, background: scoreStyle.background };

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

      {multi && (
        <div className="whoami-box">
          <label className="whoami">
            我是
            <select value={activeGraderId} onChange={(e) => setActiveGrader(e.target.value)}
              title="這台電腦上的批改者：新的標註會記錄成這位批改者，其他人的分數格會鎖住">
              {graders.map((g, i) => (
                <option key={g.id} value={g.id}>{i + 1}. {g.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="score-label-row">
        <label className="score-label" htmlFor="score-input-0">{multi ? 'Scores' : 'Score'}</label>
        <ScoreAppearance />
      </div>
      <div className={`score-grid ${sizeClass} ${multi ? 'multi' : ''}`}>
        {graders.map((g, i) => {
          const mine = !multi || g.id === activeGraderId;
          const locked = !mine && !unlocked[g.id];
          return (
          <div key={g.id} className={`score-row ${invalid[g.id] ? 'invalid' : ''} ${mine ? 'mine' : locked ? 'locked' : 'unlocked'}`}>
            {multi && (
              <span className="grader-label" title={g.name}>
                {g.name}{mine && <span className="me-tag">我</span>}
              </span>
            )}
            <input
              readOnly={locked}
              onDoubleClick={() => locked && unlock(g)}
              id={`score-input-${i}`}
              ref={(el) => {
                inputs.current[i] = el;
                if (g.id === activeGraderId || (!multi && i === 0)) scoreInputRef.current = el;
              }}
              className="score-input"
              style={boxStyle}
              inputMode="decimal"
              autoComplete="off"
              placeholder="—"
              value={values[g.id] ?? ''}
              onFocus={(e) => {
                if (locked) e.currentTarget.title = `${g.name} 的分數已鎖定（點右邊 🔒 解鎖）`;
              }}
              onChange={(e) => onChange(g.id, g.maxScore, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !invalid[g.id]) {
                  e.preventDefault();
                  void goNext(); // focus stays in this grader's box for the next student
                } else if (e.key === 'Escape') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label={multi ? `${g.name} score` : 'Score'}
              aria-invalid={!!invalid[g.id]}
            />
            <span className="score-max">/ {formatScore(g.maxScore)}</span>
            {multi && !mine && (
              <button className={`lock-btn ${locked ? '' : 'open'}`} onClick={() => (locked ? unlock(g) : setUnlocked((u) => ({ ...u, [g.id]: false })))}
                title={locked ? `${g.name} 的分數已鎖定，點一下解鎖修改` : '點一下重新鎖定'}>
                {locked ? '🔒' : '🔓'}
              </button>
            )}
          </div>
          );
        })}
      </div>
      {multi && graders.some((g) => g.id !== activeGraderId && unlocked[g.id]) && (
        <div className="lock-warning">⚠ 你正在修改其他批改者的分數</div>
      )}
      {multi && (
        <div className="score-total">
          <span>總分</span>
          <strong>{formatScore(file.score)}</strong>
          <span className="muted">/ {formatScore(file.maxScore)}</span>
          {file.status !== 'graded' && file.score !== null && <span className="muted small">（尚有批改者未填）</span>}
        </div>
      )}
      <div className={`score-hint ${anyInvalid ? 'error' : ''}`}>
        {anyInvalid
          ? `${multi ? anyInvalid.name + '：' : ''}請輸入 0 到 ${formatScore(anyInvalid.maxScore)} 之間的數字`
          : <>Press <kbd>Enter</kbd> to save &amp; open the next student</>}
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
  const backupRef = useRef<HTMLInputElement | null>(null);
  const [asking, setAsking] = useState<{ info: BackupInfo; text: string; resolve: (c: ImportChoice | null) => void } | null>(null);

  /** merge one or more backups; with several graders, ask for each file which grader it belongs to */
  const mergeBackups = async (picked: File[]) => {
    await flush();
    const msgs: string[] = [];
    for (const f of picked) {
      try {
        const text = await f.text();
        const st = useStore.getState();
        const asg = st.assignments.find((a) => a.id === st.assignmentId)!;
        let options: MergeOptions;
        let label = '';
        if (gradersOf(asg).length > 1) {
          const info = inspectBackup(text, f.name);
          const choice = await new Promise<ImportChoice | null>((resolve) => setAsking({ info, text, resolve }));
          setAsking(null);
          if (!choice) {
            msgs.push(`${f.name}：已取消`);
            continue;
          }
          options = choice.options;
          label = `（${choice.label}）`;
        } else {
          const probe = await importBackup(text, asg, st.files, { dryRun: true });
          let onConflict: 'keep' | 'overwrite' = 'keep';
          if (probe.overwritten > 0)
            onConflict = confirm(
              `${f.name}\n\n有 ${probe.overwritten} 個分數和這台電腦上已經填好的分數不同。\n\n` +
                `按「確定」= 用 backup 的分數覆蓋\n按「取消」= 保留這台電腦的分數（建議）`,
            ) ? 'overwrite' : 'keep';
          options = { onConflict };
        }
        setBusy('Merging backup…');
        const fresh = useStore.getState();
        const res = await importBackup(text, fresh.assignments.find((a) => a.id === fresh.assignmentId)!, fresh.files, options);
        await reload();
        setBusy(null);
        msgs.push(
          `${f.name}${label}：${res.matched} 份作業、${res.scoresImported} 個分數、${res.annotationsAdded} 個標註` +
            (res.gradersAdded ? `、新增 ${res.gradersAdded} 位批改者` : '') +
            (res.overwritten ? (options.onConflict === 'overwrite' ? `、覆蓋 ${res.overwritten} 個不同的分數` : `、${res.overwritten} 個不同的分數保留原值`) : '') +
            (res.unmatched.length ? `（${res.unmatched.length} 份在這裡找不到）` : ''),
        );
      } catch (err) {
        setBusy(null);
        setAsking(null);
        msgs.push(`${f.name}：失敗 ${err instanceof Error ? err.message : err}`);
      }
    }
    if (msgs.every((m) => m.endsWith('已取消'))) toast('已取消匯入', 'info');
    else toast(`已合併 ${msgs.join('；')}`, msgs.some((m) => m.includes('失敗')) ? 'error' : 'success');
  };

  const graders = gradersOf(assignment);
  const graded = files.filter((f) => f.status === 'graded').length;
  const inProgress = files.filter((f) => f.status === 'in_progress').length;
  const avg = average(files);
  const pct = files.length ? (graded / files.length) * 100 : 0;

  const opts = { stampScore: stamp, applyViewRotation: true, graders };

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
      {inProgress > 0 && <div className="muted small">{inProgress} in progress{graders.length > 1 ? '' : ' (annotated, no score yet)'}</div>}
      {graders.length > 1 && (
        <div className="grader-progress">
          {graders.map((g) => {
            const n = files.filter((f) => (scoresOf(f)[g.id] ?? null) !== null).length;
            return (
              <div key={g.id} className="grader-progress-row">
                <span className="gp-name" title={g.name}>{g.name}</span>
                <span className="gp-bar"><span style={{ width: `${files.length ? (n / files.length) * 100 : 0}%` }} /></span>
                <span className="gp-num">{n}/{files.length}</span>
              </div>
            );
          })}
        </div>
      )}

      <button className={`export-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <Icon.download /> Export and Import <span className="chev">{open ? '▾' : '▸'}</span>
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
            <span className="sub-title">Backup 備份 / 匯入</span>
            <span className="muted small">分數＋標註的 .json 檔（不含 PDF）。多人批改時，用它把其他批改者的成績匯進來。</span>
            <div className="row-2">
              <button className="btn small" disabled={!files.length} onClick={() => void run('Exporting backup…', () => exportBackup(assignment, files))}
                title="下載這份作業的分數與標註（.json）">
                <Icon.download /> Save backup
              </button>
              <button className="btn small" disabled={!files.length} onClick={() => backupRef.current?.click()}
                title="匯入其他批改者（或自己之前）的 backup .json，合併分數與標註">
                <Icon.file /> Import backup…
              </button>
            </div>
            {!files.length && <span className="muted small">先匯入同一批 PDF，才能匯入 backup。</span>}
          </div>
        </div>
      )}
      {/* kept outside the collapsible panel so other places (e.g. the import bar) can open it */}
      <input ref={(el) => { backupRef.current = el; backupInputRef.current = el; }} type="file" accept=".json,application/json" hidden multiple
        data-testid="backup-input"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length) void mergeBackups(picked);
        }} />
      {asking && (
        <BackupImportDialog info={asking.info} text={asking.text}
          onCancel={() => asking.resolve(null)} onConfirm={(c) => asking.resolve(c)} />
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
  const label = { saved: '已自動儲存', pending: '儲存中…', saving: '儲存中…', error: '儲存失敗，重試中' }[saveState];

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
        <button className="link-btn" onClick={() => openGuide()} title="使用說明">
          📖 使用說明
        </button>
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
