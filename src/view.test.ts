import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { HelperView } from "./view.ts";

initTheme();

const theme = { fg: (_c: string, s: string) => s };
const mk = () => {
  const h: any = { name: "api", repo: "/x/api", status: "working", activity: "bash git log", lines: [
    { kind: "main", text: "how are tokens issued?" }, { kind: "tool", text: "read src/a.ts" },
    { kind: "helper", text: "**Tokens** issued in `src/auth.ts:10`" }, { kind: "you", text: "check refresh too" }],
    subscribe: () => () => {}, say() {}, abort() {} };
  return { h, pool: { helpers: [h], close: async () => {} } as any };
};

test("overlay renders within width, handles keys", () => {
  const { h, pool } = mk();
  let finished = false;
  const v = new HelperView({ requestRender() {} }, theme, pool, h, () => (finished = true));
  for (const w of [20, 60, 120]) for (const l of v.render(w)) assert.ok(visibleWidth(l) <= w, `${w}: ${l}`);
  assert.ok(v.render(80).join("\n").includes("tokens") || v.render(80).join("\n").includes("Tokens"));
  v.handleInput("\x1b"); // esc
  assert.ok(finished);
});
