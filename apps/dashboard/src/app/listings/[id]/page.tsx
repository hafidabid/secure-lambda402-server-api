import { Suspense } from "react";
import { ListingView } from "./view";

export default function ListingPage() {
  return (
    <Suspense fallback={null}>
      <ListingView />
    </Suspense>
  );
}
