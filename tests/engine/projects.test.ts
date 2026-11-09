// 17.2 5단계: 시장, 프로젝트 개설·할인, 지분 판매와 검증, 만기 정산, 지분 평가 함수(9.7)
import { describe, expect, it } from 'vitest';
import { getLegalActions, RULES } from '../../src/engine';
import { distribute, priceRange, shareValue } from '../../src/engine/projects';
import type { Action, GameState, ProjectInstance } from '../../src/engine/types';
import { act, current, emptyMarket, forceDie, me, newGame, passTurn, player, putInMarket, reason, startTurnWith, toActions } from '../helpers';

const TWO = [
  { name: '민지', controller: 'human' as const },
  { name: '준호', controller: 'ai' as const },
];
const life = (action: 'work' | 'overtime' | 'study' | 'rest'): Action => ({ type: 'LIFE_ACTION', action });
const open = (cardId: string): Action => ({ type: 'OPEN_PROJECT', cardId });
const end = (s: GameState) => act(s, current(s), { type: 'END_PHASE' });
const other = (s: GameState) => s.turnOrder.find((id) => id !== current(s))!;

/** 현재 플레이어가 ④에서 개설 권한(시장 칸)을 가진 상태 */
function withGrant(state: GameState, cardId: string, discount = 0, source: 'market' | 'collab' = 'market'): GameState {
  const s = toActions(state);
  putInMarket(s, cardId);
  s.turn!.modifiers.openGrant = { source, discount };
  return s;
}

/** 현재 플레이어가 cardId를 열고 ⑤ 거래 단계로 간다 */
function openAndTrade(state: GameState, cardId: string): GameState {
  let s = withGrant(state, cardId);
  s = act(s, current(s), open(cardId));
  return end(s);
}

const project = (s: GameState, i = 0): ProjectInstance => s.projects[i]!;
const offer = (s: GameState, count: number, price: number, targetId = other(s), projectId = project(s).instanceId): Action => ({
  type: 'OFFER_SHARES',
  projectId,
  targetId,
  count,
  pricePerShare: price,
});

