import { RULES } from '../../engine';
import type { GameState } from '../../engine/types';
import { environmentInfo, marketCards, stageLabel, tileOf } from '../viewModel';

/** 타일 번호 → 6×6 격자 위치 (왼쪽 위에서 시계 방향) */
export function tileCell(i: number): { row: number; col: number } {
  if (i <= 5) return { row: 1, col: i + 1 };
  if (i <= 10) return { row: i - 4, col: 6 };
  if (i <= 15) return { row: 6, col: 6 - (i - 10) };
  return { row: 6 - (i - 15), col: 1 };
}

export const PLAYER_COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'];

export function Board({ state, highlight }: { state: GameState; highlight?: number[] }) {
  const env = environmentInfo(state);
  const market = marketCards(state);
  return (
    <div className="card">
      <div className="board" role="img" aria-label="보드">
        {Array.from({ length: RULES.board.length }, (_, i) => {
          const { kind, label } = tileOf(i);
          const { row, col } = tileCell(i);
          const here = state.players.filter((p) => p.position === i);
          return (
            <div key={i} className={`tile ${kind}${highlight?.includes(i) ? ' target' : ''}`} style={{ gridRow: row, gridColumn: col }}>
              <span className="num">{i}</span>
              <span className="kind">{label}</span>
              <span className="tokens">
                {here.map((p) => (
                  <span key={p.id} className="token" style={{ background: PLAYER_COLORS[p.seat] }} title={p.name}>
                    {p.name.slice(0, 1)}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
        <div className="board-center">
          <div className="badges">
            <span className="badge strong">
              {state.round >= 1 ? `${state.round} / ${RULES.rounds}라운드` : '시작 전'}
            </span>
            <span className="badge">{stageLabel(state)}</span>
          </div>
          <div>
            <b>공통 환경: {env.title}</b>
            <div className="muted">{env.effect}</div>
            <div className="muted">남은 환경 덱: {env.remaining.map((r) => `${r.title} ${r.count}`).join(' · ')}</div>
          </div>
          <div>
            <b>시장 공개 프로젝트</b>
            {market.length === 0 && <div className="muted">없음</div>}
            {market.map((m, k) => (
              <div key={k} className="muted">
                {m.title} — 비용 {m.cost}, 기간 {m.duration}, 결과 {m.results}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
