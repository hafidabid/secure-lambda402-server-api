/** BullMQ queue contract shared between the gateway (producer) and the worker (consumer). docs/03 B3 Redis keys: "q:runs". */
export const RUN_QUEUE_NAME = "runs";

export interface RunJobData {
  runId: string;
}
