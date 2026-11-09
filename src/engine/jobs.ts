// 직업 규칙 (DESIGN_PHASE3.md 5·6·7장)

import { environmentCard, RULES, type WorkJob } from './data';
import type { GameState, Job, PlayerState } from './types';

export function isWorkJob(job: Job): job is WorkJob {
  return job !== 'none';
}

/** 근무 급여. 근무한 시점의 직업·역량·환경·턴 수정자로 정한다(5장) */
export function workPay(state: GameState, job: Job, skill: number): number {
  if (!isWorkJob(job)) return 0;
  const rule = RULES.jobs[job];
  const env = environmentCard(state.environment);
  let pay = rule.pay;
  if (job === 'business') pay = env.businessPay;
  if (rule.highSkill && skill >= rule.highSkill.atLeast) pay = rule.highSkill.pay;
  if (job === 'tech') pay += env.techPayDelta;
  pay += state.turn?.modifiers.workPayDelta ?? 0;
  return Math.max(0, pay);
}

/** 추가근무 수입. null이면 추가근무 불가 직업 */
export function overtimePay(job: Job): number | null {
  if (!isWorkJob(job)) return null;
  return RULES.jobs[job].overtime;
}

/** 학습 행동의 학습비: 기본 2, 기술직 1, 기술 전환기 −1 (최소 0) */
export function studyCost(state: GameState, p: PlayerState): number {
  const base = isWorkJob(p.job) ? (RULES.jobs[p.job].studyCost ?? RULES.lifeActions.study.cost) : RULES.lifeActions.study.cost;
  return Math.max(0, base - environmentCard(state.environment).studyDiscount);
}

export function jobSkillRequirement(job: WorkJob): number {
  return RULES.jobs[job].skill;
}

export function openingFee(job: WorkJob): number {
  return RULES.jobs[job].openingFee;
}
