// 17.2 2단계: 턴·라운드 진행, 이동, 행동력, 생활 행동, 직업, 생활비, 노화
import { describe, expect, it } from 'vitest';
import { getLegalActions, RULES } from '../../src/engine';
import type { Action, GameState } from '../../src/engine/types';
import { act, current, me, newGame, passTurn, player, reason, toActions } from '../helpers';

const life = (action: 'work' | 'overtime' | 'study' | 'rest'): Action => ({ type: 'LIFE_ACTION', action });
const has = (s: GameState, a: Action) => getLegalActions(s, current(s)).some((x) => JSON.stringify(x) === JSON.stringify(a));

describe('이동 (3장)', () => {
  it('굴린 뒤 조정 없이 이동하면 행동력이 그대로이고 ④로 간다', () => {
    let s = newGame(1);
    const id = current(s);
    s = act(s, id, { type: 'ROLL' });
    const dice = s.turn!.dice!;
    expect(dice).toBeGreaterThanOrEqual(1);
    expect(dice).toBeLessThanOrEqual(6);
    expect(reason(s, id, { type: 'ROLL' })).toBe('ALREADY_ROLLED');
    player(s, id).position = (5 - dice + 20) % 20; // 도착 칸이 시장(빈 공개 목록)이 되게
    s = act(s, id, { type: 'ADJUST', delta: 0 });
    expect(player(s, id).position).toBe(5);
    expect(s.turn).toMatchObject({ phase: 'actions', apLeft: 3, adjusted: false });
  });

  it('굴리기 전에는 조정할 수 없다', () => {
    const s = newGame(1);
    expect(reason(s, current(s), { type: 'ADJUST', delta: 0 })).toBe('NOT_ROLLED');
  });

  it('±1 조정은 규칙 값(move.adjustAp, 시험값 2)만큼 행동력을 쓴다', () => {
    expect(RULES.move.adjustAp).toBe(2);
    const s = newGame(1);
    s.turn!.dice = 6;
    const t = act(s, current(s), { type: 'ADJUST', delta: 1 });
    expect(me(t).position).toBe(7);
    expect(t.turn).toMatchObject({ apLeft: 3 - RULES.move.adjustAp, adjusted: true });
  });

  it('E01 주사위 1에서 −1 조정은 선택지에 없다', () => {
    const s = newGame(1);
    s.turn!.dice = 1;
    expect(has(s, { type: 'ADJUST', delta: -1 })).toBe(false);
    expect(has(s, { type: 'ADJUST', delta: 0 })).toBe(true);
    expect(has(s, { type: 'ADJUST', delta: 1 })).toBe(true);
    expect(reason(s, current(s), { type: 'ADJUST', delta: -1 })).toBe('MOVE_OUT_OF_RANGE');
  });

  it('E02 행동력 0에서 이동 조정은 불가', () => {
    const s = newGame(1);
    s.turn!.dice = 3;
    s.turn!.apLeft = RULES.move.adjustAp - 1;
    expect(reason(s, current(s), { type: 'ADJUST', delta: 1 })).toBe('NO_AP');
    s.turn!.apLeft = 0;
    expect(reason(s, current(s), { type: 'ADJUST', delta: 1 })).toBe('NO_AP');
    expect(reason(s, current(s), { type: 'ADJUST', delta: -1 })).toBe('NO_AP');
    expect(reason(s, current(s), { type: 'ADJUST', delta: 0 })).toBe('OK');
  });

  it('보드는 순환한다 (출발 칸 통과 보상 없음)', () => {
    const s = newGame(1);
    me(s).position = 18;
    s.turn!.dice = 5;
    const t = act(s, current(s), { type: 'ADJUST', delta: 0 });
    expect(me(t).position).toBe(3);
    expect(me(t).cash).toBe(me(s).cash);
  });
});

describe('행동력 (4.1)', () => {
  it('턴 시작 시 건강 ≤ 3이면 행동력 2', () => {
    let s = newGame(2);
    const next = s.turnOrder[1]!;
    player(s, next).health = 3;
    s = passTurn(s);
    expect(s.turn).toMatchObject({ playerId: next, apTotal: 2, apLeft: 2 });
  });

  it('행동력이 없으면 생활 행동 불가', () => {
    const s = toActions(newGame(2));
    s.turn!.apLeft = 0;
    expect(reason(s, current(s), life('rest'))).toBe('NO_AP');
    expect(reason(s, current(s), { type: 'END_PHASE' })).toBe('OK');
  });
});