describe('개설 (9.2)', () => {
  it('시장 칸 권한으로 개설: 행동력 0, 정가 지출, 4지분, 만기 = 개설 + 기간 − 1', () => {
    let s = withGrant(newGame(61), 'cafe');
    const id = current(s);
    s = act(s, id, open('cafe'));
    expect(player(s, id).cash).toBe(4);
    expect(s.turn!.apLeft).toBe(3);
    expect(project(s)).toMatchObject({ cardId: 'cafe', openerId: id, baseCost: 6, paidCost: 6, openedRound: 1, maturityRound: 2, shares: { [id]: 4 } });
    expect(s.market).not.toContain('cafe');
    expect(s.turn!.modifiers.openGrant).toBeUndefined();
    expect(reason(s, id, open(s.market[0]!))).toBe('LIMIT_REACHED');
  });

  it('권한이 없으면 자영업만 개설 행동(행동력 1)으로 개설', () => {
    const s = toActions(newGame(62));
    const cardId = s.market[0]!;
    expect(reason(s, current(s), open(cardId))).toBe('NO_OPEN_RIGHT');
    me(s).job = 'business';
    me(s).cash = 20;
    const t = act(s, current(s), open(cardId));
    expect(t.turn!.apLeft).toBe(2);
  });

  it('E45 할인 개설: 실제 지출만 낮아지고 가격 범위는 정가 기준, 카드 재등장 시 정가', () => {
    let s = withGrant(newGame(63), 'shared-office', 2, 'collab');
    s = act(s, current(s), open('shared-office'));
    expect(project(s)).toMatchObject({ baseCost: 8, paidCost: 6 });
    expect(priceRange(project(s).baseCost)).toEqual({ min: 1, max: 3 });
    // 같은 카드의 다른 장을 권한 없이(자영업) 열면 정가
    let t = toActions(s);
    t = structuredClone(t);
    t.turn!.counts.open = 0;
    me(t).job = 'business';
    me(t).cash = 20;
    putInMarket(t, 'shared-office');
    t = act(t, current(t), open('shared-office'));
    expect(project(t, 1)).toMatchObject({ baseCost: 8, paidCost: 8 });
  });

  it('협업 할인은 최소 1', () => {
    let s = withGrant(newGame(63), 'online-shop', 5, 'collab');
    s = act(s, current(s), open('online-shop'));
    expect(project(s).paidCost).toBe(1);
  });

  it('E36 개설자로서 진행 중 프로젝트 2개면 개설 불가', () => {
    const s = withGrant(newGame(64), 'rental');
    const id = current(s);
    const mk = (n: number): ProjectInstance => ({
      instanceId: `x${n}`, cardId: 'online-shop', openerId: id, baseCost: 4, paidCost: 4, openedRound: 1, maturityRound: 5, shares: { [id]: 4 },
    });
    // 카드 장수를 맞추려고 덱에서 두 장을 뺀다
    const deck = s.decks.project;
    for (let i = 0; i < 2; i++) deck.drawPile.splice(deck.drawPile.indexOf('online-shop'), 1);
    s.projects.push(mk(1), mk(2));
    expect(reason(s, id, open('rental'))).toBe('PROJECT_LIMIT');
  });

  it('자발 지출이므로 현금이 모자라면 개설 불가', () => {
    const s = withGrant(newGame(65), 'rental');
    me(s).cash = 9;
    expect(reason(s, current(s), open('rental'))).toBe('NOT_ENOUGH_CASH');
  });

  it('E32 시장 공개 카드가 0장이면 시장 칸에서 개설 선택지 없음', () => {
    let s = newGame(66);
    emptyMarket(s);
    me(s).position = 4;
    s.turn!.dice = 1;
    s = act(s, current(s), { type: 'ADJUST', delta: 0 });
    expect(getLegalActions(s, current(s)).some((a) => a.type === 'OPEN_PROJECT')).toBe(false);
  });
});

