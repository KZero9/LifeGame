// 17.2 6단계: 목표(플레이어별 덱), 종료 청산, 점수, 동점
import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../../src/engine';
import { computeResult, assetScore } from '../../src/engine/scoring';
import type { GameState, ProjectInstance } from '../../src/engine/types';
import { act, autoPickGoals, current, newGame, newGameRaw, passTurn, player, putInMarket, reason, toActions } from '../helpers';

const FOUR = [
  { name: '가', controller: 'human' as const },
  { name: '나', controller: 'ai' as const },
  { name: '다', controller: 'ai' as const },
  { name: '라', controller: 'human' as const },
];

/** 5라운드 목표 선택 대기까지 진행 */
function toRound5Picks(state: GameState): GameState {
  let s = state;
  while (!(s.round === 5 && s.pendingGoalPicks.length > 0)) {
    s = toActions(s);
    const id = current(s);
    s = act(s, id, { type: 'END_PHASE' });
    if (s.turn?.playerId === id && s.turn.phase === 'trade') s = act(s, id, { type: 'END_PHASE' });
  }
  return s;
}

function addProject(s: GameState, p: Omit<ProjectInstance, 'baseCost' | 'paidCost' | 'openedRound'> & Partial<ProjectInstance>): void {
  const deck = s.decks.project;
  const i = deck.drawPile.indexOf(p.cardId);
  if (i >= 0) deck.drawPile.splice(i, 1);
  else s.market.splice(s.market.indexOf(p.cardId), 1);
  s.projects.push({ baseCost: 6, paidCost: 6, openedRound: s.round, ...p });
}

describe('목표 받기 (10.2, E51)', () => {
  it('E51 4인 게임 시작: 플레이어마다 자기 덱에서 3장, 2장 선택, 플레이어 간 중복 허용', () => {
    const s = newGameRaw(101, FOUR);
    expect(s.status).toBe('goalPick');
    expect(s.round).toBe(0);
    expect(s.turn).toBeNull();
    expect(s.pendingGoalPicks).toHaveLength(4);
    for (const pick of s.pendingGoalPicks) {
      expect(pick).toMatchObject({ min: 2, max: 2 });
      expect(new Set(pick.offered).size).toBe(3);
      expect(player(s, pick.playerId).goalDeck.drawPile).toHaveLength(3);
    }
    // 같은 목표가 여러 플레이어에게 나올 수 있다 (6종 × 4명 = 12장 필요하지만 각자 덱이므로 가능)
    const all = s.pendingGoalPicks.flatMap((p) => p.offered);
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBeLessThan(12);
  });

  it('선택 후 1라운드가 열리고, 고르지 않은 카드는 버려 다시 나오지 않는다', () => {
    let s = newGameRaw(102, FOUR);
    expect(reason(s, s.pendingGoalPicks[0]!.playerId, { type: 'ROLL' })).toBe('GOAL_PICK_PENDING');
    const firstPick = structuredClone(s.pendingGoalPicks);
    s = autoPickGoals(s);
    expect(s).toMatchObject({ status: 'playing', round: 1 });
    for (const pick of firstPick) {
      const p = player(s, pick.playerId);
      expect(p.goals.map((g) => g.goalId)).toEqual(pick.offered.slice(0, 2));
      expect(p.goals.every((g) => g.pickedRound === 0 && g.status === 'active')).toBe(true);
      expect(p.goalDeck.discard).toEqual([pick.offered[2]]);
    }

    // 5라운드: 남은 3장 중 2장, 0~1장 추가
    s = toRound5Picks(s);
    expect(s.status).toBe('goalPick');
    expect(s.turn).toBeNull();
    for (const pick of s.pendingGoalPicks) {
      expect(pick).toMatchObject({ min: 0, max: 1 });
      expect(pick.offered).toHaveLength(2);
      const p = player(s, pick.playerId);
      for (const id of pick.offered) expect(p.goals.map((g) => g.goalId).concat(p.goalDeck.discard)).not.toContain(id);
    }
    const [a, b] = s.pendingGoalPicks as [(typeof s.pendingGoalPicks)[0], (typeof s.pendingGoalPicks)[0]];
    expect(getLegalActions(s, a.playerId)).toHaveLength(3); // 0장, 1장 × 2
    s = act(s, a.playerId, { type: 'PICK_GOALS', goalIds: [a.offered[1]!] });
    expect(player(s, a.playerId).goals.at(-1)).toMatchObject({ goalId: a.offered[1], pickedRound: 5 });
    s = act(s, b.playerId, { type: 'PICK_GOALS', goalIds: [] });
    s = autoPickGoals(s);
    expect(s.status).toBe('playing');
    expect(s.turn).toMatchObject({ playerId: s.turnOrder[0], phase: 'move' });
    for (const p of s.players) expect(p.goals.length + p.goalDeck.discard.length + p.goalDeck.drawPile.length).toBe(6);
  });

  it('E31 이미 3장이면 5라운드에 추가할 수 없다', () => {
    let s = newGame(103);
    const id = s.turnOrder[0]!;
    player(s, id).goals.push({ goalId: player(s, id).goalDeck.drawPile[0]!, pickedRound: 0, countedProjectIds: [], status: 'active' });
    player(s, id).goalDeck.drawPile.shift();
    s = toRound5Picks(s);
    expect(s.pendingGoalPicks.some((p) => p.playerId === id)).toBe(false);
    expect(reason(s, id, { type: 'PICK_GOALS', goalIds: [] })).toBe('NO_GOAL_PICK');
  });
});

