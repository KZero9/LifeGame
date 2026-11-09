// 수치 데이터 접근 (DESIGN_PHASE3.md 0장 [조정]: 수치는 데이터 파일에서 바꿀 수 있어야 한다)

import rulesJson from '../data/rules.json';
import environmentJson from '../data/environment.json';
import type { Job, Stage } from './types';

export type TileKind = 'rest' | 'opportunity' | 'event' | 'expense' | 'market';
export type WorkJob = Exclude<Job, 'none'>;

export interface StageRule {
  stage: Stage;
  fromRound: number;
  toRound: number;
  livingCost: number;
  aging: number;
}

export interface JobRule {
  skill: number;
  openingFee: number;
  /** 기본 급여. 자영업은 환경 카드의 businessPay를 쓴다 */
  pay: number;
  highSkill?: { atLeast: number; pay: number };
  /** null이면 추가근무 불가 */
  overtime: number | null;
  /** 직업 고유 학습비 (없으면 기본 학습비) */
  studyCost?: number;
}

export interface Rules {
  rounds: number;
  start: { cash: number; debt: number; health: number; skill: number; job: WorkJob; position: number };
  stages: StageRule[];
  ap: { base: number; lowHealth: number; lowHealthAtMost: number };
  health: { min: number; max: number; agingFloor: number };
  skill: { min: number; max: number };
  move: { adjustAp: number; minSteps: number; maxSteps: number };
  lifeActions: {
    work: { ap: number; perTurn: number };
    overtime: { ap: number; perTurn: number; health: number };
    study: { ap: number; perTurn: number; cost: number; skill: number };
    rest: { ap: number; perTurn: number; health: number };
    jobSearch: { ap: number; perTurn: number };
  };
  jobs: Record<WorkJob, JobRule>;
  board: TileKind[];
}

export interface EnvironmentCard {
  id: string;
  title: string;
  count: number;
  businessPay: number;
  projectDelta: number;
  techPayDelta: number;
  studyDiscount: number;
  rehireCostDelta: number;
}

export const RULES = rulesJson as Rules;
export const ENVIRONMENTS = environmentJson.cards as EnvironmentCard[];
export const DEFAULT_ENVIRONMENT = environmentJson.default;

export const WORK_JOBS: readonly WorkJob[] = ['parttime', 'office', 'tech', 'business'];

export function environmentCard(id: string | null): EnvironmentCard {
  const card = ENVIRONMENTS.find((c) => c.id === (id ?? DEFAULT_ENVIRONMENT));
  if (!card) throw new Error(`알 수 없는 환경 카드: ${String(id)}`);
  return card;
}

export function stageRule(round: number): StageRule {
  const rule = RULES.stages.find((s) => round >= s.fromRound && round <= s.toRound);
  if (!rule) throw new Error(`라운드 범위 밖: ${round}`);
  return rule;
}

export function tileKind(position: number): TileKind {
  const kind = RULES.board[position];
  if (!kind) throw new Error(`보드 범위 밖: ${position}`);
  return kind;
}