describe('생활 행동 (5장)', () => {
  it('근무: 급여는 ⑥에서 지급된다', () => {
    let s = toActions(newGame(3));
    const id = current(s);
    s = act(s, id, life('work'));
    expect(s.turn).toMatchObject({ pendingIncome: 3, workedAsJob: 'parttime', apLeft: 2 });
    expect(player(s, id).cash).toBe(10);
    s = act(s, id, { type: 'END_PHASE' });
    // 1라운드 생활비 2: 10 + 3 − 2
    expect(player(s, id).cash).toBe(11);
  });

  it('E11 근무 없이 추가근무 불가', () => {
    const s = toActions(newGame(3));
    expect(reason(s, current(s), life('overtime'))).toBe('NOT_WORKED');
  });

  it('추가근무: 직업표 수입과 건강 −1', () => {
    let s = toActions(newGame(3));
    const id = current(s);
    s = act(s, id, life('work'));
    s = act(s, id, life('overtime'));
    expect(s.turn!.pendingIncome).toBe(6);
    expect(player(s, id).health).toBe(7);
    expect(reason(s, id, life('overtime'))).toBe('LIMIT_REACHED');
  });

  it('E13 자영업 추가근무 불가', () => {
    let s = toActions(newGame(3));
    me(s).job = 'business';
    s.environment = 'normal';
    s = act(s, current(s), life('work'));
    expect(s.turn!.pendingIncome).toBe(5);
    expect(reason(s, current(s), life('overtime'))).toBe('NO_OVERTIME_JOB');
  });

  it('추가근무 불가 턴 수정자(과로 경고)', () => {
    let s = toActions(newGame(3));
    s = act(s, current(s), life('work'));
    s.turn!.modifiers.noOvertime = true;
    expect(reason(s, current(s), life('overtime'))).toBe('OVERTIME_BLOCKED');
  });

  it('무직은 근무 불가', () => {
    const s = toActions(newGame(3));
    me(s).job = 'none';
    expect(reason(s, current(s), life('work'))).toBe('NO_JOB');
  });

  it('학습: 학습비 2로 역량 +1, 기술직은 1, 역량 6이면 불가', () => {
    let s = toActions(newGame(4));
    const id = current(s);
    s = act(s, id, life('study'));
    expect(player(s, id)).toMatchObject({ skill: 2, cash: 8 });
    expect(reason(s, id, life('study'))).toBe('LIMIT_REACHED');

    let t = toActions(newGame(4));
    me(t).job = 'tech';
    me(t).skill = 3;
    t = act(t, current(t), life('study'));
    expect(me(t)).toMatchObject({ skill: 4, cash: 9 });

    const u = toActions(newGame(4));
    me(u).skill = 6;
    expect(reason(u, current(u), life('study'))).toBe('SKILL_MAX');
  });

  it('기술 전환기에는 학습비 −1 (최소 0)', () => {
    let s = toActions(newGame(4));
    s.environment = 'techTransition';
    me(s).job = 'tech';
    me(s).skill = 3;
    s = act(s, current(s), life('study'));
    expect(me(s).cash).toBe(10);
  });

  it('학습비가 없으면 불가 (자발 지출은 현금만)', () => {
    const s = toActions(newGame(4));
    me(s).cash = 1;
    expect(reason(s, current(s), life('study'))).toBe('NOT_ENOUGH_CASH');
  });

  it('E14 휴식은 턴당 2회까지', () => {
    let s = toActions(newGame(5));
    const id = current(s);
    player(s, id).health = 5;
    s = act(s, id, life('rest'));
    s = act(s, id, life('rest'));
    expect(player(s, id).health).toBe(7);
    expect(s.turn!.apLeft).toBe(1);
    expect(reason(s, id, life('rest'))).toBe('LIMIT_REACHED');
  });

  it('E38 건강 9에서 +2 → 10', () => {
    let s = toActions(newGame(5));
    const id = current(s);
    player(s, id).health = 9;
    s = act(s, id, life('rest'));
    s = act(s, id, life('rest'));
    expect(player(s, id).health).toBe(10);
  });
});

