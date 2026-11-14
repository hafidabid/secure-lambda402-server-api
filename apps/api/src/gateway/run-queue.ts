import { Queue } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { RUN_QUEUE_NAME, type RunJobData } from "@securelambda/schemas";
import type { AppConfig } from "../config";
import Redis from "ioredis";

export type { RunJobData };
export const RUN_QUEUE = Symbol("RUN_QUEUE");

export const runQueueProvider = {
  provide: RUN_QUEUE,
  useFactory: (configService: ConfigService<AppConfig, true>) => {
    const connection = new Redis(configService.get("REDIS_URL", { infer: true }), { maxRetriesPerRequest: null });
    return new Queue<RunJobData>(RUN_QUEUE_NAME, { connection });
  },
  inject: [ConfigService],
};
