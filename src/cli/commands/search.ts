import type { Command } from "commander";
import { createContext, type AppContext } from "../../core/context.js";
import { createSearchEngine } from "../../core/search.js";
import { handleError } from "../context.js";
import { renderSearchResult } from "../render.js";

export function registerSearchCommand(program: Command): void {
  const cmd = program
    .command("search <query>")
    .description("Search verified notes (add --include-archived to include archived ones)")
    .option("--include-archived", "also include archived notes")
    .option("--scope <scope>", "filter by scope")
    .option("--limit <n>", "maximum number of results", (v) => parseInt(v, 10))
    .action(async (query: string, opts: { includeArchived?: boolean; scope?: string; limit?: number }) => {
      let ctx: AppContext | undefined;
      try {
        ctx = createContext({});
        const engine = createSearchEngine(ctx);
        const result = engine.search({
          query,
          include_archived: opts.includeArchived,
          scope: opts.scope,
          limit: opts.limit,
        });
        console.log(renderSearchResult(result));
      } catch (err) {
        handleError(cmd, err);
      } finally {
        ctx?.db.close();
      }
    });
}
