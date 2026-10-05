import { useEffect, useMemo, useState } from 'react';
import { currentAssignment, useStore } from '../store/useStore';
import { gradersOf } from '../lib/graders';
import { importBackup, type BackupInfo, type MergeOptions, type MergeResult } from '../lib/exporters';
import { formatScore } from '../lib/util';

export interface ImportChoice {
  options: MergeOptions;
  /** label for the result message, e.g. "王老師 → 李助教" */
  label: string;
}

/**
 * Asked once per backup file when this assignment has several graders:
 * "whose backup is this, and which score box should it go into?"
 */
export function BackupImportDialog({
  info, text, onCancel, onConfirm,
}: {
  info: BackupInfo;
  text: string;
  onCancel: () => void;
  onConfirm: (c: ImportChoice) => void;
}) {
  const assignment = useStore(currentAssignment);
  const files = useStore((s) => s.files);
  const ours = gradersOf(assignment);

  // default source = the backup slot with the most scores; default target = same name, else same position
  const defaultFrom = useMemo(() => {
    const best = [...info.graders].sort((a, b) => (info.scoredPerSlot[b.id] ?? 0) - (info.scoredPerSlot[a.id] ?? 0))[0];
    return best?.id ?? 'g1';
  }, [info]);
  const guessTarget = (from: string) => {
    const src = info.graders.find((g) => g.id === from);
    return ours.find((g) => src && g.name === src.name)?.id ?? ours.find((g) => g.id === from)?.id ?? ours[0].id;
  };

  const [from, setFrom] = useState<string>(defaultFrom); // a backup slot id or 'all'
  const [to, setTo] = useState<string>(() => guessTarget(defaultFrom));
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [onConflict, setOnConflict] = useState<'keep' | 'overwrite'>('keep');
  const [preview, setPreview] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options: MergeOptions = useMemo(
    () => ({ slotMap: from === 'all' ? undefined : { from, to }, includeAnnotations, onConflict }),
    [from, to, includeAnnotations, onConflict],
  );

  // live preview (dry run) of what this import will do
  useEffect(() => {
    let alive = true;
    if (!assignment) return;
    importBackup(text, assignment, files, { ...options, dryRun: true })
      .then((r) => alive && (setPreview(r), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [text, assignment, files, options]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);

  const srcName = (id: string) => info.graders.find((g) => g.id === id)?.name ?? id;
  const dstName = (id: string) => ours.find((g) => g.id === id)?.name ?? id;
  const label = from === 'all' ? '全部格子（依順序）' : `${srcName(from)} → ${dstName(to)}`;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal import-dialog" role="dialog" aria-label="Import backup" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>匯入 backup</h3>
          <button className="link-btn" onClick={onCancel}>取消</button>
        </div>
        <div className="import-file">
          <strong>{info.fileName}</strong>
          <span className="muted small">
            {info.assignmentName} · {info.files} 份作業 · {info.annotations} 個標註
            {info.exportedAt ? ` · ${new Date(info.exportedAt).toLocaleString()}` : ''}
          </span>
        </div>

        <label className="import-field">
          <span>這份 backup 是哪位批改者的？（要匯入 backup 裡的哪一格分數）</span>
          <select value={from} onChange={(e) => {
            const v = e.target.value;
            setFrom(v);
            if (v !== 'all') setTo(guessTarget(v));
          }}>
            {info.graders.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}（滿分 {formatScore(g.maxScore)}，{info.scoredPerSlot[g.id] ?? 0} 份有分數）
              </option>
            ))}
            {info.graders.length > 1 && <option value="all">全部格子，依格子順序對應</option>}
          </select>
        </label>

        <label className="import-field">
          <span>匯入到這裡的哪位批改者？</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} disabled={from === 'all'}>
            {ours.map((g) => (
              <option key={g.id} value={g.id}>{g.name}（滿分 {formatScore(g.maxScore)}）</option>
            ))}
          </select>
        </label>
        {from !== 'all' && (() => {
          const s = info.graders.find((g) => g.id === from);
          const d = ours.find((g) => g.id === to);
          return s && d && s.maxScore !== d.maxScore ? (
            <div className="lock-warning">⚠ 滿分不同：backup 的「{s.name}」滿分 {formatScore(s.maxScore)}，這裡的「{d.name}」滿分 {formatScore(d.maxScore)}。分數會原樣匯入，不會換算。</div>
          ) : null;
        })()}

        <label className="checkbox-row">
          <input type="checkbox" checked={includeAnnotations} onChange={(e) => setIncludeAnnotations(e.target.checked)} />
          一併匯入標註{from !== 'all' ? `（記錄為「${dstName(to)}」的標註）` : ''}
        </label>

        {error && <div className="viewer-message error">{error}</div>}
        {preview && (
          <div className="import-preview">
            會匯入 <strong>{preview.scoresImported}</strong> 個分數、<strong>{preview.annotationsAdded}</strong> 個標註，
            對應到 {preview.matched} 份作業
            {preview.unmatched.length > 0 && <span className="muted">（{preview.unmatched.length} 份在這裡找不到，會略過）</span>}
            {preview.gradersAdded > 0 && <span>，並新增 {preview.gradersAdded} 位批改者</span>}。
            {preview.overwritten > 0 && (
              <div className="import-conflict">
                <div>⚠ 有 <strong>{preview.overwritten}</strong> 個分數和這台電腦上已填的不同：</div>
                <label><input type="radio" checked={onConflict === 'keep'} onChange={() => setOnConflict('keep')} /> 保留這台電腦的分數（建議）</label>
                <label><input type="radio" checked={onConflict === 'overwrite'} onChange={() => setOnConflict('overwrite')} /> 用 backup 的分數覆蓋</label>
              </div>
            )}
          </div>
        )}

        <div className="import-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn primary" disabled={!!error} onClick={() => onConfirm({ options, label })}>匯入</button>
        </div>
      </div>
    </div>
  );
}
