import { useState } from 'react';
import { createGame, MAX_PLAYERS, MIN_PLAYERS } from '../../engine';
import type { Controller, GameState } from '../../engine/types';

interface Seat {
  name: string;
  controller: Controller;
}

const DEFAULT_SEATS: Seat[] = [
  { name: '나', controller: 'human' },
  { name: 'AI 하나', controller: 'ai' },
  { name: 'AI 둘', controller: 'ai' },
  { name: 'AI 셋', controller: 'ai' },
];

function randomSeed(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(buf);
  return buf[0] || Math.floor(Math.random() * 0xffffffff);
}

export function SetupScreen({ onStart }: { onStart: (state: GameState) => void }) {
  const [count, setCount] = useState(4);
  const [seats, setSeats] = useState<Seat[]>(DEFAULT_SEATS);
  const [seed, setSeed] = useState('');
  const [error, setError] = useState('');

  const update = (i: number, patch: Partial<Seat>) => setSeats((list) => list.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const start = () => {
    const chosen = seats.slice(0, count);
    const seedValue = seed.trim() === '' ? randomSeed() : Number(seed);
    const r = createGame({ seed: seedValue, players: chosen });
    if (!r.ok) {
      setError({ INVALID_SEED: '시드는 0 이상 4294967295 이하의 정수여야 합니다', INVALID_NAME: '이름을 입력해 주세요', PLAYER_COUNT: '2~4명이어야 합니다' }[r.reason] ?? r.reason);
      return;
    }
    onStart(r.state);
  };

  return (
    <div className="app">
      <div className="card stack" style={{ maxWidth: 560, margin: '24px auto' }}>
        <h1>LifeGame</h1>
        <p className="muted">12라운드 동안 일하고, 배우고, 쉬고, 함께 투자해 인생 점수를 겨루는 보드게임입니다. 한 기기에서 번갈아 하고, 빈 자리는 AI가 맡습니다.</p>
        <label>
          인원
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map((n) => (
              <option key={n} value={n}>
                {n}명
              </option>
            ))}
          </select>
        </label>
        {seats.slice(0, count).map((s, i) => (
          <div className="row" key={i}>
            <span className="badge">{i + 1}번 자리</span>
            <input aria-label={`${i + 1}번 자리 이름`} value={s.name} maxLength={12} onChange={(e) => update(i, { name: e.target.value })} />
            <select aria-label={`${i + 1}번 자리 조작`} value={s.controller} onChange={(e) => update(i, { controller: e.target.value as Controller })}>
              <option value="human">사람</option>
              <option value="ai">AI</option>
            </select>
          </div>
        ))}
        <label>
          시드 (선택)
          <input value={seed} placeholder="비우면 무작위" inputMode="numeric" onChange={(e) => setSeed(e.target.value)} style={{ width: 160 }} />
        </label>
        {error && <p className="danger">{error}</p>}
        <button className="primary" onClick={start}>
          게임 시작
        </button>
        <p className="muted">턴 순서는 시작할 때 무작위로 정해집니다.</p>
      </div>
    </div>
  );
}
