import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { wrapReadOnly } from "./sandbox.ts";

test("no sandbox -> null (fail closed)", () => {
  assert.equal(wrapReadOnly("ls", "win32", () => false), null);
  assert.equal(wrapReadOnly("ls", "linux", () => false), null);
});

test("quotes the command", () => {
  const w = wrapReadOnly("echo 'hi'", "linux", (p) => p === "/usr/bin/bwrap")!;
  assert.ok(w.endsWith(`/bin/bash -c 'echo '\\''hi'\\'''`));
});

test("real darwin sandbox blocks writes, allows reads and tmp", { skip: process.platform !== "darwin" }, () => {
  const dir = mkdtempSync(join(process.cwd(), ".sbx-"));
  try {
    const run = (c: string) => execSync(wrapReadOnly(c)!, { stdio: "pipe" });
    assert.throws(() => run(`touch ${dir}/x`));
    assert.ok(!existsSync(join(dir, "x")));
    run(`ls ${dir}`);
    const ok = join(tmpdir(), `sbx-ok-${process.pid}`);
    run(`echo hi > ${ok}`);
    rmSync(ok);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
