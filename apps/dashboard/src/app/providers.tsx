"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider } from "@/lib/wallet";
import { SessionProvider } from "@/lib/session";

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const [ready, setReady] = useState(!MOCKING);

  useEffect(() => {
    if (!MOCKING) return;
    import("@/mocks/browser").then(({ startMocks }) => startMocks()).then(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <SessionProvider>{children}</SessionProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}
