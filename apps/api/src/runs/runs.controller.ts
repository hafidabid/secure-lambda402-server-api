import { Controller, Get, Headers, HttpCode, Param, Sse } from "@nestjs/common";
import { Observable, interval, map, takeWhile, mergeMap } from "rxjs";
import { MessageEvent } from "@nestjs/common";
import { isTerminal } from "@securelambda/schemas";
import { RunsService, toRunDto } from "./runs.service";
import { PrismaService } from "../common/prisma.service";

@Controller("runs")
export class RunsController {
  private sseInterval: number = 1000; // Default 1000ms, can be overridden for tests

  constructor(
    private readonly runsService: RunsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Set the poll interval for SSE (used in tests).
   */
  setSseInterval(ms: number): void {
    this.sseInterval = ms;
  }

  /**
   * GET /v1/runs/:id/receipt
   * Get run receipt info (exec_tx, settle_tx, wasm_hash, attested).
   * Returns ReceiptSchema-compliant JSON.
   * Includes defaults for missing attestation/payment (run still in progress).
   * Must come before GET /:id to take precedence.
   */
  @Get(":id/receipt")
  @HttpCode(200)
  async getReceipt(@Param("id") id: string) {
    return this.runsService.getReceipt(id);
  }

  /**
   * GET /v1/runs/:id/events
   * Server-Sent Events endpoint that polls the run's state and emits updates.
   * Completes when the run reaches a terminal state.
   * Returns Observable<MessageEvent> with data set to RunSchema-compliant Run object.
   * Must come before GET /:id to take precedence.
   */
  @Sse(":id/events")
  @HttpCode(200)
  runEvents(@Param("id") runId: string): Observable<MessageEvent> {
    return interval(this.sseInterval).pipe(
      mergeMap(async () => {
        // Get the current run state
        const run = await this.prisma.run.findUnique({
          where: { id: runId },
        });

        if (!run) {
          throw new Error(`Run not found: ${runId}`);
        }

        const runDto = toRunDto(run);
        return {
          data: runDto,
        } as MessageEvent;
      }),
      takeWhile((event: MessageEvent) => {
        // Continue polling unless the run reached a terminal state
        const runData = event.data as any;
        return !isTerminal(runData.state);
      }, true), // Include the final emission where predicate becomes false
    );
  }

  /**
   * GET /v1/runs/:id
   * Get a single run by id. Returns RunSchema-compliant JSON.
   * RN-01: if run not found, throws NotFoundException (404).
   */
  @Get(":id")
  @HttpCode(200)
  async getRun(@Param("id") id: string) {
    return this.runsService.getRun(id);
  }
}

// Separate controller for seller runs at /v1/seller/runs
@Controller("seller/runs")
export class SellerRunsController {
  constructor(private readonly runsService: RunsService) {}

  /**
   * GET /v1/seller/runs
   * Get all runs for listings owned by the given seller.
   * Returns array of { id, buyer_id, state, created_at } (no result field).
   * Reads seller id from x-account-id header.
   */
  @Get()
  @HttpCode(200)
  async getSellerRuns(@Headers("x-account-id") accountId?: string) {
    if (!accountId) {
      return [];
    }
    return this.runsService.getSellerRuns(accountId);
  }
}
