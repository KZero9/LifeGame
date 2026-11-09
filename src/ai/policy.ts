// AI 정책 (DESIGN_PHASE3.md 12장)
//
// 규칙 엔진의 합법 행동 목록에서 고른다. 사람과 같은 규칙과 공개 정보만 쓴다. 난수를 쓰지 않는다.
// 결정마다 후보를 다시 평가하고, 생활 행동·거래 단계에서 최고 효용이 0 이하이면 END_PHASE를 고른다.

import { checkAction } from '../engine/applyAction';
import { optionVoluntaryCost } from '../engine/cards';
import { ENVIRONMENTS, RULES, stageRule, tileKind, WORK_JOBS, type WorkJob } from '../engine/data';
import { getGoal } from '../engine/goals';
import { overtimePay, studyCost, workPay } from '../engine/jobs';
import { getLegalActions } from '../engine/legal';
import {
  activeOpenedBy,
  expectedTotalPayout,
  getProjectCard,
  isTradable,
  priceRange,
  sellableShares,
  shareValue,
} from '../engine/projects';
import { getPlayer } from '../engine/state';
import { pendingOption } from '../engine/tiles';
import type { Action, GameState, Job, PlayerId, PlayerState } from '../engine/types';

/** 정책 변형 (18.3). 기본 AI는 모든 값이 비어 있다 */
export interface PolicyConfig {
  name: string;
  /** 도달하고 유지하려는 직업 */
  targetJob?: WorkJob;
  /** 추가근무 효용 가산 */
  overtimeBonus?: number;
  /** 학습 효용 가산 */
  studyBonus?: number;
  /** 프로젝트 개설 효용 가산 */
  projectBonus?: number;
  /** 상환할 때 남기는 현금 (기본: 비상금 기준 R). 회복 측정은 0 */
  repayReserve?: number;
}

export const DEFAULT_POLICY: PolicyConfig = { name: 'default' };

export const POLICY_VARIANTS: Record<string, PolicyConfig> = {
  default: DEFAULT_POLICY,
  officeOvertime: { name: 'officeOvertime', targetJob: 'office', overtimeBonus: 2 },
  techEarly: { name: 'techEarly', targetJob: 'tech', studyBonus: 1 },
  businessProjects: { name: 'businessProjects', targetJob: 'business', projectBonus: 2 },
  studyFirst: { name: 'studyFirst', studyBonus: 3 },
};

// ---------------------------------------------------------------------------
// 12.2 기본 값

const AP_VALUE = 2;
const EXCLUDED = Number.NEGATIVE_INFINITY;
const EPS = 1e-9;

/** 비상금 기준 R = 다음 생활비 + 2 */
export function reserve(state: GameState): number {
  return stageRule(Math.min(Math.max(state.round, 1), RULES.rounds)).livingCost + 2;
}

const roundsLeft = (state: GameState) => RULES.rounds - state.round + 1;

/** 건강 변화의 가치: 1당 현금 1.5, 결과 건강이 4 이하가 되는 구간은 1당 3. 건강 0(입원)은 큰 손해 */
export function healthValue(health: number, delta: number): number {
  let value = 0;
  let h = health;
  const step = delta > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(delta); i++) {
    if (step > 0) {
      if (h >= RULES.health.max) break;
      h += 1;
      value += h <= 4 ? 3 : 1.5;
    } else {
      if (h <= 0) break;
      h -= 1;
      value -= h <= 4 ? 3 : 1.5;
      if (h === 0) value -= 8; // 입원: 치료비 3과 한 턴의 행동·수입
    }
  }
  return value;
}

