// 규칙 엔진 진입점 (DESIGN_PHASE3.md 15장)
//
// applyAction(state, actor, action)
//   - 입력 상태는 절대 바꾸지 않는다. 복제본(draft)에서 처리하고 성공할 때만 돌려준다.
//   - 형식 → 맥락 → 행동별 규칙(check) 순서로 검사하고, 실패하면 사유를 돌려준다.
//   - 처리기는 handlers/index.ts에 등록한다. 등록 전 행동은 NOT_IMPLEMENTED.

import { HANDLERS } from './handlers';
import type { Handler, HandlerTable } from './handlers/types';
import type { Ctx } from './state';
import type { Action, ApplyResult, GameState, PlayerId } from './types';
import { validateContext, validateShape } from './validate';

export function applyAction(state: GameState, actor: PlayerId, action: Action): ApplyResult {
  return applyActionWith(HANDLERS, state, actor, action);
}

/** 상태를 바꾸지 않고 적용 가능 여부만 검사한다. 가능하면 null, 아니면 사유 코드 */
export function checkAction(state: GameState, actor: PlayerId, action: unknown): string | null {
  return checkActionWith(HANDLERS, state, actor, action);
}

export function checkActionWith(handlers: HandlerTable, state: GameState, actor: PlayerId, action: unknown): string | null {
  const shapeError = validateShape(action);
  if (shapeError) return shapeError;
  const typed = action as Action;
  const contextError = validateContext(state, actor, typed);
  if (contextError) return contextError;
  const handler = handlers[typed.type] as Handler | undefined;
  if (!handler) return 'NOT_IMPLEMENTED';
  return handler.check(state, actor, typed);
}

/** 처리기 표를 주입할 수 있는 내부 구현. 테스트에 쓴다 */
export function applyActionWith(handlers: HandlerTable, state: GameState, actor: PlayerId, action: unknown): ApplyResult {
  const reason = checkActionWith(handlers, state, actor, action);
  if (reason) return { ok: false, reason };
  const typed = action as Action;
  const handler = handlers[typed.type] as Handler;

  // 로그 항목은 바꾸지 않는 값이므로 배열만 새로 만들고, 나머지 상태는 깊은 복제한다
  const { log, ...rest } = state;
  const draft: GameState = { ...structuredClone(rest), log: log.slice() };
  const ctx: Ctx = { log: [] };
  handler.apply(draft, actor, typed, ctx);
  draft.log.push(...ctx.log);
  return { ok: true, state: draft, log: ctx.log };
}
