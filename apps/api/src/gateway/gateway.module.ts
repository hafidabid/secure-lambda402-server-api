import { Module } from "@nestjs/common";
import { FacilitatorModule } from "../facilitator/facilitator.module";
import { GatewayController } from "./gateway.controller";
import { GatewayService } from "./gateway.service";
import { runQueueProvider } from "./run-queue";

@Module({
  imports: [FacilitatorModule],
  controllers: [GatewayController],
  providers: [GatewayService, runQueueProvider],
})
export class GatewayModule {}
