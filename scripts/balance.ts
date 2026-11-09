// 균형 측정 보고: npm run balance -- [정책 셀당 시드] [기본 판 수] [직업 비교 시드] [회복 시드]
import { RULES } from '../src/engine/data';
import { measureDefault, measureJobs, measurePolicies, measureRecovery } from '../src/sim/measure';

declare const process: { argv: string[] };
// 실험용 규칙 덮어쓰기 (데이터 파일은 바꾸지 않는다)
//   --set=move.adjustAp=2  --set=jobs.tech.pay=5  --only=default,policies,jobs,recovery
const flags = process.argv.filter((a) => a.startsWith('--'));
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let only: string[] | null = null;
for (const flag of flags) {
  const [key, ...rest] = flag.slice(2).split('=');
  if (key === 'set') {
    const [path, value] = [rest[0]!, rest[1]!];
    const keys = path.split('.');
    let target = RULES as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) target = target[k] as Record<string, unknown>;
    target[keys.at(-1)!] = Number(value);
  }
  if (key === 'only') only = rest.join('=').split(',');
}
const run = (name: string) => !only || only.includes(name);
const defaults = [250, 1000, 250, 200];
const [policySeeds, defaultGames, jobSeeds, recoverySeeds] = defaults.map((d, k) => Number(positional[k] ?? d)) as [number, number, number, number];
if (flags.length) console.log(`실험 규칙: ${flags.join(' ')}`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const f = (x: number) => x.toFixed(2);
const t0 = Date.now();

if (run('default')) {
console.log(`## 기본 AI 4인 ${defaultGames}판`);
const d = measureDefault(defaultGames);
console.log(`- 평균 최종 점수 ${f(d.meanTotal)} (자산 ${f(d.meanAsset)}, 목표 ${f(d.meanGoal)}), 점수 비중 자산 ${pct(d.assetShare)} / 목표 ${pct(d.goalShare)}`);
console.log(`- 자리별 승률: ${d.seatWinRate.map(pct).join(' / ')}`);
console.log(`- 이동 조정 사용률 ${pct(d.adjustRate)}, 시장 칸 도달률 ${pct(d.marketReachRate)}`);
console.log(`- 칸별 도달 빈도: ${d.tileFrequency.map((x, i) => `${i}:${pct(x)}`).join(' ')}`);
console.log(`- 최종 직업 비율: ${Object.entries(d.finalJobs).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}; 사무직을 한 번이라도 가진 비율 ${pct(d.officeEverRate)}`);
console.log(`- 거래: 제안 ${d.offers}, 성립 ${d.trades} (${pct(d.trades / Math.max(1, d.offers))}), 성립 거래 중 양측 기대 순이익 ≥ 0 ${pct(d.tradeBothNonNegative)}, 구매자 평균 기대 순이익 ${f(d.buyerNetMean)}`);
console.log(`- 구조조정 실직 ${d.laidOff.count}명의 최종 순위 분포: ${d.laidOff.rankDist.map(pct).join(' / ')}`);
console.log(`- 경조사 참석 ${d.celebration.attend}, 불참 ${d.celebration.skip}`);
console.log(`- 판당 입원 ${f(d.hospitalizations)}, 판당 개설 ${f(d.projectsOpened)}, 개설자 직업 ${JSON.stringify(d.projectsByJob)}`);
console.log(`- 목표 달성률: ${Object.entries(d.goalsAchievedRate).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`);
console.log(`- 자영업 경험자 ${d.bizCash.players}명 현금흐름 합: 근무 ${d.bizCash.wage}, 개업비 −${d.bizCash.fee}, 만기 지급 ${d.bizCash.payout}, 지분 판매 ${d.bizCash.shareSales}`);

}

if (run('policies')) {
  console.log(`\n## 정책별 승률 (5개 중 4개 × 자리 순환 4 × 시드 ${policySeeds})`);
  for (const r of measurePolicies(policySeeds)) {
    console.log(`- ${r.policy}: 승률 ${pct(r.winRate)} (${r.games}판), 평균 점수 ${f(r.meanTotal)} [95% CI ${f(r.ci[0])}, ${f(r.ci[1])}]`);
  }
}

if (run('jobs')) {
  console.log(`\n## 직업 비교 (시나리오 하네스, 시드 ${jobSeeds})`);
  for (const r of measureJobs(jobSeeds)) console.log(`- ${r.job}: 평균 ${f(r.meanTotal)}, 표준편차 ${f(r.sd)}, 1위 비율 ${pct(r.winRate)}`);
}

if (run('recovery')) {
  console.log(`\n## 회복 (아르바이트 정책, 2인, 시드 ${recoverySeeds})`);
  for (const r of measureRecovery(recoverySeeds)) console.log(`- ${r.start}: 부채 0 도달 ${pct(r.recoveredRate)}, 평균 도달 라운드 ${f(r.meanRounds)}`);
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}초)`);
