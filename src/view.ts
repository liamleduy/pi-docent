import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Focusable,
} from "@earendil-works/pi-tui";
import type { Helper, Pool } from "./helper.ts";

export type ViewResult = { talked: Helper[] };

const dot = (h: Helper) => (h.status === "working" || h.status === "starting" ? "●" : "○");

/** Widget lines shown above the editor. */
export function widgetLines(pool: Pool, theme: any): string[] {
  const rows = pool.helpers.map((h) => {
    const st = h.status === "working" ? theme.fg("accent", h.activity || "working") : theme.fg("dim", h.status);
    return ` ${theme.fg(h.status === "working" ? "accent" : "dim", dot(h))} ${h.name}  ${st}`;
  });
  return [theme.fg("dim", ` helpers · ctrl+n or /helpers to talk to one`), ...rows];
}

/** Overlay: live transcript of one helper plus its own input. Esc leaves; the helper keeps running. */
export class HelperView implements Focusable {
  private input = new Input({ prompt: "› " });
  private idx: number;
  private scroll = 0;
  private unsub?: () => void;
  private talked = new Set<Helper>();
  private tui: any;
  private theme: any;
  private pool: Pool;
  private done: (r: ViewResult) => void;

  constructor(tui: any, theme: any, pool: Pool, start: Helper, done: (r: ViewResult) => void) {
    this.tui = tui;
    this.theme = theme;
    this.pool = pool;
    this.done = done;
    this.idx = Math.max(0, pool.helpers.indexOf(start));
    this.input.onSubmit = (v) => {
      const h = this.cur();
      if (!h || !v.trim()) return;
      h.say(v.trim());
      this.talked.add(h);
      this.input.setValue("");
      this.scroll = 0;
    };
    this.watch();
  }

  get focused() {
    return this.input.focused;
  }
  set focused(v: boolean) {
    this.input.focused = v; // IME / cursor placement
  }

  private cur(): Helper | undefined {
    return this.pool.helpers[this.idx];
  }
  private watch() {
    this.unsub?.();
    this.unsub = this.cur()?.subscribe(() => this.tui.requestRender());
  }
  private finish() {
    this.unsub?.();
    this.done({ talked: [...this.talked] });
  }

  handleInput(data: string): void {
    const h = this.cur();
    if (!h) return this.finish();
    if (matchesKey(data, "escape")) return this.finish();
    if (matchesKey(data, "tab")) {
      this.idx = (this.idx + 1) % this.pool.helpers.length;
      this.scroll = 0;
      this.watch();
    } else if (matchesKey(data, "ctrl+k")) h.abort();
    else if (matchesKey(data, "ctrl+x")) {
      void this.pool.close(h).then(() => {
        if (!this.pool.helpers.length) return this.finish();
        this.idx = Math.min(this.idx, this.pool.helpers.length - 1);
        this.watch();
        this.tui.requestRender();
      });
      return;
    } else if (matchesKey(data, "pageUp")) this.scroll += 5;
    else if (matchesKey(data, "pageDown")) this.scroll = Math.max(0, this.scroll - 5);
    else this.input.handleInput(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const t = this.theme;
    const h = this.cur();
    const inner = Math.max(10, width - 4);
    const box = (s: string) => `${t.fg("accent", "│")} ${s}${" ".repeat(Math.max(0, inner - visibleWidth(s)))} ${t.fg("accent", "│")}`;
    const rule = (l: string, r: string, label = "") => {
      const text = label ? ` ${label} ` : "";
      return t.fg("accent", l + "─" + text + "─".repeat(Math.max(0, width - 3 - visibleWidth(text))) + r);
    };
    if (!h) return [rule("┌", "┐", "no helpers"), rule("└", "┘")];

    const body: string[] = [];
    for (const l of h.lines) {
      if (l.kind === "helper") body.push(...new Markdown(l.text, 0, 0, getMarkdownTheme()).render(inner));
      else {
        const [tag, color] =
          l.kind === "main" ? ["main ▸ ", "accent"] : l.kind === "you" ? ["you ▸ ", "success"] : l.kind === "error" ? ["! ", "error"] : ["  ", "dim"];
        body.push(...wrapTextWithAnsi(t.fg(color, tag + l.text), inner));
      }
    }
    const rows = Math.max(8, Math.floor((process.stdout.rows || 30) * 0.8) - 5);
    const max = Math.max(0, body.length - rows);
    this.scroll = Math.min(this.scroll, max);
    const end = body.length - this.scroll;
    const view = body.slice(Math.max(0, end - rows), end);
    while (view.length < rows) view.push("");

    const status = h.status === "working" ? t.fg("accent", h.activity || "working") : t.fg("dim", h.status);
    const hint = "enter send · esc back · tab next · ^k abort · ^x close · pgup/dn scroll";
    return [
      rule("┌", "┐", `${h.name} (${h.repo}) ── ${status}${t.fg("accent", "")}`),
      ...view.map((l) => box(truncateToWidth(l, inner))),
      rule("├", "┤"),
      box(truncateToWidth(this.input.render(inner)[0] ?? "", inner)),
      rule("└", "┘", t.fg("dim", truncateToWidth(hint, width - 8))),
    ].map((l) => truncateToWidth(l, width));
  }

  invalidate() {}
}
