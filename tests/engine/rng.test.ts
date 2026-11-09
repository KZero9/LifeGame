import { describe, expect, it } from 'vitest';
import {
  allStreamKeys,
  createRngState,
  deriveStreamState,
  nextInt,
  nextUint32,
  rollDie,
  RngStreams,
  shuffle,
  type RngState,
} from '../../src/engine/rng';

const KEYS = allStreamKeys(['p1', 'p2', 'p3', 'p4']);
const rolls = (rng: RngState, key: string, n: number) => Array.from({ length: n }, () => rollDie(rng, key));

describe('용도별 시드 난수 (17.3)', () => {
  it('17.3의 용도별 스트림을 모두 만든다', () => {
    expect(KEYS).toEqual(
      expect.arrayContaining([
        'turnOrder', 'deck:env', 'deck:event:youth', 'deck:event:middle', 'deck:event:senior',
        'deck:opportunity', 'deck:expense', 'deck:project', 'dice:check', 'dice:maturity',
        'dice:move:p1', 'dice:move:p4', 'deck:goal:p1', 'deck:goal:p4',
      ]),
    );
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });

  it('같은 시드는 같은 수열을 만든다', () => {
    const a = createRngState(12345, KEYS);
    const b = createRngState(12345, KEYS);
    expect(a).toEqual(b);
    for (const key of KEYS) expect(rolls(a, key, 50)).toEqual(rolls(b, key, 50));
  });

  it('다른 시드는 다른 수열을 만든다', () => {
    const a = createRngState(1, KEYS);
    const b = createRngState(2, KEYS);
    expect(rolls(a, RngStreams.move('p1'), 30)).not.toEqual(rolls(b, RngStreams.move('p1'), 30));
  });

  it('스트림끼리 초기 상태가 모두 다르다', () => {
    const rng = createRngState(7, KEYS);
    expect(new Set(Object.values(rng)).size).toBe(KEYS.length);
  });

  it('한 스트림에서 뽑아도 다른 스트림의 순서는 바뀌지 않는다', () => {
    const quiet = createRngState(99, KEYS);
    const noisy = createRngState(99, KEYS);
    // noisy 쪽에서만 p1 이동 주사위와 사건 덱 섞기를 많이 실행
    rolls(noisy, RngStreams.move('p1'), 500);
    shuffle(noisy, RngStreams.event('youth'), Array.from({ length: 12 }, (_, i) => i));
    expect(rolls(quiet, RngStreams.move('p2'), 40)).toEqual(rolls(noisy, RngStreams.move('p2'), 40));
    expect(rolls(quiet, RngStreams.maturity, 40)).toEqual(rolls(noisy, RngStreams.maturity, 40));
  });

  it('상태를 JSON으로 저장했다가 이어서 뽑아도 같은 결과다', () => {
    const live = createRngState(2026, KEYS);
    rolls(live, RngStreams.check, 17);
    const restored = JSON.parse(JSON.stringify(live)) as RngState;
    expect(rolls(restored, RngStreams.check, 30)).toEqual(rolls(live, RngStreams.check, 30));
  });

  it('알고리즘이 바뀌면 재현이 깨지므로 고정값으로 확인한다', () => {
    const rng = createRngState(12345, KEYS);
    expect(deriveStreamState(12345, 'dice:move:p1')).toBe(rng['dice:move:p1']);
    expect(rolls(rng, 'dice:move:p1', 12)).toMatchInlineSnapshot(`
      [
        2,
        1,
        6,
        5,
        4,
        5,
        3,
        6,
        5,
        2,
        2,
        6,
      ]
    `);
    expect(shuffle(rng, 'turnOrder', ['p1', 'p2', 'p3', 'p4'])).toMatchInlineSnapshot(`
      [
        "p2",
        "p4",
        "p1",
        "p3",
      ]
    `);
  });

  it('주사위는 1–6만 나오고 거의 고르게 분포한다', () => {
    const rng = createRngState(5, KEYS);
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const d = rollDie(rng, RngStreams.check);
      expect(d >= 1 && d <= 6 && Number.isInteger(d)).toBe(true);
      counts[d - 1]!++;
    }
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(n / 6 * 0.05);
  });

  it('nextInt는 범위 양 끝을 포함하고 잘못된 범위는 거부한다', () => {
    const rng = createRngState(3, KEYS);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(nextInt(rng, RngStreams.check, -2, 2));
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    expect(() => nextInt(rng, RngStreams.check, 3, 2)).toThrow();
    expect(() => nextInt(rng, RngStreams.check, 0, 1.5)).toThrow();
  });

  it('섞기는 순열을 돌려주고 입력 배열을 바꾸지 않는다', () => {
    const rng = createRngState(8, KEYS);
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const copy = input.slice();
    const out = shuffle(rng, RngStreams.project, input);
    expect(input).toEqual(copy);
    expect(out.slice().sort()).toEqual(copy);
  });

  it('잘못된 시드와 초기화되지 않은 스트림은 오류다', () => {
    expect(() => deriveStreamState(-1, 'x')).toThrow();
    expect(() => deriveStreamState(1.5, 'x')).toThrow();
    expect(() => deriveStreamState(2 ** 32, 'x')).toThrow();
    expect(() => nextUint32({}, 'missing')).toThrow();
  });
});
