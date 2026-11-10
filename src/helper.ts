import { realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import {
  createAgentSession,
  createBashTool,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { wrapReadOnly } from "./sandbox.ts";

export type Line = { kind: "main" | "you" | "helper" | "tool" | "error"; text: string };
export type Status = "starting" | "working" | "idle" | "closed";

const PROMPT = (name: string, repo: string, bash: boolean) => `
You are the expert on one repository: "${name}" at ${repo}. You are a long-lived helper: you keep your context across questions, and the user may talk to you directly as well as the main agent.
You only read; you never modify anything. ${bash ? "Bash runs in a read-only sandbox (writes fail): use it for git log/blame/show, rg, and read-only inspection." : "You have no bash."}
Research the real code before answering; code is the source of truth. Cite path:line for every claim. If you cannot find something, say "not found" and what you searched. Never guess.
Lead with the answer, then the evidence. Mention related files or concepts the asker will likely need next. Be concise.`;

export class Helper {
  name: string;
  repo: string;
  status: Status = "starting";
  activity = "";
  usedAt: number;
  lines: Line[] = [];
  private session!: AgentSession;
  private open?: Line;
  private chain: Promise<unknown> = Promise.resolve();
  private subs = new Set<() => void>();
  private unsub?: () => void;
  private tick: () => number;

  constructor(name: string, repo: string, tick: () => number) {
    this.name = name;
    this.repo = repo;
    this.tick = tick;
    this.usedAt = tick();
  }

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  }
  private emit() {
    for (const f of this.subs) f();
  }
  private push(kind: Line["kind"], text: string) {
    this.lines.push({ kind, text });
    this.emit();
  }

  async start(model: any, thinkingLevel: any) {
    const sandboxed = wrapReadOnly("true") !== null;
    const loader = new DefaultResourceLoader({
      cwd: this.repo,
      agentDir: getAgentDir(),
      noExtensions: true, // no recursion: helpers never load pi-docent
      noSkills: true,
      appendSystemPrompt: [PROMPT(this.name, this.repo, sandboxed)],
    });
    await loader.reload();
    const bash = sandboxed
      ? createBashTool(this.repo, {
          spawnHook: (c) => ({ ...c, command: wrapReadOnly(c.command) ?? "echo 'bash unavailable' >&2; exit 1" }),
        })
      : undefined;
    const { session } = await createAgentSession({
      cwd: this.repo,
      model,
      thinkingLevel,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(this.repo),
      tools: bash ? ["read", "grep", "find", "ls", "bash"] : ["read", "grep", "find", "ls"],
      customTools: bash ? [bash as any] : undefined,
    });
    this.session = session;
    this.unsub = session.subscribe((e: any) => this.onEvent(e));
    this.status = "idle";
    this.emit();
  }

  private onEvent(e: any) {
    switch (e.type) {
      case "agent_start":
        this.status = "working";
        this.activity = "thinking";
        break;
      case "message_update": {
        const d = e.assistantMessageEvent;
        if (d?.type === "text_delta") {
          if (!this.open) {
            this.open = { kind: "helper", text: "" };
            this.lines.push(this.open);
          }
          this.open.text += d.delta;
          this.activity = "answering";
        }
        break;
      }
      case "message_end":
        this.open = undefined;
        break;
      case "tool_execution_start": {
        const a = e.args ?? {};
        const arg = a.command ?? a.path ?? a.pattern ?? "";
        this.activity = `${e.toolName} ${String(arg).split("\n")[0]}`.slice(0, 80);
        this.lines.push({ kind: "tool", text: this.activity });
        break;
      }
      case "agent_settled":
        this.status = "idle";
        this.activity = "";
        this.open = undefined;
        break;
      default:
        return;
    }
    this.emit();
  }

  /** Main agent asks. Serialized; waits for any user-started run to finish first. */
  ask(question: string, signal?: AbortSignal, onUpdate?: (text: string) => void): Promise<string> {
    const run = this.chain.then(async () => {
      await this.session.waitForIdle();
      this.usedAt = this.tick();
      this.push("main", question);
      const stop = this.subscribe(() => onUpdate?.(`${this.name}: ${this.activity || this.status}`));
      const onAbort = () => void this.session.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        await this.session.prompt(question);
        return this.session.getLastAssistantText() ?? "(no answer)";
      } finally {
        stop();
        signal?.removeEventListener("abort", onAbort);
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }

  /** User talks to the helper directly; steers if it is mid-run. */
  say(text: string) {
    this.usedAt = this.tick();
    this.push("you", text);
    const p = this.session.isStreaming ? this.session.steer(text) : this.session.prompt(text);
    Promise.resolve(p).catch((err) => this.push("error", String(err?.message ?? err)));
  }

  abort() {
    void this.session.abort();
  }

  lastAnswer() {
    return this.session.getLastAssistantText();
  }

  async close() {
    if (this.status === "closed") return;
    this.status = "closed";
    this.unsub?.();
    try {
      await this.session.abort();
    } catch {}
    this.session.dispose();
    this.emit();
  }
}

/** Helpers not used for `limit` main prompts, and not busy. Pure for testing. */
export function staleHelpers<T extends { usedAt: number; status: Status }>(hs: T[], tick: number, limit: number): T[] {
  return hs.filter((h) => h.status === "idle" && tick - h.usedAt >= limit);
}

export class Pool {
  helpers: Helper[] = [];
  prompts = 0;
  private starting = new Map<string, Promise<Helper>>();

  find(ref: string): Helper | undefined {
    return this.helpers.find((h) => h.name === ref || h.repo === ref);
  }

  uniqueName(repo: string) {
    const base = basename(repo);
    let n = base;
    for (let i = 2; this.helpers.some((h) => h.name === n); i++) n = `${base}-${i}`;
    return n;
  }

  /** Get or spawn the helper for a repo path. */
  async get(path: string, model: any, thinkingLevel: any): Promise<Helper> {
    const repo = realpathSync(path); // throws if missing
    if (!statSync(repo).isDirectory()) throw new Error(`not a directory: ${path}`);
    const live = this.helpers.find((h) => h.repo === repo);
    if (live) return live;
    let p = this.starting.get(repo);
    if (!p) {
      const h = new Helper(this.uniqueName(repo), repo, () => this.prompts);
      p = h.start(model, thinkingLevel).then(() => {
        this.helpers.push(h);
        return h;
      });
      this.starting.set(repo, p);
      p.finally(() => this.starting.delete(repo)).catch(() => {});
    }
    return p;
  }

  async close(h: Helper) {
    this.helpers = this.helpers.filter((x) => x !== h);
    await h.close();
  }

  async closeAll() {
    await Promise.all([...this.helpers].map((h) => this.close(h)));
  }
}
