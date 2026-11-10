import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool, staleHelpers } from "./helper.ts";

test("staleHelpers: only idle and unused for >= limit prompts", () => {
  const hs = [
    { name: "a", usedAt: 0, status: "idle" as const },
    { name: "b", usedAt: 0, status: "working" as const },
    { name: "c", usedAt: 5, status: "idle" as const },
  ];
  assert.deepEqual(staleHelpers(hs, 8, 8).map((h) => h.name), ["a"]);
});

test("uniqueName de-dupes", () => {
  const p = new Pool();
  p.helpers = [{ name: "api" } as any, { name: "api-2" } as any];
  assert.equal(p.uniqueName("/x/api"), "api-3");
  assert.equal(p.uniqueName("/x/web"), "web");
});
