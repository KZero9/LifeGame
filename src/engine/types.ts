// 상태·행동·카드 데이터 타입 (DESIGN_PHASE3.md 15장 구현 계약)
// 상태 객체가 유일한 사실 기준이다. 로그는 설명과 재생용이며 상태를 대신하지 않는다.

export type PlayerId = string;
export type Job = 'none' | 'parttime' | 'office' | 'tech' | 'business';
export type Stage = 'youth' | 'middle' | 'senior';
export type Controller = 'human' | 'ai';

/** 카드 id 목록. drawPile[0]이 맨 위 */
export interface Deck {
  drawPile: string[];
  discard: string[];
}

export interface GoalInstance {
  goalId: string;
  /** 누적형은 이 라운드 이후 실적만 셈 */
  pickedRound: number;
  /** 누적형: 센 프로젝트 instanceId */
  countedProjectIds: string[];
  /** 유지형 실패 저장. 달성 여부는 종료 시 계산 */
  status: 'active' | 'failed';
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  controller: Controller;
  seat: number;
  cash: number;
  debt: number;
  health: number;
  skill: number;
  job: Job;
  position: number;
  hospitalized: boolean;
  goals: GoalInstance[];
  /** K01: 플레이어별 목표 덱 */
  goalDeck: Deck;
}

export interface ProjectInstance {
  instanceId: string;
  cardId: string;
  openerId: PlayerId;
  /** P09: 정가 (가격 범위 기준) */
  baseCost: number;
  /** P09: 실제 지출 (청산·순이익 기준) */
  paidCost: number;
  openedRound: number;
  maturityRound: number;
  /** 합계 4, 개설자 ≥ 1 */
  shares: Record<PlayerId, number>;
}

export interface SettledProject {
  instanceId: string;
  cardId: string;
  openerId: PlayerId;
  round: number;
  kind: 'matured' | 'liquidated';
  /** 만기: 총 지급액 P / 청산: floor(paidCost / 2) */
  total: number;
  /** 정산 직전 지분 */
  shares: Record<PlayerId, number>;
  payouts: Record<PlayerId, number>;
  /** 만기 정산의 주사위 (청산이면 없음) */
  dice?: number;
}

export interface TurnModifiers {
  /** 과로 경고 */
  noOvertime: boolean;
  /** 채용 공고 */
  freeJobSearch: boolean;
  /** 구조조정(아르바이트) −1 */
  workPayDelta: number;
  /** 이번 턴 개설 권한 */
  openGrant?: { source: 'market' | 'seminar' | 'collab'; discount: number };
}

export type TurnPhase = 'start' | 'move' | 'tile' | 'actions' | 'trade' | 'settle';

export interface TurnCounts {
  work: number;
  overtime: number;
  study: number;
  rest: number;
  jobSearch: number;
  open: number;
}

export interface TurnState {
  playerId: PlayerId;
  phase: TurnPhase;
  /** P07: ①에서 기록, ⑥ 퇴원 판정 */
  startedHospitalized: boolean;
  /** P01 */
  debtAtStart: number;
  /** P01 */
  repaidThisTurn: number;
  apTotal: number;
  apLeft: number;
  dice?: number;
  adjusted: boolean;
  counts: TurnCounts;
  /** 급여 기준 직업 */
  workedAsJob?: Job;
  pendingIncome: number;
  modifiers: TurnModifiers;
  /** 이번 턴 제안한 대상 */
  offerTargets: PlayerId[];
  pendingTile?: {
    cardId: string;
    branch?: string;
    optionIds: string[];
    /** 실직 분기의 복귀 대상 */
    previousJob?: Job;
  };
}

export interface ShareOffer {
  offerId: string;
  projectId: string;
  sellerId: PlayerId;
  buyerId: PlayerId;
  count: number;
  pricePerShare: number;
  status: 'pending' | 'accepted' | 'rejected' | 'invalid';
}

export interface PendingGoalPick {
  playerId: PlayerId;
  offered: string[];
  min: number;
  max: number;
}

/** 모든 상태 변화는 원인과 함께 남긴다: { round, playerId, kind, delta, cause } */
export interface LogEntry {
  round: number;
  playerId?: PlayerId;
  kind: string;
  delta?: number;
  cause: string;
}

export interface PlayerResult {
  playerId: PlayerId;
  cash: number;
  debt: number;
  /** 종료 청산으로 받은 금액 (현금에 이미 포함) */
  liquidation: number;
  /** 현금 − 부채 */
  netWorth: number;
  assetScore: number;
  goalScore: number;
  goals: { goalId: string; achieved: boolean; points: number; reason: string }[];
  health: number;
  total: number;
  /** 공동 순위 허용 (1, 1, 3 …) */
  rank: number;
}

