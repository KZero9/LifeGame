// ③ 칸 선택지 (DESIGN_PHASE3.md 8.1)

import { getPlayer } from '../state';
import { applyOption, checkOption, pendingOption } from '../tiles';
import type { Handler } from './types';

export const CHOOSE_OPTION: Handler<'CHOOSE_OPTION'> = {
  check(state, actor, { optionId }) {
    if (!state.turn?.pendingTile) return 'NO_PENDING_CARD';
    const found = pendingOption(state, optionId);
    if (!found) return 'UNKNOWN_OPTION';
    return checkOption(state, getPlayer(state, actor), found.option);
  },
  apply(draft, _actor, { optionId }, ctx) {
    const found = pendingOption(draft, optionId);
    if (!found) throw new Error(`선택지 없음: ${optionId}`);
    applyOption(draft, ctx, found.card, found.option);
  },
};
