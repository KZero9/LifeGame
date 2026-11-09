// 덱 뽑기·버리기 (DESIGN_PHASE3.md 7장, 8.2, E33)

import { CARD_DATA } from './cards';
import { ENVIRONMENTS } from './data';
import { projectDeckCards } from './projects';
import { RngStreams, shuffle, type RngState } from './rng';
import type { Deck, GameState, Stage } from './types';

export type DeckKey = 'env' | 'opportunity' | 'expense' | 'project' | `event:${Stage}`;

export function deckOf(state: GameState, key: DeckKey): Deck {
  if (key.startsWith('event:')) return state.decks.event[key.slice(6) as Stage];
  return state.decks[key as 'env' | 'opportunity' | 'expense' | 'project'];
}

export function streamOf(key: DeckKey): string {
  if (key.startsWith('event:')) return RngStreams.event(key.slice(6) as Stage);
  return { env: RngStreams.env, opportunity: RngStreams.opportunity, expense: RngStreams.expense, project: RngStreams.project }[
    key as 'env' | 'opportunity' | 'expense' | 'project'
  ];
}

export function newDeck(rng: RngState, key: DeckKey, cards: readonly string[]): Deck {
  return { drawPile: shuffle(rng, streamOf(key), cards), discard: [] };
}

/** 맨 위 카드를 뽑는다. 뽑을 더미가 비면 버린 더미를 섞어 쓴다. 둘 다 비면 null */
export function draw(state: GameState, key: DeckKey): string | null {
  const deck = deckOf(state, key);
  if (deck.drawPile.length === 0 && deck.discard.length > 0) {
    deck.drawPile = shuffle(state.rng, streamOf(key), deck.discard);
    deck.discard = [];
  }
  return deck.drawPile.shift() ?? null;
}

export function discard(state: GameState, key: DeckKey, cardId: string): void {
  deckOf(state, key).discard.push(cardId);
}

/** 게임 시작 시 사건·기회·지출·환경·프로젝트 덱을 섞어 만든다 */
export function initCardDecks(state: GameState): void {
  const rng = state.rng;
  state.decks.event = {
    youth: newDeck(rng, 'event:youth', CARD_DATA.decks.youth),
    middle: newDeck(rng, 'event:middle', CARD_DATA.decks.middle),
    senior: newDeck(rng, 'event:senior', CARD_DATA.decks.senior),
  };
  state.decks.opportunity = newDeck(rng, 'opportunity', CARD_DATA.decks.opportunity);
  state.decks.expense = newDeck(rng, 'expense', CARD_DATA.decks.expense);
  state.decks.env = newDeck(rng, 'env', ENVIRONMENTS.flatMap((c) => Array.from({ length: c.count }, () => c.id)));
  state.decks.project = newDeck(rng, 'project', projectDeckCards());
}
