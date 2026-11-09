import type { GameState, PlayerResult } from '../../engine/types';
import { getGoal } from '../../engine/goals';

/** 11.2 구간별 자산 점수 */
function assetBreakdown(n: number): string {
  if (n < 0) return `순자산 ${n} → −ceil(${-n} / 2)`;
  const a = Math.min(n, 20) / 2;
  const b = Math.min(Math.max(n - 20, 0), 20) / 4;
  const c = Math.max(n - 40, 0) / 8;
  const parts = [`0~20: ${a}`];
  if (n > 20) parts.push(`20~40: ${b}`);
  if (n > 40) parts.push(`40 초과: ${c}`);
  return `${parts.join(' + ')} = ${a + b + c} → 내림`;
}

/** 결과 화면: 순위, 점수 구성과 근거 (11.3) */
export function ResultView({ state, onExit }: { state: GameState; onExit: () => void }) {
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  const results = state.result!.players;
  const winners = results.filter((r) => r.rank === 1).map((r) => nameOf(r.playerId));
  return (
    <div className="card stack">
      <h2>게임 종료 — {winners.join(', ')} {winners.length > 1 ? '공동 1위' : '승리'}</h2>
      <p className="muted">최종 점수 = 자산 점수 + 달성한 목표 점수. 동점이면 목표 점수 → 건강 → 공동 순위.</p>
      {results.map((r: PlayerResult) => (
        <div key={r.playerId} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>
              {r.rank}위 {nameOf(r.playerId)}
            </h3>
            <span className="badge strong">{r.total}점</span>
          </div>
          <table>
            <tbody>
              <tr>
                <th>순자산</th>
                <td>
                  현금 {r.cash}
                  {r.liquidation > 0 ? ` (종료 청산 ${r.liquidation} 포함)` : ''} − 부채 {r.debt} = {r.netWorth}
                </td>
              </tr>
              <tr>
                <th>자산 점수</th>
                <td>
                  {r.assetScore}점 <span className="muted">({assetBreakdown(r.netWorth)})</span>
                </td>
              </tr>
              <tr>
                <th>목표 점수</th>
                <td>
                  {r.goalScore}점
                  {r.goals.map((g) => (
                    <div key={g.goalId} className={g.achieved ? 'ok' : 'muted'}>
                      {g.achieved ? '달성' : '미달성'} · {getGoal(g.goalId).title} {getGoal(g.goalId).points}점 — {g.reason}
                    </div>
                  ))}
                </td>
              </tr>
              <tr>
                <th>건강 (동점 기준)</th>
                <td>{r.health}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <button className="primary" onClick={onExit}>
        새 게임
      </button>
    </div>
  );
}
