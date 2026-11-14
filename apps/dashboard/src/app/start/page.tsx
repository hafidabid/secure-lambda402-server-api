import { Suspense } from "react";
import { StartView } from "./view";

export default function StartPage() {
  return (
    <Suspense fallback={null}>
      <StartView />
    </Suspense>
  );
}
