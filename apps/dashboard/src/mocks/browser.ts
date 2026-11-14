import { setupWorker } from "msw/browser";
import { handlers, scenarioFrom } from "./handlers";

export async function startMocks() {
  const worker = setupWorker(...handlers(scenarioFrom(window.location.search)));
  await worker.start({ onUnhandledRequest: "bypass", quiet: true });
}