export interface FinalResult {
  players: PlayerResult[];
}

/** 17.3 용도별 난수 스트림 키 */
export type RngStreamKey = string;

export interface GameState {
  seed: number;
  /** 용도별 난수 상태 (17.3). 키 → 32비트 내부 상태 */
  rng: Record<RngStreamKey, number>;
  /** 0 = 시작 전(setup·goalPick), 1–12 진행 */
  round: number;
  players: PlayerState[];
  turnOrder: PlayerId[];
  turnIndex: number;
  turn: TurnState | null;
  /** 이번 라운드 환경 카드 id. 첫 라운드 공개 전에는 null */
  environment: string | null;
  decks: {
    env: Deck;
    event: Record<Stage, Deck>;
    opportunity: Deck;
    expense: Deck;
    project: Deck;
  };
  /** 공개 프로젝트 카드 id */
  market: string[];
  /** 진행 중만. 정산·청산 즉시 제거 */
  projects: ProjectInstance[];
  /** 정산 결과 기록 */
  projectHistory: SettledProject[];
  pendingOffer?: ShareOffer;
  /** 설정 직후·5라운드 시작 */
  pendingGoalPicks: PendingGoalPick[];
  /** 제안·인스턴스 id 발급용 일련번호 */
  nextId: number;
  log: LogEntry[];
  status: 'setup' | 'goalPick' | 'playing' | 'finished';
  result?: FinalResult;
}

export type LifeActionKind = 'work' | 'overtime' | 'study' | 'rest';

export type Action =
  | { type: 'ROLL' }
  | { type: 'ADJUST'; delta: -1 | 0 | 1 }
  | { type: 'CHOOSE_OPTION'; optionId: string }
  | { type: 'LIFE_ACTION'; action: LifeActionKind }
  | { type: 'CHANGE_JOB'; job: Job }
  | { type: 'OPEN_PROJECT'; cardId: string }
  | { type: 'REPAY'; amount: number }
  | { type: 'OFFER_SHARES'; projectId: string; targetId: PlayerId; count: number; pricePerShare: number }
  | { type: 'RESPOND_OFFER'; offerId: string; accept: boolean }
  | { type: 'PICK_GOALS'; goalIds: string[] }
  | { type: 'END_PHASE' };

export type ActionType = Action['type'];

export type ApplyResult =
  | { ok: true; state: GameState; log: LogEntry[] }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// 카드 데이터 (JSON, 선언형). 로더와 검사는 17.2 4단계에서 구현한다.

/** 카드 적용 조건과 선택지 조건 */
export type Condition =
  | { kind: 'job'; in: Job[] }
  | { kind: 'healthAtMost'; value: number }
  | { kind: 'healthAtLeast'; value: number }
  | { kind: 'skillAtLeast'; value: number }
  | { kind: 'skillAtMost'; value: number }
  | { kind: 'cashAtLeast'; value: number }
  | { kind: 'marketNotEmpty' };

export type CardDeckKind = 'event' | 'opportunity' | 'expense' | 'rest';

export interface CardBranch {
  autoEffects?: Effect[];
  /** 있으면 isFallback 정확히 1개 */
  options?: CardOption[];
  /** 분기 설명 */
  text?: string;
}

export interface EventCard {
  id: string;
  deck: CardDeckKind;
  title: string;
  /** 불충족 → 해당 없음 */
  appliesIf?: Condition[];
  /** 사전 판정 → 분기 키. 직업이 목록에 없으면 해당 없음 */
  check?: {
    byJob: Partial<Record<Job, string | { roll: { atLeast: number; success: string; fail: string } }>>;
  };
  /** 판정이 없으면 'default' */
  branches: Record<string, CardBranch>;
}

export interface CardOption {
  id: string;
  label: string;
  isFallback?: boolean;
  conditions?: Condition[];
  apCost?: number;
  voluntaryCost?: number;
  /** 자발 비용에 더할 환경 카드 값 (불황의 재취업 비용 +1) */
  envCostDelta?: 'rehireCostDelta';
  forcedCost?: number;
  /** 순서대로 적용, 건강 판정은 모두 적용 뒤 */
  effects: Effect[];
  resultText: string;
}

export type Effect =
  | { kind: 'cash'; amount: number }
  | { kind: 'health'; amount: number }
  | { kind: 'skill'; amount: number }
  | { kind: 'ap'; amount: number }
  | { kind: 'setJob'; job: Job }
  | { kind: 'restorePreviousJob' }
  | { kind: 'modifier'; key: 'noOvertime' | 'freeJobSearch' | 'workPayDelta'; value: boolean | number }
  | { kind: 'grantOpen'; source: 'seminar' | 'collab'; discount: number };
