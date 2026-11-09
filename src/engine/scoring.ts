// 종료와 점수 (DESIGN_PHASE3.md 11장)

import { evaluateGoal } from './goals';
import { closeProject, getProjectCard, liquidationTotal } from './projects';
import { emit, type Ctx } from './state';
import type { FinalResult, GameState, PlayerResult } from './types';

/** 11.2 자산 점수: 누진 계산 후 마지막에 한 번 내림. 음수는 −ceil(|n|/2) */
export function assetScore(netWorth: number): number {
  if (netWorth < 0) return -Math.ceil(-netWorth / 2);
  // 1/2, 1/4, 1/8 구간을 8배 정수로 계산해 부동소수 오차 없이 내림
  const eighths = 4 * Math.min(netWorth, 20) + 2 * Math.min(Math.max(netWorth - 20, 0), 20) + Math.max(netWorth - 40, 0);
  return Math.floor(eighths / 8);
}

/** 11.1-2 미완료 프로젝트 청산 (만기 정산 뒤). 사업가·동반자 실적에 넣지 않는다 */
export function liquidateProjects(state: GameState, ctx: Ctx): Record<string, number> {
  const received: Record<string, number> = {};
  for (const project of [...state.projects]) {
    const total = liquidationTotal(project);
    const record = closeProject(state, ctx, project, 'liquidated', total, `${getProjectCard(project.cardId).title} 종료 청산`);
    for (const [id, amount] of Object.entries(record.payouts)) received[id] = (received[id] ?? 0) + amount;
  }
  return received;
}

/** 11.1-3~5 순자산, 목표 판정, 점수, 순위 */
export function computeResult(state: GameState, liquidation: Record<string, number>): FinalResult {
  const players: PlayerResult[] = state.players.map((p) => {
    const netWorth = p.cash - p.debt;
    const goals = p.goals.map((g) => evaluateGoal(p, g));
    const goalScore = goals.reduce((sum, g) => sum + g.points, 0);
    const asset = assetScore(netWorth);
    return {
      playerId: p.id,
      cash: p.cash,
      debt: p.debt,
      liquidation: liquidation[p.id] ?? 0,
      netWorth,
      assetScore: asset,
      goalScore,
      goals,
      health: p.health,
      total: asset + goalScore,
      rank: 0,
    };
  });
  // 11.3 동점: 목표 점수 → 건강 → 공동 순위
  const key = (r: PlayerResult) => [r.total, r.goalScore, r.health] as const;
  const better = (a: PlayerResult, b: PlayerResult) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! > kb[i]!;
    return false;
  };
  for (const r of players) r.rank = 1 + players.filter((o) => better(o, r)).length;
  return { players: [...players].sort((a, b) => a.rank - b.rank || a.playerId.localeCompare(b.playerId)) };
}

export function finishGame(state: GameState, ctx: Ctx): void {
  const liquidation = liquidateProjects(state, ctx);
  state.result = computeResult(state, liquidation);
  state.status = 'finished';
  state.turn = null;
  for (const r of state.result.players) {
    emit(state, ctx, { playerId: r.playerId, kind: 'score', delta: r.total, cause: `최종 ${r.rank}위: 자산 ${r.assetScore} + 목표 ${r.goalScore}` });
  }
  emit(state, ctx, { kind: 'game', cause: '게임 종료' });
}
