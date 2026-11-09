// 합법 행동 목록 (DESIGN_PHASE3.md 15장)
//
// 후보를 만들고 checkAction으로 거른다. 수치가 자유로운 행동(REPAY 금액, OFFER_SHARES 조합)은
// 대표 후보만 낸다. 수치 범위 검증은 applyAction이 한다.

import { checkAction } from './applyAction';
import { WORK_JOBS } from './data';
import { activeOpenedBy, isTradable, priceRange, sellableShares, shareValue } from './projects';
import { findPlayer } from './state';
import type { Action, GameState, PlayerId } from './types';

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combinations(items.slice(i + 1), size - 1)) out.push([item, ...rest]);
  });
  return out;
}

function candidates(state: GameState, actor: PlayerId): Action[] {
  const pick = state.pendingGoalPicks.find((p) => p.playerId === actor);
  if (pick) {
    const out: Action[] = [];
    for (let n = pick.min; n <= pick.max; n++) {
      for (const goalIds of combinations(pick.offered, n)) out.push({ type: 'PICK_GOALS', goalIds });
    }
    return out;
  }
  const offer = state.pendingOffer;
  if (offer?.status === 'pending') {
    return offer.buyerId === actor
      ? [
          { type: 'RESPOND_OFFER', offerId: offer.offerId, accept: true },
          { type: 'RESPOND_OFFER', offerId: offer.offerId, accept: false },
        ]
      : [];
  }
  const turn = state.turn;
  if (!turn || turn.playerId !== actor) return [];
  const p = findPlayer(state, actor);
  if (!p) return [];

  const open: Action[] = state.market.map((cardId) => ({ type: 'OPEN_PROJECT', cardId }));
  switch (turn.phase) {
    case 'move':
      return [{ type: 'ROLL' }, { type: 'ADJUST', delta: -1 }, { type: 'ADJUST', delta: 0 }, { type: 'ADJUST', delta: 1 }];
    case 'tile':
      return (turn.pendingTile?.optionIds ?? []).map((optionId): Action => ({ type: 'CHOOSE_OPTION', optionId }));
    case 'actions': {
      const repayMax = Math.min(p.cash, p.debt);
      const repay: Action[] = repayMax >= 1 ? [...new Set([1, repayMax])].map((amount) => ({ type: 'REPAY', amount })) : [];
      return [
        { type: 'LIFE_ACTION', action: 'work' },
        { type: 'LIFE_ACTION', action: 'overtime' },
        { type: 'LIFE_ACTION', action: 'study' },
        { type: 'LIFE_ACTION', action: 'rest' },
        ...WORK_JOBS.map((job): Action => ({ type: 'CHANGE_JOB', job })),
        ...open,
        ...repay,
        { type: 'END_PHASE' },
      ];
    }
    case 'trade':
      return [...offerCandidates(state, actor), { type: 'END_PHASE' }];
    default:
      return [];
  }
}

/** 지분 판매 대표 후보: 판매 가능한 프로젝트 × 대상 × 수량 × 가격(최저·기대 가치·최고) */
function offerCandidates(state: GameState, actor: PlayerId): Action[] {
  const out: Action[] = [];
  for (const project of activeOpenedBy(state, actor)) {
    if (!isTradable(state, project)) continue;
    const range = priceRange(project.baseCost);
    for (const target of state.players) {
      if (target.id === actor) continue;
      for (let count = 1; count <= sellableShares(project); count++) {
        const fair = Math.ceil(shareValue(state, project.instanceId, target.id, 1).expected);
        const prices = [...new Set([range.min, Math.min(range.max, Math.max(range.min, fair)), range.max])];
        for (const pricePerShare of prices) {
          out.push({ type: 'OFFER_SHARES', projectId: project.instanceId, targetId: target.id, count, pricePerShare });
        }
      }
    }
  }
  return out;
}

export function getLegalActions(state: GameState, actor: PlayerId): Action[] {
  return candidates(state, actor).filter((a) => checkAction(state, actor, a) === null);
}

/** 지금 입력을 기다리는 플레이어 목록 (목표 선택·제안 응답·차례) */
export function playersToAct(state: GameState): PlayerId[] {
  if (state.status === 'finished') return [];
  if (state.pendingGoalPicks.length > 0) return state.pendingGoalPicks.map((p) => p.playerId);
  if (state.pendingOffer?.status === 'pending') return [state.pendingOffer.buyerId];
  return state.turn ? [state.turn.playerId] : [];
}
