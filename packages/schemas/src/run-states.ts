/**
 * Run lifecycle states per docs/03 B5 (Figure 2) and docs/05 section 7 (RN-*
 * test cases). Terminal states are SETTLED (success) and
 * FAILED_NOT_CHARGED / PAYMENT_REJECTED (buyer never charged).
 */
export const RUN_STATES = [
  "REQUESTED",
  "PAYMENT_VERIFIED",
  "PAYMENT_REJECTED",
  "QUEUED",
  "SUBMITTED",
  "POLLING",
  "RETRYING",
  "EXECUTING",
  "RESULT_READY",
  "SETTLE_PENDING",
  "SETTLED",
  "FAILED_NOT_CHARGED",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<RunState> = new Set([
  "SETTLED",
  "FAILED_NOT_CHARGED",
  "PAYMENT_REJECTED",
]);

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Valid from -> to transitions. Used to guard every state write. */
export const RUN_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  REQUESTED: ["PAYMENT_VERIFIED", "PAYMENT_REJECTED"],
  PAYMENT_VERIFIED: ["QUEUED"],
  PAYMENT_REJECTED: [],
  QUEUED: ["SUBMITTED"],
  SUBMITTED: ["EXECUTING", "POLLING", "RETRYING"],
  EXECUTING: ["RESULT_READY", "RETRYING", "FAILED_NOT_CHARGED"],
  POLLING: ["EXECUTING", "RESULT_READY", "FAILED_NOT_CHARGED"],
  RETRYING: ["QUEUED", "FAILED_NOT_CHARGED"],
  RESULT_READY: ["SETTLED", "SETTLE_PENDING"],
  SETTLE_PENDING: ["SETTLED"],
  SETTLED: [],
  FAILED_NOT_CHARGED: [],
};

export function canTransition(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export const MAX_RUN_ATTEMPTS = 3;
export const POLL_INTERVAL_MS = 3_000;
export const POLL_DEADLINE_MS = 180_000;
export const BACKGROUND_POLL_DEADLINE_MS = 600_000;
export const PAYMENT_VALID_MS = 15 * 60 * 1000;
