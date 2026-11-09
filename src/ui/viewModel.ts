// 화면용 데이터 (React와 무관한 순수 함수)
//
// 화면은 규칙을 따로 판단하지 않는다. 가능 여부와 불가 사유는 모두 엔진의 checkAction에서 가져온다.

import { checkAction } from '../engine/applyAction';
import { getCard, optionVoluntaryCost } from '../engine/cards';
import { ENVIRONMENTS, environmentCard, RULES, stageRule, tileKind, WORK_JOBS, type TileKind, type WorkJob } from '../engine/data';
import { getGoal } from '../engine/goals';
import { overtimePay, studyCost, workPay } from '../engine/jobs';
import { openTerms } from '../engine/handlers/projects';
import {
  activeOpenedBy,
  expectedTotalPayout,
  getProjectCard,
  isTradable,
  priceRange,
  PROJECT_RULES,
  sellableShares,
  shareValue,
} from '../engine/projects';
import { assetScore } from '../engine/scoring';
import { findPlayer, getPlayer } from '../engine/state';
import type { Action, CardOption, GameState, Job, PlayerId, PlayerState, Stage } from '../engine/types';
import { REJECT_MESSAGES, type RejectReason } from '../engine/validate';

export const TILE_LABEL: Record<TileKind, string> = {
  rest: '휴식',
  opportunity: '기회',
  event: '사건',
  expense: '지출',
  market: '시장',
};

export const JOB_LABEL: Record<Job, string> = {
  none: '무직',
  parttime: '아르바이트',
  office: '사무직',
  tech: '기술직',
  business: '자영업',
};

export const STAGE_LABEL: Record<Stage, string> = { youth: '청년기', middle: '중년기', senior: '장년기' };

export function reasonText(reason: string | null, detail?: { need: number; have: number }): string {
  if (!reason) return '';
  if (reason === 'NOT_ENOUGH_CASH' && detail) return `돈 부족 (필요 ${detail.need}, 보유 ${detail.have})`;
  return REJECT_MESSAGES[reason as RejectReason] ?? reason;
}

export interface Choice {
  action: Action;
  label: string;
  detail?: string;
  enabled: boolean;
  reason: string;
}

function choice(state: GameState, actor: PlayerId, action: Action, label: string, detail?: string, cashNeed?: number): Choice {
  const reason = checkAction(state, actor, action);
  const p = findPlayer(state, actor);
  return {
    action,
    label,
    ...(detail ? { detail } : {}),
    enabled: reason === null,
    reason: reasonText(reason, cashNeed !== undefined && p ? { need: cashNeed, have: p.cash } : undefined),
  };
}

// ---------------------------------------------------------------------------
// 보드와 공통 정보

export function stageLabel(state: GameState): string {
  return state.round >= 1 ? STAGE_LABEL[stageRule(state.round).stage] : '시작 전';
}

export function environmentInfo(state: GameState): { title: string; effect: string; remaining: { title: string; count: number }[] } {
  const env = environmentCard(state.environment);
  const effects: string[] = [];
  if (env.id === 'boom') effects.push('자영업 급여 7', '만기 지급 +2');
  if (env.id === 'recession') effects.push(`자영업 급여 ${env.businessPay}`, '만기 지급 −2', '재취업 비용 +1');
  if (env.id === 'techTransition') effects.push('기술직 급여 −3', '학습비 −1');
  if (env.id === 'normal') effects.push('효과 없음');
  const remaining = ENVIRONMENTS.map((e) => ({ title: e.title, count: state.decks.env.drawPile.filter((id) => id === e.id).length }));
  return { title: state.environment ? env.title : '공개 전', effect: effects.join(', '), remaining };
}

export function tileOf(position: number): { kind: TileKind; label: string } {
  const kind = tileKind(position);
  return { kind, label: TILE_LABEL[kind] };
}

// ---------------------------------------------------------------------------
// 플레이어 요약

export interface GoalProgress {
  goalId: string;
  title: string;
  points: number;
  description: string;
  status: string;
  likely: boolean;
}

export function goalProgress(state: GameState, p: PlayerState): GoalProgress[] {
  return p.goals.map((g) => {
    const card = getGoal(g.goalId);
    let status = '';
    let likely = false;
    if (card.type === 'state') {
      const s = card.state ?? {};
      const parts: string[] = [];
      if (s.skillAtLeast !== undefined) parts.push(`역량 ${p.skill}/${s.skillAtLeast}`);
      if (s.healthAtLeast !== undefined) parts.push(`건강 ${p.health}/${s.healthAtLeast}`);
      likely = (s.skillAtLeast === undefined || p.skill >= s.skillAtLeast) && (s.healthAtLeast === undefined || p.health >= s.healthAtLeast);
      status = parts.join(', ');
    } else if (card.type === 'cumulative') {
      const target = card.cumulative?.target ?? 0;
      likely = g.countedProjectIds.length >= target;
      status = `${Math.min(g.countedProjectIds.length, target)}/${target}`;
    } else {
      likely = g.status === 'active';
      status = g.status === 'failed' ? '실패' : state.round >= (card.maintenance?.fromRound ?? 99) ? '유지 중' : `${card.maintenance?.fromRound}라운드부터 판정`;
    }
    return { goalId: g.goalId, title: card.title, points: card.points, description: card.description, status, likely };
  });
}

