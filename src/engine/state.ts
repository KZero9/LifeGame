// 상태 조회와 자원 변경 도우미
//
// 자원을 바꾸는 함수는 모두 draft(applyAction이 만든 복제본)만 바꾸고, 원인을 로그에 남긴다.

import { RULES } from './data';
import type { GameState, LogEntry, PlayerId, PlayerState, TurnState } from './types';

export interface Ctx {
  /** 이번 처리에서 생긴 로그. 끝나면 state.log에 덧붙인다 */
  log: LogEntry[];
}

export function findPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState {
  const p = findPlayer(state, id);
  if (!p) throw new Error(`없는 플레이어: ${id}`);
  return p;
}

/** 진행 중인 턴 (없으면 오류). 처리기는 맥락 검사를 통과한 뒤에만 부른다 */
export function activeTurn(state: GameState): TurnState {
  if (!state.turn) throw new Error('진행 중인 턴이 없음');
  return state.turn;
}

export function emit(state: GameState, ctx: Ctx, entry: Omit<LogEntry, 'round'>): void {
  ctx.log.push({ round: state.round, ...entry });
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 건강 변화. clamp(0, 10) 적용. 입원 판정은 행동·선택지의 효과를 모두 적용한 뒤 따로 한다(4.2) */
export function changeHealth(state: GameState, ctx: Ctx, p: PlayerState, delta: number, cause: string): void {
  const before = p.health;
  p.health = clamp(p.health + delta, RULES.health.min, RULES.health.max);
  if (p.health !== before) emit(state, ctx, { playerId: p.id, kind: 'health', delta: p.health - before, cause });
}

export function changeSkill(state: GameState, ctx: Ctx, p: PlayerState, delta: number, cause: string): void {
  const before = p.skill;
  p.skill = clamp(p.skill + delta, RULES.skill.min, RULES.skill.max);
  if (p.skill !== before) emit(state, ctx, { playerId: p.id, kind: 'skill', delta: p.skill - before, cause });
}

/** 수입 (현금 증가) */
export function gainCash(state: GameState, ctx: Ctx, p: PlayerState, amount: number, cause: string): void {
  if (amount <= 0) return;
  p.cash += amount;
  emit(state, ctx, { playerId: p.id, kind: 'cash', delta: amount, cause });
}

/** 자발 지출: 현금으로만. 호출 전에 현금이 충분한지 검사해야 한다(4.3) */
export function payVoluntary(state: GameState, ctx: Ctx, p: PlayerState, amount: number, cause: string): void {
  if (amount <= 0) return;
  if (p.cash < amount) throw new Error(`자발 지출 현금 부족: ${p.id} ${amount} > ${p.cash}`);
  p.cash -= amount;
  emit(state, ctx, { playerId: p.id, kind: 'cash', delta: -amount, cause });
}

/** 강제 지출: 현금을 0까지 쓰고 부족분은 부채로 전환(긴급 대출, 4.3) */
export function payForced(state: GameState, ctx: Ctx, p: PlayerState, amount: number, cause: string): void {
  if (amount <= 0) return;
  const fromCash = Math.min(p.cash, amount);
  const toDebt = amount - fromCash;
  if (fromCash > 0) {
    p.cash -= fromCash;
    emit(state, ctx, { playerId: p.id, kind: 'cash', delta: -fromCash, cause });
  }
  if (toDebt > 0) {
    p.debt += toDebt;
    emit(state, ctx, { playerId: p.id, kind: 'debt', delta: toDebt, cause: `${cause} (긴급 대출)` });
  }
}
