// 균형 측정 (DESIGN_PHASE3.md 18.3)

import { POLICY_VARIANTS, type PolicyConfig } from '../ai/policy';
import { RULES } from '../engine/data';
import { shareValue } from '../engine/projects';
import type { GameState, PlayerId } from '../engine/types';
import { compareJobs, runScenario } from './scenario';
import { runGame } from './simulate';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function ci95(xs: number[]): [number, number] {
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
  const h = (1.96 * sd) / Math.sqrt(xs.length);
  return [m - h, m + h];
}

/** 공동 1위 k명이면 각자 1/k승 */
function winShares(state: GameState): Record<PlayerId, number> {
  const top = state.result!.players.filter((p) => p.rank === 1);
  return Object.fromEntries(state.result!.players.map((p) => [p.playerId, p.rank === 1 ? 1 / top.length : 0]));
}

// ---------------------------------------------------------------------------
// 1. 정책별 승률: 5개 중 4개 조합 × 자리 순환 4 × 시드

export interface PolicyRow {
  policy: string;
  games: number;
  winRate: number;
  meanTotal: number;
  ci: [number, number];
}

export function measurePolicies(seedsPerCell: number): PolicyRow[] {
  const names = Object.keys(POLICY_VARIANTS);
  const wins: Record<string, number> = {};
  const totals: Record<string, number[]> = {};
  for (const name of names) {
    wins[name] = 0;
    totals[name] = [];
  }
  for (let skip = 0; skip < names.length; skip++) {
    const four = names.filter((_, i) => i !== skip);
    for (let rot = 0; rot < 4; rot++) {
      const seating = four.map((_, i) => four[(i + rot) % 4]!);
      for (let seed = 1; seed <= seedsPerCell; seed++) {
        const r = runGame({ seed, seats: seating.map((n) => ({ policy: POLICY_VARIANTS[n] as PolicyConfig })), checkInvariants: false });
        const ws = winShares(r.state);
        r.seatIds.forEach((id, seat) => {
          const name = seating[seat]!;
          wins[name]! += ws[id] ?? 0;
          totals[name]!.push(r.state.result!.players.find((p) => p.playerId === id)!.total);
        });
      }
    }
  }
  return names.map((policy) => ({
    policy,
    games: totals[policy]!.length,
    winRate: wins[policy]! / totals[policy]!.length,
    meanTotal: mean(totals[policy]!),
    ci: ci95(totals[policy]!),
  }));
}

// ---------------------------------------------------------------------------
// 2. 기본 AI 4인 게임에서 여러 지표를 함께 잰다

export interface DefaultMetrics {
  games: number;
  seatWinRate: number[];
  assetShare: number;
  goalShare: number;
  meanTotal: number;
  meanAsset: number;
  meanGoal: number;
  tileFrequency: number[];
  adjustRate: number;
  marketReachRate: number;
  finalJobs: Record<string, number>;
  officeEverRate: number;
  offers: number;
  trades: number;
  tradeBothNonNegative: number;
  buyerNetMean: number;
  laidOff: { count: number; rankDist: number[] };
  celebration: { attend: number; skip: number };
  hospitalizations: number;
  projectsOpened: number;
  projectsByJob: Record<string, number>;
  goalsAchievedRate: Record<string, number>;
  bizCash: { wage: number; fee: number; payout: number; shareSales: number; players: number };
}

