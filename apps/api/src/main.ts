import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { ApiErrorFilter } from "./common/api-error.filter";
import { loadConfig, sellerAllowList } from "./config";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["log", "warn", "error"] });
  app.useGlobalFilters(new ApiErrorFilter());
  app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
  if (config.TRUST_PROXY_HOPS > 0) app.set("trust proxy", config.TRUST_PROXY_HOPS);

  // Callers authenticate with a bearer token, not cookies, so allowing any origin does not expose a session.
  const origins = config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: origins.includes("*") ? true : origins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-payment"],
    exposedHeaders: ["location"],
    maxAge: 600,
  });

  if (sellerAllowList(config).size === 0) {
    Logger.warn("SELLER_ALLOW_LIST is empty: any signed-in account can create and publish listings", "Bootstrap");
  }

  await app.listen(config.PORT);
}

bootstrap();
