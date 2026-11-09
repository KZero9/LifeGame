// 후속 밸런스 측정 (BALANCE_PHASE8.md 3장 후속)
//
// 기본 AI 다인 게임에서 행동 반복, 낮은 건강 턴, 목표 제시·선택·달성, 목표 점수 격차,
// 부채 발생·규모·회복, 실직 후 재취업, 회복 중 선택지를 함께 잰다.

import { chooseAction, DEFAULT_POLICY, type PolicyConfig } from '../ai/policy';
import { applyAction } from '../engine/applyAction';
import { RULES } from '../engine/data';
import { GOAL_RULES } from '../engine/goals';
import { getLegalActions, playersToAct } from '../engine/legal';
import { createGame } from '../engine/setup';
import type { Action, GameState, Job, PlayerId } from '../engine/types';
import { runScenario } from './scenario';
import { runGame } from './simulate';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const pctile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const PRO_JOBS: Job[] = ['office', 'tech', 'business'];

interface TurnRecord {
  playerId: PlayerId;
  startHealth: number;
  apTotal: number;
  kinds: string[];
}

export interface FollowupMetrics {
  games: number;
  players: number;
  seeds: string;
  // 행동
  turns: number;
  adjustRate: number;
  workOnlyRate: number;
  restRate: number;
  identicalToPrevRate: number;
  longestSameStreakMean: number;
  actionMix: Record<string, number>;
  // 낮은 건강
  lowHealthTurns: number;
  lowHealthTurnRate: number;
  lowHealthRestRate: number;
  lowHealthAdjustRate: number;
  lowHealthNoRecoveryActionRate: number;
  lowHealthNextTurnImprovedRate: number;
  lowHealthStreak3Players: number;
  hospitalizationsPerGame: number;
  // 칸
  eventTileRate: number;
  expenseTileRate: number;
  // 목표
  goals: Record<string, { offered: number; picked: number; achieved: number }>;
  pickedAchievedRate: number;
  goalScoreMean: number;
  goalSpreadMean: number;
  assetSpreadMean: number;
  goalScoreSdWithinGame: number;
  // 부채
  everDebtRate: number;
  maxDebtP50: number;
  maxDebtP90: number;
  maxDebtMax: number;
  debt10Rate: number;
  debt20Rate: number;
  debtRecoveredRate: number;
  debt10RecoveredRate: number;
  debt10FinalRankDist: number[];
  // 실직
  layoffs: number;
  layoffChoices: Record<string, number>;
  reemployProTurnsMean: number;
  reemployProRate: number;
  layoffFinalRankDist: number[];
  // 회복 중 선택지
  recoveryTurns: number;
  recoveryOptionsMean: number;
  recoveryNoOptionRate: number;
  // 직업
  finalJobs: Record<string, number>;
  everJob: Record<string, number>;
  meanTotal: number;
  scoreSd: number;
}

/** 행동을 분류한다 */
function kindOf(a: Action): string | null {
  switch (a.type) {
    case 'LIFE_ACTION':
      return a.action;
    case 'CHANGE_JOB':
      return 'jobSearch';
    case 'OPEN_PROJECT':
      return 'open';
    case 'REPAY':
      return 'repay';
    case 'ADJUST':
      return a.delta === 0 ? null : 'adjust';
    case 'OFFER_SHARES':
      return 'offer';
    default:
      return null;
  }
}

/** 생활 행동 단계 진입 시 사용 가능한 의미 있는 선택지 수 (END_PHASE 제외, 행동 종류 기준) */
function meaningfulOptions(state: GameState, actor: PlayerId): number {
  const kinds = new Set<string>();
  for (const a of getLegalActions(state, actor)) {
    if (a.type === 'END_PHASE') continue;
    kinds.add(a.type === 'LIFE_ACTION' ? a.action : a.type === 'CHANGE_JOB' ? `job:${a.job}` : a.type);
  }
  return kinds.size;
}