/** 역량 1의 가치: 2. 다음 직업 조건·보유 목표에 필요하면 3. 역량 6이면 0 */
export function skillValue(p: PlayerState, config: PolicyConfig): number {
  if (p.skill >= RULES.skill.max) return 0;
  const next = p.skill + 1;
  const jobNeeds = WORK_JOBS.some((j) => RULES.jobs[j].skill === next) || next === RULES.jobs.tech.highSkill?.atLeast;
  const goalNeeds = p.goals.some((g) => {
    if (g.status !== 'active') return false;
    const need = getGoal(g.goalId).state?.skillAtLeast;
    return need !== undefined && p.skill < need;
  });
  const targetNeeds = config.targetJob !== undefined && p.skill < RULES.jobs[config.targetJob].skill;
  return jobNeeds || goalNeeds || targetNeeds ? 3 : 2;
}

/** 환경 덱 구성으로 평균한 기대 급여 (구직 판단용) */
function expectedPay(state: GameState, job: Job, skill: number): number {
  if (job === 'none') return 0;
  const total = ENVIRONMENTS.reduce((n, e) => n + e.count, 0);
  let sum = 0;
  for (const env of ENVIRONMENTS) sum += env.count * workPay({ ...state, environment: env.id, turn: null }, job, skill);
  return sum / total;
}

function jobChangeValue(state: GameState, p: PlayerState, job: Job, config: PolicyConfig): number {
  const gain = (expectedPay(state, job, p.skill) - expectedPay(state, p.job, p.skill)) * Math.min(roundsLeft(state), 4) * 0.5;
  let bias = 0;
  if (config.targetJob) {
    if (job === config.targetJob) bias += 6;
    else if (p.job === config.targetJob) bias -= 100;
  }
  return gain + bias;
}

// ---------------------------------------------------------------------------
// 목표 한계 가치 (12.3, 12.4, P10)

function activeGoal(p: PlayerState, goalId: string) {
  return p.goals.find((g) => g.goalId === goalId && g.status === 'active');
}

export function entrepreneurMarginal(state: GameState, p: PlayerState, maturityRound: number): number {
  const g = activeGoal(p, 'entrepreneur');
  if (!g || maturityRound > RULES.rounds) return 0;
  const card = getGoal('entrepreneur');
  const pending = activeOpenedBy(state, p.id).filter((x) => x.maturityRound <= RULES.rounds).length;
  const n = (card.cumulative?.target ?? 2) - g.countedProjectIds.length - pending;
  return n <= 0 ? 0 : (card.points * 0.3) / n;
}

export function companionMarginal(state: GameState, p: PlayerState, projectId: string): number {
  const g = activeGoal(p, 'companion');
  const project = state.projects.find((x) => x.instanceId === projectId);
  if (!g || !project || project.maturityRound > RULES.rounds) return 0;
  if ((project.shares[p.id] ?? 0) > 0) return 0; // 이미 보유한 프로젝트의 추가 매입은 0 (E29)
  const card = getGoal('companion');
  const target = card.cumulative?.target ?? 3;
  if (g.countedProjectIds.length >= target) return 0;
  const held = state.projects.filter((x) => x.openerId !== p.id && (x.shares[p.id] ?? 0) > 0 && x.maturityRound <= RULES.rounds).length;
  const n = target - g.countedProjectIds.length - held;
  return n <= 0 ? 0 : (card.points * 0.3) / n;
}

// ---------------------------------------------------------------------------
// 행동 효용 (12.3)

function openUtility(state: GameState, p: PlayerState, cardId: string, discount: number, config: PolicyConfig): number {
  const card = getProjectCard(cardId);
  const cost = Math.max(1, card.cost - discount);
  if (p.cash - cost < reserve(state)) return EXCLUDED;
  const maturity = state.round + card.duration - 1;
  return (
    expectedTotalPayout(state, cardId, p.job === 'business', cost) -
    cost +
    entrepreneurMarginal(state, p, maturity) +
    (config.projectBonus ?? 0)
  );
}

function bestOpenUtility(state: GameState, p: PlayerState, discount: number, config: PolicyConfig): number {
  let best = 0;
  for (const cardId of state.market) best = Math.max(best, openUtility(state, p, cardId, discount, config));
  return best;
}

