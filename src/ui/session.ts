// 화면 진행 제어 (React와 무관). 사람 차례를 찾고, AI 차례면 한 결정씩 진행한다

import { chooseAction, DEFAULT_POLICY } from '../ai/policy';
import { applyAction } from '../engine/applyAction';
import { playersToAct } from '../engine/legal';
import { findPlayer } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { MAX_DECISIONS_PER_TURN } from '../sim/simulate';

export interface Session {
  state: GameState;
  /** AI 안전장치용: 현재 턴 키와 결정 수 */
  turnKey: string;
  turnDecisions: number;
  error?: string;
}

export const newSession = (state: GameState): Session => ({ state, turnKey: '', turnDecisions: 0 });

/** 지금 입력할 사람(사람 컨트롤러) 또는 AI */
export function nextActor(state: GameState): { id: PlayerId; human: boolean } | null {
  const ids = playersToAct(state);
  if (ids.length === 0) return null;
  // 목표 선택처럼 여럿이 대기하면 AI를 먼저 처리하고, 사람은 자리 순서대로
  const ai = ids.find((id) => findPlayer(state, id)?.controller === 'ai');
  if (ai) return { id: ai, human: false };
  const human = [...ids].sort((a, b) => (findPlayer(state, a)?.seat ?? 0) - (findPlayer(state, b)?.seat ?? 0))[0]!;
  return { id: human, human: true };
}

/** 사람의 행동 적용 */
export function applyHuman(session: Session, actor: PlayerId, action: Action): Session {
  const r = applyAction(session.state, actor, action);
  if (!r.ok) return { ...session, error: r.reason };
  return { ...session, state: r.state, error: undefined };
}

/** AI 한 결정 진행. AI 차례가 아니면 그대로 */
export function stepAI(session: Session): Session {
  const next = nextActor(session.state);
  if (!next || next.human) return session;
  const s = session.state;
  const key = s.turn ? `${s.round}:${s.turnIndex}:${next.id}` : `pick:${s.round}:${next.id}`;
  const turnDecisions = key === session.turnKey ? session.turnDecisions + 1 : 1;
  const player = findPlayer(s, next.id)!;
  let action = chooseAction(s, next.id, DEFAULT_POLICY);
  if (!action) return { ...session, error: `${player.name}: 합법 행동 없음` };
  if (turnDecisions > MAX_DECISIONS_PER_TURN && s.turn?.playerId === next.id) action = { type: 'END_PHASE' };
  const r = applyAction(s, next.id, action);
  if (!r.ok) return { ...session, turnKey: key, turnDecisions, error: `${player.name}: ${r.reason}` };
  return { state: r.state, turnKey: key, turnDecisions };
}

/** 사람 차례나 게임 종료까지 AI를 즉시 진행 (건너뛰기) */
export function runAIUntilHuman(session: Session, limit = 5000): Session {
  let s = session;
  for (let i = 0; i < limit; i++) {
    const next = nextActor(s.state);
    if (!next || next.human || s.error) return s;
    s = stepAI(s);
  }
  return s;
}
