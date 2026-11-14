import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ApiErrorFilter } from "./common/api-error.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  app.useGlobalFilters(new ApiErrorFilter());
  app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