export interface PlayerSummary {
  id: PlayerId;
  name: string;
  controller: 'human' | 'ai';
  cash: number;
  debt: number;
  health: number;
  skill: number;
  job: string;
  position: number;
  hospitalized: boolean;
  goals: GoalProgress[];
  /** 지금 끝난다고 할 때 점수 (지분 가치 제외) */
  scoreNow: number;
  isTurn: boolean;
  seatOrder: number;
}

export function playerSummaries(state: GameState): PlayerSummary[] {
  return state.turnOrder.map((id, i) => {
    const p = getPlayer(state, id);
    const goals = goalProgress(state, p);
    return {
      id,
      name: p.name,
      controller: p.controller,
      cash: p.cash,
      debt: p.debt,
      health: p.health,
      skill: p.skill,
      job: JOB_LABEL[p.job],
      position: p.position,
      hospitalized: p.hospitalized,
      goals,
      scoreNow: assetScore(p.cash - p.debt) + goals.filter((g) => g.likely).reduce((s, g) => s + g.points, 0),
      isTurn: state.turn?.playerId === id,
      seatOrder: i + 1,
    };
  });
}

// ---------------------------------------------------------------------------
// 프로젝트

export interface ProjectRow {
  instanceId: string;
  title: string;
  opener: string;
  openerId: PlayerId;
  maturityRound: number;
  paidCost: number;
  baseCost: number;
  shares: { name: string; count: number }[];
  results: string;
  liquidationOnly: boolean;
}

export function projectRows(state: GameState): ProjectRow[] {
  return state.projects.map((proj) => {
    const card = getProjectCard(proj.cardId);
    return {
      instanceId: proj.instanceId,
      title: card.title,
      opener: getPlayer(state, proj.openerId).name,
      openerId: proj.openerId,
      maturityRound: proj.maturityRound,
      paidCost: proj.paidCost,
      baseCost: proj.baseCost,
      shares: Object.entries(proj.shares)
        .filter(([, n]) => n > 0)
        .map(([id, count]) => ({ name: getPlayer(state, id).name, count })),
      results: card.results.join(' / '),
      liquidationOnly: proj.maturityRound > RULES.rounds,
    };
  });
}

export function marketCards(state: GameState): { cardId: string; title: string; cost: number; duration: number; results: string }[] {
  return state.market.map((cardId) => {
    const c = getProjectCard(cardId);
    return { cardId, title: c.title, cost: c.cost, duration: c.duration, results: c.results.join(' / ') };
  });
}

// ---------------------------------------------------------------------------
// 단계별 선택지

export function moveChoices(state: GameState, actor: PlayerId): Choice[] {
  const turn = state.turn;
  if (!turn || turn.dice === undefined) return [choice(state, actor, { type: 'ROLL' }, '주사위 굴리기')];
  const p = getPlayer(state, actor);
  return ([0, -1, 1] as const).map((delta) => {
    const steps = (turn.dice ?? 0) + delta;
    const dest = (p.position + steps) % RULES.board.length;
    const label = delta === 0 ? `${steps}칸 이동` : `${delta > 0 ? '+1' : '−1'} 조정 → ${steps}칸`;
    const detail = `${dest}번 ${TILE_LABEL[tileKind(dest)]}${delta !== 0 ? ` · 행동력 ${RULES.move.adjustAp}` : ''}`;
    return choice(state, actor, { type: 'ADJUST', delta }, label, detail);
  });
}

function optionCost(state: GameState, o: CardOption): string {
  const parts: string[] = [];
  if (o.apCost) parts.push(`행동력 ${o.apCost}`);
  const v = optionVoluntaryCost(state, o);
  if (v) parts.push(`현금 ${v}`);
  if (o.forcedCost) parts.push(`강제 지출 ${o.forcedCost} (부족분은 부채)`);
  return parts.join(' · ');
}

export interface TileView {
  title: string;
  text: string;
  choices: Choice[];
}

export function tileView(state: GameState, actor: PlayerId): TileView | null {
  const pending = state.turn?.pendingTile;
  if (!pending) return null;
  const card = getCard(pending.cardId);
  const branch = card.branches[pending.branch ?? 'default'];
  const choices = (branch?.options ?? []).map((o) =>
    choice(state, actor, { type: 'CHOOSE_OPTION', optionId: o.id }, o.label + (o.isFallback ? ' (기본)' : ''), optionCost(state, o) || '비용 없음', optionVoluntaryCost(state, o)),
  );
  return { title: card.title, text: branch?.text ?? '', choices };
}