describe('지분 판매 (9.5)', () => {
  it('제안 → 수락: 현금과 지분을 한 번에 옮긴다', () => {
    let s = openAndTrade(newGame(70), 'shared-office');
    const seller = current(s);
    const buyer = other(s);
    const before = player(s, seller).cash + player(s, buyer).cash;
    s = act(s, seller, offer(s, 2, 2, buyer));
    expect(reason(s, seller, { type: 'END_PHASE' })).toBe('AWAITING_OFFER_RESPONSE');
    s = act(s, buyer, { type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: true });
    expect(project(s).shares).toEqual({ [seller]: 2, [buyer]: 2 });
    expect(player(s, seller).cash + player(s, buyer).cash).toBe(before);
    expect(s.pendingOffer!.status).toBe('accepted');
  });

  it('거절: 변화 없음, 같은 대상에게 다시 제안 불가(E19), 다른 대상에게는 가능', () => {
    let s = openAndTrade(newGame(71, [...TWO, { name: '지수', controller: 'human' }]), 'cafe');
    const seller = current(s);
    const [b1, b2] = s.turnOrder.filter((id) => id !== seller) as [string, string];
    s = act(s, seller, offer(s, 1, 2, b1));
    s = act(s, b1, { type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: false });
    expect(project(s).shares).toEqual({ [seller]: 4 });
    expect(reason(s, seller, offer(s, 1, 2, b1))).toBe('ALREADY_OFFERED');
    s = act(s, seller, offer(s, 1, 2, b2));
    s = act(s, b2, { type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: false });
    expect(s.turn!.offerTargets).toEqual([b1, b2]);
  });

  it('턴당 2건까지', () => {
    let s = openAndTrade(newGame(72, [...TWO, { name: '지수', controller: 'human' }, { name: '하린', controller: 'ai' }]), 'cafe');
    const seller = current(s);
    const buyers = s.turnOrder.filter((id) => id !== seller);
    for (const b of buyers.slice(0, 2)) {
      s = act(s, seller, offer(s, 1, 2, b));
      s = act(s, b, { type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: false });
    }
    expect(reason(s, seller, offer(s, 1, 2, buyers[2]))).toBe('LIMIT_REACHED');
  });

  it('E15 매입한 지분은 되팔 수 없다', () => {
    let s = openAndTrade(newGame(73, [...TWO, { name: '지수', controller: 'human' }]), 'cafe');
    const seller = current(s);
    const buyer = other(s);
    s = act(s, seller, offer(s, 1, 2, buyer));
    s = act(s, buyer, { type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: true });
    s = end(s); // 판매자 턴 종료 → 다음 사람 턴
    while (current(s) !== buyer) s = passTurn(s);
    s = toActions(s);
    s.turn!.phase = 'trade';
    const third = s.turnOrder.find((id) => id !== seller && id !== buyer)!;
    expect(reason(s, buyer, offer(s, 1, 2, third))).toBe('NOT_OPENER');
  });

  it('E16 개설자의 4지분 판매 → 최대 3', () => {
    const s = openAndTrade(newGame(74), 'cafe');
    expect(reason(s, current(s), offer(s, 4, 2))).toBe('NOT_ENOUGH_SHARES');
    expect(reason(s, current(s), offer(s, 3, 2))).toBe('OK');
  });

  it('E17 가격 범위 밖 제안 거부 (정가 6 → 1~3, 정가 10 → 2~4)', () => {
    const s = openAndTrade(newGame(75), 'cafe');
    expect(reason(s, current(s), offer(s, 1, 4))).toBe('PRICE_OUT_OF_RANGE');
    expect(priceRange(6)).toEqual({ min: 1, max: 3 });
    expect(priceRange(10)).toEqual({ min: 2, max: 4 });
    expect(priceRange(4)).toEqual({ min: 1, max: 2 });
  });

  it('E18 제안 후 구매자 현금이 줄면 수락 거부, 거절은 가능', () => {
    let s = openAndTrade(newGame(76), 'shared-office');
    const buyer = other(s);
    s = act(s, current(s), offer(s, 2, 3, buyer));
    player(s, buyer).cash = 5;
    expect(reason(s, buyer, { type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: true })).toBe('NOT_ENOUGH_CASH');
    expect(getLegalActions(s, buyer)).toEqual([{ type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: false }]);
  });

  it('E20 12라운드에는 판매 제안 불가, 거래 단계를 자동으로 건너뛴다', () => {
    let s = newGame(77);
    while (s.round < 12) s = passTurn(s);
    s = withGrant(s, 'online-shop');
    const id = current(s);
    me(s).cash = 10;
    s = act(s, id, open('online-shop'));
    const probe = structuredClone(s);
    probe.turn!.phase = 'trade';
    expect(reason(probe, id, offer(probe, 1, 1))).toBe('NO_TRADE_FINAL_ROUND');
    s = end(s);
    expect(current(s)).not.toBe(id); // ⑤ 생략
  });

  it('E21 기간 1 프로젝트를 개설한 턴의 ⑤에서 판매 가능, 만기 라운드에도 거래 가능', () => {
    const s = openAndTrade(newGame(78), 'online-shop');
    expect(project(s).maturityRound).toBe(1);
    expect(s.turn!.phase).toBe('trade');
    expect(reason(s, current(s), offer(s, 1, 1))).toBe('OK');
  });

  it('제안할 것이 없으면 ⑤를 자동으로 건너뛴다', () => {
    let s = toActions(newGame(79));
    const id = current(s);
    s = end(s);
    expect(current(s)).not.toBe(id);
  });

  it('E35 입원 중인 대상도 응답(수락)할 수 있다', () => {
    let s = openAndTrade(newGame(80), 'cafe');
    const buyer = other(s);
    Object.assign(player(s, buyer), { hospitalized: true, health: 0 });
    s = act(s, current(s), offer(s, 1, 2, buyer));
    s = act(s, buyer, { type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: true });
    expect(project(s).shares[buyer]).toBe(1);
  });

  it('E40·E41·E42 자기 자신, 잘못된 수치, 이미 응답한 제안', () => {
    let s = openAndTrade(newGame(81), 'cafe');
    const seller = current(s);
    const buyer = other(s);
    expect(reason(s, seller, offer(s, 1, 2, seller))).toBe('SELF_OFFER');
    expect(reason(s, seller, offer(s, 0, 2))).toBe('NOT_POSITIVE_INTEGER');
    expect(reason(s, seller, offer(s, 1, 1.5))).toBe('NOT_POSITIVE_INTEGER');
    s = act(s, seller, offer(s, 1, 2, buyer));
    const offerId = s.pendingOffer!.offerId;
    s = act(s, buyer, { type: 'RESPOND_OFFER', offerId, accept: false });
    expect(reason(s, buyer, { type: 'RESPOND_OFFER', offerId, accept: true })).toBe('OFFER_ALREADY_RESOLVED');
  });
});

