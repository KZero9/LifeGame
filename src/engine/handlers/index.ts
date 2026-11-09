// 행동별 처리기 등록. 구현 단계마다 여기에 추가한다
import { REPAY } from './debt';
import { CHOOSE_OPTION } from './tile';
import { CHANGE_JOB, LIFE_ACTION } from './life';
import { ADJUST, END_PHASE, ROLL } from './turn';
import type { HandlerTable } from './types';

export const HANDLERS: HandlerTable = {
  ROLL,
  ADJUST,
  END_PHASE,
  LIFE_ACTION,
  CHANGE_JOB,
  REPAY,
  CHOOSE_OPTION,
};
