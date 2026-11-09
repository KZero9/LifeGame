// 헤드리스 시뮬레이터 (DESIGN_PHASE3.md 17.2 7단계, 18.3)
//
// 모든 자리를 AI 정책으로 진행해 한 판을 끝낸다. React·브라우저 API를 쓰지 않는다.

import { chooseAction, DEFAULT_POLICY, type PolicyConfig } from '../ai/policy';
import { applyAction } from '../engine/applyAction';
import { checkInvariants } from '../engine/invariants';
import { playersToAct } from '../engine/legal';
import { createGame } from '../engine/setup';
import type { Action, GameState, PlayerId } from '../engine/types';

export const MAX_DECISIONS_PER_TURN = 30;

export interface SeatConfig {
  name?: string;
  policy?: PolicyConfig;
}

export interface SimOptions {
  seed: number;
  seats: SeatConfig[];
  /** 매 행동 후 불변 조건 검사 (기본 true) */
  checkInvariants?: boolean;
  /** 행동 기록 보존 (재생 확인용) */
  recordActions?: boolean;
  /** 결정 직전에 상태를 바꾸는 훅 (시나리오 하네스의 고정 입력 주입용) */
  beforeDecision?: (state: GameState, actor: PlayerId) => GameState;
}

export interface SimResult {
  state: GameState;
  /** 안전장치 발동, 불변 조건 위반, 거부된 행동 */
  errors: string[];
  decisions: number;
  actions?: [PlayerId, Action][];
  /** 자리 번호(0부터) → 플레이어 id */
  seatIds: PlayerId[];
}

export function runGame(options: SimOptions): SimResult {
  const created = createGame({
    seed: options.seed,
    players: options.seats.map((s, i) => ({ name: s.name ?? `AI ${i + 1}`, controller: 'ai' as const })),
  });
  if (!created.ok) throw new Error(`게임 생성 실패: ${created.reason}`);
  let state = created.state;
  const seatIds = state.players.map((p) => p.id);
  const policyOf = (id: PlayerId) => options.seats[seatIds.indexOf(id)]?.policy ?? DEFAULT_POLICY;
  const errors: string[] = [];
  const actions: [PlayerId, Action][] = [];
  const check = options.checkInvariants ?? true;
  let decisions = 0;
  let turnKey = '';
  let turnDecisions = 0;

  for (let guard = 0; state.status !== 'finished'; guard++) {
    if (guard > 100000) throw new Error(`시드 ${options.seed}: 진행이 끝나지 않음`);
    const actor = playersToAct(state)[0];
    if (!actor) throw new Error(`시드 ${options.seed}: 입력할 플레이어가 없음`);
    if (options.beforeDecision) state = options.beforeDecision(state, actor);

    // 12.1 안전장치: 한 턴의 결정이 30회를 넘으면 END_PHASE 강제
    const key = state.turn ? `${state.round}:${state.turnIndex}:${actor}` : `pick:${state.round}:${actor}`;
    if (key !== turnKey) {
      turnKey = key;
      turnDecisions = 0;
    }
    turnDecisions++;
    let action = chooseAction(state, actor, policyOf(actor));
    if (!action) throw new Error(`시드 ${options.seed}: ${actor}의 합법 행동 없음`);
    if (turnDecisions > MAX_DECISIONS_PER_TURN && state.turn?.playerId === actor) {
      errors.push(`시드 ${options.seed} ${key}: 결정 ${turnDecisions}회 초과로 END_PHASE 강제`);
      action = { type: 'END_PHASE' };
    }

    const r = applyAction(state, actor, action);
    if (!r.ok) throw new Error(`시드 ${options.seed}: AI 행동 거부 ${actor} ${JSON.stringify(action)} → ${r.reason}`);
    state = r.state;
    decisions++;
    if (options.recordActions) actions.push([actor, action]);
    if (check) {
      const violations = checkInvariants(state);
      if (violations.length) errors.push(`시드 ${options.seed} ${key}: ${violations.join(', ')}`);
    }
  }
  return { state, errors, decisions, seatIds, ...(options.recordActions ? { actions } : {}) };
}

/** 같은 시드·행동 목록으로 다시 진행한다 (E46) */
export function replay(seed: number, seats: SeatConfig[], actions: [PlayerId, Action][]): GameState {
  const created = createGame({ seed, players: seats.map((s, i) => ({ name: s.name ?? `AI ${i + 1}`, controller: 'ai' as const })) });
  if (!created.ok) throw new Error(created.reason);
  let state = created.state;
  for (const [actor, action] of actions) {
    const r = applyAction(state, actor, action);
    if (!r.ok) throw new Error(`재생 실패: ${actor} ${JSON.stringify(action)} → ${r.reason}`);
    state = r.state;
  }
  return state;
}
