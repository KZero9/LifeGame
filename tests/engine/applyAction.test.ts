import { describe, expect, it } from 'vitest';
import { applyAction, REJECT_MESSAGES } from '../../src/engine';
import { applyActionWith } from '../../src/engine/applyAction';
import type { Handler } from '../../src/engine/handlers/types';
import type { Action, GameState, ShareOffer } from '../../src/engine/types';
import { newGame, playingState } from '../helpers';

const reasonOf = (state: GameState, actor: string, action: unknown) => {
  const r = applyAction(state, actor, action as Action);
  return r.ok ? 'OK' : r.reason;
};

const offer = (s: GameState, patch: Partial<ShareOffer> = {}): ShareOffer => ({
  offerId: 'o1',
  projectId: 'proj1',
  sellerId: s.turnOrder[0]!,
  buyerId: s.turnOrder[1]!,
  count: 1,
  pricePerShare: 2,
  status: 'pending',
  ...patch,
});

describe('형식 검사', () => {
  const s = playingState('actions');
  const me = s.turnOrder[0]!;

  it.each([
    [null, 'INVALID_ACTION'],
    [undefined, 'INVALID_ACTION'],
    ['ROLL', 'INVALID_ACTION'],
    [{}, 'INVALID_ACTION'],
    [{ type: 'CHEAT' }, 'INVALID_ACTION'],
    [{ type: 'ADJUST', delta: 2 }, 'INVALID_FIELD'],
    [{ type: 'ADJUST' }, 'INVALID_FIELD'],
    [{ type: 'CHOOSE_OPTION', optionId: '' }, 'INVALID_FIELD'],
    [{ type: 'LIFE_ACTION', action: 'sleep' }, 'INVALID_FIELD'],
    [{ type: 'CHANGE_JOB', job: 'none' }, 'INVALID_FIELD'],
    [{ type: 'CHANGE_JOB', job: 'ceo' }, 'INVALID_FIELD'],
    [{ type: 'OPEN_PROJECT', cardId: 3 }, 'INVALID_FIELD'],
    [{ type: 'RESPOND_OFFER', offerId: 'o1', accept: 'yes' }, 'INVALID_FIELD'],
    [{ type: 'PICK_GOALS', goalIds: 'g1' }, 'INVALID_FIELD'],
    [{ type: 'PICK_GOALS', goalIds: ['g1', 'g1'] }, 'DUPLICATE_GOAL'],
  ])('%j → %s', (action, reason) => {
    expect(reasonOf(s, me, action)).toBe(reason);
  });

  // E41: 지분 수·가격·상환액이 0, 음수, 소수
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3'])('E41 상환액 %s 거부', (amount) => {
    expect(reasonOf(s, me, { type: 'REPAY', amount })).toBe('NOT_POSITIVE_INTEGER');
  });

  it.each([
    [0, 2],
    [-1, 2],
    [1.5, 2],
    [1, 0],
    [1, -2],
    [1, 2.5],
  ])('E41 지분 수 %s, 가격 %s 거부', (count, pricePerShare) => {
    const t = playingState('trade');
    const action = { type: 'OFFER_SHARES', projectId: 'proj1', targetId: t.turnOrder[1], count, pricePerShare };
    expect(reasonOf(t, t.turnOrder[0]!, action)).toBe('NOT_POSITIVE_INTEGER');
  });
});

