import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";

const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * Wrap a shell command so it cannot write to disk (except /dev and tmp).
 * Returns null when no sandbox is available: caller must then give the helper no bash (fail closed).
 */
export function wrapReadOnly(
  cmd: string,
  platform: string = process.platform,
  has: (path: string) => boolean = existsSync,
  tmp: string = tmpdir(),
): string | null {
  if (platform === "darwin" && has("/usr/bin/sandbox-exec")) {
    const t = has(tmp) ? realpathSync(tmp) : tmp;
    if (t.includes('"')) return null;
    const profile = `(version 1)(allow default)(deny file-write*)(allow file-write* (subpath "/dev") (subpath "${t}"))`;
    return `/usr/bin/sandbox-exec -p ${q(profile)} /bin/bash -c ${q(cmd)}`;
  }
  if (platform === "linux") {
    const bwrap = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"].find(has);
    if (bwrap) return `${bwrap} --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp /bin/bash -c ${q(cmd)}`;
  }
  // ponytail: kernel sandbox only; no per-command allowlist. Windows has none -> no bash.
  return null;
}
