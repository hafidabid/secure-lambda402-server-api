"use client";

import { useQuery } from "@tanstack/react-query";
import { isTerminal, POLL_INTERVAL_MS, type RunState } from "@securelambda/schemas";
import { api } from "./api";

export function useListings(q: string) {
  return useQuery({ queryKey: ["listings", q], queryFn: () => api.listListings(q || undefined) });
}

export function useListing(id: string, account?: string | null) {
  return useQuery({ queryKey: ["listing", id], queryFn: () => api.getListing(id, account), enabled: !!id });
}

export function useEvaluator() {
  return useQuery({ queryKey: ["evaluator"], queryFn: api.getEvaluator, staleTime: Infinity });
}

// ponytail: polling only; SSE (/runs/:id/events) first with this as the fallback lands with the integration
export function useRun(id: string) {
  return useQuery({
    queryKey: ["run", id],
    queryFn: () => api.getRun(id),
    refetchInterval: (q) => (q.state.data && isTerminal(q.state.data.state) ? false : POLL_INTERVAL_MS),
  });
}

// Keyed on run state so the receipt refetches once more when the run turns terminal (settle_tx lands with SETTLED).
export function useReceipt(id: string, state: RunState | undefined) {
  return useQuery({
    queryKey: ["receipt", id, state],
    queryFn: () => api.getReceipt(id),
    enabled: !!state,
    placeholderData: (prev) => prev,
    refetchInterval: state && isTerminal(state) ? false : POLL_INTERVAL_MS,
  });
}

export function useSellerRuns(account: string | null) {
  return useQuery({
    queryKey: ["seller-runs", account],
    queryFn: () => api.getSellerRuns(account ?? ""),
    enabled: !!account,
    refetchInterval: POLL_INTERVAL_MS * 2,
  });
}