export function measureFollowup(games: number, seedBase = 100000, players = 4): FollowupMetrics {
  const turns: TurnRecord[] = [];
  const perPlayerSeq: Record<string, string[]> = {};
  let adjust = 0;
  let moves = 0;
  let eventLand = 0;
  let expenseLand = 0;
  let hosp = 0;
  const goals: Record<string, { offered: number; picked: number; achieved: number }> = {};
  for (const g of GOAL_RULES.goals) goals[g.id] = { offered: 0, picked: 0, achieved: 0 };
  let pickedTotal = 0;
  let achievedTotal = 0;
  const goalScores: number[] = [];
  const goalSpreads: number[] = [];
  const assetSpreads: number[] = [];
  const goalSds: number[] = [];
  const maxDebts: number[] = [];
  let everDebt = 0;
  let debt10 = 0;
  let debt20 = 0;
  let debtRecovered = 0;
  let debt10Recovered = 0;
  const debt10Ranks = Array.from({ length: players }, () => 0);
  let layoffs = 0;
  const layoffChoices: Record<string, number> = {};
  const reemployTurns: number[] = [];
  let reemployed = 0;
  const layoffRanks = Array.from({ length: players }, () => 0);
  let recoveryTurns = 0;
  const recoveryOptions: number[] = [];
  const finalJobs: Record<string, number> = {};
  const everJob: Record<string, number> = {};
  const totals: number[] = [];
  let lowStreak3 = 0;

  for (let g = 1; g <= games; g++) {
    const seed = seedBase + g;
    const maxDebt: Record<string, number> = {};
    const laidAt: Record<string, number> = {}; // 실직 후 지난 자기 턴 수
    const laidSince: Record<string, boolean> = {};
    const ever: Record<string, Set<string>> = {};
    const lowRun: Record<string, number> = {};
    const lowMax: Record<string, number> = {};
    let cur: TurnRecord | null = null;
    let curKey = '';
    const flush = () => {
      if (!cur) return;
      turns.push(cur);
      const sig = [...cur.kinds].sort().join('+') || '(없음)';
      (perPlayerSeq[`${seed}:${cur.playerId}`] ??= []).push(sig);
      cur = null;
    };

    const r = runGame({
      seed,
      seats: Array.from({ length: players }, () => ({})),
      checkInvariants: false,
      afterAction(before, actor, action, after) {
        // 목표 제시·선택
        if (action.type === 'PICK_GOALS') {
          const pick = before.pendingGoalPicks.find((p) => p.playerId === actor)!;
          for (const id of pick.offered) goals[id]!.offered++;
          for (const id of action.goalIds) goals[id]!.picked++;
        }
        // 턴 단위 기록
        if (before.turn && before.turn.playerId === actor) {
          const key = `${before.round}:${before.turnIndex}`;
          if (key !== curKey) {
            flush();
            curKey = key;
            const p = before.players.find((x) => x.id === actor)!;
            cur = { playerId: actor, startHealth: p.health, apTotal: before.turn.apTotal, kinds: [] };
            // 낮은 건강 연속
            if (p.health <= RULES.ap.lowHealthAtMost) lowRun[actor] = (lowRun[actor] ?? 0) + 1;
            else lowRun[actor] = 0;
            lowMax[actor] = Math.max(lowMax[actor] ?? 0, lowRun[actor]!);
            // 실직 후 경과
            if (laidSince[actor]) laidAt[actor] = (laidAt[actor] ?? 0) + 1;
          }
          const k = kindOf(action);
          if (k) cur!.kinds.push(k);
          if (action.type === 'ADJUST') {
            moves++;
            if (action.delta !== 0) adjust++;
          }
          // 생활 행동 단계 진입: 회복 중이면 선택지 수
          if (after.turn?.playerId === actor && after.turn.phase === 'actions' && before.turn.phase !== 'actions') {
            const p = after.players.find((x) => x.id === actor)!;
            if (p.debt > 0 || laidSince[actor]) {
              recoveryTurns++;
              recoveryOptions.push(meaningfulOptions(after, actor));
            }
          }
          // 실직 선택
          if (action.type === 'CHOOSE_OPTION' && before.turn.pendingTile?.cardId === 'restructure' && before.turn.pendingTile.branch === 'laidOff') {
            layoffChoices[action.optionId] = (layoffChoices[action.optionId] ?? 0) + 1;
          }
        }
        for (const p of after.players) {
          maxDebt[p.id] = Math.max(maxDebt[p.id] ?? 0, p.debt);
          (ever[p.id] ??= new Set()).add(p.job);
          if (laidSince[p.id] && PRO_JOBS.includes(p.job)) {
            reemployTurns.push(laidAt[p.id] ?? 0);
            reemployed++;
            laidSince[p.id] = false;
          }
        }
        // 실직 발생 (자동 효과로 무직이 된 직후)
        const newLogs = after.log.slice(before.log.length);
        for (const e of newLogs) {
          if (e.cause === '구조조정: 실직했다' && e.playerId) {
            layoffs++;
            laidSince[e.playerId] = true;
            laidAt[e.playerId] = 0;
          }
          if (e.kind === 'hospital') hosp++;
          if (e.kind === 'move') {
            const to = Number(/→ (\d+)번/.exec(e.cause)?.[1]);
            if (RULES.board[to] === 'event') eventLand++;
            if (RULES.board[to] === 'expense') expenseLand++;
          }
        }
      },
    });
    flush();
    const s = r.state;
    const res = s.result!.players;
    const gs = res.map((x) => x.goalScore);
    const as = res.map((x) => x.assetScore);
    goalSpreads.push(Math.max(...gs) - Math.min(...gs));
    assetSpreads.push(Math.max(...as) - Math.min(...as));
    goalSds.push(sd(gs));
    for (const x of res) {
      goalScores.push(x.goalScore);
      totals.push(x.total);
      for (const gr of x.goals) {
        pickedTotal++;
        if (gr.achieved) {
          achievedTotal++;
          goals[gr.goalId]!.achieved++;
        }
      }
    }
    for (const p of s.players) {
      const md = maxDebt[p.id] ?? 0;
      maxDebts.push(md);
      const rank = res.find((x) => x.playerId === p.id)!.rank;
      if (md > 0) {
        everDebt++;
        if (p.debt === 0) debtRecovered++;
      }
      if (md >= 10) {
        debt10++;
        if (p.debt === 0) debt10Recovered++;
        debt10Ranks[rank - 1]!++;
      }
      if (md >= 20) debt20++;
      finalJobs[p.job] = (finalJobs[p.job] ?? 0) + 1;
      for (const j of ever[p.id] ?? []) everJob[j] = (everJob[j] ?? 0) + 1;
      if ((lowMax[p.id] ?? 0) >= 3) lowStreak3++;
    }
    const laidPlayers = new Set(s.log.filter((e) => e.cause === '구조조정: 실직했다').map((e) => e.playerId!));
    for (const id of laidPlayers) layoffRanks[res.find((x) => x.playerId === id)!.rank - 1]!++;
  }

  const n = games * players;
  const low = turns.filter((t) => t.startHealth <= RULES.ap.lowHealthAtMost);
  // 낮은 건강 다음 자기 턴 건강 비교
  let improved = 0;
  let lowWithNext = 0;
  // 같은 플레이어의 다음 턴: turns 배열에서 다음 인원 수 안에 있는 같은 playerId (판 경계를 넘으면 버림)
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]!;
    if (t.startHealth > RULES.ap.lowHealthAtMost) continue;
    for (let j = i + 1; j < Math.min(turns.length, i + players + 1); j++) {
      if (turns[j]!.playerId === t.playerId) {
        lowWithNext++;
        if (turns[j]!.startHealth > t.startHealth) improved++;
        break;
      }
    }
  }
  const actionMix: Record<string, number> = {};
  for (const t of turns) for (const k of t.kinds) actionMix[k] = (actionMix[k] ?? 0) + 1;
  for (const k of Object.keys(actionMix)) actionMix[k] = actionMix[k]! / turns.length;
  let same = 0;
  let pairs = 0;
  const streaks: number[] = [];
  for (const seq of Object.values(perPlayerSeq)) {
    let run = 1;
    let best = 1;
    for (let i = 1; i < seq.length; i++) {
      pairs++;
      if (seq[i] === seq[i - 1]) {
        same++;
        run++;
        best = Math.max(best, run);
      } else run = 1;
    }
    streaks.push(best);
  }
  const workOnly = turns.filter((t) => t.kinds.length > 0 && t.kinds.every((k) => k === 'work' || k === 'overtime')).length;
  const norm = (xs: number[]) => xs.map((x) => x / Math.max(1, xs.reduce((a, b) => a + b, 0)));

  return {
    games,
    players,
    seeds: `${seedBase + 1}–${seedBase + games}`,
    turns: turns.length,
    adjustRate: adjust / Math.max(1, moves),
    workOnlyRate: workOnly / turns.length,
    restRate: turns.filter((t) => t.kinds.includes('rest')).length / turns.length,
    identicalToPrevRate: same / Math.max(1, pairs),
    longestSameStreakMean: mean(streaks),
    actionMix,
    lowHealthTurns: low.length,
    lowHealthTurnRate: low.length / turns.length,
    lowHealthRestRate: low.filter((t) => t.kinds.includes('rest')).length / Math.max(1, low.length),
    lowHealthAdjustRate: low.filter((t) => t.kinds.includes('adjust')).length / Math.max(1, low.length),
    lowHealthNoRecoveryActionRate: low.filter((t) => !t.kinds.includes('rest')).length / Math.max(1, low.length),
    lowHealthNextTurnImprovedRate: improved / Math.max(1, lowWithNext),
    lowHealthStreak3Players: lowStreak3 / n,
    hospitalizationsPerGame: hosp / games,
    eventTileRate: eventLand / Math.max(1, moves),
    expenseTileRate: expenseLand / Math.max(1, moves),
    goals,
    pickedAchievedRate: achievedTotal / Math.max(1, pickedTotal),
    goalScoreMean: mean(goalScores),
    goalSpreadMean: mean(goalSpreads),
    assetSpreadMean: mean(assetSpreads),
    goalScoreSdWithinGame: mean(goalSds),
    everDebtRate: everDebt / n,
    maxDebtP50: pctile(maxDebts.filter((x) => x > 0), 0.5),
    maxDebtP90: pctile(maxDebts.filter((x) => x > 0), 0.9),
    maxDebtMax: Math.max(0, ...maxDebts),
    debt10Rate: debt10 / n,
    debt20Rate: debt20 / n,
    debtRecoveredRate: debtRecovered / Math.max(1, everDebt),
    debt10RecoveredRate: debt10Recovered / Math.max(1, debt10),
    debt10FinalRankDist: norm(debt10Ranks),
    layoffs,
    layoffChoices,
    reemployProTurnsMean: mean(reemployTurns),
    reemployProRate: reemployed / Math.max(1, layoffs),
    layoffFinalRankDist: norm(layoffRanks),
    recoveryTurns,
    recoveryOptionsMean: mean(recoveryOptions),
    recoveryNoOptionRate: recoveryOptions.filter((x) => x === 0).length / Math.max(1, recoveryOptions.length),
    finalJobs: Object.fromEntries(Object.entries(finalJobs).map(([k, v]) => [k, v / n])),
    everJob: Object.fromEntries(Object.entries(everJob).map(([k, v]) => [k, v / n])),
    meanTotal: mean(totals),
    scoreSd: sd(totals),
  };
}

