import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiError } from "@securelambda/schemas";
import { SellerAllowListGuard } from "./seller-allow-list.guard";
import type { AppConfig } from "../config";

/**
 * Creates a fake ExecutionContext with the given headers.
 * Used for unit testing the guard without full NestJS TestingModule machinery.
 */
function fakeContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe("SellerAllowListGuard", () => {
  describe("AU-01: Positive case - valid seller in allow-list", () => {
    it("should return true when x-account-id is in the allow-list", () => {
      const configService = {
        get: () => "seller.testnet,hospital.testnet",
      } as unknown as ConfigService<AppConfig, true>;

      const guard = new SellerAllowListGuard(configService);
      const context = fakeContext({ "x-account-id": "seller.testnet" });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe("AU-02: Negative case - invalid account not in allow-list", () => {
    it("should throw ApiError with FORBIDDEN when account is not in the allow-list", () => {
      const configService = {
        get: () => "seller.testnet,hospital.testnet",
      } as unknown as ConfigService<AppConfig, true>;

      const guard = new SellerAllowListGuard(configService);
      const context = fakeContext({ "x-account-id": "attacker.testnet" });

      expect(() => guard.canActivate(context)).toThrow(ApiError);
      expect(() => guard.canActivate(context)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    });
  });

  describe("Edge case: Missing x-account-id header", () => {
    it("should throw ApiError with UNAUTHENTICATED when x-account-id header is missing", () => {
      const configService = {
        get: () => "seller.testnet,hospital.testnet",
      } as unknown as ConfigService<AppConfig, true>;

      const guard = new SellerAllowListGuard(configService);
      const context = fakeContext({});

      expect(() => guard.canActivate(context)).toThrow(ApiError);
      expect(() => guard.canActivate(context)).toThrow(
        expect.objectContaining({ code: "UNAUTHENTICATED" }),
      );
    });
  });

  describe("Edge case: Empty x-account-id header", () => {
    it("should throw ApiError with UNAUTHENTICATED when x-account-id header is empty", () => {
      const configService = {
        get: () => "seller.testnet,hospital.testnet",
      } as unknown as ConfigService<AppConfig, true>;

      const guard = new SellerAllowListGuard(configService);
      const context = fakeContext({ "x-account-id": "" });

      expect(() => guard.canActivate(context)).toThrow(ApiError);
      expect(() => guard.canActivate(context)).toThrow(
        expect.objectContaining({ code: "UNAUTHENTICATED" }),
      );
    });
  });

  describe("Edge case: Empty allow-list", () => {
    it("should reject all accounts when allow-list env var is empty", () => {
      const configService = {
        get: () => "",
      } as unknown as ConfigService<AppConfig, true>;

      const guard = new SellerAllowListGuard(configService);
      const context = fakeContext({ "x-account-id": "any-account.testnet" });

      expect(() => guard.canActivate(context)).toThrow(ApiError);
      expect(() => guard.canActivate(context)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    });
  });

  describe("Additional cases", () => {
    it("should handle whitespace in account id correctly", () => {
      const configService = {
        get: () => "seller.testnet,hospital.testnet",
      } as unknown as ConfigService<AppConfig, true>;

      const guard = new SellerAllowListGuard(configService);
      // Account id with leading/trailing whitespace should be rejected (exact match)
      const context = fakeContext({ "x-account-id": " seller.testnet " });

      expect(() => guard.canActivate(context)).toThrow(ApiError);
    });

    it("should attach account id to request when access is granted", () => {
      const configService = {
        get: () => "seller.testnet",
      } as unknown as ConfigService<AppConfig, true>;

      const guard = new SellerAllowListGuard(configService);
      const request = { headers: { "x-account-id": "seller.testnet" } };
      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as unknown as ExecutionContext;

      guard.canActivate(context);

      expect((request as any).accountId).toBe("seller.testnet");
    });

    it("should handle allow-list with whitespace correctly", () => {
      const configService = {
        get: () => " seller.testnet , hospital.testnet ",
      } as unknown as ConfigService<AppConfig, true>;

      const guard = new SellerAllowListGuard(configService);
      const context = fakeContext({ "x-account-id": "seller.testnet" });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});
