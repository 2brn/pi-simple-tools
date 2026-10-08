/**
 * A small, foreground subagent tool.
 *
 * Each invocation starts an isolated `pi --mode json` child process. The child
 * is ephemeral, has extensions and MCP disabled, and receives a role-specific
 * tool allowlist. Set PI_SIMPLE_TOOLS_PI when `pi` is not on PATH.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROLES = Object.freeze({
  scout: {
    tools: ["read", "grep", "find", "ls"],
    prompt: "You are a concise read-only scout. Inspect the requested workspace, cite relevant paths, and report findings. Do not modify files.",
  },
  reviewer: {
    tools: ["read", "grep", "find", "ls"],
    prompt: "You are a focused read-only reviewer. Find concrete correctness, safety, and test issues. Cite paths and explain impact. Do not modify files.",
  },
  worker: {
    tools: ["read", "bash", "edit", "write"],
    prompt: "You are a focused implementation worker. Complete only the assigned task, make minimal changes, and validate them before reporting the result.",
  },
});

export const simpleSubagentSchema = {
  type: "object",
  properties: {
    task: { type: "string", description: "The focused task for the isolated child agent." },
    role: {
      type: "string",
      enum: Object.keys(ROLES),
      default: "scout",
      description: "Child role. scout and reviewer are read-only; worker can edit files.",
    },
    cwd: { type: "string", description: "Optional working directory for the child process." },
    model: { type: "string", description: "Optional Pi model ID; defaults to the parent session model." },
    thinking: { type: "string", description: "Optional Pi thinking level for the child." },
  },
  required: ["task"],
  additionalProperties: false,
};

export function roleConfig(role = "scout") {
  return ROLES[role] ?? ROLES.scout;
}

export function modelId(model) {
  return model ? `${model.provider}/${model.id}` : undefined;
}

export function buildChildArgs({ task, role = "scout", model, thinking, promptPath }) {
  const config = roleConfig(role);
  const args = [
    "--mode",
    "json",
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-mcp",
    "--tools",
    config.tools.join(","),
  ];

  if (model) args.push("--model", model);
  if (thinking) args.push("--thinking", thinking);
  args.push("--append-system-prompt", promptPath, `Task: ${task}`);
  return args;
}

export function assistantText(message) {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function consumeJsonLine(state, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return state;
  }

  if (event.type !== "message_end" || event.message?.role !== "assistant") return state;
  const text = assistantText(event.message);
  if (text) state.output = text;
  state.stopReason = event.message.stopReason ?? state.stopReason;
  state.errorMessage = event.message.errorMessage ?? state.errorMessage;
  return state;
}

function truncate(value, limit = 8_000) {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n[truncated]`;
}

export function runChild({ command, args, cwd, signal, onLine }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let spawnError;
    let aborted = false;
    let killTimer;

    const abort = () => {
      aborted = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref?.();
    };
    const removeAbortListener = () => signal?.removeEventListener("abort", abort);

    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code) => {
      if (stdout.trim()) onLine(stdout);
      if (killTimer) clearTimeout(killTimer);
      removeAbortListener();
      resolve({ exitCode: code ?? 1, stderr: truncate(stderr), aborted, spawnError });
    });
  });
}

export default function simpleSubagent(pi) {
  pi.registerTool({
    name: "simple_subagent",
    label: "Simple Subagent",
    description:
      "Delegate one focused task to an isolated foreground Pi child. Default scout and reviewer roles are read-only; worker may edit files.",
    parameters: simpleSubagentSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const role = Object.hasOwn(ROLES, params.role) ? params.role : "scout";
      const config = roleConfig(role);
      const tempDir = await mkdtemp(join(tmpdir(), "pi-simple-tools-"));
      const promptPath = join(tempDir, "role.md");
      const model = params.model ?? modelId(ctx.model);
      const thinking = params.thinking ?? ctx.thinkingLevel;
      const state = { output: "", stopReason: undefined, errorMessage: undefined };

      try {
        await writeFile(promptPath, `${config.prompt}\n`, { encoding: "utf8", mode: 0o600 });
        const args = buildChildArgs({ task: params.task, role, model, thinking, promptPath });
        onUpdate?.({
          content: [{ type: "text", text: `Running ${role} subagent...` }],
          details: { role, status: "running" },
        });

        const result = await runChild({
          command: process.env.PI_SIMPLE_TOOLS_PI || "pi",
          args,
          cwd: params.cwd || ctx.cwd,
          signal,
          onLine: (line) => consumeJsonLine(state, line),
        });
        const details = {
          role,
          model,
          exitCode: result.exitCode,
          stopReason: state.stopReason,
          stderr: result.stderr || undefined,
        };

        if (result.aborted) throw new Error("Simple subagent was aborted");
        if (result.spawnError) {
          return {
            content: [{ type: "text", text: `Unable to start Pi child: ${result.spawnError.message}` }],
            details,
            isError: true,
          };
        }
        if (result.exitCode !== 0 || state.stopReason === "error" || state.stopReason === "aborted") {
          return {
            content: [{ type: "text", text: state.errorMessage || result.stderr || "Pi child failed without output." }],
            details,
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: state.output || "Pi child completed without an assistant response." }],
          details,
        };
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  });
}
