import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NearFacilitator, NearRpcChain, SandboxFacilitator, type FacilitatorPort } from "@securelambda/facilitator";
import { RedisService } from "../common/redis.service";
import type { AppConfig } from "../config";

export const FACILITATOR_PORT = Symbol("FACILITATOR_PORT");

@Module({
  providers: [
    {
      provide: FACILITATOR_PORT,
      useFactory: (redisService: RedisService, config: ConfigService<AppConfig, true>): FacilitatorPort => {
        if (config.get("FACILITATOR_MODE", { infer: true }) !== "near") {
          return new SandboxFacilitator(redisService.client);
        }
        const relayerAccountId = config.get("RELAYER_ACCOUNT", { infer: true });
        const relayerPrivateKey = config.get("RELAYER_KEY", { infer: true });
        if (!relayerAccountId || !relayerPrivateKey) {
          throw new Error("FACILITATOR_MODE=near needs RELAYER_ACCOUNT and RELAYER_KEY");
        }
        const tokenContract = config.get("PAYMENT_TOKEN_CONTRACT", { infer: true });
        if (!tokenContract) throw new Error("FACILITATOR_MODE=near needs PAYMENT_TOKEN_CONTRACT (e.g. wrap.testnet)");
        const chain = new NearRpcChain({
          rpcUrl: config.get("NEAR_RPC_URL", { infer: true }),
          networkId: config.get("NEAR_NETWORK", { infer: true }),
          relayerAccountId,
          relayerPrivateKey,
        });
        return new NearFacilitator(redisService.client, chain, [tokenContract]);
      },
      inject: [RedisService, ConfigService],
    },
  ],
  exports: [FACILITATOR_PORT],
})
export class FacilitatorModule {}