// ---------------------------------------------------------------------------
// 회복 시나리오: 부채·입원에서 시작한 아르바이트 정책

export interface RecoveryRow {
  start: string;
  seeds: string;
  reachedZeroRate: number;
  meanRoundToZero: number;
  finalDebtMean: number;
  finalDebtP90: number;
  /** 회복 중 생활 행동 단계에서 의미 있는 선택지 수 평균 */
  optionsMean: number;
  /** 다시 전문 직업으로 옮긴 비율 (정책이 허용할 때) */
  proJobRate: number;
  finalRankDist: number[];
}

export function measureRecoveryDetailed(seeds: number, seedBase = 300000, policy: PolicyConfig = { name: 'recover', repayReserve: 0 }): RecoveryRow[] {
  const cases: { start: string; patch: Partial<GameState['players'][number]> }[] = [
    { start: '부채 1', patch: { cash: 0, debt: 1 } },
    { start: '부채 5', patch: { cash: 0, debt: 5 } },
    { start: '부채 10', patch: { cash: 0, debt: 10 } },
    { start: '부채 20', patch: { cash: 0, debt: 20 } },
    { start: '입원 직후(부채 3)', patch: { cash: 0, debt: 3, health: 0, hospitalized: true } },
    { start: '실직(무직, 부채 5)', patch: { cash: 0, debt: 5, job: 'none', skill: 3 } },
  ];
  return cases.map(({ start, patch }) => {
    const rounds: number[] = [];
    const finals: number[] = [];
    const options: number[] = [];
    const ranks = [0, 0];
    let reached = 0;
    let pro = 0;
    for (let k = 1; k <= seeds; k++) {
      let found = 0;
      const r = runScenario({
        seed: seedBase + k,
        seats: [{ policy }, {}],
        subjectSeat: 0,
        script: { subjectPatch: patch },
        afterAction(before, actor, _action, after) {
          const subject = after.players[0]!;
          if (actor === subject.id && after.turn?.playerId === actor && after.turn.phase === 'actions' && before.turn?.phase !== 'actions' && subject.debt > 0) {
            options.push(meaningfulOptions(after, actor));
          }
          if (!found && before.turn?.playerId === subject.id && after.turn?.playerId !== subject.id && subject.debt === 0) found = before.round;
        },
      });
      const subject = r.state.players[0]!;
      finals.push(subject.debt);
      if (PRO_JOBS.includes(subject.job)) pro++;
      ranks[r.subject.rank - 1]!++;
      if (found) {
        reached++;
        rounds.push(found);
      }
    }
    return {
      start,
      seeds: `${seedBase + 1}–${seedBase + seeds}`,
      reachedZeroRate: reached / seeds,
      meanRoundToZero: mean(rounds),
      finalDebtMean: mean(finals),
      finalDebtP90: pctile(finals, 0.9),
      optionsMean: mean(options),
      proJobRate: pro / seeds,
      finalRankDist: ranks.map((x) => x / seeds),
    };
  });
}

