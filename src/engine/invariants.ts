// 불변 조건 (DESIGN_PHASE3.md 18.2). 매 행동 후, 시뮬레이션 중에도 검사한다
// 위반 목록을 돌려준다. 빈 배열이면 정상

import { RULES } from './data';
import { PROJECT_RULES } from './projects';
import type { GameState } from './types';

const isInt = (n: number) => Number.isInteger(n);

export function checkInvariants(state: GameState): string[] {
  const errors: string[] = [];
  for (const p of state.players) {
    const tag = `${p.id}:`;
    if (!isInt(p.cash) || p.cash < 0) errors.push(`${tag} 현금 ${p.cash}`);
    if (!isInt(p.debt) || p.debt < 0) errors.push(`${tag} 부채 ${p.debt}`);
    if (!isInt(p.health) || p.health < RULES.health.min || p.health > RULES.health.max) errors.push(`${tag} 건강 ${p.health}`);
    if (!isInt(p.skill) || p.skill < RULES.skill.min || p.skill > RULES.skill.max) errors.push(`${tag} 역량 ${p.skill}`);
    if (!isInt(p.position) || p.position < 0 || p.position >= RULES.board.length) errors.push(`${tag} 위치 ${p.position}`);
    if (p.hospitalized && p.health !== 0) errors.push(`${tag} 입원 중 건강 ${p.health}`);
  }
  for (const proj of state.projects) {
    const total = Object.values(proj.shares).reduce((a, b) => a + b, 0);
    if (total !== 4) errors.push(`${proj.instanceId}: 지분 합 ${total}`);
    if ((proj.shares[proj.openerId] ?? 0) < 1) errors.push(`${proj.instanceId}: 개설자 지분 < 1`);
  }
  // 프로젝트 카드 장수 보존: 덱 + 버린 더미 + 시장 + 진행 중 = 10
  const cardTotal = state.decks.project.drawPile.length + state.decks.project.discard.length + state.market.length + state.projects.length;
  const expectedCards = PROJECT_RULES.cards.length * PROJECT_RULES.copiesPerCard;
  if (cardTotal !== expectedCards) errors.push(`프로젝트 카드 ${cardTotal}장 (기대 ${expectedCards})`);
  const opened: Record<string, number> = {};
  for (const proj of state.projects) opened[proj.openerId] = (opened[proj.openerId] ?? 0) + 1;
  for (const [id, n] of Object.entries(opened)) if (n > PROJECT_RULES.maxActivePerOpener) errors.push(`${id}: 진행 중 개설 ${n}개`);

  if (state.status === 'playing') {
    if (state.round < 1 || state.round > RULES.rounds) errors.push(`라운드 ${state.round}`);
    const t = state.turn;
    if (t) {
      if (t.playerId !== state.turnOrder[state.turnIndex]) errors.push(`턴 플레이어 불일치 ${t.playerId}`);
      if (t.apLeft < 0 || t.apLeft > t.apTotal + 1) errors.push(`행동력 ${t.apLeft}/${t.apTotal}`);
    } else if (state.pendingGoalPicks.length === 0) {
      errors.push('진행 중인데 턴이 없음');
    }
  }
  if (state.status === 'finished' && state.turn) errors.push('종료 후 턴이 남음');
  return errors;
}
