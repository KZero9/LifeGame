// 프로젝트와 지분 (DESIGN_PHASE3.md 9장)

import projectsJson from '../data/projects.json';
import { ENVIRONMENTS, environmentCard, RULES } from './data';
import { discard, draw } from './decks';
import { rollDie, RngStreams } from './rng';
import { emit, gainCash, getPlayer, type Ctx } from './state';
import type { GameState, PlayerId, ProjectInstance, SettledProject } from './types';

export interface ProjectCard {
  id: string;
  title: string;
  cost: number;
  duration: number;
  /** 주사위 1–2 / 3–4 / 5–6 결과 */
  results: [number, number, number];
}

export interface ProjectRules {
  copiesPerCard: number;
  marketSize: number;
  maxActivePerOpener: number;
  businessBonus: number;
  offersPerTurn: number;
  priceRange: { minNumerator: number; maxNumerator: number; denominator: number };
  liquidationDivisor: number;
  cards: ProjectCard[];
}

export const PROJECT_RULES = projectsJson as unknown as ProjectRules;
const PROJECT_INDEX = new Map(PROJECT_RULES.cards.map((c) => [c.id, c]));

export function getProjectCard(id: string): ProjectCard {
  const card = PROJECT_INDEX.get(id);
  if (!card) throw new Error(`없는 프로젝트 카드: ${id}`);
  return card;
}

/** 프로젝트 덱 10장 (5종 × 2장) */
export function projectDeckCards(): string[] {
  return PROJECT_RULES.cards.flatMap((c) => Array.from({ length: PROJECT_RULES.copiesPerCard }, () => c.id));
}

export const resultFor = (card: ProjectCard, dice: number): number => card.results[Math.floor((dice - 1) / 2)] ?? 0;

/** 1지분 가격 범위: [max(1, ceil(정가/4 × 0.5)), ceil(정가/4 × 1.5)] (9.5) */
export function priceRange(baseCost: number): { min: number; max: number } {
  const { minNumerator, maxNumerator, denominator } = PROJECT_RULES.priceRange;
  return {
    min: Math.max(1, Math.ceil((baseCost * minNumerator) / denominator)),
    max: Math.ceil((baseCost * maxNumerator) / denominator),
  };
}

/** 거래 가능 조건: 진행 중이고 현재 라운드 ≤ 만기 라운드, 12라운드 제외 (9.3) */
export function isTradable(state: GameState, project: ProjectInstance): boolean {
  return state.round <= project.maturityRound && state.round !== RULES.rounds && state.projects.includes(project);
}

export const activeOpenedBy = (state: GameState, playerId: PlayerId) => state.projects.filter((p) => p.openerId === playerId);

/** 판매 가능 지분 = 개설자 보유 − 1 */
export const sellableShares = (project: ProjectInstance) => (project.shares[project.openerId] ?? 0) - 1;

/** 만기 지급 배분: 타 보유자 floor(P × 지분 / 4), 개설자는 나머지 (9.4) */
export function distribute(total: number, project: ProjectInstance): Record<PlayerId, number> {
  const payouts: Record<PlayerId, number> = {};
  let others = 0;
  for (const [id, q] of Object.entries(project.shares)) {
    if (id === project.openerId || q <= 0) continue;
    payouts[id] = Math.floor((total * q) / 4);
    others += payouts[id];
  }
  payouts[project.openerId] = total - others;
  return payouts;
}

export function liquidationTotal(project: ProjectInstance): number {
  return Math.floor(project.paidCost / PROJECT_RULES.liquidationDivisor);
}

/** 2.1-3-1 만기 정산 (라운드 종료 공통 정산, 개설 순서대로) */
export function settleMaturities(state: GameState, ctx: Ctx): SettledProject[] {
  const due = state.projects.filter((p) => p.maturityRound === state.round);
  const env = environmentCard(state.environment);
  const settled: SettledProject[] = [];
  for (const project of due) {
    const card = getProjectCard(project.cardId);
    const dice = rollDie(state.rng, RngStreams.maturity);
    const opener = getPlayer(state, project.openerId);
    const bonus = opener.job === 'business' ? PROJECT_RULES.businessBonus : 0;
    const total = Math.max(0, resultFor(card, dice) + env.projectDelta + bonus);
    emit(state, ctx, {
      playerId: project.openerId,
      kind: 'project',
      delta: total,
      cause: `${card.title} 만기: 주사위 ${dice}, 결과 ${resultFor(card, dice)}, 환경 ${env.projectDelta >= 0 ? '+' : ''}${env.projectDelta}, 자영업 +${bonus} → 총 ${total}`,
    });
    const record = closeProject(state, ctx, project, 'matured', total, `${card.title} 만기 지급`);
    record.dice = dice;
    settled.push(record);
  }
  return settled;
}

