// 후속 밸런스 측정: npm run followup -- [기본 판 수] [회복 시드] [편향 시드] [직업 하네스 시드] [--set=경로=값 ...]
import { RULES } from '../src/engine/data';
import { GOAL_RULES } from '../src/engine/goals';
import { measureFollowup, measureJobBias, measureRecoveryDetailed } from '../src/sim/followup';
import { measureJobs } from '../src/sim/measure';

declare const process: { argv: string[] };
const flags = process.argv.filter((a) => a.startsWith('--'));
let only: string[] | null = null;
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const flag of flags) {
  const [key, ...rest] = flag.slice(2).split('=');
  if (key === 'set') {
    // 규칙: --set=move.adjustAp=2 / 목표: --set=goals.prepared.maintenance.cashAtLeast=20
    const keys = rest[0]!.split('.');
    let target: Record<string, unknown>;
    if (keys[0] === 'goals') {
      target = GOAL_RULES.goals.find((g) => g.id === keys[1]) as unknown as Record<string, unknown>;
      keys.splice(0, 2);
    } else target = RULES as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) target = target[k] as Record<string, unknown>;
    target[keys.at(-1)!] = Number(rest[1]);
  }
  if (key === 'only') only = rest.join('=').split(',');
}
const [games, recSeeds, biasSeeds, jobSeeds] = [1000, 200, 200, 250].map((d, i) => Number(positional[i] ?? d)) as [number, number, number, number];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const f = (x: number) => x.toFixed(2);
const t0 = Date.now();
console.log(`규칙: 이동 조정 행동력 ${RULES.move.adjustAp}${flags.length ? ` (덮어쓰기 ${flags.join(' ')})` : ''}`);

const m = measureFollowup(games);
console.log(`\n## 기본 AI 4인 ${m.games}판 (시드 ${m.seeds}), 턴 ${m.turns}`);
console.log(`- 평균 점수 ${f(m.meanTotal)} (표준편차 ${f(m.scoreSd)})`);
console.log(`- 이동 조정률 ${pct(m.adjustRate)}, 사건 칸 ${pct(m.eventTileRate)}, 지출 칸 ${pct(m.expenseTileRate)}`);
console.log(`- 행동 구성(턴당 횟수): ${Object.entries(m.actionMix).sort().map(([k, v]) => `${k} ${f(v)}`).join(', ')}`);
console.log(`- 근무·추가근무만 한 턴 ${pct(m.workOnlyRate)}, 휴식 포함 턴 ${pct(m.restRate)}, 직전 턴과 같은 행동 조합 ${pct(m.identicalToPrevRate)}, 같은 조합 최장 연속 평균 ${f(m.longestSameStreakMean)}턴`);
console.log(`- 건강 ≤ 3으로 시작한 턴 ${m.lowHealthTurns}회 (${pct(m.lowHealthTurnRate)}): 휴식 ${pct(m.lowHealthRestRate)}, 이동 조정 ${pct(m.lowHealthAdjustRate)}, 회복 행동 없음 ${pct(m.lowHealthNoRecoveryActionRate)}, 다음 턴 건강 상승 ${pct(m.lowHealthNextTurnImprovedRate)}; 3턴 이상 연속 건강 ≤ 3 플레이어 ${pct(m.lowHealthStreak3Players)}; 판당 입원 ${f(m.hospitalizationsPerGame)}`);
console.log(`- 목표 (제시 / 선택 / 달성, 선택 대비 달성률):`);
for (const [id, g] of Object.entries(m.goals)) console.log(`    ${id}: ${g.offered} / ${g.picked} / ${g.achieved} (${pct(g.achieved / Math.max(1, g.picked))}, 선택률 ${pct(g.picked / Math.max(1, g.offered))})`);
console.log(`- 선택한 목표 전체 달성률 ${pct(m.pickedAchievedRate)}, 플레이어 평균 목표 점수 ${f(m.goalScoreMean)}`);
console.log(`- 판 안 플레이어 간 격차(최대 − 최소): 목표 점수 ${f(m.goalSpreadMean)}, 자산 점수 ${f(m.assetSpreadMean)}; 판 안 목표 점수 표준편차 ${f(m.goalScoreSdWithinGame)}`);
console.log(`- 부채: 한 번이라도 진 플레이어 ${pct(m.everDebtRate)}, 최대 부채 중앙값 ${m.maxDebtP50} / 90분위 ${m.maxDebtP90} / 최대 ${m.maxDebtMax}; 최대 부채 ≥ 10 ${pct(m.debt10Rate)}, ≥ 20 ${pct(m.debt20Rate)}; 부채를 진 사람 중 종료 시 0 ${pct(m.debtRecoveredRate)}, ≥ 10 중 0 ${pct(m.debt10RecoveredRate)}, ≥ 10의 최종 순위 ${m.debt10FinalRankDist.map(pct).join(' / ')}`);
console.log(`- 실직 ${m.layoffs}회: 선택 ${JSON.stringify(m.layoffChoices)}, 전문 직업 복귀 ${pct(m.reemployProRate)} (평균 ${f(m.reemployProTurnsMean)}턴), 최종 순위 ${m.layoffFinalRankDist.map(pct).join(' / ')}`);
console.log(`- 회복 중(부채 또는 실직 후) 생활 행동 진입 ${m.recoveryTurns}회: 의미 있는 선택지 평균 ${f(m.recoveryOptionsMean)}종, 선택지 없음 ${pct(m.recoveryNoOptionRate)}`);
console.log(`- 최종 직업 ${Object.entries(m.finalJobs).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}; 한 번이라도 가진 직업 ${Object.entries(m.everJob).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`);

