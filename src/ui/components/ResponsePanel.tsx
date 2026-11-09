import type { Action, GameState } from '../../engine/types';
import { responseView } from '../viewModel';
import { ChoiceButton } from './ChoiceButton';

export function ResponsePanel({ state, onAction }: { state: GameState; onAction: (a: Action) => void }) {
  const v = responseView(state);
  if (!v) return null;
  const e = v.evaluation;
  const net = e.expected - e.total;
  return (
    <div className="card stack">
      <h2>{v.buyer}: 지분 매입 제안</h2>
      <p>
        판매자 <b>{v.seller}</b> · <b>{v.title}</b> {v.count}지분 · 1지분당 {v.pricePerShare} (총 {e.total})
      </p>
      <div className="table-wrap">
      <table>
        <tbody>
          <tr>
            <th>추가 지분의 기대 가치</th>
            <td>
              {e.expected.toFixed(2)} (기대 순이익 <span className={net >= 0 ? 'ok' : 'danger'}>{net >= 0 ? '+' : ''}{net.toFixed(2)}</span>)
            </td>
          </tr>
          <tr>
            <th>환경별 기대 가치</th>
            <td>{e.byEnvironment.map((b) => `${b.title} ${b.value.toFixed(2)}`).join(' · ')}</td>
          </tr>
          <tr>
            <th>거래 후 현금</th>
            <td>{e.cashAfter}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <p className="muted">{e.assumption}</p>
      <div className="choices">
        <ChoiceButton choice={v.accept} primary onPick={(c) => onAction(c.action)} />
        <ChoiceButton choice={v.reject} onPick={(c) => onAction(c.action)} />
      </div>
    </div>
  );
}
