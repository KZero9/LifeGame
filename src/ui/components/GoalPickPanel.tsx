import { useState } from 'react';
import type { Action, GameState } from '../../engine/types';
import { goalPickView } from '../viewModel';

export function GoalPickPanel({ state, playerId, onAction }: { state: GameState; playerId: string; onAction: (a: Action) => void }) {
  const view = goalPickView(state, playerId);
  const [selected, setSelected] = useState<string[]>([]);
  if (!view) return null;
  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= view.max ? [...cur.slice(1), id] : [...cur, id]));
  const valid = selected.length >= view.min && selected.length <= view.max;
  const rule = view.min === view.max ? `${view.max}장을 고르세요` : `${view.min}~${view.max}장을 고르세요 (추가하지 않아도 됩니다)`;
  return (
    <div className="card stack">
      <h2>{view.name}: 인생 목표 선택</h2>
      <p className="muted">
        {rule}. 목표는 모두에게 공개됩니다. 실패해도 감점은 없습니다.
        {view.current.length > 0 && ` 보유 중: ${view.current.join(', ')}`}
      </p>
      {view.offered.map((g) => (
        <label key={g.goalId} className={`goal-option${selected.includes(g.goalId) ? ' selected' : ''}`}>
          <input type="checkbox" checked={selected.includes(g.goalId)} onChange={() => toggle(g.goalId)} />{' '}
          <b>
            {g.title} · {g.points}점
          </b>
          <div className="muted">
            {g.description} — {g.type}
          </div>
        </label>
      ))}
      <button className="primary" disabled={!valid} onClick={() => onAction({ type: 'PICK_GOALS', goalIds: selected })}>
        선택 확정
      </button>
    </div>
  );
}
