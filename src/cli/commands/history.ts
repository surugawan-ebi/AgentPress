import type { Command } from "commander";
import { createContext, type AppContext } from "../../core/context.js";
import { createHistoryService } from "../../core/history.js";
import { handleError } from "../context.js";
import { renderHistory } from "../render.js";

export function registerHistoryCommand(program: Command): void {
  const cmd = program
    .command("history <id>")
    .description("Show the chronological change history for a note or proposal id")
    .action(async (id: string) => {
      let ctx: AppContext | undefined;
      try {
        ctx = createContext({});
        const history = createHistoryService(ctx);
        console.log(renderHistory(history.listByEntity(id)));
      } catch (err) {
        handleError(cmd, err);
      } finally {
        ctx?.db.close();
      }
    });
}
