import type { Ctx } from '../state';
import type { Action, ActionType, GameState, PlayerId } from '../types';

/**
 * 행동 처리기.
 * - check: 규칙상 가능한지 검사한다. 상태를 바꾸지 않는다. 불가하면 사유 코드.
 *   형식·맥락 검사(validate.ts)를 통과한 행동만 받는다. getLegalActions도 이 함수를 쓴다.
 * - apply: check를 통과한 행동을 draft에 적용하고 다음 입력 지점까지 진행한다.
 */
export interface Handler<T extends ActionType = ActionType> {
  check(state: GameState, actor: PlayerId, action: Extract<Action, { type: T }>): string | null;
  apply(draft: GameState, actor: PlayerId, action: Extract<Action, { type: T }>, ctx: Ctx): void;
}

export type HandlerTable = { [T in ActionType]?: Handler<T> };
