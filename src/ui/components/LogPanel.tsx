import { useState } from 'react';
import type { GameState } from '../../engine/types';
import { logRows } from '../viewModel';

/** 진행 기록: 원인별 자원 변화. 라운드·플레이어로 거른다 (16장) */
export function LogPanel({ state }: { state: GameState }) {
  const [round, setRound] = useState<number | 'all'>('all');
  const [player, setPlayer] = useState<string>('all');
  const rows = logRows(state)
    .filter((r) => (round === 'all' || r.round === round) && (player === 'all' || r.playerId === player))
    .reverse();
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>진행 기록</h2>
        <div className="row">
          <select aria-label="라운드" value={String(round)} onChange={(e) => setRound(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">모든 라운드</option>
            {Array.from({ length: Math.max(1, state.round) + 1 }, (_, i) => i).map((r) => (
              <option key={r} value={r}>
                {r === 0 ? '시작' : `${r}라운드`}
              </option>
            ))}
          </select>
          <select aria-label="플레이어" value={player} onChange={(e) => setPlayer(e.target.value)}>
            <option value="all">모든 플레이어</option>
            {state.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="log" style={{ marginTop: 8 }}>
        {rows.length === 0 && <div className="muted">기록 없음</div>}
        {rows.map((r, i) => (
          <div key={i}>
            <span className="muted">{r.round}R</span> {r.name && <b>{r.name}</b>} {r.text}
          </div>
        ))}
      </div>
    </div>
  );
}