export interface ActionsView {
  life: Choice[];
  jobs: Choice[];
  open: Choice[];
  repayMax: number;
  canRepay: boolean;
  end: Choice;
}

export function actionsView(state: GameState, actor: PlayerId): ActionsView {
  const p = getPlayer(state, actor);
  const turn = state.turn!;
  const ot = overtimePay(turn.workedAsJob ?? p.job);
  const life: Choice[] = [
    choice(state, actor, { type: 'LIFE_ACTION', action: 'work' }, '근무', `급여 ${workPay(state, p.job, p.skill)} (⑥에서 지급)`),
    choice(state, actor, { type: 'LIFE_ACTION', action: 'overtime' }, '추가근무', ot === null ? '불가 직업' : `+${ot}, 건강 −1`),
    choice(state, actor, { type: 'LIFE_ACTION', action: 'study' }, '학습', `현금 ${studyCost(state, p)}, 역량 +1`, studyCost(state, p)),
    choice(state, actor, { type: 'LIFE_ACTION', action: 'rest' }, '휴식', `건강 +1 (턴당 ${RULES.lifeActions.rest.perTurn}회)`),
  ];
  const jobs = WORK_JOBS.map((job: WorkJob) => {
    const rule = RULES.jobs[job];
    const req = [`역량 ${rule.skill}`, rule.openingFee ? `개업비 ${rule.openingFee}` : ''].filter(Boolean).join(', ');
    return choice(state, actor, { type: 'CHANGE_JOB', job }, `${JOB_LABEL[job]}(으)로 구직`, req, rule.openingFee);
  });
  const open = state.market.map((cardId) => {
    const c = getProjectCard(cardId);
    const terms = state.turn ? openTerms(state, actor, cardId) : null;
    const cost = terms?.cost ?? c.cost;
    const expected = expectedTotalPayout(state, cardId, p.job === 'business', cost);
    const detail = `비용 ${cost}${terms && terms.ap ? ' · 행동력 1' : ''} · 기간 ${c.duration} · 결과 ${c.results.join('/')} · 기대 지급 ${expected.toFixed(1)}`;
    return choice(state, actor, { type: 'OPEN_PROJECT', cardId }, `${c.title} 개설`, detail, cost);
  });
  const repayMax = Math.min(p.cash, p.debt);
  return {
    life,
    jobs,
    open,
    repayMax,
    canRepay: repayMax >= 1 && checkAction(state, actor, { type: 'REPAY', amount: 1 }) === null,
    end: choice(state, actor, { type: 'END_PHASE' }, '생활 행동 끝내기'),
  };
}

// ---------------------------------------------------------------------------
// 거래

export interface OfferTarget {
  id: PlayerId;
  name: string;
  cash: number;
  alreadyOffered: boolean;
}

export interface SellableProject {
  instanceId: string;
  title: string;
  sellable: number;
  priceMin: number;
  priceMax: number;
  maturityRound: number;
  liquidationOnly: boolean;
}

export interface TradeView {
  projects: SellableProject[];
  targets: OfferTarget[];
  offersLeft: number;
  end: Choice;
}

export function tradeView(state: GameState, actor: PlayerId): TradeView {
  const turn = state.turn!;
  const projects = activeOpenedBy(state, actor)
    .filter((proj) => isTradable(state, proj) && sellableShares(proj) >= 1)
    .map((proj) => {
      const range = priceRange(proj.baseCost);
      return {
        instanceId: proj.instanceId,
        title: getProjectCard(proj.cardId).title,
        sellable: sellableShares(proj),
        priceMin: range.min,
        priceMax: range.max,
        maturityRound: proj.maturityRound,
        liquidationOnly: proj.maturityRound > RULES.rounds,
      };
    });
  const targets = state.players
    .filter((x) => x.id !== actor)
    .map((x) => ({ id: x.id, name: x.name, cash: x.cash, alreadyOffered: turn.offerTargets.includes(x.id) }));
  return {
    projects,
    targets,
    offersLeft: PROJECT_RULES.offersPerTurn - turn.offerTargets.length,
    end: choice(state, actor, { type: 'END_PHASE' }, '거래 끝내기 (턴 종료)'),
  };
}

export interface OfferEvaluation {
  expected: number;
  byEnvironment: { title: string; value: number }[];
  liquidationOnly: boolean;
  total: number;
  cashAfter: number;
  /** 개설자 직업 유지 가정 문구 */
  assumption: string;
}