describe('만기 정산 (9.3, 9.4)', () => {
  it('E22 P가 음수가 되는 보정 → 0', () => {
    let s = openAndTrade(newGame(82), 'app');
    s = end(s);
    // 2라운드 만기: 환경 불황, 주사위 1–2 → 0 − 2 → 0
    while (s.round < 2) s = passTurn(s);
    s.environment = 'recession';
    forceDie(s, 'dice:maturity', (d) => d <= 2);
    while (s.round < 3) s = passTurn(s);
    const record = s.projectHistory[0]!;
    expect(record).toMatchObject({ cardId: 'app', kind: 'matured', total: 0 });
    expect(s.projects).toHaveLength(0);
  });

  it('E23 지급 배분: 타 보유자 floor, 나머지 개설자, 합계 = P', () => {
    const p: ProjectInstance = { instanceId: 'x', cardId: 'cafe', openerId: 'a', baseCost: 6, paidCost: 6, openedRound: 1, maturityRound: 2, shares: { a: 1, b: 2, c: 1 } };
    for (let total = 0; total <= 20; total++) {
      const pay = distribute(total, p);
      expect(pay.b).toBe(Math.floor((total * 2) / 4));
      expect(pay.c).toBe(Math.floor(total / 4));
      expect(pay.a! + pay.b! + pay.c!).toBe(total);
    }
  });

  it('E24 개설자가 만기 전에 자영업을 그만두면 보너스 없음 (만기 시점 판정)', () => {
    const run = (quit: boolean) => {
      let s = newGame(83);
      const id = current(s);
      Object.assign(me(s), { job: 'business', cash: 20 });
      s = openAndTrade(s, 'online-shop'); // 1라운드 만기
      s = end(s);
      if (quit) player(s, id).job = 'parttime';
      s.environment = 'normal';
      forceDie(s, 'dice:maturity', (d) => d >= 5);
      while (s.round < 2) s = passTurn(s);
      return s.projectHistory[0]!.total;
    };
    expect(run(false)).toBe(10); // 8 + 2
    expect(run(true)).toBe(8);
  });

  it('정산한 프로젝트는 즉시 제거되고 카드는 버린 더미로, 시장은 3장까지 보충', () => {
    let s = openAndTrade(newGame(84), 'online-shop');
    expect(s.market).toHaveLength(2);
    s = end(s);
    while (s.round < 2) s = passTurn(s);
    expect(s.projects).toHaveLength(0);
    expect(s.projectHistory).toHaveLength(1);
    expect(s.market).toHaveLength(3);
    expect(s.decks.project.discard).toContain('online-shop');
  });

  it('E33 프로젝트 덱과 버린 더미가 모두 비면 공개 목록이 줄어든다 (정상)', () => {
    const four = [...TWO, { name: '지수', controller: 'ai' as const }, { name: '하린', controller: 'ai' as const }];
    let s = newGame(85, four);
    const me0 = current(s);
    // 덱의 7장을 진행 중 프로젝트로 (현재 플레이어 1개, 나머지 2개씩), 만기는 12라운드
    const owners = [me0, ...s.turnOrder.filter((id) => id !== me0).flatMap((id) => [id, id])];
    s.decks.project.drawPile.splice(0).forEach((cardId, i) => {
      const owner = owners[i]!;
      s.projects.push({ instanceId: `x${i}`, cardId, openerId: owner, baseCost: 4, paidCost: 4, openedRound: 1, maturityRound: 12, shares: { [owner]: 4 } });
    });
    s = withGrant(s, s.market[0]!);
    me(s).cash = 20;
    s = act(s, me0, open(s.market[0]!));
    expect(s.market).toHaveLength(2);
    while (s.round < 2) s = passTurn(s);
    expect(s.market).toHaveLength(2);
  });
});

