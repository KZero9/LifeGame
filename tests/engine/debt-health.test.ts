// 17.2 3단계: 부채·이자·상환, 건강 보정, 입원·퇴원
import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../../src/engine';
import { changeHealth, type Ctx } from '../../src/engine/state';
import { resolveHospitalization } from '../../src/engine/health';
import type { Action, GameState } from '../../src/engine/types';
import { act, current, me, newGame, passTurn, player, reason, startTurnWith, toActions } from '../helpers';

const life = (action: 'work' | 'overtime' | 'study' | 'rest'): Action => ({ type: 'LIFE_ACTION', action });
const endTurn = (s: GameState) => act(s, current(s), { type: 'END_PHASE' });
const interestLogs = (s: GameState, id: string, round: number) =>
  s.log.filter((e) => e.playerId === id && e.round === round && e.kind === 'debt' && e.cause.startsWith('이자'));

describe('부채와 강제 지출 (4.3)', () => {
  it('E07 강제 지출 > 현금 → 현금 0, 부족분 부채', () => {
    let s = newGame(11);
    const id = current(s);
    player(s, id).cash = 1;
    s = passTurn(s); // 생활비 2
    expect(player(s, id)).toMatchObject({ cash: 0, debt: 1 });
  });

  it('E08 자발 지출 > 현금 → 선택 불가', () => {
    const s = toActions(newGame(11));
    me(s).cash = 1;
    expect(reason(s, current(s), life('study'))).toBe('NOT_ENOUGH_CASH');
    me(s).cash = 5;
    expect(reason(s, current(s), { type: 'CHANGE_JOB', job: 'business' })).toBe('NOT_ENOUGH_CASH');
  });
});

describe('이자 (4.3, P01)', () => {
  it.each([
    [1, 1],
    [10, 1],
    [11, 2],
    [20, 2],
    [21, 3],
  ])('E10 턴 시작 부채 %i → 이자 %i', (debt, interest) => {
    let s = startTurnWith(newGame(12), 2, { debt, cash: 10 });
    const id = current(s);
    s = toActions(s);
    s = endTurn(s);
    expect(interestLogs(s, id, 2).map((e) => e.delta)).toEqual([interest]);
    expect(player(s, id).debt).toBe(debt + interest);
  });

  it('E09 부채가 생긴 턴에는 새 부채에 이자가 없다', () => {
    let s = startTurnWith(newGame(12), 2, { debt: 0, cash: 0 });
    const id = current(s);
    s = passTurn(s); // 생활비 2가 부채가 됨
    expect(interestLogs(s, id, 2)).toEqual([]);
    expect(player(s, id).debt).toBe(2);
  });

  it('E09 턴 시작 부채 10 + 신규 5 + 상환 5 → 이자 대상 5 → 이자 1', () => {
    let s = startTurnWith(newGame(12), 2, { debt: 10, cash: 7 });
    const id = current(s);
    s = toActions(s);
    player(s, id).debt += 5; // 이번 턴에 생긴 강제 지출 부채 (칸 효과를 고정한 입력)
    s = act(s, id, { type: 'REPAY', amount: 5 });
    expect(s.turn!.repaidThisTurn).toBe(5);
    s = endTurn(s);
    expect(interestLogs(s, id, 2).map((e) => e.delta)).toEqual([1]);
  });

  it('턴 시작 부채를 모두 갚으면 이자 없음', () => {
    let s = startTurnWith(newGame(12), 2, { debt: 4, cash: 10 });
    const id = current(s);
    s = toActions(s);
    s = act(s, id, { type: 'REPAY', amount: 4 });
    s = endTurn(s);
    expect(interestLogs(s, id, 2)).toEqual([]);
    expect(player(s, id)).toMatchObject({ debt: 0, cash: 4 }); // 10 − 4 − 생활비 2
  });
});

