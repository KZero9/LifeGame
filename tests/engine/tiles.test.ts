// 17.2 4단계: 카드 로더와 검사, 사건·기회·지출·휴식 칸, 턴 수정자, 환경 덱
import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../../src/engine';
import { CARD_DATA, getCard, validateCardData, type CardData } from '../../src/engine/cards';
import { rollDie } from '../../src/engine/rng';
import { checkOption } from '../../src/engine/tiles';
import type { Action, GameState, Stage } from '../../src/engine/types';
import { act, autoPickGoals, current, emptyMarket, me, newGame, player, putInMarket, reason, startTurnWith } from '../helpers';

const choose = (optionId: string): Action => ({ type: 'CHOOSE_OPTION', optionId });
const life = (action: 'work' | 'overtime' | 'study' | 'rest'): Action => ({ type: 'LIFE_ACTION', action });
const EVENT_TILE = 2;
const OPPORTUNITY_TILE = 1;
const EXPENSE_TILE = 3;
const REST_TILE = 10;

/** 덱 맨 위에 cardId를 올려 두고 현재 플레이어를 target 칸으로 이동시킨다 */
function landOn(state: GameState, target: number, cardId?: string, deck?: 'opportunity' | 'expense' | Stage): GameState {
  const s = structuredClone(state);
  if (cardId && deck) {
    const d = deck === 'opportunity' || deck === 'expense' ? s.decks[deck] : s.decks.event[deck];
    const all = [...d.drawPile, ...d.discard];
    all.splice(all.indexOf(cardId), 1);
    d.drawPile = [cardId, ...all];
    d.discard = [];
  }
  me(s).position = (target - 1 + 20) % 20;
  s.turn!.dice = 1;
  return act(s, current(s), { type: 'ADJUST', delta: 0 });
}

/** 사전 판정 주사위의 다음 눈이 조건을 만족하도록 난수 상태를 고른다 */
function forceCheckDie(s: GameState, wanted: (d: number) => boolean): void {
  for (let k = 0; k < 1000; k++) {
    const trial = { 'dice:check': k };
    if (wanted(rollDie(trial, 'dice:check'))) {
      s.rng['dice:check'] = k;
      return;
    }
  }
  throw new Error('원하는 주사위를 찾지 못함');
}

const options = (s: GameState) => s.turn!.pendingTile?.optionIds ?? [];

describe('카드 데이터 검사 (8.1)', () => {
  it('MVP 카드 데이터는 규칙을 만족한다', () => {
    expect(validateCardData(CARD_DATA)).toEqual([]);
    expect(CARD_DATA.decks.youth).toHaveLength(4);
    expect(CARD_DATA.decks.middle).toHaveLength(4);
    expect(CARD_DATA.decks.senior).toHaveLength(4);
    expect(CARD_DATA.decks.opportunity).toHaveLength(4);
    expect(CARD_DATA.decks.expense).toHaveLength(2);
  });

  it('대체 선택지 누락·중복·비용, 없는 분기, 알 수 없는 효과를 찾아낸다', () => {
    const bad = structuredClone(CARD_DATA) as CardData;
    const housing = bad.cards.find((c) => c.id === 'housing')!;
    housing.branches.default!.options!.find((o) => o.id === 'forced')!.isFallback = false;
    const celebration = bad.cards.find((c) => c.id === 'celebration')!;
    celebration.branches.default!.options!.find((o) => o.id === 'skip')!.voluntaryCost = 1;
    const restructure = bad.cards.find((c) => c.id === 'restructure')!;
    restructure.check!.byJob.tech = 'missing';
    const checkup = bad.cards.find((c) => c.id === 'checkup')!;
    (checkup.branches.default!.options![0]!.effects as unknown[]).push({ kind: 'teleport' });
    bad.decks.youth.push('nope');
    const errors = validateCardData(bad).join('\n');
    expect(errors).toContain('housing/default: 대체 선택지가 0개');
    expect(errors).toContain('celebration/default: 대체 선택지 skip에 조건·행동력·자발 비용이 있음');
    expect(errors).toContain('없는 분기 missing');
    expect(errors).toContain('알 수 없는 효과 teleport');
    expect(errors).toContain('없는 카드 nope');
  });
});

