import { useEffect, useState } from 'react';
import type { Action, GameState } from '../../engine/types';
import { evaluateOffer, offerChoice, tradeView } from '../viewModel';
import { ChoiceButton } from './ChoiceButton';

/** ⑤ 거래 창: 개설한 프로젝트의 지분 판매 제안 (9.5, 9.7) */
export function TradePanel({ state, actor, onAction }: { state: GameState; actor: string; onAction: (a: Action) => void }) {
  const view = tradeView(state, actor);
  const firstTarget = view.targets.find((t) => !t.alreadyOffered)?.id ?? '';
  const [projectId, setProjectId] = useState(view.projects[0]?.instanceId ?? '');
  const [targetId, setTargetId] = useState(firstTarget);
  const [count, setCount] = useState(1);
  const project = view.projects.find((p) => p.instanceId === projectId) ?? view.projects[0];
  const [price, setPrice] = useState(project?.priceMin ?? 1);

  // 제안을 보낸 뒤에는 아직 제안하지 않은 상대로 바꾼다
  useEffect(() => {
    if (!view.targets.some((t) => t.id === targetId && !t.alreadyOffered)) setTargetId(firstTarget);
  }, [view.targets, targetId, firstTarget]);

  const canOffer = project && view.offersLeft > 0 && targetId !== '';
  const safeCount = project ? Math.min(Math.max(1, count), project.sellable) : 1;
  const safePrice = project ? Math.min(Math.max(project.priceMin, price), project.priceMax) : 1;
  const evaluation = canOffer ? evaluateOffer(state, project.instanceId, targetId, safeCount, safePrice) : null;
  const send = canOffer ? offerChoice(state, actor, project.instanceId, targetId, safeCount, safePrice) : null;

  return (
    <div className="stack">
      {view.projects.length === 0 ? (
        <p className="muted">판매할 수 있는 지분이 없습니다.</p>
      ) : (
        <>
          <p className="muted">
            개설한 프로젝트의 지분을 다른 사람에게 팔 수 있습니다. 개설자는 1지분 이상 남겨야 하고, 이번 턴 제안 {view.offersLeft}건 남음 (같은 상대에게는 1건).
          </p>
          <div className="row">
            <label>
              프로젝트
              <select
                value={project?.instanceId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  const p = view.projects.find((x) => x.instanceId === e.target.value);
                  if (p) setPrice(p.priceMin);
                }}
              >
                {view.projects.map((p) => (
                  <option key={p.instanceId} value={p.instanceId}>
                    {p.title} (판매 가능 {p.sellable})
                  </option>
                ))}
              </select>
            </label>
            <label>
              상대
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {view.targets.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.alreadyOffered}>
                    {t.name} (현금 {t.cash}){t.alreadyOffered ? ' — 제안함' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {project && (
            <div className="row">
              <label>
                지분 수
                <input type="number" min={1} max={project.sellable} value={safeCount} onChange={(e) => setCount(Number(e.target.value))} />
              </label>
              <label>
                1지분 가격
                <input type="number" min={project.priceMin} max={project.priceMax} value={safePrice} onChange={(e) => setPrice(Number(e.target.value))} />
              </label>
              <span className="muted">
                가격 범위 {project.priceMin}~{project.priceMax}
              </span>
            </div>
          )}
          {evaluation && (
            <table>
              <tbody>
                <tr>
                  <th>상대가 얻는 기대 가치</th>
                  <td>
                    {evaluation.expected.toFixed(2)} / 받을 금액 {evaluation.total} → 내 기대 순이익 {(evaluation.total - evaluation.expected).toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <th>환경별</th>
                  <td>{evaluation.byEnvironment.map((b) => `${b.title} ${b.value.toFixed(2)}`).join(' · ')}</td>
                </tr>
                <tr>
                  <th>상대의 거래 후 현금</th>
                  <td className={evaluation.cashAfter < 0 ? 'danger' : ''}>{evaluation.cashAfter}</td>
                </tr>
              </tbody>
            </table>
          )}
          {evaluation && <p className="muted">{evaluation.assumption}</p>}
          {send && <ChoiceButton choice={send} onPick={(c) => onAction(c.action)} />}
        </>
      )}
      <ChoiceButton choice={view.end} primary onPick={(c) => onAction(c.action)} />
    </div>
  );
}
