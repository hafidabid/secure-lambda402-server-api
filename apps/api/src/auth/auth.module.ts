import { Module } from "@nestjs/common";
import { SellerAllowListGuard } from "./seller-allow-list.guard";

@Module({
  providers: [SellerAllowListGuard],
  exports: [SellerAllowListGuard],
})
export class AuthModule {}