function tileValue(state: GameState, p: PlayerState, position: number, config: PolicyConfig): number {
  switch (tileKind(position)) {
    case 'market':
      return bestOpenUtility(state, p, 0, config);
    case 'rest':
      return Math.max(healthValue(p.health, 2), AP_VALUE);
    case 'event':
      return -1;
    case 'expense':
      return -2.5;
    case 'opportunity':
      return 1;
  }
}

function optionUtility(state: GameState, p: PlayerState, optionId: string, config: PolicyConfig): number {
  const found = pendingOption(state, optionId);
  if (!found) return EXCLUDED;
  const { option } = found;
  const voluntary = optionVoluntaryCost(state, option);
  if (!option.isFallback && p.cash - voluntary < reserve(state)) return EXCLUDED;
  const forced = option.forcedCost ?? 0;
  let u = -voluntary - forced - AP_VALUE * (option.apCost ?? 0);
  u -= Math.max(0, forced - (p.cash - voluntary)) * 0.15; // 부채 전환분의 이자 부담
  let health = p.health;
  for (const e of option.effects) {
    switch (e.kind) {
      case 'cash':
        u += e.amount;
        break;
      case 'health':
        u += healthValue(health, e.amount);
        health = Math.min(RULES.health.max, Math.max(0, health + e.amount));
        break;
      case 'skill':
        for (let i = 0; i < e.amount; i++) u += skillValue({ ...p, skill: p.skill + i }, config);
        break;
      case 'ap':
        u += AP_VALUE * e.amount;
        break;
      case 'setJob':
        u += jobChangeValue(state, p, e.job, config);
        break;
      case 'restorePreviousJob': {
        const prev = state.turn?.pendingTile?.previousJob;
        if (prev) u += jobChangeValue(state, p, prev, config);
        break;
      }
      case 'modifier':
        if (e.key === 'noOvertime') u -= 1;
        if (e.key === 'freeJobSearch') u += 0.5;
        break;
      case 'grantOpen':
        u += bestOpenUtility(state, p, e.discount, config);
        break;
    }
  }
  return u;
}

/** 목표 카드 하나의 대략적 기대 점수 (선택용) */
function goalEstimate(state: GameState, p: PlayerState, goalId: string, config: PolicyConfig): number {
  const card = getGoal(goalId);
  const left = roundsLeft(state);
  let prob = 0.4;
  switch (goalId) {
    case 'expert':
      prob = Math.min(1, Math.max(0, (left / 2 - (6 - p.skill)) / 3 + 0.5)) + (config.studyBonus ? 0.2 : 0);
      break;
    case 'healthy-old':
      prob = p.health >= (card.state?.healthAtLeast ?? 7) ? 0.5 : 0.3;
      break;
    case 'steady':
      prob = p.skill >= 3 ? 0.7 : 0.5;
      break;
    case 'entrepreneur':
      prob = p.job === 'business' || config.targetJob === 'business' ? 0.6 : 0.25;
      break;
    case 'companion':
      prob = 0.3;
      break;
    case 'prepared':
      prob = p.cash >= (card.maintenance?.cashAtLeast ?? 10) && p.debt === 0 ? 0.5 : 0.3;
      break;
  }
  return card.points * Math.min(1, Math.max(0, prob));
}

// ---------------------------------------------------------------------------
// 결정

interface Scored {
  action: Action;
  utility: number;
  order: number;
}

/** 동점 순서: 근무 > 추가근무 > 프로젝트 개설 > 학습 > 구직 > 휴식 > 상환 > END_PHASE */
function tieOrder(a: Action): number {
  switch (a.type) {
    case 'LIFE_ACTION':
      return { work: 0, overtime: 1, study: 3, rest: 5 }[a.action];
    case 'OPEN_PROJECT':
      return 2;
    case 'CHANGE_JOB':
      return 4;
    case 'REPAY':
      return 6;
    case 'END_PHASE':
      return 9;
    default:
      return 7;
  }
}

