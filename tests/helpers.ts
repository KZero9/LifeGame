import { createGame, type GameConfig } from '../src/engine';
import type { GameState, TurnPhase, TurnState } from '../src/engine/types';

export const THREE_PLAYERS: GameConfig['players'] = [
  { name: '가', controller: 'human' },
  { name: '나', controller: 'ai' },
  { name: '다', controller: 'ai' },
];

export function newGame(seed = 42, players = THREE_PLAYERS): GameState {
  const r = createGame({ seed, players });
  if (!r.ok) throw new Error(r.reason);
  return r.state;
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

/** 현재 플레이어를 주사위 dice로 이동시켜 ④ 생활 행동 단계까지 진행 (조정 없음) */
export function toActions(state: GameState, dice = 3): GameState {
  const s = structuredClone(state);
  s.turn!.dice = dice;
  return act(s, current(s), { type: 'ADJUST', delta: 0 });
}

/** 현재 플레이어의 턴을 아무 행동 없이 끝낸다 */
export function passTurn(state: GameState): GameState {
  let s = toActions(state);
  s = act(s, current(s), { type: 'END_PHASE' });
  if (s.turn?.phase === 'trade') s = act(s, current(s), { type: 'END_PHASE' });
  return s;
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
