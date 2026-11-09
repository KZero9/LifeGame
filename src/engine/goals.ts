// 인생 목표 (DESIGN_PHASE3.md 10장)

import goalsJson from '../data/goals.json';
import { RngStreams, shuffle } from './rng';
import { emit, getPlayer, type Ctx } from './state';
import type { GameState, GoalInstance, PlayerId, PlayerState, SettledProject } from './types';

export interface GoalCard {
  id: string;
  title: string;
  type: 'state' | 'cumulative' | 'maintenance';
  points: number;
  description: string;
  state?: { skillAtLeast?: number; healthAtLeast?: number };
  cumulative?: { metric: 'ownMatured' | 'othersMatured'; target: number };
  maintenance?: { fromRound: number; toRound: number; cashAtLeast: number; debtAtMost: number };
}

export interface GoalRules {
  startOffer: number;
  startPick: number;
  extraRound: number;
  extraOffer: number;
  extraPickMax: number;
  maxGoals: number;
  goals: GoalCard[];
}

export const GOAL_RULES = goalsJson as unknown as GoalRules;
const GOAL_INDEX = new Map(GOAL_RULES.goals.map((g) => [g.id, g]));

export function getGoal(id: string): GoalCard {
  const g = GOAL_INDEX.get(id);
  if (!g) throw new Error(`없는 목표: ${id}`);
  return g;
}

/** K01: 플레이어마다 6종 1장씩으로 된 자기 덱을 따로 섞는다 */
export function initGoalDecks(state: GameState): void {
  for (const p of state.players) {
    p.goalDeck = { drawPile: shuffle(state.rng, RngStreams.goal(p.id), GOAL_RULES.goals.map((g) => g.id)), discard: [] };
  }
}

/** 목표 카드를 나눠 주고 선택 대기 상태를 만든다. 버린 목표는 다시 나오지 않으므로 덱을 다시 섞지 않는다 */
function offerGoals(state: GameState, ctx: Ctx, p: PlayerState, count: number, min: number, max: number): void {
  const offered = p.goalDeck.drawPile.splice(0, count);
  if (offered.length === 0) return;
  const cappedMax = Math.min(max, GOAL_RULES.maxGoals - p.goals.length, offered.length);
  if (cappedMax <= 0) {
    p.goalDeck.discard.push(...offered);
    return;
  }
  state.pendingGoalPicks.push({ playerId: p.id, offered, min: Math.min(min, cappedMax), max: cappedMax });
  emit(state, ctx, { playerId: p.id, kind: 'goal', cause: `목표 후보: ${offered.map((id) => getGoal(id).title).join(', ')}` });
}

/** 시작: 3장 받아 2장 선택 */
export function dealStartingGoals(state: GameState, ctx: Ctx): void {
  for (const p of state.players) offerGoals(state, ctx, p, GOAL_RULES.startOffer, GOAL_RULES.startPick, GOAL_RULES.startPick);
}

/** 5라운드 시작: 남은 3장 중 2장 받아 0~1장 추가 (최대 보유 3장) */
export function dealExtraGoals(state: GameState, ctx: Ctx): void {
  for (const p of state.players) offerGoals(state, ctx, p, GOAL_RULES.extraOffer, 0, GOAL_RULES.extraPickMax);
}

export function pickGoals(state: GameState, ctx: Ctx, playerId: PlayerId, goalIds: string[]): void {
  const p = getPlayer(state, playerId);
  const pick = state.pendingGoalPicks.find((x) => x.playerId === playerId);
  if (!pick) throw new Error(`목표 선택 대기 없음: ${playerId}`);
  for (const goalId of goalIds) {
    p.goals.push({ goalId, pickedRound: state.round, countedProjectIds: [], status: 'active' });
  }
  p.goalDeck.discard.push(...pick.offered.filter((id) => !goalIds.includes(id)));
  state.pendingGoalPicks = state.pendingGoalPicks.filter((x) => x.playerId !== playerId);
  emit(state, ctx, {
    playerId,
    kind: 'goal',
    cause: goalIds.length ? `목표 선택: ${goalIds.map((id) => getGoal(id).title).join(', ')}` : '목표 추가 안 함',
  });
}

/** 누적형 실적: 만기 정산된 프로젝트를 센다 (청산은 제외, E25) */
export function recordMaturity(state: GameState, ctx: Ctx, settled: SettledProject): void {
  for (const p of state.players) {
    for (const g of p.goals) {
      const card = getGoal(g.goalId);
      if (!card.cumulative || g.status !== 'active' || settled.round < g.pickedRound) continue;
      if (g.countedProjectIds.includes(settled.instanceId)) continue;
      const held = (settled.shares[p.id] ?? 0) > 0;
      const counts =
        card.cumulative.metric === 'ownMatured' ? settled.openerId === p.id : settled.openerId !== p.id && held;
      if (!counts) continue;
      g.countedProjectIds.push(settled.instanceId);
      emit(state, ctx, { playerId: p.id, kind: 'goal', cause: `${card.title} 진행 ${Math.min(g.countedProjectIds.length, card.cumulative.target)}/${card.cumulative.target}` });
    }
  }
}

/** ⑥-5 유지형 목표 판정. 한 번이라도 어기면 실패를 저장한다 (E30) */
export function checkMaintenanceGoals(state: GameState, ctx: Ctx, p: PlayerState): void {
  for (const g of p.goals) {
    const m = getGoal(g.goalId).maintenance;
    if (!m || g.status !== 'active' || state.round < m.fromRound || state.round > m.toRound) continue;
    if (p.cash >= m.cashAtLeast && p.debt <= m.debtAtMost) continue;
    g.status = 'failed';
    emit(state, ctx, { playerId: p.id, kind: 'goal', cause: `${getGoal(g.goalId).title} 실패 (현금 ${p.cash}, 부채 ${p.debt})` });
  }
}

export interface GoalEvaluation {
  goalId: string;
  achieved: boolean;
  points: number;
  reason: string;
}

/** 종료 시 목표 판정 (11.1-4) */
export function evaluateGoal(p: PlayerState, g: GoalInstance): GoalEvaluation {
  const card = getGoal(g.goalId);
  const done = (achieved: boolean, reason: string): GoalEvaluation => ({ goalId: g.goalId, achieved, points: achieved ? card.points : 0, reason });
  switch (card.type) {
    case 'state': {
      const s = card.state ?? {};
      const okSkill = s.skillAtLeast === undefined || p.skill >= s.skillAtLeast;
      const okHealth = s.healthAtLeast === undefined || p.health >= s.healthAtLeast;
      return done(okSkill && okHealth, `종료 시 역량 ${p.skill}, 건강 ${p.health}`);
    }
    case 'cumulative': {
      const target = card.cumulative?.target ?? 0;
      return done(g.countedProjectIds.length >= target, `실적 ${g.countedProjectIds.length}/${target}`);
    }
    case 'maintenance':
      return done(g.status === 'active', g.status === 'active' ? '기간 내 조건 유지' : '기간 중 조건 위반');
  }
}