describe('상환 (4.3)', () => {
  it('행동력 없이 여러 번 상환할 수 있다', () => {
    let s = toActions(newGame(13));
    const id = current(s);
    Object.assign(player(s, id), { cash: 5, debt: 6 });
    s = act(s, id, { type: 'REPAY', amount: 2 });
    s = act(s, id, { type: 'REPAY', amount: 3 });
    expect(player(s, id)).toMatchObject({ cash: 0, debt: 1 });
    expect(s.turn).toMatchObject({ apLeft: 3, repaidThisTurn: 5 });
  });

  it.each([0, -1, 1.5])('E41 상환액 %s 거부', (amount) => {
    const s = toActions(newGame(13));
    Object.assign(me(s), { cash: 5, debt: 5 });
    expect(reason(s, current(s), { type: 'REPAY', amount })).toBe('NOT_POSITIVE_INTEGER');
  });

  it('E43 상환액 > 현금 또는 > 부채 거부', () => {
    const s = toActions(newGame(13));
    Object.assign(me(s), { cash: 3, debt: 5 });
    expect(reason(s, current(s), { type: 'REPAY', amount: 4 })).toBe('REPAY_EXCEEDS_CASH');
    Object.assign(me(s), { cash: 9, debt: 5 });
    expect(reason(s, current(s), { type: 'REPAY', amount: 6 })).toBe('REPAY_EXCEEDS_DEBT');
    Object.assign(me(s), { cash: 9, debt: 0 });
    expect(reason(s, current(s), { type: 'REPAY', amount: 1 })).toBe('NO_DEBT');
  });

  it('상환은 ④에서만, 합법 후보는 1과 최대 금액', () => {
    const s = toActions(newGame(13));
    Object.assign(me(s), { cash: 4, debt: 6 });
    const repay = getLegalActions(s, current(s)).filter((a) => a.type === 'REPAY');
    expect(repay).toEqual([
      { type: 'REPAY', amount: 1 },
      { type: 'REPAY', amount: 4 },
    ]);
    s.turn!.phase = 'trade';
    expect(reason(s, current(s), { type: 'REPAY', amount: 1 })).toBe('WRONG_PHASE');
  });

  it('E39 다른 플레이어 턴·라운드 종료 정산 중에는 부채가 생기지 않는다', () => {
    let s = newGame(14);
    for (const p of s.players) p.cash = 0;
    const debtsBefore = () => Object.fromEntries(s.players.map((p) => [p.id, p.debt]));
    for (let i = 0; i < s.players.length * 3; i++) {
      const id = current(s);
      const before = debtsBefore();
      s = passTurn(s); // 마지막 턴이면 라운드 종료 정산과 다음 라운드 시작까지 진행
      for (const p of s.players) {
        if (p.id !== id) expect(p.debt).toBe(before[p.id]);
      }
    }
  });
});

describe('건강 보정과 입원 (4.2)', () => {
  it('E03 건강 1에서 −2 → 0으로 보정, 효과를 모두 적용한 뒤 입원, 치료비 1회', () => {
    const s = toActions(newGame(15));
    const p = me(s);
    Object.assign(p, { health: 1, cash: 1 });
    const ctx: Ctx = { log: [] };
    changeHealth(s, ctx, p, -2, '건강 악화');
    expect(p.health).toBe(0);
    expect(p.hospitalized).toBe(false); // 판정 전
    expect(resolveHospitalization(s, ctx, p)).toBe(true);
    expect(p).toMatchObject({ hospitalized: true, cash: 0, debt: 2 });
    expect(s.turn!.apLeft).toBe(0);
    expect(resolveHospitalization(s, ctx, p)).toBe(false); // 치료비 1회
    expect(p.debt).toBe(2);
  });

  it('E03 추가근무로 건강 0 → 입원, 남은 행동력 소멸, ④·⑤ 생략하고 ⑥ 진행', () => {
    let s = startTurnWith(newGame(15), 2, { health: 1, cash: 5 });
    const id = current(s);
    expect(s.turn!.apTotal).toBe(2);
    s = toActions(s);
    s.turn!.apLeft = 3; // 남은 행동력이 소멸하는지 보려고 1 더 줌
    s = act(s, id, life('work'));
    s = act(s, id, life('overtime'));
    expect(current(s)).not.toBe(id); // 턴이 끝나 다음 사람
    const p = player(s, id);
    // 5 − 치료비 3 + 수입 6 − 생활비 2 = 6, 노화 없음(청년기)
    expect(p).toMatchObject({ hospitalized: true, health: 0, cash: 6, debt: 0 });
    expect(s.log.some((e) => e.playerId === id && e.cause === '입원으로 남은 행동력 소멸')).toBe(true);
  });

  it('E04·E05 입원 중 턴: ①~⑤ 생략, 수입 0, 건강 4, 노화 없음 → 다음 턴 행동력 3', () => {
    let s = startTurnWith(newGame(16), 6, { hospitalized: true, health: 0, cash: 5, job: 'office', skill: 2 });
    // 입원한 플레이어의 턴은 자동 정산되어 이미 다음 사람 차례
    const id = s.turnOrder[0]!;
    expect(current(s)).toBe(s.turnOrder[1]);
    const p = player(s, id);
    expect(p).toMatchObject({ hospitalized: false, health: 4, cash: 2 }); // 생활비 3, 수입 0, 노화 없음
    const entries = s.log.filter((e) => e.playerId === id && e.round === 6);
    expect(entries.some((e) => e.kind === 'income' || e.cause === '근무 수입')).toBe(false);
    expect(entries.some((e) => e.cause === '노화')).toBe(false);
    // 다음 라운드 자기 턴
    while (current(s) !== id) s = passTurn(s);
    expect(s.turn).toMatchObject({ apTotal: 3, startedHospitalized: false });
  });

  it('E37 입원 중 건강 감소 효과 → 0 유지, 재진입·추가 치료비 없음', () => {
    const s = toActions(newGame(17));
    const p = player(s, s.turnOrder[1]!);
    Object.assign(p, { hospitalized: true, health: 0, cash: 10 });
    const ctx: Ctx = { log: [] };
    changeHealth(s, ctx, p, -2, '테스트');
    expect(resolveHospitalization(s, ctx, p)).toBe(false);
    expect(p).toMatchObject({ health: 0, cash: 10, hospitalized: true });
  });
});

