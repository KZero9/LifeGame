import type { Action, GameState } from '../../engine/types';
import { tradeView } from '../viewModel';
import { ChoiceButton } from './ChoiceButton';

/** ⑤ 거래 (9단계: 거래 종료만. 제안 창은 10단계) */
export function TradePanel({ state, actor, onAction }: { state: GameState; actor: string; onAction: (a: Action) => void }) {
  const view = tradeView(state, actor);
  return <ChoiceButton choice={view.end} primary onPick={(c) => onAction(c.action)} />;
}
