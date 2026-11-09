// 카드 데이터 로더와 검사 (DESIGN_PHASE3.md 8.1, 15장)

import cardsJson from '../data/cards.json';
import { environmentCard } from './data';
import type { CardOption, Condition, EventCard, GameState, Job, PlayerState, Stage } from './types';

export interface CardData {
  decks: Record<Stage | 'opportunity' | 'expense', string[]>;
  cards: EventCard[];
}

const JOBS: readonly Job[] = ['none', 'parttime', 'office', 'tech', 'business'];
const EFFECT_KINDS = new Set(['cash', 'health', 'skill', 'ap', 'setJob', 'restorePreviousJob', 'modifier', 'grantOpen']);
const CONDITION_KINDS = new Set(['job', 'healthAtMost', 'healthAtLeast', 'skillAtLeast', 'skillAtMost', 'cashAtLeast', 'marketNotEmpty']);
const MODIFIER_KEYS = new Set(['noOvertime', 'freeJobSearch', 'workPayDelta']);

const nonNegInt = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0);

/** 8.1 데이터 규칙 검사. 오류 문구 목록을 돌려준다 */
export function validateCardData(data: CardData): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const card of data.cards) {
    const at = `카드 ${card.id}`;
    if (ids.has(card.id)) errors.push(`${at}: id 중복`);
    ids.add(card.id);
    for (const c of card.appliesIf ?? []) if (!CONDITION_KINDS.has(c.kind)) errors.push(`${at}: 알 수 없는 조건 ${c.kind}`);

    const branchKeys = Object.keys(card.branches);
    if (branchKeys.length === 0) errors.push(`${at}: 분기 없음`);
    if (card.check) {
      for (const [job, target] of Object.entries(card.check.byJob)) {
        if (!JOBS.includes(job as Job)) errors.push(`${at}: 알 수 없는 직업 ${job}`);
        const targets = typeof target === 'string' ? [target] : target ? [target.roll.success, target.roll.fail] : [];
        if (typeof target === 'object' && target && (target.roll.atLeast < 1 || target.roll.atLeast > 6)) errors.push(`${at}: 판정 값 범위 밖`);
        for (const t of targets) if (!card.branches[t]) errors.push(`${at}: 없는 분기 ${t}`);
      }
    } else if (!card.branches.default) {
      errors.push(`${at}: 판정이 없으면 default 분기가 필요`);
    }

    for (const [key, branch] of Object.entries(card.branches)) {
      const bat = `${at}/${key}`;
      for (const e of branch.autoEffects ?? []) checkEffect(e, bat, errors);
      const options = branch.options;
      if (!options) continue;
      if (options.length === 0) errors.push(`${bat}: 빈 선택지 목록`);
      const fallbacks = options.filter((o) => o.isFallback);
      if (fallbacks.length !== 1) errors.push(`${bat}: 대체 선택지가 ${fallbacks.length}개 (정확히 1개여야 함)`);
      for (const f of fallbacks) {
        if ((f.conditions?.length ?? 0) > 0 || (f.apCost ?? 0) !== 0 || (f.voluntaryCost ?? 0) !== 0 || f.envCostDelta) {
          errors.push(`${bat}: 대체 선택지 ${f.id}에 조건·행동력·자발 비용이 있음`);
        }
      }
      const optionIds = new Set<string>();
      for (const o of options) {
        if (optionIds.has(o.id)) errors.push(`${bat}: 선택지 id 중복 ${o.id}`);
        optionIds.add(o.id);
        if (!nonNegInt(o.apCost) || !nonNegInt(o.voluntaryCost) || !nonNegInt(o.forcedCost)) errors.push(`${bat}/${o.id}: 비용은 0 이상의 정수`);
        for (const c of o.conditions ?? []) if (!CONDITION_KINDS.has(c.kind)) errors.push(`${bat}/${o.id}: 알 수 없는 조건 ${c.kind}`);
        for (const e of o.effects) checkEffect(e, `${bat}/${o.id}`, errors);
        if (!o.resultText) errors.push(`${bat}/${o.id}: 결과 문구 없음`);
      }
    }
  }
  for (const [deck, list] of Object.entries(data.decks)) {
    for (const id of list) {
      const card = data.cards.find((c) => c.id === id);
      if (!card) errors.push(`덱 ${deck}: 없는 카드 ${id}`);
      else {
        const expected = deck === 'opportunity' || deck === 'expense' ? deck : 'event';
        if (card.deck !== expected) errors.push(`덱 ${deck}: 카드 ${id}의 종류가 ${card.deck}`);
      }
    }
  }
  return errors;
}

function checkEffect(e: { kind: string } & Record<string, unknown>, at: string, errors: string[]): void {
  if (!EFFECT_KINDS.has(e.kind)) errors.push(`${at}: 알 수 없는 효과 ${e.kind}`);
  if (e.kind === 'modifier' && !MODIFIER_KEYS.has(String(e.key))) errors.push(`${at}: 알 수 없는 수정자 ${String(e.key)}`);
  if (e.kind === 'setJob' && !JOBS.includes(e.job as Job)) errors.push(`${at}: 알 수 없는 직업 ${String(e.job)}`);
}

export const CARD_DATA = cardsJson as unknown as CardData;
const loadErrors = validateCardData(CARD_DATA);
if (loadErrors.length > 0) throw new Error(`카드 데이터 오류:\n${loadErrors.join('\n')}`);

const CARD_INDEX = new Map(CARD_DATA.cards.map((c) => [c.id, c]));
export const REST_CARD_ID = 'rest-tile';

export function getCard(id: string): EventCard {
  const card = CARD_INDEX.get(id);
  if (!card) throw new Error(`없는 카드: ${id}`);
  return card;
}

export function conditionMet(state: GameState, p: PlayerState, c: Condition): boolean {
  switch (c.kind) {
    case 'job':
      return c.in.includes(p.job);
    case 'healthAtMost':
      return p.health <= c.value;
    case 'healthAtLeast':
      return p.health >= c.value;
    case 'skillAtLeast':
      return p.skill >= c.value;
    case 'skillAtMost':
      return p.skill <= c.value;
    case 'cashAtLeast':
      return p.cash >= c.value;
    case 'marketNotEmpty':
      return state.market.length > 0;
  }
}

export const allConditionsMet = (state: GameState, p: PlayerState, cs: readonly Condition[] | undefined) =>
  (cs ?? []).every((c) => conditionMet(state, p, c));

/** 선택지의 자발 비용 (환경 보정 포함) */
export function optionVoluntaryCost(state: GameState, o: CardOption): number {
  const base = o.voluntaryCost ?? 0;
  return o.envCostDelta ? base + environmentCard(state.environment)[o.envCostDelta] : base;
}
