// 생활 행동과 구직 (DESIGN_PHASE3.md 5·6장)

import { RULES } from '../data';
import { isWorkJob, jobSkillRequirement, openingFee, overtimePay, studyCost, workPay } from '../jobs';
import { activeTurn, changeHealth, changeSkill, emit, getPlayer, payVoluntary, type Ctx } from '../state';
import type { GameState, LifeActionKind, PlayerId } from '../types';
import type { Handler } from './types';

function spendAp(state: GameState, ctx: Ctx, actor: PlayerId, ap: number, cause: string): void {
  if (ap <= 0) return;
  activeTurn(state).apLeft -= ap;
  emit(state, ctx, { playerId: actor, kind: 'ap', delta: -ap, cause });
}

const LABEL: Record<LifeActionKind, string> = { work: '근무', overtime: '추가근무', study: '학습', rest: '휴식' };

export const LIFE_ACTION: Handler<'LIFE_ACTION'> = {
  check(state, actor, { action }) {
    const turn = activeTurn(state);
    const p = getPlayer(state, actor);
    const rule = RULES.lifeActions[action];
    if (turn.counts[action] >= rule.perTurn) return 'LIMIT_REACHED'; // E14
    switch (action) {
      case 'work':
        if (!isWorkJob(p.job)) return 'NO_JOB';
        break;
      case 'overtime':
        if (turn.counts.work === 0) return 'NOT_WORKED'; // E11
        if (overtimePay(turn.workedAsJob ?? p.job) === null) return 'NO_OVERTIME_JOB'; // E13
        if (turn.modifiers.noOvertime) return 'OVERTIME_BLOCKED';
        break;
      case 'study':
        if (p.skill >= RULES.skill.max) return 'SKILL_MAX';
        break;
      case 'rest':
        break;
    }
    if (turn.apLeft < rule.ap) return 'NO_AP';
    if (action === 'study' && p.cash < studyCost(state, p)) return 'NOT_ENOUGH_CASH';
    return null;
  },
  apply(draft, actor, { action }, ctx) {
    const turn = activeTurn(draft);
    const p = getPlayer(draft, actor);
    spendAp(draft, ctx, actor, RULES.lifeActions[action].ap, LABEL[action]);
    turn.counts[action] += 1;
    switch (action) {
      case 'work': {
        turn.workedAsJob = p.job;
        const pay = workPay(draft, p.job, p.skill);
        turn.pendingIncome += pay;
        emit(draft, ctx, { playerId: actor, kind: 'income', delta: pay, cause: '근무 (⑥에서 지급)' });
        break;
      }
      case 'overtime': {
        const pay = overtimePay(turn.workedAsJob ?? p.job) ?? 0;
        turn.pendingIncome += pay;
        emit(draft, ctx, { playerId: actor, kind: 'income', delta: pay, cause: '추가근무 (⑥에서 지급)' });
        changeHealth(draft, ctx, p, RULES.lifeActions.overtime.health, '추가근무');
        break;
      }
      case 'study':
        payVoluntary(draft, ctx, p, studyCost(draft, p), '학습비');
        changeSkill(draft, ctx, p, RULES.lifeActions.study.skill, '학습');
        break;
      case 'rest':
        changeHealth(draft, ctx, p, RULES.lifeActions.rest.health, '휴식');
        break;
    }
  },
};

function jobSearchAp(state: GameState): number {
  return activeTurn(state).modifiers.freeJobSearch ? 0 : RULES.lifeActions.jobSearch.ap;
}

/** 구직: 근무 전에만, 턴당 1회, 즉시 이직 */
export const CHANGE_JOB: Handler<'CHANGE_JOB'> = {
  check(state, actor, { job }) {
    const turn = activeTurn(state);
    const p = getPlayer(state, actor);
    if (!isWorkJob(job)) return 'INVALID_FIELD';
    if (turn.counts.jobSearch >= RULES.lifeActions.jobSearch.perTurn) return 'LIMIT_REACHED'; // E50
    if (turn.counts.work > 0) return 'ALREADY_WORKED'; // E12
    if (p.job === job) return 'SAME_JOB';
    if (p.skill < jobSkillRequirement(job)) return 'SKILL_REQUIRED';
    if (turn.apLeft < jobSearchAp(state)) return 'NO_AP';
    if (p.cash < openingFee(job)) return 'NOT_ENOUGH_CASH';
    return null;
  },
  apply(draft, actor, { job }, ctx) {
    const turn = activeTurn(draft);
    const p = getPlayer(draft, actor);
    if (!isWorkJob(job)) return;
    spendAp(draft, ctx, actor, jobSearchAp(draft), '구직');
    turn.counts.jobSearch += 1;
    payVoluntary(draft, ctx, p, openingFee(job), '개업비');
    const before = p.job;
    p.job = job;
    emit(draft, ctx, { playerId: actor, kind: 'job', cause: `${before} → ${job}` });
  },
};