/** 9.7 거래 창 표시: 추가 지분의 기대 가치, 환경별 기대 가치, 거래 후 현금 */
export function evaluateOffer(state: GameState, projectId: string, buyerId: PlayerId, count: number, pricePerShare: number): OfferEvaluation {
  const v = shareValue(state, projectId, buyerId, count);
  const proj = state.projects.find((x) => x.instanceId === projectId)!;
  const opener = getPlayer(state, proj.openerId);
  const total = count * pricePerShare;
  return {
    expected: v.expected,
    byEnvironment: ENVIRONMENTS.map((e) => ({ title: e.title, value: v.byEnvironment[e.id] ?? 0 })),
    liquidationOnly: v.liquidationOnly,
    total,
    cashAfter: getPlayer(state, buyerId).cash - total,
    assumption: v.liquidationOnly
      ? '게임 종료 전 만기 안 됨 — 청산 환급만'
      : opener.job === 'business'
        ? '개설자가 자영업을 유지한다고 가정 (+2 보너스)'
        : '개설자의 현재 직업 유지 가정',
  };
}

export function offerChoice(state: GameState, actor: PlayerId, projectId: string, targetId: PlayerId, count: number, pricePerShare: number): Choice {
  return choice(state, actor, { type: 'OFFER_SHARES', projectId, targetId, count, pricePerShare }, '제안 보내기');
}

export interface ResponseView {
  seller: string;
  buyerId: PlayerId;
  buyer: string;
  title: string;
  count: number;
  pricePerShare: number;
  evaluation: OfferEvaluation;
  accept: Choice;
  reject: Choice;
}

export function responseView(state: GameState): ResponseView | null {
  const offer = state.pendingOffer;
  if (!offer || offer.status !== 'pending') return null;
  const proj = state.projects.find((x) => x.instanceId === offer.projectId);
  if (!proj) return null;
  const total = offer.count * offer.pricePerShare;
  return {
    seller: getPlayer(state, offer.sellerId).name,
    buyerId: offer.buyerId,
    buyer: getPlayer(state, offer.buyerId).name,
    title: getProjectCard(proj.cardId).title,
    count: offer.count,
    pricePerShare: offer.pricePerShare,
    evaluation: evaluateOffer(state, offer.projectId, offer.buyerId, offer.count, offer.pricePerShare),
    accept: choice(state, offer.buyerId, { type: 'RESPOND_OFFER', offerId: offer.offerId, accept: true }, '수락', `총 ${total}`, total),
    reject: choice(state, offer.buyerId, { type: 'RESPOND_OFFER', offerId: offer.offerId, accept: false }, '거절'),
  };
}

// ---------------------------------------------------------------------------
// 목표 선택

export interface GoalPickView {
  playerId: PlayerId;
  name: string;
  min: number;
  max: number;
  offered: { goalId: string; title: string; points: number; description: string; type: string }[];
  current: string[];
}

const GOAL_TYPE_LABEL = { state: '상태형 (종료 시 판정)', cumulative: '누적형 (선택 이후 실적)', maintenance: '유지형 (한 번 어기면 실패)' };

export function goalPickView(state: GameState, playerId: PlayerId): GoalPickView | null {
  const pick = state.pendingGoalPicks.find((x) => x.playerId === playerId);
  if (!pick) return null;
  const p = getPlayer(state, playerId);
  return {
    playerId,
    name: p.name,
    min: pick.min,
    max: pick.max,
    offered: pick.offered.map((id) => {
      const g = getGoal(id);
      return { goalId: id, title: g.title, points: g.points, description: g.description, type: GOAL_TYPE_LABEL[g.type] };
    }),
    current: p.goals.map((g) => getGoal(g.goalId).title),
  };
}

// ---------------------------------------------------------------------------
// 진행 기록

export interface LogRow {
  round: number;
  name: string;
  playerId?: PlayerId;
  text: string;
  delta?: number;
  kind: string;
}

const DELTA_KINDS = new Set(['cash', 'debt', 'health', 'skill']);
const KIND_LABEL: Record<string, string> = { cash: '현금', debt: '부채', health: '건강', skill: '역량', ap: '행동력' };

export function logRows(state: GameState): LogRow[] {
  return state.log.map((e) => {
    const name = e.playerId ? (findPlayer(state, e.playerId)?.name ?? e.playerId) : '';
    const deltaText = e.delta !== undefined && (DELTA_KINDS.has(e.kind) || e.kind === 'ap') ? ` ${KIND_LABEL[e.kind]} ${e.delta > 0 ? '+' : e.delta < 0 ? '−' : ''}${Math.abs(e.delta)}` : '';
    return { round: e.round, name, ...(e.playerId ? { playerId: e.playerId } : {}), text: `${e.cause}${deltaText}`, ...(e.delta !== undefined ? { delta: e.delta } : {}), kind: e.kind };
  });
}
