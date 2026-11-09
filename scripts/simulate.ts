// 헤드리스 완주 검사: npm run sim -- [판 수] [인원]
// 예: npm run sim -- 1000 4
import { runGame } from '../src/sim/simulate';

// Node 타입 패키지 없이 쓰는 최소 선언 (vite-node로 실행)
declare const process: { argv: string[]; exit(code: number): never };

const games = Number(process.argv[2] ?? 1000);
const players = Number(process.argv[3] ?? 4);
const t0 = Date.now();
let errorCount = 0;
let decisions = 0;
const firstErrors: string[] = [];
for (let seed = 1; seed <= games; seed++) {
  const r = runGame({ seed, seats: Array.from({ length: players }, () => ({})) });
  decisions += r.decisions;
  errorCount += r.errors.length;
  if (r.errors.length && firstErrors.length < 10) firstErrors.push(...r.errors.slice(0, 10 - firstErrors.length));
}
console.log(`${players}명 AI ${games}판 완주, 오류 ${errorCount}건, 판당 결정 ${(decisions / games).toFixed(1)}회, ${((Date.now() - t0) / 1000).toFixed(1)}초`);
for (const e of firstErrors) console.log(`  ${e}`);
process.exit(errorCount === 0 ? 0 : 1);
