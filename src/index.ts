import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Pool, staleHelpers, type Helper } from "./helper.ts";
import { HelperView, widgetLines, type ViewResult } from "./view.ts";

const IDLE_PROMPTS = Number(process.env.PI_DOCENT_IDLE_PROMPTS) || 8;
const WIDGET = "pi-docent";
const abs = (cwd: string, p: string) => resolve(cwd, p.startsWith("~") ? p.replace("~", homedir()) : p);

export default function (pi: ExtensionAPI) {
  const pool = new Pool();
  let ui: any; // latest ctx.ui, for widget refresh from async helper events
  const watched = new WeakSet<Helper>();

  const refresh = () => {
    if (!ui) return;
    ui.setWidget(WIDGET, pool.helpers.length ? widgetLines(pool, ui.theme) : undefined);
  };
  const track = (h: Helper) => {
    if (watched.has(h)) return;
    watched.add(h);
    h.subscribe(refresh);
  };

  pi.on("session_start", (_e, ctx) => {
    ui = ctx.ui;
  });

  pi.on("session_shutdown", async () => {
    await pool.closeAll();
    ui?.setWidget(WIDGET, undefined);
  });

  pi.on("before_agent_start", async (event: any, ctx) => {
    if (event.messageType === "user") {
      pool.prompts++;
      for (const h of staleHelpers(pool.helpers, pool.prompts, IDLE_PROMPTS)) {
        await pool.close(h);
        ctx.ui.notify(`closed helper ${h.name} (unused for ${IDLE_PROMPTS} prompts)`, "info");
      }
      refresh();
    }
    const sections = event.systemPromptOptions?.sections;
    if (sections) {
      if (pool.helpers.length)
        sections.helpers = pool.helpers.map((h) => `- ${h.name}: ${h.repo} (${h.status})`).join("\n") +
          "\nThese helpers are alive; ask follow-ups with helper_ask, close with helper_close when done with the repo.";
      else delete sections.helpers;
    }
  });

  pi.registerTool({
    name: "helper_ask",
    label: "Helper",
    description:
      "Ask a persistent read-only helper agent that is the expert on one repository (any local path). Spawns it on first use and keeps it alive with its context, so follow-ups are cheap. Answers cite path:line.",
    promptSnippet: "Ask a persistent per-repo expert helper about a repo outside the current project",
    promptGuidelines: [
      "Use helper_ask when the task requires understanding code in a repository outside the current working directory, instead of reading that repo yourself.",
      "Use helper_ask with the same repo for follow-ups: the helper remembers earlier questions. Call it for several repos in parallel when needed.",
      "Use helper_close when you are done with a repo and the conversation moves on.",
    ],
    parameters: Type.Object({
      repo: Type.String({ description: "Repo path, or name of a live helper" }),
      question: Type.String({ description: "A precise question" }),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      ui = ctx.ui;
      const h =
        pool.find(params.repo) ?? (await pool.get(abs(ctx.cwd, params.repo), ctx.model, pi.getThinkingLevel()));
      track(h);
      refresh();
      const text = await h.ask(params.question, signal, (t) =>
        onUpdate?.({ content: [{ type: "text", text: t }], details: { helper: h.name } }),
      );
      return { content: [{ type: "text", text }], details: { helper: h.name, repo: h.repo } };
    },
  });

  pi.registerTool({
    name: "helper_close",
    label: "Close helper",
    description: "Close the helper for a repo once the conversation no longer needs it.",
    parameters: Type.Object({ repo: Type.String({ description: "Helper name or repo path" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const h = pool.find(params.repo) ?? pool.find(abs(ctx.cwd, params.repo));
      if (!h) return { content: [{ type: "text", text: "no such helper" }], details: {} };
      await pool.close(h);
      refresh();
      return { content: [{ type: "text", text: `closed ${h.name}` }], details: {} };
    },
  });

  async function openView(ctx: any, ref?: string) {
    if (!pool.helpers.length) return ctx.ui.notify("no helpers running", "info");
    let h = ref ? pool.find(ref) : pool.helpers.length === 1 ? pool.helpers[0] : undefined;
    if (!h) {
      const pick = await ctx.ui.select("Talk to helper", pool.helpers.map((x) => `${x.name}  ${x.status}`));
      h = pool.helpers.find((x) => pick?.startsWith(x.name + " "));
    }
    if (!h) return;
    const start = h;
    const r: ViewResult | undefined = await ctx.ui.custom(
      (tui: any, theme: any, _kb: any, done: (r: ViewResult) => void) => new HelperView(tui, theme, pool, start, done),
      { overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center" } },
    );
    for (const t of r?.talked ?? []) {
      pi.sendMessage(
        {
          customType: "pi-docent",
          content: `The user talked to helper "${t.name}" directly. Its latest answer:\n${t.lastAnswer() ?? "(none yet)"}`,
          display: false,
        },
        { deliverAs: "nextTurn" },
      );
    }
  }

  // ctrl+n: works everywhere. alt+h: only where Option is Meta (not default on macOS).
  for (const key of ["ctrl+n", "alt+h"] as const)
    pi.registerShortcut(key, { description: "Talk to a helper agent", handler: (ctx) => openView(ctx) });
  pi.registerCommand("helpers", {
    description: "Talk to a helper agent: /helpers [name]",
    getArgumentCompletions: (p: string) => {
      const m = pool.helpers.filter((h) => h.name.startsWith(p)).map((h) => ({ value: h.name, label: h.name }));
      return m.length ? m : null;
    },
    handler: (args, ctx) => openView(ctx, args.trim() || undefined),
  });
}
