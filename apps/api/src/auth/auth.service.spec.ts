import { ConfigService } from "@nestjs/config";
import { randomNearPrivateKey, signNep413 } from "@securelambda/facilitator";
import { ApiError } from "@securelambda/schemas";
import { AuthService } from "./auth.service";
import { AuthMiddleware } from "./auth.middleware";
import { AuthenticatedGuard } from "./authenticated.guard";

/** The three Redis commands the auth service uses, with real GETDEL/EX semantics, in memory. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      set: async (k: string, v: string) => (store.set(k, v), "OK"),
      get: async (k: string) => store.get(k) ?? null,
      getdel: async (k: string) => {
        const v = store.get(k) ?? null;
        store.delete(k);
        return v;
      },
      del: async (k: string) => (store.delete(k) ? 1 : 0),
    },
  };
}

const config = (overrides: Record<string, unknown> = {}) =>
  ({
    get: (key: string) =>
      ({ AUTH_AUDIENCE: "securelambda-api", AUTH_SESSION_TTL_SECONDS: 3600, AUTH_CHALLENGE_TTL_SECONDS: 300, AUTH_MODE: "signed", ...overrides })[key],
  }) as unknown as ConfigService<any, true>;

function setup(fullAccess = true) {
  const redis = fakeRedis();
  const prisma = { account: { upsert: jest.fn().mockResolvedValue({}) } };
  const auth = new AuthService(redis as any, prisma as any, config(), async () => fullAccess);
  return { redis, auth, prisma };
}

async function expectUnauthenticated(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
}

describe("AuthService (NEP-413 login)", () => {
  const privateKey = randomNearPrivateKey();
  const account = "buyer.testnet";

  async function signedLogin(auth: AuthService, overrides: Partial<{ account: string; key: string; recipient: string; message: string }> = {}) {
    const challenge = await auth.createChallenge(account);
    const sig = signNep413(overrides.key ?? privateKey, {
      message: overrides.message ?? challenge.message,
      nonce: Buffer.from(challenge.nonce, "base64"),
      recipient: overrides.recipient ?? challenge.recipient,
    });
    return { challenge, sig, input: { accountId: overrides.account ?? account, publicKey: sig.publicKey, signature: sig.signature, nonce: challenge.nonce } };
  }

  it("issues a session for a valid signature and resolves it to the account", async () => {
    const { auth } = setup();
    const { input } = await signedLogin(auth);
    const session = await auth.login(input);
    expect(session.account_id).toBe(account);
    await expect(auth.resolve(session.token)).resolves.toBe(account);
  });

  it("creates the account row on a successful login, and not on a failed one", async () => {
    const { auth, prisma } = setup();
    await auth.login((await signedLogin(auth)).input);
    expect(prisma.account.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: account } }));
    const denied = setup(false);
    await expectUnauthenticated(denied.auth.login((await signedLogin(denied.auth)).input));
    expect(denied.prisma.account.upsert).not.toHaveBeenCalled();
  });

  it("stores sessions under a hash, never the raw token", async () => {
    const { auth, redis } = setup();
    const session = await auth.login((await signedLogin(auth)).input);
    expect([...redis.store.keys()].some((k) => k.includes(session.token))).toBe(false);
  });

  it("makes a challenge single-use: replaying the same signed login fails", async () => {
    const { auth } = setup();
    const { input } = await signedLogin(auth);
    await auth.login(input);
    await expectUnauthenticated(auth.login(input));
  });

  it("burns the challenge even when the attempt fails", async () => {
    const { auth } = setup();
    const { challenge, sig } = await signedLogin(auth);
    const bad = { accountId: account, publicKey: sig.publicKey, signature: Buffer.alloc(64).toString("base64"), nonce: challenge.nonce };
    await expectUnauthenticated(auth.login(bad));
    await expectUnauthenticated(auth.login({ ...bad, signature: sig.signature }));
  });

  it("rejects a signature made for a different recipient (another service)", async () => {
    const { auth } = setup();
    await expectUnauthenticated(auth.login((await signedLogin(auth, { recipient: "some-other-app" })).input));
  });

  it("rejects a signature over a different message", async () => {
    const { auth } = setup();
    await expectUnauthenticated(auth.login((await signedLogin(auth, { message: "Log in to SecureLambda as victim.testnet" })).input));
  });

  it("rejects a challenge issued to one account when another account claims it", async () => {
    const { auth } = setup();
    const { input } = await signedLogin(auth);
    await expectUnauthenticated(auth.login({ ...input, accountId: "victim.testnet" }));
  });

  it("rejects a valid signature from a key that is not a full-access key of the account", async () => {
    const { auth } = setup(false);
    await expectUnauthenticated(auth.login((await signedLogin(auth)).input));
  });

  it("rejects an unknown nonce and a malformed one", async () => {
    const { auth } = setup();
    const { input } = await signedLogin(auth);
    await expectUnauthenticated(auth.login({ ...input, nonce: Buffer.alloc(32, 7).toString("base64") }));
    await expectUnauthenticated(auth.login({ ...input, nonce: "abc" }));
  });

  it("refuses a challenge for a malformed account id", async () => {
    const { auth } = setup();
    await expect(auth.createChallenge("Not An Account!")).rejects.toBeInstanceOf(ApiError);
  });

  it("logout ends the session", async () => {
    const { auth } = setup();
    const session = await auth.login((await signedLogin(auth)).input);
    await auth.logout(session.token);
    await expect(auth.resolve(session.token)).resolves.toBeNull();
  });
});

describe("AuthMiddleware", () => {
  async function run(mode: string, headers: Record<string, string>) {
    const { auth } = setup();
    const challenge = await auth.createChallenge("buyer.testnet");
    const key = randomNearPrivateKey();
    const sig = signNep413(key, { message: challenge.message, nonce: Buffer.from(challenge.nonce, "base64"), recipient: challenge.recipient });
    const session = await auth.login({ accountId: "buyer.testnet", publicKey: sig.publicKey, signature: sig.signature, nonce: challenge.nonce });
    const req = { headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v.replace("<token>", session.token)])) } as any;
    const next = jest.fn();
    await new AuthMiddleware(auth, config({ AUTH_MODE: mode })).use(req, {} as any, next);
    return { req, next };
  }

  it("signed mode: a spoofed x-account-id is discarded", async () => {
    const { req } = await run("signed", { "x-account-id": "victim.testnet" });
    expect(req.headers["x-account-id"]).toBeUndefined();
  });

  it("signed mode: the account comes from the session, not from the header", async () => {
    const { req } = await run("signed", { "x-account-id": "victim.testnet", authorization: "Bearer <token>" });
    expect(req.headers["x-account-id"]).toBe("buyer.testnet");
  });

  it("signed mode: a bad bearer token is rejected, not treated as anonymous", async () => {
    await expect(run("signed", { authorization: "Bearer nope" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("header mode (dev only) keeps the header", async () => {
    const { req } = await run("header", { "x-account-id": "dev.testnet" });
    expect(req.headers["x-account-id"]).toBe("dev.testnet");
  });
});

describe("AuthenticatedGuard", () => {
  const ctx = (headers: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;
  it("passes with an account and fails closed without one", () => {
    const guard = new AuthenticatedGuard();
    expect(guard.canActivate(ctx({ "x-account-id": "a.testnet" }))).toBe(true);
    expect(() => guard.canActivate(ctx({}))).toThrow(expect.objectContaining({ code: "UNAUTHENTICATED" }));
    expect(() => guard.canActivate(ctx({ "x-account-id": " " }))).toThrow(expect.objectContaining({ code: "UNAUTHENTICATED" }));
  });
});
