import { SpendGuard } from "./spend-guard";

describe("SpendGuard", () => {
  test("refuses a quote above max_price and does not count it", () => {
    const guard = new SpendGuard({});
    expect(() => guard.authorize(101n, 100n)).toThrow("exceeds max_price 100");
    expect(guard.authorizedTotal).toBe(0n);
  });

  test("refuses a quote above the per-run cap even when max_price allows it", () => {
    const guard = new SpendGuard({ maxPerRun: 50n });
    expect(() => guard.authorize(60n, 100n)).toThrow("exceeds SECURELAMBDA_MAX_PER_RUN 50");
    expect(guard.authorizedTotal).toBe(0n);
  });

  test("counts spend across calls and refuses the one that would cross the session budget", () => {
    const guard = new SpendGuard({ sessionBudget: 100n });
    guard.authorize(40n, 40n);
    guard.authorize(60n, 60n);
    expect(guard.authorizedTotal).toBe(100n);
    expect(() => guard.authorize(1n, 1n)).toThrow("over SECURELAMBDA_SESSION_BUDGET 100");
    expect(guard.authorizedTotal).toBe(100n);
  });

  test("allows a quote exactly at every limit", () => {
    const guard = new SpendGuard({ maxPerRun: 10n, sessionBudget: 10n });
    guard.authorize(10n, 10n);
    expect(guard.authorizedTotal).toBe(10n);
  });
});
