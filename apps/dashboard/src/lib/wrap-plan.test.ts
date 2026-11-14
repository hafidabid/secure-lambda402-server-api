import { test } from "node:test";
import assert from "node:assert/strict";
import { planWrap } from "./wrap-plan.ts";

const near = (amount: number) => BigInt(amount * 1000) * BigInt("1000000000000000000000");

test("enough wNEAR already: nothing to wrap", () => {
  assert.equal(planWrap({ price: near(2), balance: near(3), registered: true }), null);
  assert.equal(planWrap({ price: near(2), balance: near(2), registered: true }), null);
});

test("short on wNEAR: wrap only the missing amount", () => {
  assert.deepEqual(planWrap({ price: near(2), balance: near(0.5), registered: true }), { register: false, wrapYocto: near(1.5) });
});

test("never held wNEAR: register on the token and wrap the full price", () => {
  assert.deepEqual(planWrap({ price: near(2), balance: BigInt(0), registered: false }), { register: true, wrapYocto: near(2) });
});
