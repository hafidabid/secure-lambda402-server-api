"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { isTerminal, POLL_INTERVAL_MS, type RunState } from "@securelambda/schemas";
import { api } from "./api";
import { useSession } from "./session";

const FIRST_PAGE: string | null = null;

export function useListings(q: string) {
  return useInfiniteQuery({
    queryKey: ["listings", q],
    queryFn: ({ pageParam }) => api.listListings(q, pageParam),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useListing(id: string) {
  const { token } = useSession();
  return useQuery({ queryKey: ["listing", id, !!token], queryFn: () => api.getListing(id, token), enabled: !!id });
}

export function useEvaluator() {
  return useQuery({ queryKey: ["evaluator"], queryFn: api.getEvaluator, staleTime: Infinity });
}

export function useRun(id: string) {
  const { token } = useSession();
  return useQuery({
    queryKey: ["run", id, token],
    queryFn: () => api.getRun(id, token ?? ""),
    enabled: !!token,
    refetchInterval: (q) => (q.state.data && isTerminal(q.state.data.state) ? false : POLL_INTERVAL_MS),
  });
}

// Keyed on run state so the receipt refetches once more when the run turns terminal (settle_tx lands with SETTLED).
export function useReceipt(id: string, state: RunState | undefined) {
  const { token } = useSession();
  return useQuery({
    queryKey: ["receipt", id, state, token],
    queryFn: () => api.getReceipt(id, token ?? ""),
    enabled: !!state && !!token,
    placeholderData: (prev) => prev,
    refetchInterval: state && isTerminal(state) ? false : POLL_INTERVAL_MS,
  });
}

export function useSellerRuns() {
  const { token } = useSession();
  return useQuery({
    queryKey: ["seller-runs", token],
    queryFn: () => api.getSellerRuns(token ?? ""),
    enabled: !!token,
    refetchInterval: POLL_INTERVAL_MS * 2,
  });
}
