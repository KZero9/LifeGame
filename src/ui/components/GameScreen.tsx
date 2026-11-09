import { useEffect, useMemo, useState } from 'react';
import type { Action } from '../../engine/types';
import { applyHuman, nextActor, runAIUntilHuman, stepAI, type Session } from '../session';
import { logRows, moveChoices, reasonText } from '../viewModel';
import { Board } from './Board';
import { GoalPickPanel } from './GoalPickPanel';
import { PhasePanel } from './PhasePanel';
import { PlayerPanels, ProjectPanel } from './PlayerPanels';
import { ResponsePanel } from './ResponsePanel';
import { LogPanel } from './LogPanel';
import { ResultView } from './ResultView';

const SPEEDS = { normal: 500, fast: 120 } as const;

export function GameScreen({ session, setSession, onExit }: { session: Session; setSession: (s: Session) => void; onExit: () => void }) {
  const { state } = session;
  const [speed, setSpeed] = useState<keyof typeof SPEEDS>('normal');
  const [handedTo, setHandedTo] = useState<string | null>(null);
  const actor = nextActor(state);
  // 기기 넘김: 사람이 2명 이상이면 입력할 사람이 바뀔 때 안내한다. 정보는 모두 공개라 가리지 않는다 (16장)
  const humans = state.players.filter((p) => p.controller === 'human').length;
  const needHandoff = humans >= 2 && !!actor?.human && state.status !== 'finished' && handedTo !== actor.id;
  const actorName = actor ? state.players.find((p) => p.id === actor.id)?.name : '';

  // AI 차례면 한 결정씩 진행 (16장: 단계당 0.5초 이내, 건너뛰기 허용)
  useEffect(() => {
    if (!actor || actor.human || session.error) return;
    const timer = setTimeout(() => setSession(stepAI(session)), SPEEDS[speed]);
    return () => clearTimeout(timer);
  }, [session, actor?.id, actor?.human, speed, setSession]);

  const act = (a: Action) => actor && setSession(applyHuman(session, actor.id, a));
  const highlight = useMemo(() => {
    if (!actor?.human || state.turn?.phase !== 'move' || state.turn.dice === undefined) return undefined;
    return moveChoices(state, actor.id)
      .filter((c) => c.enabled && c.action.type === 'ADJUST')
      .map((c) => Number(/^(\d+)번/.exec(c.detail ?? '')?.[1]));
  }, [state, actor?.id, actor?.human]);
  const recent = logRows(state).slice(-6).reverse();

  return (
    <div className="app">
      <div className="header">
        <h1 style={{ margin: 0 }}>LifeGame</h1>
        <div className="row">
          {actor && !actor.human && (
            <>
              <span className="muted">{actorName} 진행 중…</span>
              <button onClick={() => setSpeed(speed === 'normal' ? 'fast' : 'normal')}>{speed === 'normal' ? '빠르게' : '보통 속도'}</button>
              <button onClick={() => setSession(runAIUntilHuman(session))}>AI 턴 건너뛰기</button>
            </>
          )}
          <button onClick={() => window.confirm('게임을 그만두고 처음 화면으로 갈까요?') && onExit()}>처음으로</button>
        </div>
      </div>
      {session.error && <p className="danger">처리하지 못했습니다: {reasonText(session.error)}</p>}
      {needHandoff && actor && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card stack">
            <h2>{actorName}에게 기기를 넘겨 주세요</h2>
            <p className="muted">
              {state.pendingGoalPicks.some((p) => p.playerId === actor.id)
                ? '인생 목표를 고를 차례입니다.'
                : state.pendingOffer?.status === 'pending' && state.pendingOffer.buyerId === actor.id
                  ? '지분 매입 제안에 답할 차례입니다.'
                  : '턴을 진행할 차례입니다.'}
            </p>
            <button className="primary" onClick={() => setHandedTo(actor.id)}>
              {actorName}: 준비됐어요
            </button>
          </div>
        </div>
      )}
      {state.status === 'finished' ? (
        <ResultView state={state} onExit={onExit} />
      ) : (
        <div className="grid-main">
          <Board state={state} {...(highlight ? { highlight } : {})} />
          <div className="stack">
            {actor?.human && state.pendingGoalPicks.some((p) => p.playerId === actor.id) && (
              <GoalPickPanel key={`${state.round}:${actor.id}`} state={state} playerId={actor.id} onAction={act} />
            )}
            {actor?.human && state.pendingOffer?.status === 'pending' && state.pendingOffer.buyerId === actor.id && <ResponsePanel state={state} onAction={act} />}
            {actor?.human && state.turn?.playerId === actor.id && state.pendingGoalPicks.length === 0 && state.pendingOffer?.status !== 'pending' && (
              <PhasePanel state={state} actor={actor.id} onAction={act} />
            )}
            <div className="card">
              <h3>최근 기록</h3>
              <div className="log">
                {recent.map((r, i) => (
                  <div key={i}>
                    <span className="muted">{r.round}R</span> {r.name && <b>{r.name}</b>} {r.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="stack" style={{ marginTop: 16 }}>
        <PlayerPanels state={state} />
        <ProjectPanel state={state} />
        <LogPanel state={state} />
      </div>
    </div>
  );
}
