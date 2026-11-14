import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { codeFence } from "./docs-code.ts";

test("reads the language and source of an MDX fence, dropping the trailing newline", () => {
  const children = createElement("code", { className: "language-bash" }, "curl https://api/v1/evaluator\n");
  assert.deepEqual(codeFence(children), { lang: "bash", code: "curl https://api/v1/evaluator" });
});

test("a fence without a language is plain text", () => {
  const children = createElement("code", null, "{ \"ok\": true }\n");
  assert.deepEqual(codeFence(children), { lang: "text", code: "{ \"ok\": true }" });
});

test("anything that is not a single code element with text is not a fence", () => {
  assert.equal(codeFence("loose text"), null);
  assert.equal(codeFence(createElement("code", { className: "language-ts" }, createElement("b", null, "x"))), null);
});
