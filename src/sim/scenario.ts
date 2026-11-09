// 시나리오 하네스 (DESIGN_PHASE3.md 17.3, 18.3)
//
// 같은 시드(같은 덱 순서·용도별 주사위)에 고정 입력을 주입하고, 한 자리의 조건만 바꿔 비교한다.
// 예: 직업 비교는 대상 자리의 시작 직업과 정책만 다르게 한다.

import { POLICY_VARIANTS, type PolicyConfig } from '../ai/policy';
import { RULES, type WorkJob } from '../engine/data';
import type { GameState, PlayerId, PlayerResult } from '../engine/types';
import { runGame, type SeatConfig, type SimOptions, type SimResult } from './simulate';

export interface ScenarioScript {
  /** 플레이어 자리별 이동 주사위 순서. 주어지면 ROLL 대신 이 값을 쓴다 */
  moveDice?: Record<number, number[]>;
  /** 게임 시작 직후 덱 맨 위 순서 (사건 단계별·기회·지출·환경·프로젝트) */
  deckTops?: Partial<{ youth: string[]; middle: string[]; senior: string[]; opportunity: string[]; expense: string[]; env: string[]; project: string[] }>;
  /** 시작 직후 대상 자리의 상태를 바꾼다 */
  subjectPatch?: Partial<GameState['players'][number]>;
}

export interface ScenarioOptions {
  seed: number;
  seats: SeatConfig[];
  afterAction?: SimOptions['afterAction'];
  /** 비교 대상 자리 (0부터) */
  subjectSeat: number;
  script?: ScenarioScript;
}

function putOnTop(pile: { drawPile: string[]; discard: string[] }, ids: string[]): void {
  const all = [...pile.drawPile, ...pile.discard];
  for (const id of ids) {
    const i = all.indexOf(id);
    if (i < 0) throw new Error(`덱에 없는 카드: ${id}`);
    all.splice(i, 1);
  }
  pile.drawPile = [...ids, ...all];
  pile.discard = [];
}

export function runScenario(options: ScenarioOptions): SimResult & { subject: PlayerResult } {
  const script = options.script ?? {};
  let prepared = false;
  const used: Record<number, number> = {};
  const result = runGame({
    seed: options.seed,
    seats: options.seats,
    ...(options.afterAction ? { afterAction: options.afterAction } : {}),
    beforeDecision(state, actor: PlayerId) {
      let s = state;
      if (!prepared) {
        prepared = true;
        s = structuredClone(s);
        const subject = s.players[options.subjectSeat]!;
        if (script.subjectPatch) Object.assign(subject, script.subjectPatch);
        const tops = script.deckTops ?? {};
        if (tops.youth) putOnTop(s.decks.event.youth, tops.youth);
        if (tops.middle) putOnTop(s.decks.event.middle, tops.middle);
        if (tops.senior) putOnTop(s.decks.event.senior, tops.senior);
        if (tops.opportunity) putOnTop(s.decks.opportunity, tops.opportunity);
        if (tops.expense) putOnTop(s.decks.expense, tops.expense);
        if (tops.env) putOnTop(s.decks.env, tops.env);
        if (tops.project) putOnTop(s.decks.project, tops.project);
      }
      const seat = s.players.findIndex((p) => p.id === actor);
      const dice = script.moveDice?.[seat];
      if (dice && s.turn?.playerId === actor && s.turn.phase === 'move' && s.turn.dice === undefined) {
        const n = used[seat] ?? 0;
        const value = dice[n % dice.length]!;
        used[seat] = n + 1;
        if (s === state) s = structuredClone(s);
        s.turn!.dice = value;
      }
      return s;
    },
  });
  const subjectId = result.seatIds[options.subjectSeat]!;
  const subject = result.state.result!.players.find((p) => p.playerId === subjectId)!;
  return { ...result, subject };
}

export interface JobComparison {
  job: WorkJob;
  total: number;
  assetScore: number;
  goalScore: number;
  rank: number;
}

/** 직업 비교: 대상 자리의 시작 직업(조건 역량 포함)과 정책의 목표 직업만 바꾼다. 나머지 자리는 기본 AI */
export function compareJobs(seed: number, playerCount = 4, jobs: WorkJob[] = ['parttime', 'office', 'tech', 'business']): JobComparison[] {
  return jobs.map((job) => {
    const policy: PolicyConfig = { ...POLICY_VARIANTS.default!, name: `job:${job}`, targetJob: job };
    const seats: SeatConfig[] = Array.from({ length: playerCount }, (_, i) => (i === 0 ? { policy } : {}));
    const r = runScenario({
      seed,
      seats,
      subjectSeat: 0,
      script: { subjectPatch: { job, skill: Math.max(RULES.start.skill, RULES.jobs[job].skill) } },
    });
    return { job, total: r.subject.total, assetScore: r.subject.assetScore, goalScore: r.subject.goalScore, rank: r.subject.rank };
  });
}
