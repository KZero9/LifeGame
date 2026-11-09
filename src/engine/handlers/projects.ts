// 프로젝트 개설과 지분 판매 (DESIGN_PHASE3.md 9.2, 9.5)

import { RULES } from '../data';
import {
  activeOpenedBy,
  getProjectCard,
  isTradable,
  priceRange,
  PROJECT_RULES,
  sellableShares,
} from '../projects';
import { activeTurn, emit, findPlayer, getPlayer, payVoluntary } from '../state';
import type { GameState, PlayerId } from '../types';
import type { Handler } from './types';

/** 개설 경로와 비용. 개설 권한(시장·설명회·협업)이 있으면 행동력 0, 없으면 자영업의 개설 행동(행동력 1) */
export function openTerms(state: GameState, actor: PlayerId, cardId: string): { cost: number; ap: number; source: string } | null {
  const turn = activeTurn(state);
  const base = getProjectCard(cardId).cost;
  const grant = turn.modifiers.openGrant;
  if (grant) return { cost: Math.max(1, base - grant.discount), ap: 0, source: grant.source };
  if (getPlayer(state, actor).job === 'business') return { cost: base, ap: 1, source: 'business' };
  return null;
}

export const OPEN_PROJECT: Handler<'OPEN_PROJECT'> = {
  check(state, actor, { cardId }) {
    const turn = activeTurn(state);
    if (!state.market.includes(cardId)) return 'NOT_IN_MARKET';
    if (turn.counts.open >= 1) return 'LIMIT_REACHED';
    if (activeOpenedBy(state, actor).length >= PROJECT_RULES.maxActivePerOpener) return 'PROJECT_LIMIT'; // E36
    const terms = openTerms(state, actor, cardId);
    if (!terms) return 'NO_OPEN_RIGHT';
    if (turn.apLeft < terms.ap) return 'NO_AP';
    if (getPlayer(state, actor).cash < terms.cost) return 'NOT_ENOUGH_CASH';
    return null;
  },
  apply(draft, actor, { cardId }, ctx) {
    const turn = activeTurn(draft);
    const terms = openTerms(draft, actor, cardId)!;
    const card = getProjectCard(cardId);
    if (terms.ap > 0) {
      turn.apLeft -= terms.ap;
      emit(draft, ctx, { playerId: actor, kind: 'ap', delta: -terms.ap, cause: '프로젝트 개설' });
    }
    payVoluntary(draft, ctx, getPlayer(draft, actor), terms.cost, `${card.title} 개설`);
    draft.market.splice(draft.market.indexOf(cardId), 1);
    const instanceId = `proj-${draft.nextId++}`;
    draft.projects.push({
      instanceId,
      cardId,
      openerId: actor,
      baseCost: card.cost,
      paidCost: terms.cost,
      openedRound: draft.round,
      maturityRound: draft.round + card.duration - 1,
      shares: { [actor]: 4 },
    });
    turn.counts.open += 1;
    delete turn.modifiers.openGrant;
    emit(draft, ctx, {
      playerId: actor,
      kind: 'project',
      cause: `${card.title} 개설 (실제 지출 ${terms.cost}, 만기 ${draft.round + card.duration - 1}라운드)`,
    });
  },
};

/** 제안 단계에서 쓰는 규칙 검사 (수락 직전 재검증과 공유) */
function checkSale(state: GameState, sellerId: PlayerId, projectId: string, count: number, pricePerShare: number): string | null {
  if (state.round === RULES.rounds) return 'NO_TRADE_FINAL_ROUND'; // E20
  const project = state.projects.find((p) => p.instanceId === projectId);
  if (!project) return 'UNKNOWN_PROJECT';
  if (project.openerId !== sellerId) return 'NOT_OPENER'; // E15
  if (!isTradable(state, project)) return 'NOT_TRADABLE';
  if (count > sellableShares(project)) return 'NOT_ENOUGH_SHARES'; // E16
  const range = priceRange(project.baseCost); // P09: 정가 기준
  if (pricePerShare < range.min || pricePerShare > range.max) return 'PRICE_OUT_OF_RANGE'; // E17
  return null;
}

export const OFFER_SHARES: Handler<'OFFER_SHARES'> = {
  check(state, actor, { projectId, targetId, count, pricePerShare }) {
    const turn = activeTurn(state);
    if (turn.offerTargets.length >= PROJECT_RULES.offersPerTurn) return 'LIMIT_REACHED';
    if (turn.offerTargets.includes(targetId)) return 'ALREADY_OFFERED'; // E19
    return checkSale(state, actor, projectId, count, pricePerShare);
  },
  apply(draft, actor, { projectId, targetId, count, pricePerShare }, ctx) {
    const offerId = `offer-${draft.nextId++}`;
    draft.pendingOffer = { offerId, projectId, sellerId: actor, buyerId: targetId, count, pricePerShare, status: 'pending' };
    activeTurn(draft).offerTargets.push(targetId);
    const card = getProjectCard(draft.projects.find((p) => p.instanceId === projectId)!.cardId);
    emit(draft, ctx, { playerId: actor, kind: 'offer', cause: `${card.title} ${count}지분 × ${pricePerShare}를 ${targetId}에게 제안` });
  },
};

export const RESPOND_OFFER: Handler<'RESPOND_OFFER'> = {
  check(state, actor, { accept }) {
    if (!accept) return null;
    const offer = state.pendingOffer!;
    // 수락 직전 재검증 (9.5, E18)
    const buyer = findPlayer(state, actor);
    if (!buyer || buyer.cash < offer.count * offer.pricePerShare) return 'NOT_ENOUGH_CASH';
    return checkSale(state, offer.sellerId, offer.projectId, offer.count, offer.pricePerShare);
  },
  apply(draft, actor, { accept }, ctx) {
    const offer = draft.pendingOffer!;
    if (!accept) {
      offer.status = 'rejected';
      emit(draft, ctx, { playerId: actor, kind: 'offer', cause: '지분 제안 거절' });
      return;
    }
    const project = draft.projects.find((p) => p.instanceId === offer.projectId)!;
    const total = offer.count * offer.pricePerShare;
    const buyer = getPlayer(draft, actor);
    const seller = getPlayer(draft, offer.sellerId);
    const card = getProjectCard(project.cardId);
    payVoluntary(draft, ctx, buyer, total, `${card.title} 지분 매입`);
    seller.cash += total;
    emit(draft, ctx, { playerId: seller.id, kind: 'cash', delta: total, cause: `${card.title} 지분 판매` });
    project.shares[offer.sellerId] = (project.shares[offer.sellerId] ?? 0) - offer.count;
    project.shares[actor] = (project.shares[actor] ?? 0) + offer.count;
    offer.status = 'accepted';
    emit(draft, ctx, { playerId: actor, kind: 'offer', cause: `${card.title} ${offer.count}지분 매입 체결` });
  },
};
