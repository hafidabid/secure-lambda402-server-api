import { Injectable, NotFoundException } from "@nestjs/common";
import { Run, Receipt } from "@securelambda/schemas";
import { PrismaService } from "../common/prisma.service";
import { loadReceipt } from "../common/receipt";

/** Convert a DB run (with camelCase, Json resultJson) to API format (snake_case, mapped result). */
export function toRunDto(dbRun: any): Run {
  return {
    id: dbRun.id,
    listing_id: dbRun.listingId,
    buyer_id: dbRun.buyerId,
    model_id: dbRun.modelId,
    state: dbRun.state,
    payment_nonce: dbRun.paymentNonce,
    attempt: dbRun.attempt,
    exec_tx_hash: dbRun.execTxHash ?? null,
    result: dbRun.resultJson ?? null,
    error_code: dbRun.errorCode ?? null,
    mode: dbRun.mode,
    created_at: dbRun.createdAt.toISOString(),
    updated_at: dbRun.updatedAt.toISOString(),
  };
}

@Injectable()
export class RunsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get a single run by id.
   * RN-01: if run not found, throw NotFoundException (404).
   * Only the buyer who paid for the run may read it (it carries their result). Anyone else gets the same 404,
   * so run ids cannot be probed.
   */
  async getRun(runId: string, accountId: string): Promise<Run> {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
    });

    if (!run || run.buyerId !== accountId) {
      throw new NotFoundException(`Run not found: ${runId}`);
    }

    return toRunDto(run);
  }

  /**
   * Get a run's receipt info (attestation + payment).
   * RN-*: If run doesn't exist, throw NotFoundException (404).
   * Returns receipt with defaults for missing attestation/payment.
   */
  async getReceipt(runId: string, accountId: string): Promise<Receipt> {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
    });

    if (!run || run.buyerId !== accountId) {
      throw new NotFoundException(`Run not found: ${runId}`);
    }

    return loadReceipt(this.prisma, run);
  }

  /**
   * List runs for a given seller's listings.
   * Only returns id, buyer_id, state, created_at (no result/metrics per US-10).
   */
  async getSellerRuns(sellerId: string): Promise<any[]> {
    // Find all listing IDs owned by this seller
    const listings = await this.prisma.listing.findMany({
      where: { sellerId },
      select: { id: true },
    });

    const listingIds = listings.map((l) => l.id);

    if (listingIds.length === 0) {
      return [];
    }

    // Find all runs for those listings, order by createdAt descending
    const runs = await this.prisma.run.findMany({
      where: { listingId: { in: listingIds } },
      orderBy: { createdAt: "desc" },
    });

    // Map to the seller view (no result field)
    return runs.map((run) => ({
      id: run.id,
      buyer_id: run.buyerId,
      state: run.state,
      created_at: run.createdAt.toISOString(),
    }));
  }
}
