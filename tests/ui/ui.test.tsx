// 17.2 9단계: UI. 화면 데이터(viewModel)만으로 사람 차례를 처리해 한 판을 끝낼 수 있는지, 각 화면이 오류 없이 그려지는지 확인한다
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/engine';
import type { Action, GameState } from '../../src/engine/types';
import { App } from '../../src/App';
import { GameScreen } from '../../src/ui/components/GameScreen';
import { SetupScreen } from '../../src/ui/components/SetupScreen';
import { applyHuman, newSession, nextActor, runAIUntilHuman, type Session } from '../../src/ui/session';
import { actionsView, goalPickView, moveChoices, responseView, tileView, tradeView, type Choice } from '../../src/ui/viewModel';

const PLAYERS = [
  { name: '나', controller: 'human' as const },
  { name: 'AI 하나', controller: 'ai' as const },
  { name: 'AI 둘', controller: 'ai' as const },
  { name: 'AI 셋', controller: 'ai' as const },
];

function start(seed: number, players = PLAYERS): Session {
  const r = createGame({ seed, players });
  if (!r.ok) throw new Error(r.reason);
  return newSession(r.state);
}

/** 사람 차례에 화면에 보이는 선택지 중 하나를 고른다 (간단한 규칙: 활성화된 첫 생활 행동, 없으면 끝내기) */
function humanPick(state: GameState, id: string, round: number): Action {
  const goal = goalPickView(state, id);
  if (goal) return { type: 'PICK_GOALS', goalIds: goal.offered.slice(0, goal.max).map((g) => g.goalId) };
  const resp = responseView(state);
  if (resp && resp.buyerId === id) return (round % 2 === 0 && resp.accept.enabled ? resp.accept : resp.reject).action;
  const first = (cs: Choice[]) => cs.find((c) => c.enabled);
  switch (state.turn?.phase) {
    case 'move':
      return first(moveChoices(state, id))!.action;
    case 'tile':
      return first(tileView(state, id)!.choices)!.action;
    case 'actions': {
      const v = actionsView(state, id);
      return (first(v.open) ?? first(v.life) ?? v.end).action;
    }
    case 'trade':
      return tradeView(state, id).end.action;
  }
  throw new Error(`처리할 수 없는 화면: ${state.turn?.phase}`);
}

function playToEnd(session: Session): { session: Session; humanDecisions: number; screens: Set<string> } {
  let s = session;
  let humanDecisions = 0;
  const screens = new Set<string>();
  for (let i = 0; i < 20000 && s.state.status !== 'finished'; i++) {
    s = runAIUntilHuman(s);
    if (s.error) throw new Error(s.error);
    const next = nextActor(s.state);
    if (!next) break;
    const screen = s.state.pendingGoalPicks.length ? 'goal' : s.state.pendingOffer?.status === 'pending' ? 'response' : s.state.turn!.phase;
    screens.add(screen);
    if (screens.size <= 6) renderToString(<GameScreen session={s} setSession={() => {}} onExit={() => {}} />);
    const action = humanPick(s.state, next.id, s.state.round);
    const before = s;
    s = applyHuman(s, next.id, action);
    if (s.error) throw new Error(`사람 행동 거부: ${JSON.stringify(action)} → ${s.error} (${before.state.turn?.phase})`);
    humanDecisions++;
  }
  return { session: s, humanDecisions, screens };
}

describe('9단계 완료 기준: 사람 1명 + AI 3명으로 한 판 완주', () => {
  it.each([1, 2, 3, 4, 5])('시드 %i: 화면 선택지만으로 끝까지 진행', (seed) => {
    const { session, humanDecisions, screens } = playToEnd(start(seed));
    expect(session.state.status).toBe('finished');
    expect(session.state.result!.players).toHaveLength(4);
    expect(humanDecisions).toBeGreaterThan(30);
    expect(screens.has('goal')).toBe(true);
    expect(screens.has('move')).toBe(true);
    expect(screens.has('actions')).toBe(true);
    // 끝난 화면도 그려진다
    expect(renderToString(<GameScreen session={session} setSession={() => {}} onExit={() => {}} />)).toContain('게임 종료');
  });
});

describe('화면 그리기', () => {
  it('설정 화면과 첫 화면', () => {
    expect(renderToString(<App />)).toContain('게임 시작');
    expect(renderToString(<SetupScreen onStart={() => {}} />)).toContain('시드');
  });

  it('목표 선택 화면: 받은 3장과 고를 장수', () => {
    const s = runAIUntilHuman(start(9));
    const html = renderToString(<GameScreen session={s} setSession={() => {}} onExit={() => {}} />);
    expect(html).toContain('인생 목표 선택');
    expect(goalPickView(s.state, 'p1')!.offered).toHaveLength(3);
  });

  it('이동 화면: 굴리기 전·후 선택지와 도착 칸', () => {
    let s = runAIUntilHuman(start(10));
    s = applyHuman(s, 'p1', humanPick(s.state, 'p1', 0));
    s = runAIUntilHuman(s);
    expect(s.state.turn).toMatchObject({ playerId: 'p1', phase: 'move' });
    expect(moveChoices(s.state, 'p1').map((c) => c.label)).toEqual(['주사위 굴리기']);
    s = applyHuman(s, 'p1', { type: 'ROLL' });
    const choices = moveChoices(s.state, 'p1');
    expect(choices).toHaveLength(3);
    expect(choices[0]!.detail).toMatch(/^\d+번 /);
    const html = renderToString(<GameScreen session={s} setSession={() => {}} onExit={() => {}} />);
    expect(html).toContain('주사위');
  });

  it('불가 사유를 선택 전에 보여 준다 (돈 부족)', () => {
    let s = runAIUntilHuman(start(11));
    s = applyHuman(s, 'p1', humanPick(s.state, 'p1', 0));
    s = runAIUntilHuman(s);
    const state = structuredClone(s.state);
    state.turn!.phase = 'actions';
    state.players[0]!.cash = 1;
    const study = actionsView(state, 'p1').life.find((c) => c.label === '학습')!;
    expect(study.enabled).toBe(false);
    expect(study.reason).toBe('돈 부족 (필요 2, 보유 1)');
  });
});
