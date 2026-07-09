import type { Command } from "commander";
import { createContext, type AppContext } from "../../core/context.js";
import { createNoteService } from "../../core/notes.js";
import { createReviewService } from "../../core/reviews.js";
import type { NoteStatus } from "../../types/common.js";
import { handleError } from "../context.js";
import { renderNotesList, renderPendingList } from "../render.js";

export function registerListCommand(program: Command): void {
  const cmd = program
    .command("list")
    .description("List notes, or the draft/proposal review queue with --pending")
    .option("--pending", "show the draft/proposal review queue instead of notes")
    .option("--scope <scope>", "filter by scope")
    .option("--status <status>", "filter by status")
    .action(async (opts: { pending?: boolean; scope?: string; status?: string }) => {
      let ctx: AppContext | undefined;
      try {
        ctx = createContext({});
        if (opts.pending) {
          const reviews = createReviewService(ctx);
          const { items } = reviews.listReviewItems({ scope: opts.scope, status: opts.status });
          console.log(renderPendingList(items));
        } else {
          const notes = createNoteService(ctx);
          const list = notes.listNotes({ scope: opts.scope, status: opts.status as NoteStatus | undefined });
          console.log(renderNotesList(list));
        }
      } catch (err) {
        handleError(cmd, err);
      } finally {
        ctx?.db.close();
      }
    });
}