export function measureDefault(games: number, players = 4): DefaultMetrics {
  const seatWins = Array.from({ length: players }, () => 0);
  let asset = 0;
  let goal = 0;
  const totals: number[] = [];
  const assets: number[] = [];
  const goals: number[] = [];
  const tiles = Array.from({ length: RULES.board.length }, () => 0);
  let moves = 0;
  let adjusts = 0;
  let marketReach = 0;
  const finalJobs: Record<string, number> = {};
  let officeEver = 0;
  let offers = 0;
  let trades = 0;
  let bothOk = 0;
  const buyerNets: number[] = [];
  const laidRanks = Array.from({ length: players }, () => 0);
  let laidCount = 0;
  const celebration = { attend: 0, skip: 0 };
  let hosp = 0;
  let opened = 0;
  const projectsByJob: Record<string, number> = {};
  const goalPicked: Record<string, number> = {};
  const goalDone: Record<string, number> = {};
  const biz = { wage: 0, fee: 0, payout: 0, shareSales: 0, players: 0 };

  for (let seed = 1; seed <= games; seed++) {
    const pendingEV = new Map<string, number>();
    const everOffice = new Set<string>();
    const everBusiness = new Set<string>();
    const r = runGame({
      seed: 100000 + seed,
      seats: Array.from({ length: players }, () => ({})),
      checkInvariants: false,
      afterAction(before, actor, action, after) {
        if (action.type === 'OFFER_SHARES') {
          offers++;
          const ev = shareValue(before, action.projectId, action.targetId, action.count).expected;
          pendingEV.set(after.pendingOffer!.offerId, ev);
        }
        if (action.type === 'RESPOND_OFFER' && action.accept) {
          trades++;
          const offer = before.pendingOffer!;
          const price = offer.count * offer.pricePerShare;
          const ev = pendingEV.get(offer.offerId) ?? 0;
          buyerNets.push(ev - price);
          if (Math.abs(ev - price) < 1e-9) bothOk++;
        }
        if (action.type === 'OPEN_PROJECT') {
          opened++;
          const job = before.players.find((p) => p.id === actor)!.job;
          projectsByJob[job] = (projectsByJob[job] ?? 0) + 1;
        }
        for (const p of after.players) {
          if (p.job === 'office') everOffice.add(p.id);
          if (p.job === 'business') everBusiness.add(p.id);
        }
      },
    });
    const s = r.state;
    const ws = winShares(s);
    r.seatIds.forEach((id) => {
      const seat = s.turnOrder.indexOf(id);
      seatWins[seat]! += ws[id] ?? 0;
    });
    for (const p of s.result!.players) {
      totals.push(p.total);
      assets.push(p.assetScore);
      goals.push(p.goalScore);
      asset += Math.max(0, p.assetScore);
      goal += p.goalScore;
      for (const g of p.goals) {
        goalPicked[g.goalId] = (goalPicked[g.goalId] ?? 0) + 1;
        if (g.achieved) goalDone[g.goalId] = (goalDone[g.goalId] ?? 0) + 1;
      }
    }
    for (const p of s.players) finalJobs[p.job] = (finalJobs[p.job] ?? 0) + 1;
    officeEver += everOffice.size;
    const laid = new Set<string>();
    for (const e of s.log) {
      if (e.kind === 'move') {
        moves++;
        const to = Number(/→ (\d+)번/.exec(e.cause)?.[1]);
        if (Number.isFinite(to)) {
          tiles[to]!++;
          if (RULES.board[to] === 'market') marketReach++;
        }
      }
      if (e.kind === 'ap' && e.cause.startsWith('이동 조정')) adjusts++;
      if (e.cause === '구조조정: 실직했다' && e.playerId) laid.add(e.playerId);
      if (e.kind === 'choice' && e.cause === '경조사: 현금 1로 참석') celebration.attend++;
      if (e.kind === 'choice' && e.cause === '경조사: 불참') celebration.skip++;
      if (e.kind === 'hospital') hosp++;
      if (e.playerId && everBusiness.has(e.playerId)) {
        if (e.kind === 'cash' && e.cause === '근무 수입') biz.wage += e.delta ?? 0;
        if (e.kind === 'cash' && e.cause === '개업비') biz.fee += -(e.delta ?? 0);
        if (e.kind === 'cash' && e.cause.endsWith('만기 지급')) biz.payout += e.delta ?? 0;
        if (e.kind === 'cash' && e.cause.endsWith('지분 판매')) biz.shareSales += e.delta ?? 0;
      }
    }
    biz.players += everBusiness.size;
    for (const id of laid) {
      laidCount++;
      laidRanks[s.result!.players.find((p) => p.playerId === id)!.rank - 1]!++;
    }
  }
  const n = games * players;
  return {
    games,
    seatWinRate: seatWins.map((w) => w / games),
    assetShare: asset / (asset + goal),
    goalShare: goal / (asset + goal),
    meanTotal: mean(totals),
    meanAsset: mean(assets),
    meanGoal: mean(goals),
    tileFrequency: tiles.map((t) => t / moves),
    adjustRate: adjusts / moves,
    marketReachRate: marketReach / moves,
    finalJobs: Object.fromEntries(Object.entries(finalJobs).map(([k, v]) => [k, v / n])),
    officeEverRate: officeEver / n,
    offers,
    trades,
    tradeBothNonNegative: trades ? bothOk / trades : NaN,
    buyerNetMean: mean(buyerNets),
    laidOff: { count: laidCount, rankDist: laidRanks.map((x) => x / Math.max(1, laidCount)) },
    celebration,
    hospitalizations: hosp / games,
    projectsOpened: opened / games,
    projectsByJob,
    goalsAchievedRate: Object.fromEntries(Object.keys(goalPicked).map((k) => [k, (goalDone[k] ?? 0) / goalPicked[k]!])),
    bizCash: biz,
  };
}

