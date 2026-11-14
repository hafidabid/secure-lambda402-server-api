import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { RedisService, redisClientProvider } from "./redis.service";
import { StorageService } from "./storage.service";

@Global()
@Module({
  providers: [PrismaService, redisClientProvider, RedisService, StorageService],
  exports: [PrismaService, RedisService, StorageService],
})
export class CommonModule {}
