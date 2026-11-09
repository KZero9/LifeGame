// 라운드와 턴 진행 (DESIGN_PHASE3.md 2장)
//
// 입력을 기다리지 않는 단계(① 시작, ⑥ 정산, 라운드 시작·종료)는 여기서 자동으로 처리한다.
// 처리기는 단계를 끝낼 때 이 모듈의 함수를 불러 다음 입력 지점까지 진행시킨다.

import { environmentCard, RULES, stageRule } from './data';
import { discard, draw } from './decks';
import { discharge } from './health';
import { activeTurn, changeHealth, emit, gainCash, getPlayer, payForced, type Ctx } from './state';
import type { GameState, PlayerId, TurnState } from './types';

export function newTurnState(playerId: PlayerId, startedHospitalized: boolean, debtAtStart: number, ap: number): TurnState {
  return {
    playerId,
    phase: 'start',
    startedHospitalized,
    debtAtStart,
    repaidThisTurn: 0,
    apTotal: ap,
    apLeft: ap,
    adjusted: false,
    counts: { work: 0, overtime: 0, study: 0, rest: 0, jobSearch: 0, open: 0 },
    pendingIncome: 0,
    modifiers: { noOvertime: false, freeJobSearch: false, workPayDelta: 0 },
    offerTargets: [],
  };
}

/** 게임 시작: 시작 목표 선택이 끝났으면 1라운드를 연다 */
export function startGameIfReady(state: GameState, ctx: Ctx): void {
  if (state.pendingGoalPicks.length > 0) {
    state.status = 'goalPick';
    return;
  }
  if (state.round === 0) beginRound(state, ctx, 1);
}

/** 2.1-1 라운드 시작 */
export function beginRound(state: GameState, ctx: Ctx, round: number): void {
  state.round = round;
  state.status = 'playing';
  state.turnIndex = 0;
  state.turn = null;
  emit(state, ctx, { kind: 'round', cause: `${round}라운드 시작 (${stageRule(round).stage})` });
  // 공통 환경 카드 공개 (7장). 덱이 비면 버린 8장을 다시 섞는다
  state.environment = draw(state, 'env');
  emit(state, ctx, { kind: 'environment', cause: `공통 환경: ${environmentCard(state.environment).title}` });
  beginTurn(state, ctx);
}

/** ① 시작: 행동력 확정, 턴 시작 부채·입원 상태 기록 */
export function beginTurn(state: GameState, ctx: Ctx): void {
  const playerId = state.turnOrder[state.turnIndex];
  if (playerId === undefined) throw new Error(`턴 순서 범위 밖: ${state.turnIndex}`);
  const p = getPlayer(state, playerId);
  const ap = p.hospitalized ? 0 : p.health <= RULES.ap.lowHealthAtMost ? RULES.ap.lowHealth : RULES.ap.base;
  state.turn = newTurnState(playerId, p.hospitalized, p.debt, ap);
  emit(state, ctx, { playerId, kind: 'turn', cause: p.hospitalized ? '턴 시작 (입원 중: ①~⑤ 생략)' : `턴 시작 (행동력 ${ap})` });

  if (p.hospitalized) {
    settleTurn(state, ctx);
    return;
  }
  state.turn.phase = 'move';
}

export function enterActions(state: GameState): void {
  activeTurn(state).phase = 'actions';
}

/** ⑤ 거래. 제안할 수 있는 것이 없으면 클릭을 줄이려고 바로 정산으로 넘어간다 (16장 시간 예산) */
export function enterTrade(state: GameState, ctx: Ctx): void {
  const turn = activeTurn(state);
  turn.phase = 'trade';
  if (!hasTradeOptions(state, turn.playerId)) settleTurn(state, ctx);
}

/** 이번 턴에 지분 판매 제안을 할 수 있는가. 지분 거래는 5단계에서 구현한다 */
export function hasTradeOptions(_state: GameState, _playerId: PlayerId): boolean {
  return false;
}

/** ⑥ 개인 정산 */
export function settleTurn(state: GameState, ctx: Ctx): void {
  const turn = activeTurn(state);
  turn.phase = 'settle';
  turn.apLeft = 0;
  const p = getPlayer(state, turn.playerId);
  const stage = stageRule(state.round);

  // 1. 이자: 턴 시작 부채 중 이번 턴에 갚지 않은 금액에만 붙는다 (4.3, P01)
  const interestBase = Math.max(0, turn.debtAtStart - turn.repaidThisTurn);
  if (interestBase > 0) {
    const interest = Math.ceil(interestBase / RULES.debt.interestDivisor);
    p.debt += interest;
    emit(state, ctx, { playerId: p.id, kind: 'debt', delta: interest, cause: `이자 (대상 ${interestBase})` });
  }

  // 2. 수입: 이번 턴 근무·추가근무 수입
  gainCash(state, ctx, p, turn.pendingIncome, '근무 수입');
  turn.pendingIncome = 0;

  // 3. 강제 지출: 생활비
  payForced(state, ctx, p, stage.livingCost, '생활비');

  // 4. 건강: 입원으로 시작한 턴이면 퇴원, 이번 턴에 입원했으면 없음, 아니면 노화
  if (turn.startedHospitalized) {
    discharge(state, ctx, p);
  } else if (!p.hospitalized && stage.aging > 0 && p.health > RULES.health.agingFloor) {
    const target = Math.max(RULES.health.agingFloor, p.health - stage.aging);
    changeHealth(state, ctx, p, target - p.health, '노화');
  }

  // 5. 유지형 목표 판정 — 6단계에서 구현

  // 6. 다음 플레이어
  emit(state, ctx, { playerId: p.id, kind: 'turn', cause: '턴 종료' });
  nextTurn(state, ctx);
}

function nextTurn(state: GameState, ctx: Ctx): void {
  state.turnIndex += 1;
  if (state.turnIndex < state.turnOrder.length) {
    beginTurn(state, ctx);
    return;
  }
  endRound(state, ctx);
}

/** 2.1-3 라운드 종료 정산 */
export function endRound(state: GameState, ctx: Ctx): void {
  state.turn = null;
  // 1. 만기 프로젝트 정산 — 5단계
  // 2. 이번 라운드 환경 카드를 버린 더미로
  if (state.environment) discard(state, 'env', state.environment);
  // 3. 시장 보충 — 5단계
  emit(state, ctx, { kind: 'round', cause: `${state.round}라운드 종료` });
  if (state.round >= RULES.rounds) {
    finishGame(state, ctx);
    return;
  }
  beginRound(state, ctx, state.round + 1);
}

/** 11.1 종료 처리. 청산·목표·점수는 6단계에서 구현한다 */
function finishGame(state: GameState, ctx: Ctx): void {
  state.status = 'finished';
  state.turn = null;
  emit(state, ctx, { kind: 'game', cause: '게임 종료' });
}
