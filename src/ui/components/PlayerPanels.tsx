import type { GameState } from '../../engine/types';
import { playerSummaries, projectRows } from '../viewModel';
import { PLAYER_COLORS } from './Board';

export function PlayerPanels({ state }: { state: GameState }) {
  const seatOf = (id: string) => state.players.find((p) => p.id === id)?.seat ?? 0;
  return (
    <div className="grid-players">
      {playerSummaries(state).map((p) => (
        <div key={p.id} className={`card player${p.isTurn ? ' turn' : ''}`} style={{ borderLeftColor: PLAYER_COLORS[seatOf(p.id)] }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>
              {p.seatOrder}. {p.name}
            </h3>
            <span className="badge">{p.controller === 'ai' ? 'AI' : '사람'}</span>
          </div>
          <div className="muted">
            {p.job}
            {p.hospitalized ? ' · 입원 중' : ''}
            {p.isTurn && state.turn ? ` · 행동력 ${state.turn.apLeft}` : ''}
          </div>
          <div className="stats">
            <span>
              현금 <b>{p.cash}</b>
            </span>
            <span className={p.debt > 0 ? 'danger' : ''}>
              부채 <b>{p.debt}</b>
            </span>
            <span>
              예상 <b>{p.scoreNow}</b>점
            </span>
            <span className={p.health <= 3 ? 'danger' : ''}>
              건강 <b>{p.health}</b>
            </span>
            <span>
              역량 <b>{p.skill}</b>
            </span>
            <span>
              위치 <b>{p.position}</b>
            </span>
          </div>
          {p.goals.map((g) => (
            <div key={g.goalId} className={`goal${g.likely ? ' likely' : ''}`} title={g.description}>
              <span>
                {g.title} ({g.points}점)
              </span>
              <span>{g.status}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ProjectPanel({ state }: { state: GameState }) {
  const rows = projectRows(state);
  return (
    <div className="card">
      <h2>진행 중 프로젝트</h2>
      {rows.length === 0 ? (
        <p className="muted">없음</p>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>프로젝트</th>
              <th>개설자</th>
              <th>만기</th>
              <th>결과표</th>
              <th>지분</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.instanceId}>
                <td>
                  {r.title}
                  <div className="muted">
                    정가 {r.baseCost}, 실제 지출 {r.paidCost}
                  </div>
                </td>
                <td>{r.opener}</td>
                <td>{r.liquidationOnly ? `${r.maturityRound}라운드 (종료 시 청산)` : `${r.maturityRound}라운드 종료`}</td>
                <td>{r.results}</td>
                <td>{r.shares.map((s) => `${s.name} ${s.count}`).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
