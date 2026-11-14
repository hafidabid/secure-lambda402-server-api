import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NearRpcReader } from "@securelambda/facilitator";
import type { AppConfig } from "../config";
import { AuthController } from "./auth.controller";
import { AuthMiddleware } from "./auth.middleware";
import { AuthService, FULL_ACCESS_KEY_CHECK } from "./auth.service";
import { AuthenticatedGuard } from "./authenticated.guard";
import { SellerAllowListGuard } from "./seller-allow-list.guard";

@Module({
  controllers: [AuthController],
  providers: [
    SellerAllowListGuard,
    AuthenticatedGuard,
    AuthService,
    AuthMiddleware,
    {
      provide: FULL_ACCESS_KEY_CHECK,
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const reader = new NearRpcReader(config.get("NEAR_RPC_URL", { infer: true }));
        return (accountId: string, publicKey: string) => reader.isFullAccessKey(accountId, publicKey);
      },
      inject: [ConfigService],
    },
  ],
  exports: [SellerAllowListGuard, AuthenticatedGuard, AuthService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes("*");
  }
}
