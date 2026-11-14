import { Suspense } from "react";
import { BuyRunView } from "./view";

export default function BuyRunPage() {
  return (
    <Suspense fallback={null}>
      <BuyRunView />
    </Suspense>
  );
}
