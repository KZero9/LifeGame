import { useState } from 'react';
import { RULES } from '../../engine';
import type { Action, GameState } from '../../engine/types';
import { actionsView, moveChoices, tileView, type Choice } from '../viewModel';
import { ChoiceButton } from './ChoiceButton';
import { TradePanel } from './TradePanel';

const PHASE_TITLE: Record<string, string> = {
  move: '② 이동',
  tile: '③ 칸 처리',
  actions: '④ 생활 행동',
  trade: '⑤ 거래',
};

/** 사람 차례의 단계별 선택지 */
export function PhasePanel({ state, actor, onAction }: { state: GameState; actor: string; onAction: (a: Action) => void }) {
  const turn = state.turn;
  const name = state.players.find((p) => p.id === actor)?.name ?? actor;
  const pick = (c: Choice) => onAction(c.action);
  if (!turn || turn.playerId !== actor) return null;
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          {name} · {PHASE_TITLE[turn.phase] ?? turn.phase}
        </h2>
        <span className="badge">행동력 {turn.apLeft}</span>
      </div>
      {turn.phase === 'move' && <MoveStep state={state} actor={actor} onPick={pick} />}
      {turn.phase === 'tile' && <TileStep state={state} actor={actor} onPick={pick} />}
      {turn.phase === 'actions' && <ActionsStep state={state} actor={actor} onAction={onAction} />}
      {turn.phase === 'trade' && <TradePanel state={state} actor={actor} onAction={onAction} />}
    </div>
  );
}

function MoveStep({ state, actor, onPick }: { state: GameState; actor: string; onPick: (c: Choice) => void }) {
  const choices = moveChoices(state, actor);
  return (
    <>
      {state.turn?.dice !== undefined && <p>주사위 {state.turn.dice}. 행동력 {RULES.move.adjustAp}로 ±1 조정할 수 있습니다.</p>}
      <div className="choices">
        {choices.map((c, i) => (
          <ChoiceButton key={i} choice={c} primary={i === 0} onPick={onPick} />
        ))}
      </div>
    </>
  );
}

function TileStep({ state, actor, onPick }: { state: GameState; actor: string; onPick: (c: Choice) => void }) {
  const view = tileView(state, actor);
  if (!view) return <p className="muted">처리 중…</p>;
  return (
    <>
      <h3>{view.title}</h3>
      {view.text && <p>{view.text}</p>}
      <div className="choices">
        {view.choices.map((c, i) => (
          <ChoiceButton key={i} choice={c} onPick={onPick} />
        ))}
      </div>
    </>
  );
}

function ActionsStep({ state, actor, onAction }: { state: GameState; actor: string; onAction: (a: Action) => void }) {
  const view = actionsView(state, actor);
  const [repay, setRepay] = useState(1);
  const grant = state.turn?.modifiers.openGrant;
  const pick = (c: Choice) => onAction(c.action);
  const amount = Math.min(Math.max(1, Math.floor(repay) || 1), Math.max(1, view.repayMax));
  return (
    <>
      <div className="choices">
        {view.life.map((c, i) => (
          <ChoiceButton key={i} choice={c} onPick={pick} />
        ))}
      </div>
      <details>
        <summary>구직 (근무 전에만, 턴당 1회)</summary>
        <div className="choices" style={{ marginTop: 8 }}>
          {view.jobs.map((c, i) => (
            <ChoiceButton key={i} choice={c} onPick={pick} />
          ))}
        </div>
      </details>
      {(grant || view.open.some((c) => c.enabled)) && (
        <div className="stack">
          <h3>프로젝트 개설{grant ? ` — 이번 턴 개설 권한 (${{ market: '시장 칸', seminar: '투자 설명회', collab: '협업 제안' }[grant.source]})` : ' — 자영업 개설 행동'}</h3>
          <div className="choices">
            {view.open.map((c, i) => (
              <ChoiceButton key={i} choice={c} onPick={pick} />
            ))}
          </div>
        </div>
      )}
      {view.canRepay && (
        <div className="row">
          <span>부채 상환 (행동력 없음)</span>
          <input type="number" min={1} max={view.repayMax} value={amount} onChange={(e) => setRepay(Number(e.target.value))} aria-label="상환액" />
          <button onClick={() => onAction({ type: 'REPAY', amount })}>상환</button>
          <button onClick={() => onAction({ type: 'REPAY', amount: view.repayMax })}>최대 {view.repayMax} 상환</button>
        </div>
      )}
      <ChoiceButton choice={view.end} primary onPick={pick} />
    </>
  );
}
