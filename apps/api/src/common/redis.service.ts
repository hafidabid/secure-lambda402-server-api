import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { AppConfig } from "../config";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

export const redisClientProvider = {
  provide: REDIS_CLIENT,
  useFactory: (configService: ConfigService<AppConfig, true>) => {
    const url = configService.get("REDIS_URL", { infer: true });
    return new Redis(url, { maxRetriesPerRequest: null });
  },
  inject: [ConfigService],
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
