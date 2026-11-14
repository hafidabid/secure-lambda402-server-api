import { Module } from "@nestjs/common";
import { RunsController, SellerRunsController } from "./runs.controller";
import { RunsService } from "./runs.service";

@Module({
  controllers: [RunsController, SellerRunsController],
  providers: [RunsService],
})
export class RunsModule {}
