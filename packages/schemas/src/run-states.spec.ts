import { canTransition, isTerminal, RUN_TRANSITIONS, RUN_STATES } from "./run-states";

describe("run state machine (docs/03 B5 Figure 2)", () => {
  it("every state referenced in a transition list is a known state", () => {
    for (const [from, tos] of Object.entries(RUN_TRANSITIONS)) {
      expect(RUN_STATES).toContain(from);
      for (const to of tos) expect(RUN_STATES).toContain(to);
    }
  });

  it("terminal states have no outgoing transitions", () => {
    for (const state of RUN_STATES) {
      if (isTerminal(state)) {
        expect(RUN_TRANSITIONS[state]).toEqual([]);
      }
    }
  });

  it("the happy path is a valid chain: REQUESTED -> ... -> SETTLED", () => {
    const path = [
      "REQUESTED",
      "PAYMENT_VERIFIED",
      "QUEUED",
      "SUBMITTED",
      "EXECUTING",
      "RESULT_READY",
      "SETTLED",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it("RN-06: a run cannot move directly from SUBMITTED to SETTLED, skipping result and settlement checks", () => {
    expect(canTransition("SUBMITTED", "SETTLED")).toBe(false);
  });

  it("a settled run cannot transition anywhere else (no double settlement)", () => {
    expect(canTransition("SETTLED", "SETTLE_PENDING")).toBe(false);
  });
});
