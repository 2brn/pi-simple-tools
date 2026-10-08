import assert from "node:assert/strict";
import test from "node:test";

import simpleSubagent, {
  ROLES,
  assistantText,
  buildChildArgs,
  consumeJsonLine,
  simpleSubagentSchema,
} from "../extensions/simple-subagent.js";

test("subagent schema requires a task and exposes the supported roles", () => {
  assert.deepEqual(simpleSubagentSchema.required, ["task"]);
  assert.deepEqual(simpleSubagentSchema.properties.role.enum, Object.keys(ROLES));
});

test("scout child invocation is isolated and read-only", () => {
  const args = buildChildArgs({
    task: "inspect the repository",
    role: "scout",
    model: "openai/example",
    thinking: "low",
    promptPath: "/tmp/role.md",
  });

  assert.deepEqual(args.slice(0, 12), [
    "--mode", "json", "--print", "--no-session", "--no-extensions", "--no-mcp", "--tools", "read,grep,find,ls",
    "--model", "openai/example", "--thinking", "low",
  ]);
  assert.deepEqual(args.slice(-3), ["--append-system-prompt", "/tmp/role.md", "Task: inspect the repository"]);
});

test("JSON event parsing preserves the latest assistant response", () => {
  const state = { output: "", stopReason: undefined, errorMessage: undefined };
  consumeJsonLine(state, "not json");
  consumeJsonLine(state, JSON.stringify({ type: "message_end", message: { role: "user", content: [] } }));
  consumeJsonLine(
    state,
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        stopReason: "end",
      },
    }),
  );

  assert.equal(state.output, "done");
  assert.equal(state.stopReason, "end");
  assert.equal(assistantText({ role: "assistant", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }), "one\ntwo");
});

test("subagent registers one model-callable tool", () => {
  let definition;
  simpleSubagent({ registerTool(value) { definition = value; } });
  assert.equal(definition.name, "simple_subagent");
  assert.equal(definition.parameters, simpleSubagentSchema);
});