describe('지분 가치 평가 (9.7)', () => {
  /** 개설된 프로젝트 하나와 남은 환경 덱을 지정한 상태 */
  function valued(cardId: string, opts: { round: number; opener: 'business' | 'office'; remainingEnv: string[]; maturityInRound?: number }) {
    const s = newGame(90, TWO);
    const [a, b] = s.turnOrder as [string, string];
    s.round = opts.round;
    player(s, a).job = opts.opener;
    const card = { cafe: [6, 2], 'shared-office': [8, 2], rental: [10, 3] }[cardId as 'cafe']!;
    const deck = s.decks.project;
    deck.drawPile.splice(deck.drawPile.indexOf(cardId), 1);
    s.projects.push({
      instanceId: 'p', cardId, openerId: a, baseCost: card[0]!, paidCost: card[0]!, openedRound: opts.round,
      maturityRound: opts.maturityInRound ?? opts.round + card[1]! - 1, shares: { [a]: 4 },
    });
    // 남은 환경 덱 지정 (나머지는 버린 더미)
    const all = ['normal', 'normal', 'normal', 'boom', 'boom', 'recession', 'recession', 'techTransition'];
    for (const id of opts.remainingEnv) all.splice(all.indexOf(id), 1);
    s.environment = all.shift()!;
    s.decks.env = { drawPile: opts.remainingEnv, discard: all };
    return { s, a, b };
  }

  it('13.2 동네 카페(자영업 +2) 1지분: 보통 2, 호황 8/3, 불황 5/3, 남은 덱 기준 25/12', () => {
    const { s, b } = valued('cafe', { round: 7, opener: 'business', remainingEnv: ['normal', 'normal', 'boom', 'recession'] });
    const v = shareValue(s, 'p', b, 1);
    expect(v.byEnvironment.normal).toBeCloseTo(2);
    expect(v.byEnvironment.boom).toBeCloseTo(8 / 3);
    expect(v.byEnvironment.recession).toBeCloseTo(5 / 3);
    expect(v.expected).toBeCloseTo(25 / 12);
    expect(v.liquidationOnly).toBe(false);
  });

  it('13.1 공유 오피스 2지분 (만기 환경 보통 가정) → 14/3', () => {
    const { s, b } = valued('shared-office', { round: 5, opener: 'office', remainingEnv: ['normal'] });
    expect(shareValue(s, 'p', b, 2).expected).toBeCloseTo(14 / 3);
  });

  it('여러 지분 기대값은 보유분과 합쳐 내림한 차이 (P04)', () => {
    const { s, b } = valued('shared-office', { round: 5, opener: 'office', remainingEnv: ['normal'] });
    s.projects[0]!.shares = { [s.turnOrder[0]!]: 3, [b]: 1 };
    // q=1, k=1: E[floor(2P/4) − floor(P/4)], P = 4/10/15 → 1/3/4
    expect(shareValue(s, 'p', b, 1).expected).toBeCloseTo(8 / 3);
  });

  it('만기 라운드가 현재 라운드면 공개된 환경으로 확정', () => {
    const { s, b } = valued('cafe', { round: 7, opener: 'office', remainingEnv: ['boom'], maturityInRound: 7 });
    s.environment = 'recession';
    expect(shareValue(s, 'p', b, 1).expected).toBeCloseTo(shareValue(s, 'p', b, 1).byEnvironment.recession!);
  });

  it('남은 덱보다 먼 만기는 전체 8장 분포', () => {
    const { s, b } = valued('rental', { round: 8, opener: 'office', remainingEnv: ['boom'] });
    const v = shareValue(s, 'p', b, 1);
    const full = (3 * v.byEnvironment.normal! + 2 * v.byEnvironment.boom! + 2 * v.byEnvironment.recession! + v.byEnvironment.techTransition!) / 8;
    expect(v.expected).toBeCloseTo(full);
  });

  it('E44 11라운드에 연 기간 3 프로젝트 → 청산 배분으로 평가', () => {
    const { s, b } = valued('rental', { round: 11, opener: 'office', remainingEnv: ['boom'] });
    const v = shareValue(s, 'p', b, 1);
    expect(v.liquidationOnly).toBe(true);
    expect(v.expected).toBe(1); // floor(floor(10/2) × 1/4)
    expect(shareValue(s, 'p', b, 3).expected).toBe(3); // floor(5 × 3/4)
  });
});

