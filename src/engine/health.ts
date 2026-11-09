// 건강과 입원 (DESIGN_PHASE3.md 4.2)

import { RULES } from './data';
import { emit, payForced, type Ctx } from './state';
import type { GameState, PlayerState } from './types';

/**
 * 입원 판정. 한 행동·선택지의 효과를 모두 적용한 뒤 부른다.
 * 비입원 상태에서 건강이 0이면 입원하고 치료비(강제 지출)를 한 번 낸다.
 * 이미 입원 중이면 아무 일도 없다(E37). 새로 입원했으면 true.
 */
export function resolveHospitalization(state: GameState, ctx: Ctx, p: PlayerState): boolean {
  if (p.hospitalized || p.health > RULES.health.min) return false;
  p.hospitalized = true;
  emit(state, ctx, { playerId: p.id, kind: 'hospital', cause: '건강 0 → 입원' });
  payForced(state, ctx, p, RULES.hospital.fee, '치료비');
  if (state.turn?.playerId === p.id && state.turn.apLeft > 0) {
    emit(state, ctx, { playerId: p.id, kind: 'ap', delta: -state.turn.apLeft, cause: '입원으로 남은 행동력 소멸' });
    state.turn.apLeft = 0;
  }
  return true;
}

/** ⑥ 퇴원: 입원 상태로 시작한 턴의 정산에서 건강을 4로 설정하고 입원 해제 */
export function discharge(state: GameState, ctx: Ctx, p: PlayerState): void {
  const before = p.health;
  p.health = RULES.hospital.dischargeHealth;
  p.hospitalized = false;
  emit(state, ctx, { playerId: p.id, kind: 'health', delta: p.health - before, cause: '퇴원' });
}
