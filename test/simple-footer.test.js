import assert from "node:assert/strict";
import test from "node:test";

import simpleFooter, { fitText, footerText } from "../extensions/simple-footer.js";

test("footer text includes optional branch", () => {
  assert.equal(footerText("openai/example", "main"), "Simple Footer | openai/example | main");
  assert.equal(footerText(undefined, undefined), "Simple Footer | no model");
});

test("footer text fits narrow widths", () => {
  assert.equal(fitText("abcdef", 0), "");
  assert.equal(fitText("abcdef", 3), "abc");
  assert.equal(fitText("abcdef", 5), "ab...");
  assert.equal(fitText("abc", 5), "abc");
});

test("footer installs only for TUI sessions", () => {
  let handler;
  simpleFooter({ on(event, callback) { assert.equal(event, "session_start"); handler = callback; } });

  let setFooterCalled = false;
  handler({}, { mode: "json", ui: { setFooter() { setFooterCalled = true; } } });
  assert.equal(setFooterCalled, false);

  let factory;
  handler({}, { mode: "tui", model: { provider: "openai", id: "test" }, ui: { setFooter(value) { factory = value; } } });
  const component = factory(
    { requestRender() {} },
    { fg(_color, text) { return text; } },
    { getGitBranch() { return "main"; }, onBranchChange() { return () => {}; } },
  );
  assert.deepEqual(component.render(80), ["Simple Footer | openai/test | main"]);
});
