// 부적법 입력 거부 틀 (DESIGN_PHASE3.md 9.5, 15장)
//
// applyAction은 UI 검증과 별개로 입력을 거부한다. 검사는 두 층이다.
//   1) 형식: 행동 종류, 필드 타입, 수치 범위(양의 정수 등). 상태를 보지 않는다.
//   2) 맥락: 행위자, 게임 상태, 차례, 단계, 대기 중인 제안·목표 선택.
// 행동별 규칙(행동력, 현금, 횟수 제한 등)은 각 규칙 단계의 처리기가 검사한다.

import type { Action, ActionType, GameState, Job, PlayerId, TurnPhase } from './types';

/** 거부 사유 코드와 화면 문구 */
export const REJECT_MESSAGES = {
  INVALID_ACTION: '알 수 없는 행동입니다',
  INVALID_FIELD: '행동 입력값이 올바르지 않습니다',
  NOT_POSITIVE_INTEGER: '1 이상의 정수만 입력할 수 있습니다',
  DUPLICATE_GOAL: '같은 목표를 두 번 고를 수 없습니다',
  UNKNOWN_ACTOR: '참가자가 아닙니다',
  GAME_NOT_STARTED: '게임이 아직 시작되지 않았습니다',
  GAME_FINISHED: '게임이 끝났습니다',
  NOT_YOUR_TURN: '차례가 아닙니다',
  WRONG_PHASE: '지금 단계에서 할 수 없는 행동입니다',
  AWAITING_OFFER_RESPONSE: '지분 제안에 대한 응답을 기다리는 중입니다',
  GOAL_PICK_PENDING: '인생 목표 선택이 끝나지 않았습니다',
  NO_GOAL_PICK: '고를 목표가 없습니다',
  GOAL_NOT_OFFERED: '받지 않은 목표입니다',
  GOAL_PICK_COUNT: '고를 수 있는 목표 수를 벗어났습니다',
  OFFER_NOT_FOUND: '해당 제안이 없습니다',
  OFFER_ALREADY_RESOLVED: '이미 응답한 제안입니다',
  NOT_OFFER_TARGET: '제안을 받은 사람만 응답할 수 있습니다',
  SELF_OFFER: '자기 자신에게는 제안할 수 없습니다',
  UNKNOWN_TARGET: '제안 대상이 참가자가 아닙니다',
  NOT_IMPLEMENTED: '아직 구현되지 않은 행동입니다',
  // 행동별 규칙 (처리기 check)
  NO_AP: '행동력이 부족합니다',
  LIMIT_REACHED: '이번 턴에 더 할 수 없는 행동입니다',
  ALREADY_ROLLED: '이미 주사위를 굴렸습니다',
  NOT_ROLLED: '먼저 주사위를 굴려야 합니다',
  MOVE_OUT_OF_RANGE: '이동 칸 수는 1~7이어야 합니다',
  NO_JOB: '무직은 근무할 수 없습니다',
  NOT_WORKED: '이번 턴에 근무한 뒤에만 추가근무할 수 있습니다',
  NO_OVERTIME_JOB: '이 직업은 추가근무를 할 수 없습니다',
  OVERTIME_BLOCKED: '이번 턴에는 추가근무를 할 수 없습니다',
  SKILL_MAX: '역량이 이미 최대입니다',
  NOT_ENOUGH_CASH: '돈이 부족합니다',
  ALREADY_WORKED: '근무한 뒤에는 구직할 수 없습니다',
  SAME_JOB: '이미 그 직업입니다',
  SKILL_REQUIRED: '역량이 부족합니다',
  NO_DEBT: '갚을 부채가 없습니다',
  NO_PENDING_CARD: '고를 카드 선택지가 없습니다',
  UNKNOWN_OPTION: '없는 선택지입니다',
  CONDITION_NOT_MET: '선택지 조건을 만족하지 않습니다',
  NOT_IN_MARKET: '시장에 공개된 프로젝트가 아닙니다',
  PROJECT_LIMIT: '진행 중인 개설 프로젝트가 이미 2개입니다',
  NO_OPEN_RIGHT: '이번 턴에는 프로젝트를 개설할 수 없습니다',
  NO_TRADE_FINAL_ROUND: '12라운드에는 지분을 팔 수 없습니다',
  UNKNOWN_PROJECT: '없는 프로젝트입니다',
  NOT_OPENER: '개설자만 지분을 팔 수 있습니다',
  NOT_TRADABLE: '거래할 수 없는 프로젝트입니다',
  NOT_ENOUGH_SHARES: '판매할 수 있는 지분이 부족합니다 (개설자는 1지분 이상 보유)',
  PRICE_OUT_OF_RANGE: '가격 범위를 벗어났습니다',
  ALREADY_OFFERED: '이번 턴에 이미 제안한 상대입니다',
  REPAY_EXCEEDS_DEBT: '부채보다 많이 갚을 수 없습니다',
  REPAY_EXCEEDS_CASH: '현금보다 많이 갚을 수 없습니다',
} as const;

export type RejectReason = keyof typeof REJECT_MESSAGES;

const ACTION_TYPES: readonly ActionType[] = [
  'ROLL',
  'ADJUST',
  'CHOOSE_OPTION',
  'LIFE_ACTION',
  'CHANGE_JOB',
  'OPEN_PROJECT',
  'REPAY',
  'OFFER_SHARES',
  'RESPOND_OFFER',
  'PICK_GOALS',
  'END_PHASE',
];