describe('누적형·유지형 목표 (10.1, 10.3)', () => {
  it('E29 동반자: 같은 프로젝트 지분을 두 번 사도 1개로 센다', () => {
    let s = newGame(104);
    const [a, b] = s.turnOrder as [string, string];
    player(s, b).goals = [{ goalId: 'companion', pickedRound: 0, countedProjectIds: [], status: 'active' }];
    addProject(s, { instanceId: 'x', cardId: 'cafe', openerId: a, maturityRound: 1, shares: { [a]: 2, [b]: 2 } });
    while (s.round < 2) s = passTurn(s);
    expect(player(s, b).goals[0]!.countedProjectIds).toEqual(['x']);
  });

  it('사업가: 선택 이후 자신이 개설한 프로젝트의 만기만 센다', () => {
    let s = newGame(105);
    const a = s.turnOrder[0]!;
    player(s, a).goals = [{ goalId: 'entrepreneur', pickedRound: 3, countedProjectIds: [], status: 'active' }];
    addProject(s, { instanceId: 'early', cardId: 'online-shop', openerId: a, maturityRound: 2, shares: { [a]: 4 } });
    addProject(s, { instanceId: 'late', cardId: 'cafe', openerId: a, maturityRound: 3, shares: { [a]: 4 } });
    while (s.round < 4) s = passTurn(s);
    expect(player(s, a).goals[0]!.countedProjectIds).toEqual(['late']);
  });

  it('E30 든든한 대비: 9~12라운드 ⑥ 직후 조건을 어기면 실패 저장, 회복해도 달성 안 됨', () => {
    let s = newGame(106);
    const a = s.turnOrder[0]!;
    player(s, a).goals = [{ goalId: 'prepared', pickedRound: 0, countedProjectIds: [], status: 'active' }];
    while (s.round < 9) s = passTurn(s);
    Object.assign(player(s, a), { cash: 11, debt: 0 });
    s = passTurn(s); // 생활비 3 → 현금 8 < 10 → 실패
    expect(player(s, a).goals[0]!.status).toBe('failed');
    while (current(s) !== a) s = passTurn(s);
    Object.assign(player(s, a), { cash: 30, debt: 0 });
    s = passTurn(s);
    expect(player(s, a).goals[0]!.status).toBe('failed');
  });

  it('든든한 대비: 8라운드 이전 상태는 판정하지 않는다', () => {
    let s = newGame(107);
    const a = s.turnOrder[0]!;
    player(s, a).goals = [{ goalId: 'prepared', pickedRound: 0, countedProjectIds: [], status: 'active' }];
    Object.assign(player(s, a), { cash: 0, debt: 5 });
    s = passTurn(s);
    expect(player(s, a).goals[0]!.status).toBe('active');
  });
});

