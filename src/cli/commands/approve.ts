import type { Command } from "commander";
import { createContext, type AppContext } from "../../core/context.js";
import { createReviewService } from "../../core/reviews.js";
import { handleError, parseRoleOption } from "../context.js";
import { renderApproveResult } from "../render.js";

export function registerApproveCommand(program: Command): void {
  const cmd = program
    .command("approve <id>")
    .description("Approve a draft note (note_...) or an update proposal (proposal_...)")
    .option("--actor <actor>", "override actor")
    .option("--reason <reason>", "reason for approval")
    .option("--role <role>", "override role (default: reviewer)")
    .action(async (id: string, opts: { actor?: string; reason?: string; role?: string }) => {
      let ctx: AppContext | undefined;
      try {
        const role = parseRoleOption(opts.role);
        ctx = createContext({ actor: opts.actor, role, defaultRole: "reviewer" });
        const reviews = createReviewService(ctx);
        const result = reviews.approve(id, opts.reason);
        console.log(renderApproveResult(result));
      } catch (err) {
        handleError(cmd, err);
      } finally {
        ctx?.db.close();
      }
    });
}
