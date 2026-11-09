// 17.2 10단계: 거래 창, 기기 넘김, 기록, 결과 화면. 완료 기준: 사람 2명 이상 핫시트로 한 판 완주
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/engine';
import type { Action, GameState } from '../../src/engine/types';
import { GameScreen } from '../../src/ui/components/GameScreen';
import { LogPanel } from '../../src/ui/components/LogPanel';
import { ResultView } from '../../src/ui/components/ResultView';
import { applyHuman, newSession, nextActor, runAIUntilHuman, type Session } from '../../src/ui/session';
import { actionsView, evaluateOffer, goalPickView, moveChoices, offerChoice, responseView, tileView, tradeView, type Choice } from '../../src/ui/viewModel';

function start(seed: number, humans: number, total = 4): Session {
  const players = Array.from({ length: total }, (_, i) => ({ name: i < humans ? `사람${i + 1}` : `AI${i + 1}`, controller: (i < humans ? 'human' : 'ai') as 'human' | 'ai' }));
  const r = createGame({ seed, players });
  if (!r.ok) throw new Error(r.reason);
  return newSession(r.state);
}

/** 화면 선택지만으로 고른다. 거래 단계에서는 거래 창의 첫 프로젝트를 최저가 1지분으로 제안한다 */
function humanPick(state: GameState, id: string): Action {
  const goal = goalPickView(state, id);
  if (goal) return { type: 'PICK_GOALS', goalIds: goal.offered.slice(0, goal.max).map((g) => g.goalId) };
  const resp = responseView(state);
  if (resp && resp.buyerId === id) {
    const ev = resp.evaluation;
    return (resp.accept.enabled && ev.expected >= ev.total - 1 ? resp.accept : resp.reject).action;
  }
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
    case 'trade': {
      const v = tradeView(state, id);
      const project = v.projects[0];
      const target = v.targets.find((t) => !t.alreadyOffered && t.cash >= (project?.priceMin ?? 99));
      if (project && target && v.offersLeft > 0) {
        const c = offerChoice(state, id, project.instanceId, target.id, 1, project.priceMin);
        if (c.enabled) return c.action;
      }
      return v.end.action;
    }
  }
  throw new Error(`처리할 수 없는 화면: ${state.turn?.phase}`);
}

function playToEnd(session: Session) {
  let s = session;
  const stats = { handoffs: 0, humanOffers: 0, humanToHuman: 0, accepted: 0, renders: 0 };
  let lastHuman = '';
  for (let i = 0; i < 30000 && s.state.status !== 'finished'; i++) {
    s = runAIUntilHuman(s);
    if (s.error) throw new Error(s.error);
    const next = nextActor(s.state);
    if (!next) break;
    if (next.id !== lastHuman) {
      stats.handoffs++;
      lastHuman = next.id;
      if (stats.renders < 4) {
        // 사람이 바뀌면 기기 넘김 안내가 뜬다
        expect(renderToString(<GameScreen session={s} setSession={() => {}} onExit={() => {}} />)).toContain('기기를 넘겨 주세요');
        stats.renders++;
      }
    }
    const action = humanPick(s.state, next.id);
    if (action.type === 'OFFER_SHARES') {
      stats.humanOffers++;
      if (s.state.players.find((p) => p.id === action.targetId)?.controller === 'human') stats.humanToHuman++;
    }
    if (action.type === 'RESPOND_OFFER' && action.accept) stats.accepted++;
    s = applyHuman(s, next.id, action);
    if (s.error) throw new Error(`사람 행동 거부: ${JSON.stringify(action)} → ${s.error}`);
  }
  return { s, stats };
}

describe('10단계 완료 기준: 사람 2명 이상 핫시트로 한 판 완주', () => {
  it.each([
    [21, 2, 4],
    [22, 2, 2],
    [23, 3, 4],
    [24, 4, 4],
  ])('시드 %i: 사람 %i명 / 총 %i명', (seed, humans, total) => {
    const { s, stats } = playToEnd(start(seed, humans, total));
    expect(s.state.status).toBe('finished');
    expect(stats.handoffs).toBeGreaterThan(10);
    expect(stats.humanOffers).toBeGreaterThan(0);
    const html = renderToString(<GameScreen session={s} setSession={() => {}} onExit={() => {}} />);
    expect(html).toContain('게임 종료');
    expect(html).not.toContain('기기를 넘겨 주세요');
  });

  it('사람끼리 제안하고 응답하는 거래가 일어난다', () => {
    let total = 0;
    for (const seed of [31, 32, 33, 34]) total += playToEnd(start(seed, 4, 4)).stats.humanToHuman;
    expect(total).toBeGreaterThan(0);
  });
});

describe('거래 창 (9.7 표시)', () => {
  it('제안 전에 상대의 기대 가치, 환경별 가치, 거래 후 현금, 가정 문구를 보여 준다', () => {
    // 사람이 프로젝트를 연 거래 단계 찾기
    let s = start(41, 2, 2);
    for (let i = 0; i < 5000; i++) {
      s = runAIUntilHuman(s);
      if (s.state.turn?.phase === 'trade' && s.state.players.find((p) => p.id === s.state.turn!.playerId)!.controller === 'human') break;
      const next = nextActor(s.state)!;
      s = applyHuman(s, next.id, humanPick(s.state, next.id).type === 'OFFER_SHARES' ? { type: 'END_PHASE' } : humanPick(s.state, next.id));
    }
    const id = s.state.turn!.playerId;
    const v = tradeView(s.state, id);
    expect(v.projects.length).toBeGreaterThan(0);
    const p = v.projects[0]!;
    const target = v.targets[0]!;
    const e = evaluateOffer(s.state, p.instanceId, target.id, 1, p.priceMin);
    expect(e.byEnvironment.map((b) => b.title)).toEqual(['보통', '호황', '불황', '기술 전환기']);
    expect(e.cashAfter).toBe(target.cash - p.priceMin);
    expect(e.assumption.length).toBeGreaterThan(0);
    // 범위 밖 가격은 엔진이 거부하고 사유를 보여 준다
    const bad = offerChoice(s.state, id, p.instanceId, target.id, 1, p.priceMax + 1);
    expect(bad).toMatchObject({ enabled: false, reason: '가격 범위를 벗어났습니다' });
    const html = renderToString(<GameScreen session={s} setSession={() => {}} onExit={() => {}} />);
    expect(html).toContain('가격 범위');
  });
});

describe('기록과 결과 화면', () => {
  it('결과 화면: 순자산 구성, 구간별 자산 점수, 목표별 근거', () => {
    const { s } = playToEnd(start(51, 2, 2));
    const html = renderToString(<ResultView state={s.state} onExit={() => {}} />);
    expect(html).toContain('순자산');
    expect(html).toContain('0~20');
    expect(html).toMatch(/달성|미달성/);
    expect(html).toContain('동점 기준');
  });

  it('진행 기록: 원인과 변화량을 보여 준다', () => {
    const { s } = playToEnd(start(52, 2, 2));
    const html = renderToString(<LogPanel state={s.state} />);
    expect(html).toContain('생활비');
    expect(html).toContain('현금 −');
  });
});
