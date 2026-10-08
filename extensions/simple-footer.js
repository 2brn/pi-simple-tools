/**
 * A deliberately compact replacement for Pi's built-in footer.
 *
 * It only installs in interactive TUI sessions. Other Pi modes retain their
 * normal output behavior.
 */

export function footerText(model, branch) {
  const parts = ["Simple Footer", model || "no model"];
  if (branch) parts.push(branch);
  return parts.join(" | ");
}

/** Keep the unstyled source line within the terminal width. */
export function fitText(value, width) {
  const text = String(value ?? "");
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

export default function simpleFooter(pi) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width) {
          const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
          const line = fitText(footerText(model, footerData.getGitBranch()), width);
          return [theme.fg("dim", line)];
        },
      };
    });
  });
}
