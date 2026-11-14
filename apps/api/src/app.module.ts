import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadConfig } from "./config";
import { CommonModule } from "./common/common.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadConfig] }),
    CommonModule,
    HealthModule,
  ],
})
export class AppModule {}
