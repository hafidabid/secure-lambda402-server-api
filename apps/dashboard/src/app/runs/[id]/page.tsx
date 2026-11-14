import { Suspense } from "react";
import { RunView } from "./view";

export default function RunPage() {
  return (
    <Suspense fallback={null}>
      <RunView />
    </Suspense>
  );
}