if (!only || only.includes('recovery')) {
console.log(`\n## 회복 시나리오 (2인, 대상은 기본 AI + 남김 없이 상환, 시드 ${recSeeds})`);
for (const r of measureRecoveryDetailed(recSeeds)) {
  console.log(`- ${r.start}: 부채 0 도달 ${pct(r.reachedZeroRate)} (평균 ${f(r.meanRoundToZero)}라운드), 종료 부채 평균 ${f(r.finalDebtMean)} / 90분위 ${r.finalDebtP90}, 회복 중 선택지 ${f(r.optionsMean)}종, 종료 시 전문 직업 ${pct(r.proJobRate)}, 순위 ${r.finalRankDist.map(pct).join(' / ')}`);
}
console.log(`\n## 회복 시나리오 (아르바이트 고정, 시드 ${recSeeds}) — 8단계와 같은 조건`);
for (const r of measureRecoveryDetailed(recSeeds, 300000, { name: 'parttime', targetJob: 'parttime', repayReserve: 0 })) {
  console.log(`- ${r.start}: 부채 0 도달 ${pct(r.reachedZeroRate)} (평균 ${f(r.meanRoundToZero)}라운드), 종료 부채 평균 ${f(r.finalDebtMean)} / 90분위 ${r.finalDebtP90}, 회복 중 선택지 ${f(r.optionsMean)}종`);
}

}
if (!only || only.includes('jobs')) {
console.log(`\n## 직업 균형 (하네스, 시드 ${jobSeeds}) 대 AI 직업 평가 (시드 ${biasSeeds})`);
for (const r of measureJobs(jobSeeds)) console.log(`- 하네스 ${r.job}: 평균 ${f(r.meanTotal)}, 표준편차 ${f(r.sd)}, 1위 ${pct(r.winRate)}`);
const b = measureJobBias(biasSeeds);
console.log(`- 기본 AI가 역량 3·현금 20으로 1라운드에 처음 고른 직업 (시드 ${b.seeds}): ${Object.entries(b.firstChoice).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`);
console.log(`- 자영업으로 시작한 기본 AI가 끝까지 자영업 유지: ${pct(b.businessRetention)}`);
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}초)`);