// ---------------------------------------------------------------------------
// AI 직업 평가 편향: 모든 직업을 고를 수 있는 상태에서 기본 AI가 무엇을 고르는가

export interface JobBiasResult {
  seeds: string;
  /** 1라운드 첫 구직 선택 분포 */
  firstChoice: Record<string, number>;
  /** 자영업으로 시작한 기본 AI가 끝까지 자영업에 남은 비율 */
  businessRetention: number;
}

export function measureJobBias(seeds: number, seedBase = 400000): JobBiasResult {
  const first: Record<string, number> = {};
  let retained = 0;
  for (let k = 1; k <= seeds; k++) {
    // 시드마다 1번 자리를 역량 3·현금 20으로 시작시키고, 1라운드에 처음 고른 구직 대상을 기록
    const created = createGame({ seed: seedBase + k, players: Array.from({ length: 4 }, (_, i) => ({ name: `AI${i}`, controller: 'ai' as const })) });
    if (!created.ok) throw new Error(created.reason);
    let s = created.state;
    const subject = s.players[0]!.id;
    let patched = false;
    let choice = '(구직 안 함)';
    for (let guard = 0; guard < 20000 && s.status !== 'finished' && s.round <= 1; guard++) {
      const actor = playersToAct(s)[0]!;
      if (!patched && s.status === 'playing') {
        s = structuredClone(s);
        Object.assign(s.players[0]!, { skill: 3, cash: 20 });
        patched = true;
      }
      const a = chooseAction(s, actor, DEFAULT_POLICY)!;
      if (actor === subject && a.type === 'CHANGE_JOB' && choice === '(구직 안 함)') choice = a.job;
      const r = applyAction(s, actor, a);
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    }
    first[choice] = (first[choice] ?? 0) + 1;
    // 자영업 시작 유지율
    const r = runScenario({ seed: seedBase + k, seats: [{}, {}, {}, {}], subjectSeat: 0, script: { subjectPatch: { job: 'business' } } });
    if (r.state.players[0]!.job === 'business') retained++;
  }
  return {
    seeds: `${seedBase + 1}–${seedBase + seeds}`,
    firstChoice: Object.fromEntries(Object.entries(first).map(([k, v]) => [k, v / seeds])),
    businessRetention: retained / seeds,
  };
}
