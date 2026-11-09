// 무작위 합법 행동으로 여러 판을 끝까지 진행하며 불변 조건(18.2)과 재현성을 확인한다
import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/engine';
import { newGame, randomPlaythrough } from '../helpers';

describe('무작위 완주', () => {
  it.each([2, 3, 4])('%i명: 여러 시드로 끝까지 진행하고 매 행동 후 불변 조건 유지', (count) => {
    for (let seed = 1; seed <= 25; seed++) {
      const { state } = randomPlaythrough(seed * 101 + count, count);
      expect(state.status).toBe('finished');
      expect(state.round).toBe(12);
    }
  });

  it('같은 시드와 같은 행동 목록이면 결과와 로그가 같다', () => {
    const { state, actions } = randomPlaythrough(4242, 4);
    const players = state.players.map((p) => ({ name: p.name, controller: p.controller }));
    let replay = newGame(4242, players);
    for (const [actor, action] of actions) {
      const r = applyAction(replay, actor, action);
      if (!r.ok) throw new Error(r.reason);
      replay = r.state;
    }
    expect(replay).toEqual(state);
  });
});
