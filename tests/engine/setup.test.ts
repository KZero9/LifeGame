import { describe, expect, it } from 'vitest';
import { createGame, START_STATE } from '../../src/engine';
import { allStreamKeys } from '../../src/engine/rng';
import { newGame, THREE_PLAYERS } from '../helpers';

describe('게임 생성 (1.2 시작 상태)', () => {
  it('시작 자원과 직업이 1.2 표와 같다', () => {
    const s = newGame();
    expect(s.players).toHaveLength(3);
    for (const p of s.players) {
      expect(p).toMatchObject({ cash: 10, debt: 0, health: 8, skill: 1, job: 'parttime', position: 0, hospitalized: false });
    }
    expect(START_STATE).toMatchObject({ cash: 10, debt: 0, health: 8, skill: 1, job: 'parttime', position: 0 });
    expect(s).toMatchObject({ round: 1, status: 'playing', turnIndex: 0, environment: null });
    expect(s.turn).toMatchObject({ playerId: s.turnOrder[0], phase: 'move', apLeft: 3 });
  });

  it('난수 스트림을 플레이어 수에 맞게 모두 초기화한다', () => {
    const s = newGame();
    expect(Object.keys(s.rng).sort()).toEqual(allStreamKeys(['p1', 'p2', 'p3']).sort());
  });

  it('턴 순서는 시드로 정해지는 순열이다', () => {
    const a = newGame(1000);
    const b = newGame(1000);
    expect(a.turnOrder).toEqual(b.turnOrder);
    expect(a.turnOrder.slice().sort()).toEqual(['p1', 'p2', 'p3']);
    const orders = new Set(Array.from({ length: 50 }, (_, i) => newGame(i).turnOrder.join(',')));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('같은 시드와 설정이면 생성 상태 전체가 같다', () => {
    expect(newGame(77)).toEqual(newGame(77));
  });

  it('상태는 JSON 왕복 후에도 같다', () => {
    const s = newGame(5);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it.each([
    [{ seed: -1, players: THREE_PLAYERS }, 'INVALID_SEED'],
    [{ seed: 1.5, players: THREE_PLAYERS }, 'INVALID_SEED'],
    [{ seed: 1, players: THREE_PLAYERS.slice(0, 1) }, 'PLAYER_COUNT'],
    [{ seed: 1, players: [...THREE_PLAYERS, ...THREE_PLAYERS] }, 'PLAYER_COUNT'],
    [{ seed: 1, players: [{ name: ' ', controller: 'human' }, THREE_PLAYERS[1]!] }, 'INVALID_NAME'],
    [{ seed: 1, players: [{ name: 'x', controller: 'robot' }, THREE_PLAYERS[1]!] }, 'INVALID_CONTROLLER'],
  ])('부적법한 설정 거부: %j → %s', (config, reason) => {
    expect(createGame(config as never)).toEqual({ ok: false, reason });
  });

  it('2명과 4명 모두 만들 수 있다', () => {
    expect(createGame({ seed: 1, players: THREE_PLAYERS.slice(0, 2) }).ok).toBe(true);
    expect(createGame({ seed: 1, players: [...THREE_PLAYERS, { name: '라', controller: 'ai' }] }).ok).toBe(true);
  });
});
