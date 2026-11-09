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
