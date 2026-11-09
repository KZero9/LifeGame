// 부채 상환 (DESIGN_PHASE3.md 4.3): ④에서 행동력 없이, 1 이상의 정수, 현금과 부채 이하

import { activeTurn, emit, getPlayer } from '../state';
import type { Handler } from './types';

export const REPAY: Handler<'REPAY'> = {
  check(state, actor, { amount }) {
    const p = getPlayer(state, actor);
    if (p.debt === 0) return 'NO_DEBT';
    if (amount > p.debt) return 'REPAY_EXCEEDS_DEBT'; // E43
    if (amount > p.cash) return 'REPAY_EXCEEDS_CASH'; // E43
    return null;
  },
  apply(draft, actor, { amount }, ctx) {
    const p = getPlayer(draft, actor);
    p.cash -= amount;
    p.debt -= amount;
    activeTurn(draft).repaidThisTurn += amount;
    emit(draft, ctx, { playerId: actor, kind: 'cash', delta: -amount, cause: '부채 상환' });
    emit(draft, ctx, { playerId: actor, kind: 'debt', delta: -amount, cause: '부채 상환' });
  },
};
