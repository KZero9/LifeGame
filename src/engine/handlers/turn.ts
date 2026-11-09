// 이동과 단계 종료 (DESIGN_PHASE3.md 2.2 ②, 3장, 12.1)

import { RULES } from '../data';
import { enterTrade, settleTurn } from '../flow';
import { enterTile } from '../tiles';
import { rollDie, RngStreams } from '../rng';
import { activeTurn, emit, getPlayer } from '../state';
import type { Handler } from './types';

export const ROLL: Handler<'ROLL'> = {
  check(state) {
    return activeTurn(state).dice === undefined ? null : 'ALREADY_ROLLED';
  },
  apply(draft, actor, _action, ctx) {
    const turn = activeTurn(draft);
    turn.dice = rollDie(draft.rng, RngStreams.move(actor));
    emit(draft, ctx, { playerId: actor, kind: 'dice', delta: turn.dice, cause: '이동 주사위' });
  },
};

/** 주사위 결과를 행동력 1로 ±1 조정(턴당 1회, 결과 1–7). delta 0은 조정 없이 이동 */
export const ADJUST: Handler<'ADJUST'> = {
  check(state, _actor, action) {
    const turn = activeTurn(state);
    if (turn.dice === undefined) return 'NOT_ROLLED';
    if (action.delta === 0) return null;
    if (turn.apLeft < RULES.move.adjustAp) return 'NO_AP'; // E02
    const steps = turn.dice + action.delta;
    if (steps < RULES.move.minSteps || steps > RULES.move.maxSteps) return 'MOVE_OUT_OF_RANGE'; // E01
    return null;
  },
  apply(draft, actor, action, ctx) {
    const turn = activeTurn(draft);
    const p = getPlayer(draft, actor);
    if (action.delta !== 0) {
      turn.apLeft -= RULES.move.adjustAp;
      turn.adjusted = true;
      emit(draft, ctx, { playerId: actor, kind: 'ap', delta: -RULES.move.adjustAp, cause: `이동 조정 ${action.delta > 0 ? '+1' : '−1'}` });
    }
    const steps = (turn.dice ?? 0) + action.delta;
    const from = p.position;
    p.position = (p.position + steps) % RULES.board.length;
    emit(draft, ctx, { playerId: actor, kind: 'move', delta: steps, cause: `${from}번 칸 → ${p.position}번 칸` });
    enterTile(draft, ctx);
  },
};

/** 생활 행동·거래 단계를 끝낸다. 두 단계에서 항상 합법(12.1) */
export const END_PHASE: Handler<'END_PHASE'> = {
  check() {
    return null;
  },
  apply(draft, _actor, _action, ctx) {
    const turn = activeTurn(draft);
    if (turn.phase === 'actions') enterTrade(draft, ctx);
    else settleTurn(draft, ctx);
  },
};
