import { createGame, type GameConfig } from '../src/engine';
import type { GameState, TurnPhase, TurnState } from '../src/engine/types';

export const THREE_PLAYERS: GameConfig['players'] = [
  { name: '가', controller: 'human' },
  { name: '나', controller: 'ai' },
  { name: '다', controller: 'ai' },
];

/** 시작 목표 선택 직후(목표 선택 대기) 상태 */
export function newGameRaw(seed = 42, players = THREE_PLAYERS): GameState {
  const r = createGame({ seed, players });
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

/** 시작 목표를 받은 순서대로 골라 1라운드 첫 턴까지 진행한 상태 */
export function newGame(seed = 42, players = THREE_PLAYERS): GameState {
  return autoPickGoals(newGameRaw(seed, players));
}

/** 대기 중인 목표 선택을 모두 처리한다: 받은 카드 앞에서부터 최소 장수만 고른다 */
export function autoPickGoals(state: GameState): GameState {
  let s = state;
  while (s.pendingGoalPicks.length > 0) {
    const pick = s.pendingGoalPicks[0]!;
    s = act(s, pick.playerId, { type: 'PICK_GOALS', goalIds: pick.offered.slice(0, pick.min) });
  }
  return s;
}

export function makeTurn(playerId: string, phase: TurnPhase): TurnState {
  return {
    playerId,
    phase,
    startedHospitalized: false,
    debtAtStart: 0,
    repaidThisTurn: 0,
    apTotal: 3,
    apLeft: 3,
    adjusted: false,
    counts: { work: 0, overtime: 0, study: 0, rest: 0, jobSearch: 0, open: 0 },
    pendingIncome: 0,
    modifiers: { noOvertime: false, freeJobSearch: false, workPayDelta: 0 },
    offerTargets: [],
  };
}

/** 2단계 전이라 턴 진행이 없으므로, 진행 중 상태를 직접 만든다 */
export function playingState(phase: TurnPhase, seed = 42): GameState {
  const s = newGame(seed);
  s.status = 'playing';
  s.round = 1;
  s.turn = makeTurn(s.turnOrder[0]!, phase);
  return s;
}

// ---------------------------------------------------------------------------
// 진행 도우미

import { applyAction, checkInvariants, getLegalActions, playersToAct } from '../src/engine';
import { rollDie } from '../src/engine/rng';
import type { Action, PlayerState } from '../src/engine/types';

/** 행동을 적용하고 새 상태를 돌려준다. 거부되면 사유와 함께 실패 */
export function act(state: GameState, actor: string, action: Action): GameState {
  const r = applyAction(state, actor, action);
  if (!r.ok) throw new Error(`${actor} ${JSON.stringify(action)} 거부: ${r.reason}`);
  const errors = checkInvariants(r.state);
  if (errors.length) throw new Error(`불변 조건 위반: ${errors.join(', ')}`);
  return r.state;
}

export function reason(state: GameState, actor: string, action: Action): string {
  const r = applyAction(state, actor, action);
  return r.ok ? 'OK' : r.reason;
}

export const current = (s: GameState) => s.turn!.playerId;
export const player = (s: GameState, id: string): PlayerState => s.players.find((p) => p.id === id)!;
export const me = (s: GameState) => player(s, current(s));

/** 현재 플레이어를 ④ 생활 행동 단계로 바로 옮긴다 (이동·칸 효과를 고정한 입력, 18.1) */
export function toActions(state: GameState, dice = 3): GameState {
  const s = structuredClone(state);
  s.turn!.dice = dice;
  s.turn!.phase = 'actions';
  return s;
}

/** round 라운드에서 seatIndex번째 차례가 시작되기 직전까지 진행한 뒤, 그 플레이어 상태를 patch로 바꾸고 턴을 연다 */
export function startTurnWith(state: GameState, round: number, patch: Partial<PlayerState>, seatIndex = 0): GameState {
  let s = state;
  const order = s.turnOrder;
  const prevRound = seatIndex === 0 ? round - 1 : round;
  const prevIndex = seatIndex === 0 ? order.length - 1 : seatIndex - 1;
  while (!(s.round === prevRound && s.turnIndex === prevIndex)) s = passTurn(s);
  s = structuredClone(s);
  Object.assign(player(s, order[seatIndex]!), patch);
  return passTurn(s);
}

/** 현재 플레이어의 턴을 아무 행동 없이 끝낸다. 5라운드 목표 선택이 나오면 고르지 않고 넘긴다 */
export function passTurn(state: GameState): GameState {
  let s = toActions(autoPickGoals(state));
  const id = current(s);
  s = act(s, id, { type: 'END_PHASE' });
  if (s.turn?.playerId === id && s.turn.phase === 'trade') s = act(s, id, { type: 'END_PHASE' });
  return autoPickGoals(s);
}

/** 시장 공개 카드를 프로젝트 덱으로 되돌린다 (카드 장수 보존) */
export function emptyMarket(s: GameState): void {
  s.decks.project.drawPile.push(...s.market);
  s.market = [];
}

/** 프로젝트 카드 cardId를 시장에 공개한다 (덱이나 버린 더미에서 가져옴) */
export function putInMarket(s: GameState, cardId: string): void {
  if (s.market.includes(cardId)) return;
  const deck = s.decks.project;
  for (const pile of [deck.drawPile, deck.discard]) {
    const i = pile.indexOf(cardId);
    if (i >= 0) {
      pile.splice(i, 1);
      if (s.market.length >= 3) deck.drawPile.push(s.market.shift()!);
      s.market.push(cardId);
      return;
    }
  }
  throw new Error(`시장에 올릴 카드가 없음: ${cardId}`);
}

/** 용도별 스트림 key의 다음 주사위가 조건을 만족하도록 난수 상태를 고른다 */
export function forceDie(s: GameState, key: string, wanted: (d: number) => boolean): void {
  for (let k = 0; k < 10000; k++) {
    const trial = { [key]: k };
    if (wanted(rollDie(trial, key))) {
      s.rng[key] = k;
      return;
    }
  }
  throw new Error('원하는 주사위를 찾지 못함');
}

/** 간단한 시드 난수 (테스트 정책용, 엔진 난수와 별개) */
export function testRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 무작위 합법 행동으로 한 판을 끝까지 진행한다. 행동 목록과 최종 상태를 돌려준다 */
export function randomPlaythrough(seed: number, playerCount = 3, policySeed = seed): { state: GameState; actions: [string, Action][] } {
  const players = Array.from({ length: playerCount }, (_, i) => ({ name: `P${i + 1}`, controller: 'ai' as const }));
  let s = newGame(seed, players);
  const rand = testRandom(policySeed);
  const actions: [string, Action][] = [];
  for (let step = 0; s.status !== 'finished'; step++) {
    if (step > 20000) throw new Error('진행이 끝나지 않음');
    const actor = playersToAct(s)[0];
    if (!actor) throw new Error('입력할 플레이어가 없음');
    const legal = getLegalActions(s, actor);
    if (legal.length === 0) throw new Error(`합법 행동 없음: ${actor} ${s.turn?.phase}`);
    const action = legal[Math.floor(rand() * legal.length)]!;
    actions.push([actor, action]);
    s = act(s, actor, action);
  }
  return { state: s, actions };
}
