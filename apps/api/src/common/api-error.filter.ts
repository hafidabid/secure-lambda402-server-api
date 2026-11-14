import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Response } from "express";
import { ApiError } from "@securelambda/schemas";

/**
 * Maps a thrown ApiError to the documented `{ error: { code, message,
 * retryable } }` body and HTTP status (docs/03 B4). Any other exception
 * falls through to INTERNAL. Run input/plaintext is never part of an error
 * body (docs/03 B8 "Error codes returned to buyers").
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ApiError) {
      response.status(exception.httpStatus).json(exception.toBody());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(
        typeof body === "string"
          ? { error: { code: "VALIDATION_FAILED", message: body, retryable: false } }
          : body,
      );
      return;
    }

    // eslint-disable-next-line no-console
    console.error(exception);
    response
      .status(500)
      .json({ error: { code: "INTERNAL", message: "internal error", retryable: true } });
  }
}
