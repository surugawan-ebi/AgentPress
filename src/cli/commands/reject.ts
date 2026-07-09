import type { Command } from "commander";
import { createContext, type AppContext } from "../../core/context.js";
import { createReviewService } from "../../core/reviews.js";
import { handleError } from "../context.js";
import { renderRejectResult } from "../render.js";

export function registerRejectCommand(program: Command): void {
  const cmd = program
    .command("reject <id>")
    .description("Reject a draft note (note_...) or an update proposal (proposal_...)")
    .requiredOption("--reason <reason>", "reason for rejection")
    .option("--actor <actor>", "override actor")
    .action(async (id: string, opts: { reason: string; actor?: string }) => {
      let ctx: AppContext | undefined;
      try {
        ctx = createContext({ actor: opts.actor, defaultRole: "reviewer" });
        const reviews = createReviewService(ctx);
        const result = reviews.reject(id, opts.reason);
        console.log(renderRejectResult(result));
      } catch (err) {
        handleError(cmd, err);
      } finally {
        ctx?.db.close();
      }
    });
}
