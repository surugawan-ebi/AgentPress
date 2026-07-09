import type { Command } from "commander";
import pc from "picocolors";
import { createContext, type AppContext } from "../../core/context.js";
import { createNoteService } from "../../core/notes.js";
import { handleError } from "../context.js";

export function registerArchiveCommand(program: Command): void {
  const cmd = program
    .command("archive <note_id>")
    .description("Archive a verified note")
    .requiredOption("--reason <reason>", "reason for archiving")
    .option("--actor <actor>", "override actor")
    .action(async (id: string, opts: { reason: string; actor?: string }) => {
      let ctx: AppContext | undefined;
      try {
        ctx = createContext({ actor: opts.actor, defaultRole: "reviewer" });
        const notes = createNoteService(ctx);
        const note = notes.archiveNote(id, opts.reason);
        console.log(pc.green(`Archived ${note.id}.`));
      } catch (err) {
        handleError(cmd, err);
      } finally {
        ctx?.db.close();
      }
    });
}
