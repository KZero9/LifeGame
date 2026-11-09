// 칸 처리와 카드 흐름 (DESIGN_PHASE3.md 8장)
//
// 카드 처리 순서: 적용 조건 → 사전 판정 → 분기(자동 효과 → 선택지). 선택지가 있으면 CHOOSE_OPTION을 기다린다.

import { allConditionsMet, getCard, optionVoluntaryCost, REST_CARD_ID } from './cards';
import { stageRule, tileKind } from './data';
import { discard, draw, type DeckKey } from './decks';
import { enterActions, settleTurn } from './flow';
import { resolveHospitalization } from './health';
import { rollDie, RngStreams } from './rng';
import { activeTurn, changeHealth, changeSkill, emit, gainCash, getPlayer, payForced, payVoluntary, type Ctx } from './state';
import type { CardOption, Effect, EventCard, GameState, Job, PlayerState } from './types';

function deckKeyOf(state: GameState, card: EventCard): DeckKey | null {
  switch (card.deck) {
    case 'event':
      return `event:${stageRule(state.round).stage}`;
    case 'opportunity':
    case 'expense':
      return card.deck;
    case 'rest':
      return null;
  }
}

/** ③ 칸 처리 진입 */
export function enterTile(state: GameState, ctx: Ctx): void {
  const turn = activeTurn(state);
  turn.phase = 'tile';
  const p = getPlayer(state, turn.playerId);
  const kind = tileKind(p.position);
  switch (kind) {
    case 'market':
      // 8.6: 공개 프로젝트 중 1개를 이번 턴에 개설할 수 있다 (개설은 ④에서)
      if (state.market.length > 0) turn.modifiers.openGrant = { source: 'market', discount: 0 };
      emit(state, ctx, { playerId: p.id, kind: 'tile', cause: state.market.length > 0 ? '시장: 이번 턴 개설 가능' : '시장: 공개 프로젝트 없음' });
      enterActions(state);
      return;
    case 'rest':
      startCard(state, ctx, REST_CARD_ID);
      return;
    case 'event':
    case 'opportunity':
    case 'expense': {
      const key: DeckKey = kind === 'event' ? `event:${stageRule(state.round).stage}` : kind;
      const cardId = draw(state, key);
      if (!cardId) {
        emit(state, ctx, { playerId: p.id, kind: 'tile', cause: '뽑을 카드 없음' });
        enterActions(state);
        return;
      }
      startCard(state, ctx, cardId);
      return;
    }
  }
}

function startCard(state: GameState, ctx: Ctx, cardId: string): void {
  const turn = activeTurn(state);
  const p = getPlayer(state, turn.playerId);
  const card = getCard(cardId);
  emit(state, ctx, { playerId: p.id, kind: 'card', cause: card.title });

  // 1. 카드 적용 조건
  if (!allConditionsMet(state, p, card.appliesIf)) {
    emit(state, ctx, { playerId: p.id, kind: 'card', cause: `${card.title}: 해당 없음` });
    finishCard(state, ctx, card);
    return;
  }

  // 2. 사전 판정
  let branchKey = 'default';
  if (card.check) {
    const entry = card.check.byJob[p.job];
    if (entry === undefined) {
      emit(state, ctx, { playerId: p.id, kind: 'card', cause: `${card.title}: 해당 없음` });
      finishCard(state, ctx, card);
      return;
    }
    if (typeof entry === 'string') {
      branchKey = entry;
    } else {
      const d = rollDie(state.rng, RngStreams.check);
      branchKey = d >= entry.roll.atLeast ? entry.roll.success : entry.roll.fail;
      emit(state, ctx, { playerId: p.id, kind: 'dice', delta: d, cause: `${card.title} 판정 (${entry.roll.atLeast}+ 성공)` });
    }
  }
  const branch = card.branches[branchKey];
  if (!branch) throw new Error(`없는 분기: ${card.id}/${branchKey}`);
  if (branch.text) emit(state, ctx, { playerId: p.id, kind: 'card', cause: `${card.title}: ${branch.text}` });

  // 3. 자동 효과
  let previousJob: Job | undefined;
  for (const e of branch.autoEffects ?? []) {
    if (e.kind === 'setJob') previousJob = p.job;
    applyEffect(state, ctx, p, e, card.title, previousJob);
  }
  if (resolveHospitalization(state, ctx, p)) {
    finishCard(state, ctx, card, true);
    return;
  }

  // 4. 선택지
  if (branch.options && branch.options.length > 0) {
    turn.pendingTile = { cardId, branch: branchKey, optionIds: branch.options.map((o) => o.id), ...(previousJob ? { previousJob } : {}) };
    return;
  }
  finishCard(state, ctx, card);
}