describe('E34 어떤 상태에서든 칸 처리', () => {
  it('모든 카드의 모든 분기에서 대체 선택지는 현금 0·행동력 0이어도 고를 수 있다', () => {
    const s = newGame(31);
    s.turn!.apLeft = 0;
    s.market = [];
    const p = me(s);
    Object.assign(p, { cash: 0, health: 0, skill: 0, job: 'none' });
    for (const card of CARD_DATA.cards) {
      for (const branch of Object.values(card.branches)) {
        if (!branch.options) continue;
        const fallback = branch.options.find((o) => o.isFallback)!;
        expect(checkOption(s, p, fallback)).toBeNull();
      }
    }
  });

  it('적용 조건 불충족이면 해당 없음으로 자동 종료 (과로 경고, 건강 8 = E49)', () => {
    let s = newGame(32);
    me(s).health = 8;
    s = landOn(s, EVENT_TILE, 'overwork', 'youth');
    expect(s.turn!.phase).toBe('actions');
    expect(s.turn!.modifiers.noOvertime).toBe(false);
    expect(s.log.some((e) => e.cause === '과로 경고: 해당 없음')).toBe(true);
    expect(s.decks.event.youth.discard).toContain('overwork');
  });

  it('선택지를 기다리는 동안에는 선택지만 합법이고, 고르면 ④로 간다', () => {
    let s = newGame(33);
    s = landOn(s, EXPENSE_TILE, 'celebration', 'expense');
    expect(s.turn!.phase).toBe('tile');
    expect(getLegalActions(s, current(s))).toEqual([choose('attend'), choose('skip')]);
    expect(reason(s, current(s), { type: 'END_PHASE' })).toBe('WRONG_PHASE');
    expect(reason(s, current(s), choose('nope'))).toBe('UNKNOWN_OPTION');
    s = act(s, current(s), choose('attend'));
    expect(s.turn!.phase).toBe('actions');
    expect(me(s)).toMatchObject({ cash: 9, health: 9 });
    expect(s.decks.expense.discard).toEqual(['celebration']);
    expect(s.turn!.pendingTile).toBeUndefined();
  });
});

