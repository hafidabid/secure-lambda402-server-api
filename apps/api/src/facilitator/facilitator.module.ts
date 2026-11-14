import { Module } from "@nestjs/common";
import { SandboxFacilitator } from "@securelambda/facilitator";
import { RedisService } from "../common/redis.service";

export const FACILITATOR_PORT = Symbol("FACILITATOR_PORT");

@Module({
  providers: [
    {
      provide: FACILITATOR_PORT,
      useFactory: (redisService: RedisService) => new SandboxFacilitator(redisService.client),
      inject: [RedisService],
    },
  ],
  exports: [FACILITATOR_PORT],
})
export class FacilitatorModule {}
