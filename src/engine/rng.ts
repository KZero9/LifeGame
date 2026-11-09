// 용도별 시드 난수 (DESIGN_PHASE3.md 17.3)
//
// 마스터 시드와 스트림 키로 스트림마다 독립된 32비트 상태를 만든다.
// 한 스트림에서 뽑아도 다른 스트림의 순서는 바뀌지 않는다.
// 상태는 GameState.rng(Record<string, number>)에 숫자로 저장되므로 JSON 직렬화와 재현이 가능하다.
//
// 아래 draw 함수들은 전달받은 rng 기록을 직접 갱신한다.
// applyAction은 입력 상태를 복제한 뒤 그 복제본에만 이 함수들을 쓴다(입력 상태는 바뀌지 않는다).

import type { PlayerId, RngStreamKey, Stage } from './types';

export type RngState = Record<RngStreamKey, number>;

/** 17.3의 용도별 스트림 키 */
export const RngStreams = {
  turnOrder: 'turnOrder',
  env: 'deck:env',
  event: (stage: Stage) => `deck:event:${stage}`,
  opportunity: 'deck:opportunity',
  expense: 'deck:expense',
  project: 'deck:project',
  check: 'dice:check',
  maturity: 'dice:maturity',
  move: (playerId: PlayerId) => `dice:move:${playerId}`,
  goal: (playerId: PlayerId) => `deck:goal:${playerId}`,
} as const;

/** 게임에 필요한 모든 스트림 키 (플레이어 수에 따라 달라짐) */
export function allStreamKeys(playerIds: readonly PlayerId[]): RngStreamKey[] {
  const stages: Stage[] = ['youth', 'middle', 'senior'];
  return [
    RngStreams.turnOrder,
    RngStreams.env,
    ...stages.map(RngStreams.event),
    RngStreams.opportunity,
    RngStreams.expense,
    RngStreams.project,
    RngStreams.check,
    RngStreams.maturity,
    ...playerIds.map(RngStreams.move),
    ...playerIds.map(RngStreams.goal),
  ];
}

export function isValidSeed(seed: unknown): seed is number {
  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}

/** FNV-1a 32비트 문자열 해시 */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** murmur3 fmix32: 비슷한 입력도 상태가 크게 달라지게 섞는다 */
function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** 마스터 시드와 스트림 키로 스트림 초기 상태를 만든다 */
export function deriveStreamState(seed: number, key: RngStreamKey): number {
  if (!isValidSeed(seed)) throw new Error(`잘못된 시드: ${String(seed)}`);
  return mix32((seed ^ mix32(hashString(key) + 0x9e3779b9)) >>> 0);
}

export function createRngState(seed: number, keys: readonly RngStreamKey[]): RngState {
  const rng: RngState = {};
  for (const key of keys) {
    if (key in rng) throw new Error(`중복된 난수 스트림: ${key}`);
    rng[key] = deriveStreamState(seed, key);
  }
  return rng;
}

/** mulberry32 한 단계. 스트림 상태를 갱신하고 32비트 부호 없는 정수를 돌려준다 */
export function nextUint32(rng: RngState, key: RngStreamKey): number {
  const current = rng[key];
  if (current === undefined) throw new Error(`초기화되지 않은 난수 스트림: ${key}`);
  const next = (current + 0x6d2b79f5) >>> 0;
  rng[key] = next;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** [min, max] 정수. 거부 표본 추출로 치우침이 없다 */
export function nextInt(rng: RngState, key: RngStreamKey, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`잘못된 범위: [${min}, ${max}]`);
  }
  const span = max - min + 1;
  if (span > 0x100000000) throw new Error('범위가 너무 큼');
  const limit = Math.floor(0x100000000 / span) * span;
  for (;;) {
    const x = nextUint32(rng, key);
    if (x < limit) return min + (x % span);
  }
}

/** 주사위 1–6 */
export function rollDie(rng: RngState, key: RngStreamKey): number {
  return nextInt(rng, key, 1, 6);
}

/** Fisher–Yates. 새 배열을 돌려주고 입력 배열은 바꾸지 않는다 */
export function shuffle<T>(rng: RngState, key: RngStreamKey, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(rng, key, 0, i);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