/** 구직 대상 직업. 'none'(무직)은 구직으로 고를 수 없다 */
const JOB_TARGETS: readonly Job[] = ['parttime', 'office', 'tech', 'business'];
const LIFE_ACTIONS = ['work', 'overtime', 'study', 'rest'] as const;

/**
 * 자기 차례 행동이 허용되는 턴 단계 (2.2).
 * start·settle은 자동 처리 단계라 입력을 받지 않는다.
 * END_PHASE는 생활 행동·거래 단계에서 항상 합법이다(12.1).
 */
export const PHASES_BY_ACTION: Readonly<Record<Exclude<ActionType, 'RESPOND_OFFER' | 'PICK_GOALS'>, readonly TurnPhase[]>> = {
  ROLL: ['move'],
  ADJUST: ['move'],
  CHOOSE_OPTION: ['tile'],
  OPEN_PROJECT: ['actions'], // 개설 권한(시장 칸·설명회·협업) 또는 자영업 개설 행동
  LIFE_ACTION: ['actions'],
  CHANGE_JOB: ['actions'],
  REPAY: ['actions'],
  OFFER_SHARES: ['trade'],
  END_PHASE: ['actions', 'trade'],
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isPositiveInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** 1) 형식 검사. 통과하면 action은 Action 타입으로 다룰 수 있다 */
export function validateShape(action: unknown): RejectReason | null {
  if (!isRecord(action) || typeof action.type !== 'string') return 'INVALID_ACTION';
  if (!(ACTION_TYPES as readonly string[]).includes(action.type)) return 'INVALID_ACTION';
  const a = action;
  switch (a.type as ActionType) {
    case 'ROLL':
    case 'END_PHASE':
      return null;
    case 'ADJUST':
      return a.delta === -1 || a.delta === 0 || a.delta === 1 ? null : 'INVALID_FIELD';
    case 'CHOOSE_OPTION':
      return isNonEmptyString(a.optionId) ? null : 'INVALID_FIELD';
    case 'LIFE_ACTION':
      return (LIFE_ACTIONS as readonly unknown[]).includes(a.action) ? null : 'INVALID_FIELD';
    case 'CHANGE_JOB':
      return (JOB_TARGETS as readonly unknown[]).includes(a.job) ? null : 'INVALID_FIELD';
    case 'OPEN_PROJECT':
      return isNonEmptyString(a.cardId) ? null : 'INVALID_FIELD';
    case 'REPAY':
      // E41: 0, 음수, 소수 거부
      return isPositiveInteger(a.amount) ? null : 'NOT_POSITIVE_INTEGER';
    case 'OFFER_SHARES':
      if (!isNonEmptyString(a.projectId) || !isNonEmptyString(a.targetId)) return 'INVALID_FIELD';
      // E41: 지분 수·가격 0, 음수, 소수 거부
      return isPositiveInteger(a.count) && isPositiveInteger(a.pricePerShare) ? null : 'NOT_POSITIVE_INTEGER';
    case 'RESPOND_OFFER':
      return isNonEmptyString(a.offerId) && typeof a.accept === 'boolean' ? null : 'INVALID_FIELD';
    case 'PICK_GOALS': {
      if (!Array.isArray(a.goalIds) || !a.goalIds.every(isNonEmptyString)) return 'INVALID_FIELD';
      return new Set(a.goalIds).size === a.goalIds.length ? null : 'DUPLICATE_GOAL';
    }
  }
}

/** 2) 맥락 검사. 형식 검사를 통과한 행동만 받는다 */
export function validateContext(state: GameState, actor: PlayerId, action: Action): RejectReason | null {
  if (!state.players.some((p) => p.id === actor)) return 'UNKNOWN_ACTOR';
  if (state.status === 'finished') return 'GAME_FINISHED';

  // 목표 선택: 대기 중인 선택이 있는 플레이어만, 받은 카드 안에서, 정해진 장수로
  if (action.type === 'PICK_GOALS') {
    const pick = state.pendingGoalPicks.find((p) => p.playerId === actor);
    if (!pick) return 'NO_GOAL_PICK';
    if (!action.goalIds.every((id) => pick.offered.includes(id))) return 'GOAL_NOT_OFFERED';
    if (action.goalIds.length < pick.min || action.goalIds.length > pick.max) return 'GOAL_PICK_COUNT';
    return null;
  }
  if (state.pendingGoalPicks.length > 0) return 'GOAL_PICK_PENDING';

  // 제안 응답: 응답 전 제안의 대상만. 입원 중에도 응답 가능(E35)
  const offer = state.pendingOffer;
  if (action.type === 'RESPOND_OFFER') {
    if (!offer || offer.offerId !== action.offerId) return 'OFFER_NOT_FOUND';
    if (offer.status !== 'pending') return 'OFFER_ALREADY_RESOLVED'; // E42
    if (offer.buyerId !== actor) return 'NOT_OFFER_TARGET';
    return null;
  }
  if (offer?.status === 'pending') return 'AWAITING_OFFER_RESPONSE';

  // 나머지는 자기 차례 행동
  if (state.status !== 'playing' || !state.turn) return 'GAME_NOT_STARTED';
  if (state.turn.playerId !== actor) return 'NOT_YOUR_TURN';
  if (!PHASES_BY_ACTION[action.type].includes(state.turn.phase)) return 'WRONG_PHASE';

  if (action.type === 'OFFER_SHARES') {
    if (action.targetId === actor) return 'SELF_OFFER'; // E40
    if (!state.players.some((p) => p.id === action.targetId)) return 'UNKNOWN_TARGET';
  }
  return null;
}
