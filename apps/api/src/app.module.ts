import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadConfig } from "./config";
import { CommonModule } from "./common/common.module";
import { HealthModule } from "./health/health.module";
import { ListingsModule } from "./listings/listings.module";
import { AssetsModule } from "./assets/assets.module";
import { AuthModule } from "./auth/auth.module";
import { FacilitatorModule } from "./facilitator/facilitator.module";
import { GatewayModule } from "./gateway/gateway.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadConfig] }),
    CommonModule,
    HealthModule,
    ListingsModule,
    AssetsModule,
    AuthModule,
    FacilitatorModule,
    GatewayModule,
  ],
})
export class AppModule {}