describe('예시 13.1 한 턴 (거래 응답은 사람이 대신 입력)', () => {
  it('민지: 시장으로 이동 조정 → 공유 오피스 개설 → 근무·휴식 → 2지분 × 2 판매 → 정산', () => {
    // 13.1은 이동 조정 비용 1을 전제로 쓴 예시다 (현재 시험값 2)
    const saved = RULES.move.adjustAp;
    RULES.move.adjustAp = 1;
    try {
      run131();
    } finally {
      RULES.move.adjustAp = saved;
    }
  });
});

function run131() {
  {
    let s = newGame(91, TWO);
    const [minji, junho] = s.turnOrder as [string, string];
    s = startTurnWith(s, 5, { job: 'office', cash: 9, debt: 0, health: 6, skill: 3, position: 1 });
    Object.assign(player(s, junho), { job: 'business', cash: 12 });
    s.environment = 'recession';
    putInMarket(s, 'shared-office');
    expect(current(s)).toBe(minji);
    expect(s.turn!.apTotal).toBe(3);

    s.turn!.dice = 3;
    s = act(s, minji, { type: 'ADJUST', delta: 1 });
    expect(player(s, minji).position).toBe(5);
    expect(s.turn).toMatchObject({ phase: 'actions', apLeft: 2 });

    s = act(s, minji, open('shared-office'));
    expect(player(s, minji).cash).toBe(1);
    expect(project(s).maturityRound).toBe(6);

    s = act(s, minji, life('work'));
    s = act(s, minji, life('rest'));
    expect(player(s, minji).health).toBe(7);
    expect(reason(s, minji, life('study'))).toBe('NO_AP');

    s = end(s);
    expect(s.turn!.phase).toBe('trade');
    s = act(s, minji, offer(s, 2, 2, junho));
    s = act(s, junho, { type: 'RESPOND_OFFER', offerId: s.pendingOffer!.offerId, accept: true });
    expect(player(s, minji).cash).toBe(5);
    expect(player(s, junho).cash).toBe(8);

    s = end(s);
    expect(player(s, minji)).toMatchObject({ cash: 7, health: 6 });

    // 6라운드 종료 만기: 환경 보통, 주사위 3 → P = 10 → 준호 5, 민지 5
    while (s.round < 6) s = passTurn(s);
    s.environment = 'normal';
    forceDie(s, 'dice:maturity', (d) => d === 3);
    let settled = s;
    while (settled.round < 7) settled = passTurn(settled);
    const record = settled.projectHistory[0]!;
    expect(record).toMatchObject({ total: 10, payouts: { [minji]: 5, [junho]: 5 }, dice: 3 });
  }
}