describe('구조조정 (8.2, E47·E48)', () => {
  it('E48 무직 → 해당 없음', () => {
    let s = newGame(34);
    me(s).job = 'none';
    s = landOn(s, EVENT_TILE, 'restructure', 'youth');
    expect(s.turn!.phase).toBe('actions');
    expect(s.log.some((e) => e.cause === '구조조정: 해당 없음')).toBe(true);
  });

  it('아르바이트 → 이번 턴 근무 급여 −1, 선택지 없음', () => {
    let s = newGame(34);
    s.environment = 'normal';
    s = landOn(s, EVENT_TILE, 'restructure', 'youth');
    expect(s.turn!.phase).toBe('actions');
    s = act(s, current(s), life('work'));
    expect(s.turn!.pendingIncome).toBe(2);
  });

  it('E47 사무직 판정 성공 → 선택지 없이 종료', () => {
    let s = newGame(35);
    Object.assign(me(s), { job: 'office', skill: 2 });
    forceCheckDie(s, (d) => d >= 4);
    s = landOn(s, EVENT_TILE, 'restructure', 'youth');
    expect(s.turn!.phase).toBe('actions');
    expect(me(s).job).toBe('office');
  });

  it('사무직 판정 실패 → 실직 분기: 무직이 된 뒤 선택, 재취업 3으로 복귀', () => {
    let s = newGame(36);
    s.environment = 'normal';
    Object.assign(me(s), { job: 'office', skill: 2, cash: 5 });
    forceCheckDie(s, (d) => d < 4);
    s = landOn(s, EVENT_TILE, 'restructure', 'youth');
    expect(me(s).job).toBe('none');
    expect(s.turn!.pendingTile).toMatchObject({ previousJob: 'office', optionIds: ['rehire', 'stay', 'parttime'] });
    s = act(s, current(s), choose('rehire'));
    expect(me(s)).toMatchObject({ job: 'office', cash: 2 });
  });

  it('기술직 → 판정 없이 실직, 불황이면 재취업 비용 4', () => {
    let s = newGame(37);
    s.environment = 'recession';
    Object.assign(me(s), { job: 'tech', skill: 3, cash: 3 });
    s = landOn(s, EVENT_TILE, 'restructure', 'youth');
    expect(me(s).job).toBe('none');
    expect(reason(s, current(s), choose('rehire'))).toBe('NOT_ENOUGH_CASH');
    expect(getLegalActions(s, current(s))).toEqual([choose('stay'), choose('parttime')]);
    s = act(s, current(s), choose('parttime'));
    expect(me(s).job).toBe('parttime');
  });

  it('실직 후 무직 유지 → ④에서 일반 구직 가능', () => {
    let s = newGame(37);
    Object.assign(me(s), { job: 'tech', skill: 3 });
    s = landOn(s, EVENT_TILE, 'restructure', 'youth');
    s = act(s, current(s), choose('stay'));
    expect(reason(s, current(s), life('work'))).toBe('NO_JOB');
    s = act(s, current(s), { type: 'CHANGE_JOB', job: 'tech' });
    expect(me(s).job).toBe('tech');
  });

  it('자영업 → 폐업 위기: 현금 4로 유지 또는 폐업', () => {
    let s = newGame(38);
    Object.assign(me(s), { job: 'business', cash: 6 });
    s = landOn(s, EVENT_TILE, 'restructure', 'youth');
    expect(options(s)).toEqual(['keep', 'close']);
    const kept = act(s, current(s), choose('keep'));
    expect(me(kept)).toMatchObject({ job: 'business', cash: 2 });
    const closed = act(s, current(s), choose('close'));
    expect(me(closed)).toMatchObject({ job: 'none', cash: 6 });
  });
});

