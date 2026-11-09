// 17.2 7단계: AI 정책, 헤드리스 시뮬레이터, 시나리오 하네스
import { describe, expect, it } from 'vitest';
import { chooseAction, companionMarginal, healthValue, POLICY_VARIANTS, reserve } from '../../src/ai/policy';
import { shareValue } from '../../src/engine/projects';
import type { GameState } from '../../src/engine/types';
import { compareJobs, runScenario } from '../../src/sim/scenario';
import { MAX_DECISIONS_PER_TURN, replay, runGame } from '../../src/sim/simulate';
import { act, current, me, newGame, player, toActions } from '../helpers';

const TWO = [
  { name: 'A', controller: 'ai' as const },
  { name: 'B', controller: 'ai' as const },
];
const BASE: Record<string, number> = { 'online-shop': 4, cafe: 6, app: 7, 'shared-office': 8, rental: 10 };

interface OfferSetup {
  cardId: string;
  price: number;
  count?: number;
  round?: number;
  maturity?: number;
  buyerGoals?: string[];
  buyerShares?: number;
  counted?: string[];
  buyerCash?: number;
}

/** 판매자(현재 플레이어)의 진행 중 프로젝트를 만들고 상대에게 제안한 상태 */
function offered(opts: OfferSetup): { s: GameState; buyer: string } {
  let s = newGame(201, TWO);
  if (opts.round) s.round = opts.round;
  const seller = current(s);
  const buyer = s.turnOrder.find((id) => id !== seller)!;
  const deck = s.decks.project;
  const i = deck.drawPile.indexOf(opts.cardId);
  if (i >= 0) deck.drawPile.splice(i, 1);
  else s.market.splice(s.market.indexOf(opts.cardId), 1);
  const shares: Record<string, number> = { [seller]: 4 - (opts.buyerShares ?? 0) };
  if (opts.buyerShares) shares[buyer] = opts.buyerShares;
  s.projects.push({
    instanceId: 'p',
    cardId: opts.cardId,
    openerId: seller,
    baseCost: BASE[opts.cardId]!,
    paidCost: BASE[opts.cardId]!,
    openedRound: s.round,
    maturityRound: opts.maturity ?? s.round + 1,
    shares,
  });
  Object.assign(player(s, buyer), {
    cash: opts.buyerCash ?? 20,
    goals: (opts.buyerGoals ?? []).map((goalId) => ({ goalId, pickedRound: 0, countedProjectIds: opts.counted ?? [], status: 'active' as const })),
  });
  s = toActions(s);
  s.turn!.phase = 'trade';
  s = act(s, seller, { type: 'OFFER_SHARES', projectId: 'p', targetId: buyer, count: opts.count ?? 1, pricePerShare: opts.price });
  return { s, buyer };
}

const decide = (s: GameState, id: string) => chooseAction(s, id);

describe('AI 결정 (12장)', () => {
  it('E52 효용 있는 행동이 없으면 END_PHASE로 종료', () => {
    const s = toActions(newGame(202));
    s.turn!.apLeft = 0;
    me(s).debt = 0;
    expect(decide(s, current(s))).toEqual({ type: 'END_PHASE' });
  });

  it('행동력이 있으면 근무부터 하고, 효용이 없어지면 끝낸다 (반복 없음)', () => {
    let s = toActions(newGame(203));
    const id = current(s);
    const chosen: string[] = [];
    while (s.turn?.playerId === id) {
      const a = decide(s, id)!;
      chosen.push(a.type === 'LIFE_ACTION' ? a.action : a.type);
      s = act(s, id, a);
      expect(chosen.length).toBeLessThan(MAX_DECISIONS_PER_TURN);
    }
    expect(chosen[0]).toBe('work');
    expect(chosen).toContain('END_PHASE');
  });

  it('건강 가치: 1당 1.5, 결과 4 이하 구간은 3, 입원은 큰 손해', () => {
    expect(healthValue(6, 1)).toBe(1.5);
    expect(healthValue(3, 1)).toBe(3);
    expect(healthValue(5, -1)).toBe(-3);
    expect(healthValue(1, -1)).toBe(-11);
    expect(healthValue(10, 1)).toBe(0);
  });

  it('비상금 기준 R = 다음 생활비 + 2', () => {
    const s = newGame(204);
    expect(reserve(s)).toBe(4);
    s.round = 5;
    expect(reserve(s)).toBe(5);
  });
});

