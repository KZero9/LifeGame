// 게임 생성 (DESIGN_PHASE3.md 1.2 시작 상태, 17.3 난수)
//
// 플레이어 시작 자원, 턴 순서, 용도별 난수 스트림을 만들고 1라운드를 연다.
// 사건·기회·지출·환경 덱을 섞는다. 프로젝트 덱·시장·목표 덱은 5~6단계에서 채운다.

import { RULES } from './data';
import { initCardDecks } from './decks';
import { startGameIfReady } from './flow';
import { allStreamKeys, createRngState, isValidSeed, RngStreams, shuffle } from './rng';
import type { Ctx } from './state';
import type { Controller, Deck, GameState, PlayerState } from './types';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** 1.2 시작 상태 (src/data/rules.json) */
export const START_STATE = RULES.start;

export interface PlayerConfig {
  name: string;
  controller: Controller;
}

export interface GameConfig {
  /** 0 이상 2^32−1 이하 정수. 엔진은 순수 함수라 시드를 스스로 만들지 않는다 */
  seed: number;
  players: PlayerConfig[];
}

export type CreateResult = { ok: true; state: GameState } | { ok: false; reason: string };

const emptyDeck = (): Deck => ({ drawPile: [], discard: [] });

export function createGame(config: GameConfig): CreateResult {
  if (!isValidSeed(config.seed)) return { ok: false, reason: 'INVALID_SEED' };
  if (!Array.isArray(config.players)) return { ok: false, reason: 'INVALID_PLAYERS' };
  const count = config.players.length;
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) return { ok: false, reason: 'PLAYER_COUNT' };

  for (const p of config.players) {
    if (typeof p?.name !== 'string' || p.name.trim() === '') return { ok: false, reason: 'INVALID_NAME' };
    if (p.controller !== 'human' && p.controller !== 'ai') return { ok: false, reason: 'INVALID_CONTROLLER' };
  }

  const players: PlayerState[] = config.players.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name.trim(),
    controller: p.controller,
    seat: i,
    cash: START_STATE.cash,
    debt: START_STATE.debt,
    health: START_STATE.health,
    skill: START_STATE.skill,
    job: START_STATE.job,
    position: START_STATE.position,
    hospitalized: false,
    goals: [],
    goalDeck: emptyDeck(),
  }));

  const ids = players.map((p) => p.id);
  const rng = createRngState(config.seed, allStreamKeys(ids));
  // 1.2: 시작 시 무작위로 정하고 끝까지 고정
  const turnOrder = shuffle(rng, RngStreams.turnOrder, ids);

  const state: GameState = {
    seed: config.seed,
    rng,
    round: 0,
    players,
    turnOrder,
    turnIndex: 0,
    turn: null,
    environment: null,
    decks: {
      env: emptyDeck(),
      event: { youth: emptyDeck(), middle: emptyDeck(), senior: emptyDeck() },
      opportunity: emptyDeck(),
      expense: emptyDeck(),
      project: emptyDeck(),
    },
    market: [],
    projects: [],
    projectHistory: [],
    pendingGoalPicks: [],
    nextId: 1,
    log: [{ round: 0, kind: 'setup', cause: `게임 생성 (시드 ${config.seed}, 턴 순서 ${turnOrder.join(' → ')})` }],
    status: 'setup',
  };
  initCardDecks(state);
  const ctx: Ctx = { log: [] };
  startGameIfReady(state, ctx);
  state.log.push(...ctx.log);
  return { ok: true, state };
}
