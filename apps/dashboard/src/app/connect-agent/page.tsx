import { Suspense } from "react";
import { ConnectAgentView } from "./view";

export default function ConnectAgentPage() {
  return (
    <Suspense fallback={null}>
      <ConnectAgentView />
    </Suspense>
  );
}