describe('그 밖의 사건·기회·지출 카드', () => {
  it('긴급 지출: 현금 지불 / 직접 해결(행동력 2, 건강 −1, 지출 1) / 강제 지불은 부채 허용', () => {
    let s = newGame(39);
    me(s).cash = 2;
    s = landOn(s, EVENT_TILE, 'emergency-youth', 'youth');
    expect(reason(s, current(s), choose('pay'))).toBe('NOT_ENOUGH_CASH');
    const diy = act(s, current(s), choose('diy'));
    expect(me(diy)).toMatchObject({ cash: 1, health: 7 });
    expect(diy.turn!.apLeft).toBe(1);
    const forced = act(s, current(s), choose('forced'));
    expect(me(forced)).toMatchObject({ cash: 0, debt: 1 });
  });

  it('과로 경고(건강 ≤ 4): 검진 또는 이번 턴 추가근무 불가', () => {
    let s = newGame(40);
    me(s).health = 4;
    s = landOn(s, EVENT_TILE, 'overwork', 'youth');
    const checked = act(s, current(s), choose('checkup'));
    expect(me(checked)).toMatchObject({ health: 6, cash: 8 });
    let rested = act(s, current(s), choose('rest'));
    rested = act(rested, current(rested), life('work'));
    expect(reason(rested, current(rested), life('overtime'))).toBe('OVERTIME_BLOCKED');
  });

  it('건강 악화로 건강 0 → 선택지 효과 적용 뒤 입원, ⑥으로', () => {
    let s = startTurnWith(newGame(41), 9, { health: 2, cash: 10 });
    const id = current(s);
    s = landOn(s, EVENT_TILE, 'health-decline', 'senior');
    expect(reason(s, id, choose('prevent'))).toBe('OK');
    s = act(s, id, choose('suffer'));
    expect(current(s)).not.toBe(id);
    expect(player(s, id)).toMatchObject({ hospitalized: true, health: 0, cash: 4 }); // 10 − 치료비 3 − 생활비 3
    expect(s.decks.event.senior.discard).toContain('health-decline');
  });

  it('협업 제안·투자 설명회: 시장 공개 카드가 없으면 수락 불가', () => {
    let s = newGame(42);
    emptyMarket(s);
    s = landOn(s, EVENT_TILE, 'collab', 'youth');
    expect(reason(s, current(s), choose('accept'))).toBe('CONDITION_NOT_MET');
    putInMarket(s, 'cafe');
    s = act(s, current(s), choose('accept'));
    expect(s.turn!.modifiers.openGrant).toEqual({ source: 'collab', discount: 2 });

    let t = newGame(42);
    t = landOn(t, OPPORTUNITY_TILE, 'seminar', 'opportunity');
    t = act(t, current(t), choose('attend'));
    expect(t.turn!.modifiers.openGrant).toEqual({ source: 'seminar', discount: 0 });
  });

  it('학습 기회: 행동력 1 + 현금 3으로 역량 +2 (최대 6), 기술 전환기 할인 없음', () => {
    let s = newGame(43);
    s.environment = 'techTransition';
    me(s).skill = 5;
    s = landOn(s, OPPORTUNITY_TILE, 'study-chance', 'opportunity');
    s = act(s, current(s), choose('study'));
    expect(me(s)).toMatchObject({ skill: 6, cash: 7 });
    expect(s.turn!.apLeft).toBe(2);
  });

  it('E50 채용 공고: 구직 행동력 0이지만 턴당 1회', () => {
    let s = newGame(44);
    me(s).skill = 3;
    s = landOn(s, OPPORTUNITY_TILE, 'job-posting', 'opportunity');
    s = act(s, current(s), choose('use'));
    s = act(s, current(s), { type: 'CHANGE_JOB', job: 'office' });
    expect(s.turn!.apLeft).toBe(3);
    expect(reason(s, current(s), { type: 'CHANGE_JOB', job: 'tech' })).toBe('LIMIT_REACHED');
  });

  it('건강 검진: 현금 1로 건강 +2', () => {
    let s = newGame(45);
    s = landOn(s, OPPORTUNITY_TILE, 'checkup', 'opportunity');
    s = act(s, current(s), choose('checkup'));
    expect(me(s)).toMatchObject({ cash: 9, health: 10 });
  });

  it('주거비 갱신: 이사(행동력 1, 건강 −1, 현금 1)', () => {
    let s = newGame(46);
    s = landOn(s, EXPENSE_TILE, 'housing', 'expense');
    s = act(s, current(s), choose('move'));
    expect(me(s)).toMatchObject({ cash: 9, health: 7 });
    expect(s.turn!.apLeft).toBe(2);
  });

  it('휴식 칸: 건강 +2 또는 이번 턴 행동력 +1 (덱에 들어가지 않음)', () => {
    let s = newGame(47);
    me(s).health = 5;
    s = landOn(s, REST_TILE);
    expect(options(s)).toEqual(['health', 'ap']);
    const healed = act(s, current(s), choose('health'));
    expect(me(healed).health).toBe(7);
    const boosted = act(s, current(s), choose('ap'));
    expect(boosted.turn!.apLeft).toBe(4);
    expect(boosted.turn!.apTotal).toBe(3);
  });

  it('시장 칸: 공개 프로젝트가 없으면 개설 권한 없이 ④', () => {
    let s = newGame(48);
    emptyMarket(s);
    s = landOn(s, 5);
    expect(s.turn!.phase).toBe('actions');
    expect(s.turn!.modifiers.openGrant).toBeUndefined();
  });
});

