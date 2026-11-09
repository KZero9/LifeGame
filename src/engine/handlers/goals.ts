// 인생 목표 선택 (DESIGN_PHASE3.md 10.2). 받은 카드 안에서 정해진 장수인지는 validate.ts가 검사한다

import { resumeAfterGoalPicks } from '../flow';
import { pickGoals } from '../goals';
import type { Handler } from './types';

export const PICK_GOALS: Handler<'PICK_GOALS'> = {
  check() {
    return null;
  },
  apply(draft, actor, { goalIds }, ctx) {
    pickGoals(draft, ctx, actor, goalIds);
    resumeAfterGoalPicks(draft, ctx);
  },
};
