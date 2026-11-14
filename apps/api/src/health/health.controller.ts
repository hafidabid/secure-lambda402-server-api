import { Controller, Get, HttpCode, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis.service";

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get("healthz")
  @HttpCode(200)
  liveness(): { ok: true } {
    return { ok: true };
  }

  /** AP-16: readiness fails closed (503) if Postgres or Redis is unreachable, so the gateway never issues a 402 it can't honour. */
  @Get("readyz")
  @HttpCode(200)
  async readiness(): Promise<{ ok: true }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.client.ping();
    } catch (err) {
      throw new ServiceUnavailableException(`not ready: ${(err as Error).message}`);
    }
    return { ok: true };
  }
}