function scoreAction(state: GameState, p: PlayerState, a: Action, config: PolicyConfig): number {
  const turn = state.turn;
  switch (a.type) {
    case 'ROLL':
      return 0;
    case 'ADJUST': {
      if (!turn?.dice) return EXCLUDED;
      const dest = (d: number) => (p.position + (turn.dice ?? 0) + d) % RULES.board.length;
      const base = tileValue(state, p, dest(0), config);
      return a.delta === 0 ? 0 : tileValue(state, p, dest(a.delta), config) - base - AP_VALUE * RULES.move.adjustAp;
    }
    case 'CHOOSE_OPTION':
      return optionUtility(state, p, a.optionId, config);
    case 'LIFE_ACTION':
      switch (a.action) {
        case 'work':
          return workPay(state, p.job, p.skill);
        case 'overtime': {
          const pay = overtimePay(turn?.workedAsJob ?? p.job) ?? 0;
          return pay + healthValue(p.health, RULES.lifeActions.overtime.health) + (config.overtimeBonus ?? 0);
        }
        case 'study': {
          const cost = studyCost(state, p);
          if (p.cash - cost < reserve(state)) return EXCLUDED;
          return skillValue(p, config) - cost + (config.studyBonus ?? 0);
        }
        case 'rest': {
          if (p.health >= RULES.health.max) return EXCLUDED;
          let v = healthValue(p.health, 1);
          const senior = stageRule(Math.max(1, state.round)).stage === 'senior';
          const healthyOld = getGoal('healthy-old').state?.healthAtLeast ?? 7;
          if (p.health <= 4 || (activeGoal(p, 'healthy-old') && senior && p.health < healthyOld)) v *= 2;
          return v;
        }
      }
      break;
    case 'CHANGE_JOB': {
      const fee = RULES.jobs[a.job as WorkJob].openingFee;
      // 비상금 기준은 돈이 드는 구직에만 적용한다 (무직·부채 상태에서 아르바이트 구직이 막히지 않게)
      if (fee > 0 && p.cash - fee < reserve(state)) return EXCLUDED;
      const value = jobChangeValue(state, p, a.job, config) - fee;
      if (value <= 0) return value;
      // 구직은 근무 전에만 가능하므로, 같은 턴에 새 직업으로 근무할 수 있으면 그 급여까지 더해 근무보다 먼저 고른다
      const apAfter = (turn?.apLeft ?? 0) - (turn?.modifiers.freeJobSearch ? 0 : RULES.lifeActions.jobSearch.ap);
      return value + (apAfter >= RULES.lifeActions.work.ap ? workPay(state, a.job, p.skill) : 0);
    }
    case 'OPEN_PROJECT': {
      const discount = turn?.modifiers.openGrant?.discount ?? 0;
      return openUtility(state, p, a.cardId, discount, config);
    }
    case 'REPAY':
      return a.amount * 0.15;
    case 'END_PHASE':
      return 0;
    default:
      return EXCLUDED;
  }
  return EXCLUDED;
}