/** 지급하고 진행 중 목록에서 빼고 카드를 버린 더미로 보낸다 (1회만) */
export function closeProject(
  state: GameState,
  ctx: Ctx,
  project: ProjectInstance,
  kind: SettledProject['kind'],
  total: number,
  cause: string,
): SettledProject {
  const payouts = distribute(total, project);
  for (const [id, amount] of Object.entries(payouts)) gainCash(state, ctx, getPlayer(state, id), amount, cause);
  const record: SettledProject = {
    instanceId: project.instanceId,
    cardId: project.cardId,
    openerId: project.openerId,
    round: state.round,
    kind,
    total,
    shares: { ...project.shares },
    payouts,
  };
  state.projects = state.projects.filter((p) => p.instanceId !== project.instanceId);
  state.projectHistory.push(record);
  discard(state, 'project', project.cardId);
  return record;
}

/** 시장 공개 프로젝트를 3장까지 보충 (덱과 버린 더미가 모두 비면 적을 수 있다) */
export function refillMarket(state: GameState, ctx: Ctx): void {
  while (state.market.length < PROJECT_RULES.marketSize) {
    const id = draw(state, 'project');
    if (!id) break;
    state.market.push(id);
    emit(state, ctx, { kind: 'market', cause: `시장 공개: ${getProjectCard(id).title}` });
  }
}

// ---------------------------------------------------------------------------
// 9.7 지분 가치 평가 (거래 창과 AI 공용)

export interface ShareValue {
  expected: number;
  /** 환경 카드별 기대 가치 */
  byEnvironment: Record<string, number>;
  /** 만기가 12라운드 뒤라 청산 환급만 받는 경우 */
  liquidationOnly: boolean;
}

/** 만기 라운드 환경의 분포 (환경 id → 확률) */
export function maturityEnvironmentDistribution(state: GameState, maturityRound: number): Record<string, number> {
  if (maturityRound <= state.round) return { [state.environment ?? 'normal']: 1 };
  const d = maturityRound - state.round;
  const remaining = state.decks.env.drawPile;
  const pool = d <= remaining.length ? remaining : ENVIRONMENTS.flatMap((c) => Array.from({ length: c.count }, () => c.id));
  const dist: Record<string, number> = {};
  for (const id of pool) dist[id] = (dist[id] ?? 0) + 1 / pool.length;
  return dist;
}

/** 지분 q개를 가진 사람이 k개를 더 가질 때의 기대 추가 지급액 */
export function shareValue(state: GameState, projectId: string, buyerId: PlayerId, k: number): ShareValue {
  const project = state.projects.find((p) => p.instanceId === projectId);
  if (!project) throw new Error(`없는 프로젝트: ${projectId}`);
  const q = project.openerId === buyerId ? 0 : (project.shares[buyerId] ?? 0);
  const gain = (total: number) => Math.floor((total * (q + k)) / 4) - Math.floor((total * q) / 4);

  if (project.maturityRound > RULES.rounds) {
    const value = gain(liquidationTotal(project));
    const byEnvironment = Object.fromEntries(ENVIRONMENTS.map((e) => [e.id, value]));
    return { expected: value, byEnvironment, liquidationOnly: true };
  }

  const card = getProjectCard(project.cardId);
  const bonus = getPlayer(state, project.openerId).job === 'business' ? PROJECT_RULES.businessBonus : 0;
  const byEnvironment: Record<string, number> = {};
  for (const env of ENVIRONMENTS) {
    let sum = 0;
    for (let dice = 1; dice <= 6; dice++) sum += gain(Math.max(0, resultFor(card, dice) + env.projectDelta + bonus));
    byEnvironment[env.id] = sum / 6;
  }
  const dist = maturityEnvironmentDistribution(state, project.maturityRound);
  let expected = 0;
  for (const [id, prob] of Object.entries(dist)) expected += prob * (byEnvironment[id] ?? 0);
  return { expected, byEnvironment, liquidationOnly: false };
}

/** 카드를 지금 개설했을 때의 기대 총 지급액 (4지분 보유 가정, AI 개설 판단용) */
export function expectedTotalPayout(state: GameState, cardId: string, openerIsBusiness: boolean, paidCost: number): number {
  const card = getProjectCard(cardId);
  const maturity = state.round + card.duration - 1;
  if (maturity > RULES.rounds) return Math.floor(paidCost / PROJECT_RULES.liquidationDivisor);
  const bonus = openerIsBusiness ? PROJECT_RULES.businessBonus : 0;
  const dist = maturityEnvironmentDistribution(state, maturity);
  let expected = 0;
  for (const [id, prob] of Object.entries(dist)) {
    const delta = environmentCard(id).projectDelta;
    let sum = 0;
    for (let dice = 1; dice <= 6; dice++) sum += Math.max(0, resultFor(card, dice) + delta + bonus);
    expected += (prob * sum) / 6;
  }
  return expected;
}