function finishCard(state: GameState, ctx: Ctx, card: EventCard, hospitalized = false): void {
  const turn = activeTurn(state);
  const key = deckKeyOf(state, card);
  if (key) discard(state, key, card.id);
  delete turn.pendingTile;
  if (hospitalized) settleTurn(state, ctx);
  else enterActions(state);
}

function applyEffect(state: GameState, ctx: Ctx, p: PlayerState, e: Effect, cause: string, previousJob?: Job): void {
  const turn = activeTurn(state);
  switch (e.kind) {
    case 'cash':
      if (e.amount >= 0) gainCash(state, ctx, p, e.amount, cause);
      else payForced(state, ctx, p, -e.amount, cause);
      return;
    case 'health':
      changeHealth(state, ctx, p, e.amount, cause);
      return;
    case 'skill':
      changeSkill(state, ctx, p, e.amount, cause);
      return;
    case 'ap':
      turn.apLeft += e.amount;
      emit(state, ctx, { playerId: p.id, kind: 'ap', delta: e.amount, cause });
      return;
    case 'setJob': {
      const before = p.job;
      p.job = e.job;
      emit(state, ctx, { playerId: p.id, kind: 'job', cause: `${cause}: ${before} → ${e.job}` });
      return;
    }
    case 'restorePreviousJob': {
      const target = previousJob ?? p.job;
      p.job = target;
      emit(state, ctx, { playerId: p.id, kind: 'job', cause: `${cause}: ${target} 복귀` });
      return;
    }
    case 'modifier':
      if (e.key === 'workPayDelta') turn.modifiers.workPayDelta += Number(e.value);
      else turn.modifiers[e.key] = Boolean(e.value);
      emit(state, ctx, { playerId: p.id, kind: 'modifier', cause: `${cause}: ${e.key}` });
      return;
    case 'grantOpen':
      turn.modifiers.openGrant = { source: e.source, discount: e.discount };
      emit(state, ctx, { playerId: p.id, kind: 'modifier', cause: `${cause}: 이번 턴 개설 가능` });
      return;
  }
}

/** 대기 중인 카드의 선택지 */
export function pendingOption(state: GameState, optionId: string): { card: EventCard; option: CardOption } | null {
  const pending = state.turn?.pendingTile;
  if (!pending || !pending.optionIds.includes(optionId)) return null;
  const card = getCard(pending.cardId);
  const option = card.branches[pending.branch ?? 'default']?.options?.find((o) => o.id === optionId);
  return option ? { card, option } : null;
}

/** 선택지를 고를 수 있는지 (조건, 행동력, 자발 비용) */
export function checkOption(state: GameState, p: PlayerState, option: CardOption): string | null {
  if (!allConditionsMet(state, p, option.conditions)) return 'CONDITION_NOT_MET';
  if ((option.apCost ?? 0) > activeTurn(state).apLeft) return 'NO_AP';
  if (optionVoluntaryCost(state, option) > p.cash) return 'NOT_ENOUGH_CASH';
  return null;
}

/** 선택지 적용: 행동력 → 자발 비용 → 강제 비용 → 효과(순서대로) → 입원 판정 */
export function applyOption(state: GameState, ctx: Ctx, card: EventCard, option: CardOption): void {
  const turn = activeTurn(state);
  const p = getPlayer(state, turn.playerId);
  const previousJob = turn.pendingTile?.previousJob;
  emit(state, ctx, { playerId: p.id, kind: 'choice', cause: `${card.title}: ${option.label}` });
  const ap = option.apCost ?? 0;
  if (ap > 0) {
    turn.apLeft -= ap;
    emit(state, ctx, { playerId: p.id, kind: 'ap', delta: -ap, cause: card.title });
  }
  payVoluntary(state, ctx, p, optionVoluntaryCost(state, option), card.title);
  payForced(state, ctx, p, option.forcedCost ?? 0, card.title);
  for (const e of option.effects) applyEffect(state, ctx, p, e, card.title, previousJob);
  const hospitalized = resolveHospitalization(state, ctx, p);
  finishCard(state, ctx, card, hospitalized);
}
