// 규칙 엔진 공개 API. React·브라우저 API에 의존하지 않는다 (17.1)
export * from './types';
export { applyAction, checkAction } from './applyAction';
export { getLegalActions, playersToAct } from './legal';
export { checkInvariants } from './invariants';
export { RULES, ENVIRONMENTS, environmentCard, stageRule, tileKind } from './data';
export type { TileKind, Rules, JobRule, EnvironmentCard } from './data';
export { createGame, START_STATE, MIN_PLAYERS, MAX_PLAYERS } from './setup';
export type { GameConfig, PlayerConfig, CreateResult } from './setup';
export { REJECT_MESSAGES } from './validate';
export type { RejectReason } from './validate';
export { RngStreams } from './rng';
