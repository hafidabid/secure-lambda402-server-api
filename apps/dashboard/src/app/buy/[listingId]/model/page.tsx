import { Suspense } from "react";
import { BuyModelView } from "./view";

export default function BuyModelPage() {
  return (
    <Suspense fallback={null}>
      <BuyModelView />
    </Suspense>
  );
}