describe('맥락 검사', () => {
  it('참가자가 아니면 거부', () => {
    expect(reasonOf(playingState('move'), 'p9', { type: 'ROLL' })).toBe('UNKNOWN_ACTOR');
  });

  it('시작 전·종료 후에는 거부', () => {
    const s = newGame();
    s.status = 'setup';
    s.turn = null;
    expect(reasonOf(s, s.turnOrder[0]!, { type: 'ROLL' })).toBe('GAME_NOT_STARTED');
    const f = playingState('move');
    f.status = 'finished';
    expect(reasonOf(f, f.turnOrder[0]!, { type: 'ROLL' })).toBe('GAME_FINISHED');
  });

  it('차례가 아닌 행위자는 거부', () => {
    const s = playingState('move');
    expect(reasonOf(s, s.turnOrder[1]!, { type: 'ROLL' })).toBe('NOT_YOUR_TURN');
  });

  it.each([
    ['actions', { type: 'ROLL' }],
    ['move', { type: 'END_PHASE' }],
    ['tile', { type: 'LIFE_ACTION', action: 'work' }],
    ['actions', { type: 'OFFER_SHARES', projectId: 'x', targetId: 'p2', count: 1, pricePerShare: 1 }],
    ['trade', { type: 'REPAY', amount: 1 }],
    ['start', { type: 'END_PHASE' }],
    ['settle', { type: 'END_PHASE' }],
  ] as const)('단계 %s에서 %j는 거부', (phase, action) => {
    const s = playingState(phase);
    expect(reasonOf(s, s.turnOrder[0]!, action)).toBe('WRONG_PHASE');
  });

  it('E40 자기 자신에게 지분 제안은 거부', () => {
    const s = playingState('trade');
    const me = s.turnOrder[0]!;
    expect(reasonOf(s, me, { type: 'OFFER_SHARES', projectId: 'x', targetId: me, count: 1, pricePerShare: 1 })).toBe('SELF_OFFER');
    expect(reasonOf(s, me, { type: 'OFFER_SHARES', projectId: 'x', targetId: 'p9', count: 1, pricePerShare: 1 })).toBe('UNKNOWN_TARGET');
  });

  describe('지분 제안 응답', () => {
    it('응답 대기 중에는 다른 행동을 막고, 대상만 응답할 수 있다', () => {
      const s = playingState('trade');
      s.pendingOffer = offer(s);
      const [seller, buyer, other] = s.turnOrder as [string, string, string];
      expect(reasonOf(s, seller, { type: 'END_PHASE' })).toBe('AWAITING_OFFER_RESPONSE');
      expect(reasonOf(s, other, { type: 'RESPOND_OFFER', offerId: 'o1', accept: true })).toBe('NOT_OFFER_TARGET');
      expect(reasonOf(s, buyer, { type: 'RESPOND_OFFER', offerId: 'o2', accept: true })).toBe('OFFER_NOT_FOUND');
      expect(reasonOf(s, buyer, { type: 'RESPOND_OFFER', offerId: 'o1', accept: false })).toBe('OK');
    });

    it('E35 입원 중인 대상도 응답할 수 있다', () => {
      const s = playingState('trade');
      s.pendingOffer = offer(s);
      s.players.find((p) => p.id === s.turnOrder[1])!.hospitalized = true;
      expect(reasonOf(s, s.turnOrder[1]!, { type: 'RESPOND_OFFER', offerId: 'o1', accept: false })).toBe('OK');
    });

    it.each(['accepted', 'rejected', 'invalid'] as const)('E42 이미 %s인 제안에 다시 응답하면 거부', (status) => {
      const s = playingState('trade');
      s.pendingOffer = offer(s, { status });
      expect(reasonOf(s, s.turnOrder[1]!, { type: 'RESPOND_OFFER', offerId: 'o1', accept: true })).toBe('OFFER_ALREADY_RESOLVED');
      // 응답이 끝난 제안은 다른 행동을 막지 않는다
      expect(reasonOf(s, s.turnOrder[0]!, { type: 'END_PHASE' })).toBe('OK');
    });

    it('제안이 없으면 응답 거부', () => {
      const s = playingState('trade');
      expect(reasonOf(s, s.turnOrder[1]!, { type: 'RESPOND_OFFER', offerId: 'o1', accept: true })).toBe('OFFER_NOT_FOUND');
    });
  });

  describe('목표 선택', () => {
    const withPick = () => {
      const s = newGame();
      s.status = 'goalPick';
      s.pendingGoalPicks = [{ playerId: 'p1', offered: ['g1', 'g2', 'g3'], min: 2, max: 2 }];
      return s;
    };

    it('대기 중인 선택이 있으면 다른 행동을 막는다', () => {
      const s = playingState('move');
      s.pendingGoalPicks = [{ playerId: 'p1', offered: ['g1', 'g2'], min: 0, max: 1 }];
      expect(reasonOf(s, s.turnOrder[0]!, { type: 'ROLL' })).toBe('GOAL_PICK_PENDING');
    });

    it('받은 카드 안에서 정해진 장수만 고를 수 있다', () => {
      const s = withPick();
      expect(reasonOf(s, 'p2', { type: 'PICK_GOALS', goalIds: ['g1', 'g2'] })).toBe('NO_GOAL_PICK');
      expect(reasonOf(s, 'p1', { type: 'PICK_GOALS', goalIds: ['g1', 'g9'] })).toBe('GOAL_NOT_OFFERED');
      expect(reasonOf(s, 'p1', { type: 'PICK_GOALS', goalIds: ['g1'] })).toBe('GOAL_PICK_COUNT');
      expect(reasonOf(s, 'p1', { type: 'PICK_GOALS', goalIds: ['g1', 'g2', 'g3'] })).toBe('GOAL_PICK_COUNT');
      expect(reasonOf(s, 'p1', { type: 'PICK_GOALS', goalIds: ['g1', 'g2'] })).toBe('NOT_IMPLEMENTED');
    });

    it('5라운드 추가 선택은 0장도 허용된다(min 0)', () => {
      const s = playingState('move');
      s.pendingGoalPicks = [{ playerId: 'p2', offered: ['g4', 'g5'], min: 0, max: 1 }];
      expect(reasonOf(s, 'p2', { type: 'PICK_GOALS', goalIds: [] })).toBe('NOT_IMPLEMENTED');
    });
  });
});