/** AI가 직접 만드는 후보: 상환(현금 − R만큼), 지분 판매 제안(12.4) */
function extraCandidates(state: GameState, p: PlayerState, config: PolicyConfig): { action: Action; utility: number }[] {
  const out: { action: Action; utility: number }[] = [];
  const turn = state.turn;
  if (!turn || turn.playerId !== p.id) return out;
  const R = reserve(state);
  if (turn.phase === 'actions') {
    const amount = Math.min(p.debt, p.cash - (config.repayReserve ?? R));
    if (amount >= 1) out.push({ action: { type: 'REPAY', amount }, utility: amount * 0.15 });
  }
  if (turn.phase === 'trade') {
    const targets = state.players
      .filter((x) => x.id !== p.id && !turn.offerTargets.includes(x.id))
      .sort((a, b) => b.cash - a.cash || a.seat - b.seat);
    for (const project of activeOpenedBy(state, p.id)) {
      if (!isTradable(state, project) || sellableShares(project) < 1) continue;
      const range = priceRange(project.baseCost);
      for (const target of targets) {
        const ev = shareValue(state, project.instanceId, target.id, 1).expected;
        const price = Math.min(range.max, Math.max(range.min, Math.ceil(ev - EPS)));
        let count = 0;
        let utility = 0;
        if (p.cash < R) {
          count = Math.min(sellableShares(project), Math.ceil((R - p.cash) / price));
          utility = 3;
        } else if (range.max > ev + EPS) {
          count = 1;
          utility = 0.5;
        }
        while (count > 0 && target.cash < count * price) count--;
        if (count === 0) continue;
        const action: Action = { type: 'OFFER_SHARES', projectId: project.instanceId, targetId: target.id, count, pricePerShare: price };
        if (checkAction(state, p.id, action) === null) out.push({ action, utility });
        break; // 프로젝트마다 현금이 많은 상대부터 한 명
      }
    }
  }
  return out;
}

/** 다음 행동을 고른다. 입력할 차례가 아니면 null */
export function chooseAction(state: GameState, playerId: PlayerId, config: PolicyConfig = DEFAULT_POLICY): Action | null {
  const legal = getLegalActions(state, playerId);
  if (legal.length === 0) return null;
  const p = getPlayer(state, playerId);

  // 목표 선택: 기대 점수 합이 가장 큰 조합 (목표는 실패해도 손해가 없으므로 최대 장수)
  if (legal[0]!.type === 'PICK_GOALS') {
    let best = legal[0]!;
    let bestScore = -1;
    for (const a of legal) {
      if (a.type !== 'PICK_GOALS') continue;
      const score = a.goalIds.reduce((sum, id) => sum + goalEstimate(state, p, id, config), 0) + a.goalIds.length * 100;
      if (score > bestScore + EPS) {
        best = a;
        bestScore = score;
      }
    }
    return best;
  }

  // 지분 제안 응답 (12.4)
  if (legal[0]!.type === 'RESPOND_OFFER') {
    const offer = state.pendingOffer!;
    const total = offer.count * offer.pricePerShare;
    const value = shareValue(state, offer.projectId, playerId, offer.count).expected - total + companionMarginal(state, p, offer.projectId);
    const accept = value >= -EPS && p.cash - total >= reserve(state);
    const wanted = legal.find((a) => a.type === 'RESPOND_OFFER' && a.accept === accept);
    return wanted ?? legal.find((a) => a.type === 'RESPOND_OFFER' && !a.accept)!;
  }

  const scored: Scored[] = [];
  for (const action of legal) {
    if (action.type === 'REPAY' || action.type === 'OFFER_SHARES') continue; // 아래에서 AI 후보로 대체
    scored.push({ action, utility: scoreAction(state, p, action, config), order: tieOrder(action) });
  }
  for (const { action, utility } of extraCandidates(state, p, config)) scored.push({ action, utility, order: tieOrder(action) });

  let best: Scored | undefined;
  for (const s of scored) {
    if (s.utility === EXCLUDED) continue;
    if (!best || s.utility > best.utility + EPS || (Math.abs(s.utility - best.utility) <= EPS && s.order < best.order)) best = s;
  }
  const phase = state.turn?.phase;
  const endable = phase === 'actions' || phase === 'trade';
  if (endable && (!best || best.utility <= EPS)) return { type: 'END_PHASE' };
  if (best) return best.action;
  // 제외되지 않은 후보가 없을 때(이동·칸 선택): 대체 선택지나 첫 후보
  if (phase === 'tile') {
    const fallback = state.turn?.pendingTile?.optionIds.find((id) => pendingOption(state, id)?.option.isFallback);
    if (fallback) return { type: 'CHOOSE_OPTION', optionId: fallback };
  }
  return legal[0]!;
}