describe('직업과 구직 (5·6장)', () => {
  it('E12 근무 후 구직 불가', () => {
    let s = toActions(newGame(6));
    me(s).skill = 2;
    s = act(s, current(s), life('work'));
    expect(reason(s, current(s), { type: 'CHANGE_JOB', job: 'office' })).toBe('ALREADY_WORKED');
  });

  it('구직은 즉시 효력, 같은 턴 근무는 새 직업 급여', () => {
    let s = toActions(newGame(6));
    const id = current(s);
    player(s, id).skill = 2;
    s = act(s, id, { type: 'CHANGE_JOB', job: 'office' });
    expect(player(s, id).job).toBe('office');
    expect(s.turn!.apLeft).toBe(2);
    s = act(s, id, life('work'));
    expect(s.turn!.pendingIncome).toBe(5);
    s = act(s, id, life('overtime'));
    expect(s.turn!.pendingIncome).toBe(7);
  });

  it('조건: 역량 부족, 같은 직업, 턴당 1회', () => {
    let s = toActions(newGame(6));
    const id = current(s);
    expect(reason(s, id, { type: 'CHANGE_JOB', job: 'office' })).toBe('SKILL_REQUIRED');
    expect(reason(s, id, { type: 'CHANGE_JOB', job: 'parttime' })).toBe('SAME_JOB');
    player(s, id).skill = 3;
    s = act(s, id, { type: 'CHANGE_JOB', job: 'tech' });
    expect(reason(s, id, { type: 'CHANGE_JOB', job: 'office' })).toBe('LIMIT_REACHED');
  });

  it('자영업: 개업비 6을 현금으로', () => {
    let s = toActions(newGame(6));
    const id = current(s);
    player(s, id).cash = 5;
    expect(reason(s, id, { type: 'CHANGE_JOB', job: 'business' })).toBe('NOT_ENOUGH_CASH');
    player(s, id).cash = 6;
    s = act(s, id, { type: 'CHANGE_JOB', job: 'business' });
    expect(player(s, id)).toMatchObject({ job: 'business', cash: 0 });
  });

  it('채용 공고 수정자: 구직 행동력 0', () => {
    let s = toActions(newGame(6));
    s.turn!.modifiers.freeJobSearch = true;
    me(s).skill = 2;
    s = act(s, current(s), { type: 'CHANGE_JOB', job: 'office' });
    expect(s.turn!.apLeft).toBe(3);
  });

  it('무직에서 아르바이트로는 조건 없이 구직', () => {
    let s = toActions(newGame(6));
    me(s).job = 'none';
    me(s).skill = 0;
    s = act(s, current(s), { type: 'CHANGE_JOB', job: 'parttime' });
    expect(me(s).job).toBe('parttime');
  });

  it.each([
    ['parttime', 1, null, 3],
    ['office', 2, null, 5],
    ['tech', 3, null, 6],
    ['tech', 5, null, 6],
    ['tech', 5, 'techTransition', 3],
    ['business', 1, 'boom', 7],
    ['business', 1, 'normal', 5],
    ['business', 1, 'recession', 2],
    ['business', 1, 'techTransition', 5],
  ] as const)('급여: %s 역량 %i 환경 %s → %i', (job, skill, env, pay) => {
    let s = toActions(newGame(7));
    s.environment = env;
    me(s).job = job;
    me(s).skill = skill;
    s = act(s, current(s), life('work'));
    expect(s.turn!.pendingIncome).toBe(pay);
  });

  it('근무 급여 감소 수정자(구조조정·아르바이트 −1)', () => {
    let s = toActions(newGame(7));
    s.turn!.modifiers.workPayDelta = -1;
    s = act(s, current(s), life('work'));
    expect(s.turn!.pendingIncome).toBe(2);
  });
});

describe('정산·생활비·노화 (2.2 ⑥, 1.1)', () => {
  /** 지정 라운드의 첫 턴 상태를 만든다 */
  function atRound(round: number): GameState {
    let s = newGame(8);
    while (s.round < round) s = passTurn(s);
    for (const p of s.players) Object.assign(p, { cash: 10, debt: 0, health: 8 });
    return s;
  }

  it('턴 순서대로 진행하고 마지막 사람 뒤 다음 라운드', () => {
    let s = newGame(8);
    const order = s.turnOrder;
    for (let i = 0; i < order.length; i++) {
      expect(s).toMatchObject({ round: 1, turnIndex: i });
      expect(current(s)).toBe(order[i]);
      s = passTurn(s);
    }
    expect(s.round).toBe(2);
    expect(current(s)).toBe(order[0]);
  });

  it('청년기 생활비 2, 노화 없음', () => {
    let s = atRound(4);
    const id = current(s);
    const before = structuredClone(player(s, id));
    s = passTurn(s);
    expect(player(s, id).cash).toBe(before.cash - 2);
    expect(player(s, id).health).toBe(before.health);
  });

  it('중년기 생활비 3, 노화 −1', () => {
    let s = atRound(5);
    const id = current(s);
    const before = structuredClone(player(s, id));
    s = passTurn(s);
    expect(player(s, id).cash).toBe(before.cash - 3);
    expect(player(s, id).health).toBe(before.health - 1);
  });

  it('E06 노화로 건강 1 → 1 유지', () => {
    let s = atRound(9);
    const id = current(s);
    player(s, id).health = 1;
    s = passTurn(s);
    expect(player(s, id).health).toBe(1);
  });

  it('생활비가 현금보다 많으면 부족분은 부채', () => {
    let s = newGame(8);
    const id = current(s);
    player(s, id).cash = 1;
    s = passTurn(s);
    expect(player(s, id)).toMatchObject({ cash: 0, debt: 1 });
  });

  it('12라운드 종료 정산 직후 게임이 끝난다', () => {
    let s = newGame(8);
    let turns = 0;
    while (s.status !== 'finished') {
      s = passTurn(s);
      turns++;
    }
    expect(turns).toBe(RULES.rounds * s.players.length);
    expect(s.round).toBe(12);
    expect(s.turn).toBeNull();
    expect(getLegalActions(s, s.turnOrder[0]!)).toEqual([]);
  });
});
