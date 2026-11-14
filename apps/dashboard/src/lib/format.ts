import type { ErrorCode } from "@securelambda/schemas";

const YOCTO_PER_NEAR = BigInt(10) ** BigInt(24);

export function formatNear(yocto: string): string {
  const whole = BigInt(yocto) / YOCTO_PER_NEAR;
  const frac = (BigInt(yocto) % YOCTO_PER_NEAR).toString().padStart(24, "0").slice(0, 2).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function nearToYocto(near: string): string {
  const [whole = "0", frac = ""] = near.trim().split(".");
  return (BigInt(whole) * YOCTO_PER_NEAR + BigInt(frac.padEnd(24, "0").slice(0, 24))).toString();
}

export function shortHash(value: string, keep = 8): string {
  return value.length > keep * 2 + 1 ? `${value.slice(0, keep)}…${value.slice(-keep)}` : value;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

const MESSAGES: Partial<Record<ErrorCode | "NETWORK", string>> = {
  PAYMENT_INVALID: "The payment could not be verified. You were not charged.",
  PAYMENT_EXPIRED: "The payment could not be verified. You were not charged.",
  PAYMENT_REUSED: "This payment was already used.",
  RATE_LIMITED: "Too many runs. Try again in a few minutes.",
  BUDGET_EXHAUSTED: "This listing has reached its run limit for your account.",
  ASSET_TOO_LARGE: "File is larger than the 1 MB limit.",
  ASSET_HASH_MISMATCH: "Upload was corrupted. Retry.",
  ENVELOPE_INVALID: "Could not lock the file to the evaluator. Refresh and retry.",
  EVALUATOR_MISMATCH: "This listing is paused while we verify its evaluator.",
  DATA_UNUSABLE: "The dataset could not be used for this run. You were not charged.",
  MODEL_UNUSABLE: "Your model file could not be used. Check the feature order.",
  RUN_FAILED_NOT_CHARGED: "The run did not complete. You were not charged.",
  RUN_TIMEOUT_UNKNOWN: "The run did not complete. You were not charged.",
  FORBIDDEN: "This account is not enabled for selling yet.",
  LISTING_NOT_FOUND: "This listing does not exist.",
  NETWORK: "Connection lost. Reconnecting.",
};

export function userMessage(code: ErrorCode | "NETWORK"): string {
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}
