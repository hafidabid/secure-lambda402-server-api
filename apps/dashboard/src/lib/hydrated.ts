import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

// False on the server and during this component's hydration; true afterwards. Wallet state loads asynchronously,
// so components that read it must render the server placeholder until they have hydrated themselves.
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
