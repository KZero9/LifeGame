import type { GameState } from '../../engine/types';

/** 결과 (9단계: 순위와 점수. 점수 구성과 근거는 10단계) */
export function ResultView({ state, onExit }: { state: GameState; onExit: () => void }) {
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="card stack">
      <h2>게임 종료</h2>
      <table>
        <thead>
          <tr>
            <th>순위</th>
            <th>플레이어</th>
            <th>최종 점수</th>
          </tr>
        </thead>
        <tbody>
          {state.result!.players.map((r) => (
            <tr key={r.playerId}>
              <td>{r.rank}위</td>
              <td>{nameOf(r.playerId)}</td>
              <td>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="primary" onClick={onExit}>
        새 게임
      </button>
    </div>
  );
}