// ---------------------------------------------------------------------------
// 3. 직업 비교 (시나리오 하네스)

export function measureJobs(seeds: number): { job: string; meanTotal: number; sd: number; winRate: number }[] {
  const rows: Record<string, { totals: number[]; wins: number }> = {};
  for (let seed = 1; seed <= seeds; seed++) {
    for (const r of compareJobs(200000 + seed)) {
      rows[r.job] ??= { totals: [], wins: 0 };
      rows[r.job]!.totals.push(r.total);
      if (r.rank === 1) rows[r.job]!.wins++;
    }
  }
  return Object.entries(rows).map(([job, { totals, wins }]) => {
    const m = mean(totals);
    const sd = Math.sqrt(totals.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, totals.length - 1));
    return { job, meanTotal: m, sd, winRate: wins / seeds };
  });
}

// ---------------------------------------------------------------------------
// 4. 회복: 아르바이트 정책으로 부채 0까지 걸리는 라운드 수

export function measureRecovery(seeds: number): { start: string; meanRounds: number; recoveredRate: number }[] {
  const policy: PolicyConfig = { name: 'parttime', targetJob: 'parttime', repayReserve: 0 };
  const cases: { start: string; patch: Partial<GameState['players'][number]> }[] = [
    { start: '부채 1', patch: { cash: 0, debt: 1 } },
    { start: '부채 5', patch: { cash: 0, debt: 5 } },
    { start: '부채 10', patch: { cash: 0, debt: 10 } },
    { start: '부채 20', patch: { cash: 0, debt: 20 } },
    { start: '입원 직후(부채 3)', patch: { cash: 0, debt: 3, health: 0, hospitalized: true } },
  ];
  return cases.map(({ start, patch }) => {
    const rounds: number[] = [];
    let recovered = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      let found = 0;
      runScenario({
        seed: 300000 + seed,
        seats: [{ policy }, {}],
        subjectSeat: 0,
        script: { subjectPatch: patch },
        afterAction(before, _actor, _action, after) {
          if (found) return;
          const subject = after.players[0]!;
          // 대상의 턴이 끝난 직후(다음 사람 차례로 넘어감) 부채 확인
          if (before.turn?.playerId === subject.id && after.turn?.playerId !== subject.id && subject.debt === 0) found = before.round;
        },
      });
      if (found) {
        recovered++;
        rounds.push(found);
      }
    }
    return { start, meanRounds: mean(rounds), recoveredRate: recovered / seeds };
  });
}
