export interface SpendLimits {
  maxPerRun?: bigint;
  sessionBudget?: bigint;
}

/** Decides whether a quoted amount may be paid; amounts are token base units (yocto for wNEAR). */
export class SpendGuard {
  private authorized = 0n;

  constructor(private readonly limits: SpendLimits) {}

  get authorizedTotal(): bigint {
    return this.authorized;
  }

  /** Throws if the amount breaks a cap; otherwise counts it against the session budget. */
  authorize(amount: bigint, maxPrice: bigint): void {
    if (amount > maxPrice) {
      throw new Error(`refused: quote ${amount} exceeds max_price ${maxPrice}`);
    }
    const { maxPerRun, sessionBudget } = this.limits;
    if (maxPerRun !== undefined && amount > maxPerRun) {
      throw new Error(`refused: quote ${amount} exceeds SECURELAMBDA_MAX_PER_RUN ${maxPerRun}`);
    }
    if (sessionBudget !== undefined && this.authorized + amount > sessionBudget) {
      throw new Error(
        `refused: quote ${amount} would bring session spend to ${this.authorized + amount}, over SECURELAMBDA_SESSION_BUDGET ${sessionBudget}`,
      );
    }
    this.authorized += amount;
  }
}