describe('처리기 연결과 불변성', () => {
  it('처리기가 등록되지 않은 행동은 NOT_IMPLEMENTED', () => {
    const s = playingState('actions');
    expect(applyActionWith({}, s, s.turnOrder[0]!, { type: 'END_PHASE' })).toEqual({ ok: false, reason: 'NOT_IMPLEMENTED' });
  });

  it('성공하면 새 상태와 로그를 돌려주고 입력 상태는 바꾸지 않는다', () => {
    const s = playingState('actions');
    const before = structuredClone(s);
    const me = s.turnOrder[0]!;
    const repay: Handler<'REPAY'> = {
      check: () => null,
      apply(draft, actor, action, ctx) {
        const p = draft.players.find((x) => x.id === actor)!;
        p.cash -= action.amount;
        ctx.log.push({ round: draft.round, playerId: actor, kind: 'cash', delta: -action.amount, cause: '테스트 상환' });
      },
    };
    const r = applyActionWith({ REPAY: repay }, s, me, { type: 'REPAY', amount: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s).toEqual(before);
    expect(r.state).not.toBe(s);
    expect(r.state.players.find((p) => p.id === me)!.cash).toBe(7);
    expect(r.log).toHaveLength(1);
    expect(r.state.log.at(-1)).toEqual(r.log[0]);
  });

  it('규칙 검사(check)가 사유를 돌려주면 적용하지 않는다', () => {
    const s = playingState('actions');
    const before = structuredClone(s);
    let applied = false;
    const failing: Handler<'REPAY'> = {
      check: () => 'REPAY_EXCEEDS_DEBT',
      apply: () => {
        applied = true;
      },
    };
    const r = applyActionWith({ REPAY: failing }, s, s.turnOrder[0]!, { type: 'REPAY', amount: 1 });
    expect(r).toEqual({ ok: false, reason: 'REPAY_EXCEEDS_DEBT' });
    expect(applied).toBe(false);
    expect(s).toEqual(before);
  });

  it('거부할 때도 입력 상태는 바뀌지 않는다', () => {
    const s = playingState('move');
    const before = structuredClone(s);
    applyAction(s, s.turnOrder[1]!, { type: 'ROLL' });
    applyAction(s, s.turnOrder[0]!, { type: 'REPAY', amount: -5 });
    expect(s).toEqual(before);
  });

  it('모든 거부 사유에 화면 문구가 있다', () => {
    for (const [code, message] of Object.entries(REJECT_MESSAGES)) {
      expect(code).toMatch(/^[A-Z_]+$/);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