describe('AI 착취 반례 (18.2)', () => {
  it('기대 가치보다 비싼 제안(목표 가치 없음)은 거절', () => {
    const { s, buyer } = offered({ cardId: 'cafe', price: 3 });
    expect(shareValue(s, 'p', buyer, 1).expected).toBeLessThan(3);
    expect(decide(s, buyer)).toMatchObject({ type: 'RESPOND_OFFER', accept: false });
  });

  it('기대 가치 이하 가격이면 수락', () => {
    const { s, buyer } = offered({ cardId: 'rental', price: 2, maturity: 3 });
    expect(shareValue(s, 'p', buyer, 1).expected).toBeGreaterThanOrEqual(2);
    expect(decide(s, buyer)).toMatchObject({ type: 'RESPOND_OFFER', accept: true });
  });

  it('동반자 목표가 있으면 약간 비싸도 수락, 달성한 뒤에는 목표 가치 0', () => {
    const plain = offered({ cardId: 'cafe', price: 2 });
    expect(shareValue(plain.s, 'p', plain.buyer, 1).expected).toBeLessThan(2);
    expect(decide(plain.s, plain.buyer)).toMatchObject({ accept: false });
    const want = offered({ cardId: 'cafe', price: 2, buyerGoals: ['companion'] });
    expect(decide(want.s, want.buyer)).toMatchObject({ accept: true });
    const done = offered({ cardId: 'cafe', price: 2, buyerGoals: ['companion'], counted: ['a', 'b', 'c'] });
    expect(decide(done.s, done.buyer)).toMatchObject({ accept: false });
  });

  it('E29 이미 보유한 프로젝트를 추가 매입할 때는 동반자 가치 0', () => {
    const held = offered({ cardId: 'cafe', price: 2, buyerGoals: ['companion'], buyerShares: 1 });
    expect(companionMarginal(held.s, player(held.s, held.buyer), 'p')).toBe(0);
    const fresh = offered({ cardId: 'cafe', price: 2, buyerGoals: ['companion'] });
    expect(companionMarginal(fresh.s, player(fresh.s, fresh.buyer), 'p')).toBeCloseTo(0.6);
  });

  it('만기 > 12인 프로젝트는 청산 가치로 평가해 거절', () => {
    const { s, buyer } = offered({ cardId: 'rental', price: 2, round: 11, maturity: 13 });
    expect(shareValue(s, 'p', buyer, 1)).toMatchObject({ liquidationOnly: true, expected: 1 });
    expect(decide(s, buyer)).toMatchObject({ accept: false });
  });

  it('매입 후 현금이 비상금 기준보다 적으면 거절', () => {
    const { s, buyer } = offered({ cardId: 'rental', price: 2, maturity: 3, buyerCash: 5 });
    expect(decide(s, buyer)).toMatchObject({ accept: false });
  });
});

describe('헤드리스 시뮬레이터', () => {
  it.each([2, 3, 4])('%i명 AI 50판: 오류 없이 완주, 한 턴 결정 ≤ 30', (count) => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = runGame({ seed: seed * 7 + count, seats: Array.from({ length: count }, () => ({})) });
      expect(r.errors).toEqual([]);
      expect(r.state.status).toBe('finished');
    }
  });

  it('E46 같은 시드와 같은 행동 목록이면 한 판 전체가 같다 (로그 일치)', () => {
    const seats = [{}, {}, {}, {}];
    const r = runGame({ seed: 777, seats, recordActions: true });
    const again = replay(777, seats, r.actions!);
    expect(again).toEqual(r.state);
    expect(again.log).toEqual(r.state.log);
    // AI는 난수를 쓰지 않으므로 같은 시드면 같은 결과
    expect(runGame({ seed: 777, seats }).state).toEqual(r.state);
  });

  it('정책 변형 5종이 모두 완주하고, 직업 목표 정책은 그 직업에 도달한다', () => {
    const variants = Object.values(POLICY_VARIANTS);
    for (let seed = 1; seed <= 10; seed++) {
      const r = runGame({ seed, seats: variants.slice(seed % 2, (seed % 2) + 4).map((policy) => ({ policy })) });
      expect(r.errors).toEqual([]);
    }
    let reached = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = runGame({ seed, seats: [{ policy: POLICY_VARIANTS.businessProjects }, {}, {}, {}] });
      if (r.state.players[0]!.job === 'business') reached++;
    }
    expect(reached).toBeGreaterThanOrEqual(5);
  });
});

describe('시나리오 하네스', () => {
  it('직업만 바꿔 같은 시드로 비교한다', () => {
    const rows = compareJobs(31);
    expect(rows.map((r) => r.job)).toEqual(['parttime', 'office', 'tech', 'business']);
    for (const r of rows) expect(Number.isFinite(r.total)).toBe(true);
  });

  it('이동 주사위와 덱 맨 위를 고정 입력으로 주입한다', () => {
    const r = runScenario({
      seed: 5,
      seats: [{}, {}],
      subjectSeat: 0,
      script: { moveDice: { 0: [2] }, deckTops: { youth: ['emergency-youth'] } },
    });
    const subjectId = r.seatIds[0]!;
    const moves = r.state.log.filter((e) => e.playerId === subjectId && e.kind === 'move');
    expect(moves.length).toBeGreaterThan(0);
    expect(r.state.log.filter((e) => e.playerId === subjectId && e.cause === '이동 주사위')).toEqual([]);
    expect(moves.every((e) => e.delta === 1 || e.delta === 2 || e.delta === 3)).toBe(true);
  });
});
