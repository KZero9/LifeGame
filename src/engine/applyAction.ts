// 규칙 엔진 진입점 (DESIGN_PHASE3.md 15장)
//
// applyAction(state, actor, action)
//   - 입력 상태는 절대 바꾸지 않는다. 복제본(draft)에서 처리하고 성공할 때만 돌려준다.
//   - 형식 → 맥락 → 행동별 처리기 순서로 검사하고, 실패하면 사유를 돌려준다.
//   - 처리기는 규칙 단계(17.2 2~6단계)마다 HANDLERS에 등록한다. 등록 전 행동은 NOT_IMPLEMENTED.

import type { Action, ActionType, ApplyResult, GameState, LogEntry, PlayerId } from './types';
import { validateContext, validateShape, type RejectReason } from './validate';

export interface HandlerContext {
  /** 이번 행동이 남길 로그. 성공 시 state.log에도 덧붙는다 */
  log: LogEntry[];
}

/**
 * 행동 처리기. draft를 직접 바꾼다.
 * 규칙상 불가하면 사유 문자열을 돌려주고, 그러면 draft는 버려진다.
 */
export type ActionHandler<T extends ActionType = ActionType> = (
  draft: GameState,
  actor: PlayerId,
  action: Extract<Action, { type: T }>,
  ctx: HandlerContext,
) => string | void;

type HandlerTable = { [T in ActionType]?: ActionHandler<T> };

/** 1단계에서는 비어 있다. 이후 단계에서 행동별 처리기를 등록한다 */
const HANDLERS: HandlerTable = {};

export function applyAction(state: GameState, actor: PlayerId, action: Action): ApplyResult {
  return applyActionWith(HANDLERS, state, actor, action);
}

/** 처리기 표를 주입할 수 있는 내부 구현. 테스트와 이후 단계 확장에 쓴다 */
export function applyActionWith(
  handlers: HandlerTable,
  state: GameState,
  actor: PlayerId,
  action: unknown,
): ApplyResult {
  const shapeError = validateShape(action);
  if (shapeError) return reject(shapeError);
  const typed = action as Action;

  const contextError = validateContext(state, actor, typed);
  if (contextError) return reject(contextError);

  const handler = handlers[typed.type] as ActionHandler | undefined;
  if (!handler) return reject('NOT_IMPLEMENTED');

  const draft = structuredClone(state);
  const ctx: HandlerContext = { log: [] };
  const ruleError = handler(draft, actor, typed, ctx);
  if (typeof ruleError === 'string') return { ok: false, reason: ruleError };

  draft.log.push(...ctx.log);
  return { ok: true, state: draft, log: ctx.log };
}

function reject(reason: RejectReason): ApplyResult {
  return { ok: false, reason };
}