describe('덱과 환경 (7장, E33)', () => {
  it('E33 사건 덱 소진 → 버린 더미를 섞어 사용', () => {
    let s = newGame(49);
    const deck = s.decks.event.youth;
    deck.discard = [...deck.drawPile.slice(1)];
    deck.drawPile = deck.drawPile.slice(0, 1);
    const first = deck.drawPile[0]!;
    // 첫 장 처리
    s = landOn(s, EVENT_TILE);
    if (s.turn!.phase === 'tile') s = act(s, current(s), choose(getCard(s.turn!.pendingTile!.cardId).branches[s.turn!.pendingTile!.branch!]!.options!.find((o) => o.isFallback)!.id));
    expect(s.decks.event.youth.drawPile).toHaveLength(0);
    expect(s.decks.event.youth.discard).toContain(first);
    expect(s.decks.event.youth.discard).toHaveLength(4);
    // 다음 사람이 사건 칸에 서면 버린 더미 4장을 섞어 뽑는다
    s = act(s, current(s), { type: 'END_PHASE' });
    s = landOn(s, EVENT_TILE);
    // 4장을 섞어 1장을 뽑았으므로 뽑을 더미는 3장
    expect(s.decks.event.youth.drawPile).toHaveLength(3);
  });

  it('라운드마다 환경 카드 1장 공개, 8라운드 뒤 다시 섞는다 (E33 환경)', () => {
    let s = newGame(50);
    const seen: string[] = [s.environment!];
    while (s.status !== 'finished') {
      const r = s.round;
      s = passTurnSafe(s);
      if (s.round !== r && s.status !== 'finished') seen.push(s.environment!);
    }
    expect(seen).toHaveLength(12);
    const count = (list: string[], id: string) => list.filter((x) => x === id).length;
    const firstEight = seen.slice(0, 8);
    expect(count(firstEight, 'normal')).toBe(3);
    expect(count(firstEight, 'boom')).toBe(2);
    expect(count(firstEight, 'recession')).toBe(2);
    expect(count(firstEight, 'techTransition')).toBe(1);
    expect(s.decks.env.drawPile.length + s.decks.env.discard.length).toBe(8);
  });

  it('카드는 처리 후 버린 더미로 가고 덱의 총 장수는 유지된다', () => {
    let s = newGame(51);
    for (let i = 0; i < 30 && s.status !== 'finished'; i++) s = passTurnSafe(s);
    const total = (d: { drawPile: string[]; discard: string[] }) => d.drawPile.length + d.discard.length;
    expect(total(s.decks.event.youth) + total(s.decks.event.middle) + total(s.decks.event.senior)).toBe(12);
    expect(total(s.decks.opportunity)).toBe(4);
    expect(total(s.decks.expense)).toBe(2);
  });
});

/** 실제 이동으로 한 턴을 진행한다. 카드가 나오면 대체 선택지를 고른다 */
function passTurnSafe(input: GameState): GameState {
  const state = autoPickGoals(input);
  let s = act(state, current(state), { type: 'ROLL' });
  s = act(s, current(s), { type: 'ADJUST', delta: 0 });
  const id = state.turn!.playerId;
  if (s.turn?.playerId === id && s.turn.phase === 'tile') {
    const pending = s.turn.pendingTile!;
    const fallback = getCard(pending.cardId).branches[pending.branch!]!.options!.find((o) => o.isFallback)!;
    s = act(s, id, choose(fallback.id));
  }
  if (s.turn?.playerId === id && s.turn.phase === 'actions') s = act(s, id, { type: 'END_PHASE' });
  if (s.turn?.playerId === id && s.turn.phase === 'trade') s = act(s, id, { type: 'END_PHASE' });
  return autoPickGoals(s);
}