describe('예시 (13장, 칸 효과를 고정한 입력)', () => {
  it('13.3 입원과 퇴원', () => {
    // 6라운드 · 수아: 아르바이트, 현금 2, 부채 0, 건강 1
    let s = startTurnWith(newGame(18), 6, { job: 'parttime', cash: 2, debt: 0, health: 1 });
    const sua = current(s);
    expect(s.turn).toMatchObject({ apTotal: 2, debtAtStart: 0 });
    s = toActions(s);
    s = act(s, sua, life('work'));
    s = act(s, sua, life('overtime'));
    // 입원, 치료비 3: 현금 2 → 0, 부채 1 / ⑥ 이자 없음 → 수입 6 → 생활비 3 → 현금 3
    expect(player(s, sua)).toMatchObject({ hospitalized: true, health: 0, cash: 3, debt: 1 });

    // 7라운드 수아 턴(입원 중): 이자 1 → 부채 2, 생활비 3 → 현금 0, 건강 4, 퇴원
    while (s.round < 8 && !(s.round === 7 && s.turnIndex > 0)) s = s.round === 7 ? s : passTurn(s);
    expect(s.round).toBe(7);
    expect(player(s, sua)).toMatchObject({ hospitalized: false, health: 4, cash: 0, debt: 2 });

    // 8라운드: 행동력 3, 근무·추가근무·휴식 → 건강 4 / 이자 1 → 부채 3, 현금 3, 노화 → 건강 3
    while (s.round < 8) s = passTurn(s);
    expect(current(s)).toBe(sua);
    expect(s.turn!.apTotal).toBe(3);
    s = toActions(s);
    s = act(s, sua, life('work'));
    s = act(s, sua, life('overtime'));
    s = act(s, sua, life('rest'));
    expect(player(s, sua).health).toBe(4);
    expect(reason(s, sua, { type: 'REPAY', amount: 1 })).toBe('REPAY_EXCEEDS_CASH');
    s = endTurn(s);
    expect(player(s, sua)).toMatchObject({ debt: 3, cash: 3, health: 3 });
  });

  it('13.4 부채 상환 선택: 상환 4 → 이자 대상 2 → 이자 1, 미상환 → 이자 대상 6 → 이자 1', () => {
    const start = startTurnWith(newGame(19), 9, { job: 'office', skill: 2, cash: 4, debt: 6 });
    const doyun = current(start);

    let repaid = toActions(start);
    repaid = act(repaid, doyun, { type: 'REPAY', amount: 4 });
    expect(player(repaid, doyun)).toMatchObject({ cash: 0, debt: 2 });
    repaid = endTurn(repaid);
    expect(interestLogs(repaid, doyun, 9).map((e) => e.delta)).toEqual([1]);
    expect(interestLogs(repaid, doyun, 9)[0]!.cause).toBe('이자 (대상 2)');

    const kept = endTurn(toActions(start));
    expect(interestLogs(kept, doyun, 9).map((e) => e.delta)).toEqual([1]);
    expect(interestLogs(kept, doyun, 9)[0]!.cause).toBe('이자 (대상 6)');
  });
});