describe('종료 청산과 점수 (11장)', () => {
  it('E27 자산 점수 경곗값 (11.2 표)', () => {
    const table: [number, number][] = [[-1, -1], [-2, -1], [-3, -2], [0, 0], [19, 9], [20, 10], [21, 10], [28, 12], [39, 14], [40, 15], [41, 15], [48, 16], [100, 22]];
    for (const [n, score] of table) expect(assetScore(n)).toBe(score);
  });

  it('E25 12라운드에 기간 2 프로젝트 개설 → 청산(실제 지출 기준), 목표 실적 제외', () => {
    let s = newGame(108);
    while (s.round < 12) s = passTurn(s);
    s = toActions(s);
    const a = current(s);
    putInMarket(s, 'shared-office');
    s.turn!.modifiers.openGrant = { source: 'collab', discount: 2 };
    player(s, a).goals = [{ goalId: 'entrepreneur', pickedRound: 0, countedProjectIds: [], status: 'active' }];
    player(s, a).cash = 10;
    s = act(s, a, { type: 'OPEN_PROJECT', cardId: 'shared-office' });
    expect(s.projects[0]).toMatchObject({ paidCost: 6, maturityRound: 13 });
    s = act(s, a, { type: 'END_PHASE' });
    while (s.status !== 'finished') s = passTurn(s);
    const record = s.projectHistory.find((r) => r.cardId === 'shared-office')!;
    expect(record).toMatchObject({ kind: 'liquidated', total: 3, payouts: { [a]: 3 } });
    expect(player(s, a).goals[0]!.countedProjectIds).toEqual([]);
    expect(s.projects).toHaveLength(0);
  });

  it('13.5 종료 청산: 소형 임대(실제 지출 10) 개설자 3지분·민지 1지분 → 민지 1, 하린 4, 순자산 14 → 자산 점수 7', () => {
    let s = newGame(109);
    while (s.round < 12) s = passTurn(s);
    const [harin, minji] = s.turnOrder as [string, string];
    addProject(s, { instanceId: 'r', cardId: 'rental', openerId: harin, baseCost: 10, paidCost: 10, maturityRound: 13, shares: { [harin]: 3, [minji]: 1 } });
    // 하린의 12라운드 정산 후 현금이 10이 되도록 (생활비 3)
    for (const p of s.players) Object.assign(p, { cash: 13, debt: 0, goals: [] });
    s.turn!.debtAtStart = 0; // 이미 시작한 하린 턴의 기록도 맞춘다
    const minjiBefore = 13 - 3;
    while (s.status !== 'finished') s = passTurn(s);
    expect(s.projectHistory.at(-1)).toMatchObject({ kind: 'liquidated', total: 5, payouts: { [minji]: 1, [harin]: 4 } });
    const r = s.result!.players.find((x) => x.playerId === harin)!;
    expect(r).toMatchObject({ cash: 14, debt: 0, liquidation: 4, netWorth: 14, assetScore: 7, goalScore: 0, total: 7 });
    // E26: 지분 가치를 다시 더하지 않는다
    expect(s.result!.players.find((x) => x.playerId === minji)!.netWorth).toBe(minjiBefore + 1);
  });

  it('목표 판정: 상태형은 종료 시점, 누적형은 실적 수, 유지형은 실패 여부', () => {
    const s = newGame(110);
    const [a] = s.turnOrder as [string];
    Object.assign(player(s, a), {
      skill: 6, health: 5, cash: 20, debt: 0,
      goals: [
        { goalId: 'expert', pickedRound: 0, countedProjectIds: [], status: 'active' },
        { goalId: 'healthy-old', pickedRound: 0, countedProjectIds: [], status: 'active' },
        { goalId: 'companion', pickedRound: 0, countedProjectIds: ['1', '2', '3', '4'], status: 'active' },
      ],
    });
    const r = computeResult(s, {}).players.find((x) => x.playerId === a)!;
    expect(r.goals.map((g) => [g.goalId, g.achieved])).toEqual([['expert', true], ['healthy-old', false], ['companion', true]]);
    expect(r).toMatchObject({ goalScore: 12, assetScore: 10, total: 22 });
  });

  it('E28 동점: 목표 점수 → 건강 → 공동 순위', () => {
    const s = newGame(111, FOUR);
    const [a, b, c, d] = s.turnOrder as [string, string, string, string];
    const set = (id: string, cash: number, health: number, goals: string[]) =>
      Object.assign(player(s, id), { cash, debt: 0, health, skill: 6, goals: goals.map((goalId) => ({ goalId, pickedRound: 0, countedProjectIds: [], status: 'active' as const })) });
    set(a, 20, 5, ['expert']); // 10 + 6 = 16, 목표 6
    set(b, 32, 5, []); // 자산 13 → 13? (10 + 3) = 13
    set(c, 20, 6, ['expert']); // 16, 목표 6, 건강 6
    set(d, 20, 6, ['expert']); // c와 완전 동점
    const ranks = Object.fromEntries(computeResult(s, {}).players.map((r) => [r.playerId, r.rank]));
    expect(ranks).toEqual({ [c]: 1, [d]: 1, [a]: 3, [b]: 4 });
  });

  it('한 판이 끝나면 결과가 생기고 더 이상 행동할 수 없다', () => {
    let s = newGame(112);
    while (s.status !== 'finished') s = passTurn(s);
    expect(s.result!.players).toHaveLength(3);
    expect(s.result!.players.map((r) => r.rank)[0]).toBe(1);
    expect(reason(s, s.turnOrder[0]!, { type: 'ROLL' })).toBe('GAME_FINISHED');
  });
});

