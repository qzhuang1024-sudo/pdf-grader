import type { Assignment, GradedFile, Grader, GradingStatus } from '../types';

export const MAX_GRADERS = 8;

export function gradersOf(a: Pick<Assignment, 'graders' | 'maxScore'> | undefined): Grader[] {
  if (a?.graders?.length) return a.graders;
  return [{ id: 'g1', name: 'Grader 1', maxScore: a?.maxScore ?? 100 }];
}

/** per-grader scores of a file (old single-score records map to g1) */
export function scoresOf(f: Pick<GradedFile, 'scores' | 'score'>): Record<string, number | null> {
  if (f.scores) return f.scores;
  return { g1: f.score ?? null };
}

export function totalOf(scores: Record<string, number | null>, graders: Grader[]): number | null {
  let sum = 0;
  let any = false;
  for (const g of graders) {
    const v = scores[g.id];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

/** graded = every grader filled in; in progress = some score or annotations; else not started */
export function statusFor(scores: Record<string, number | null>, graders: Grader[], annotationCount: number): GradingStatus {
  const filled = graders.filter((g) => scores[g.id] !== null && scores[g.id] !== undefined).length;
  if (filled === graders.length) return 'graded';
  if (filled > 0 || annotationCount > 0) return 'in_progress';
  return 'not_started';
}

/** recompute the derived fields (total, max, status) of a file */
export function recomputeFile(f: GradedFile, graders: Grader[], annotationCount = f.annotationCount): GradedFile {
  const all = scoresOf(f);
  const scores: Record<string, number | null> = {};
  for (const g of graders) scores[g.id] = all[g.id] ?? null;
  const maxScore = graders.reduce((a, g) => a + g.maxScore, 0);
  return {
    ...f,
    scores,
    score: totalOf(scores, graders),
    maxScore,
    annotationCount,
    status: statusFor(scores, graders, annotationCount),
  };
}

export function defaultGrader(i: number, maxScore: number): Grader {
  return { id: `g${i + 1}`, name: `Grader ${i + 1}`, maxScore };
}
