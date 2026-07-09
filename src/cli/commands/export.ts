import path from "node:path";
import type { Command } from "commander";
import { createContext, type AppContext } from "../../core/context.js";
import { exportAll } from "../../core/markdown.js";
import { handleError } from "../context.js";
import { renderExportSummary } from "../render.js";

export function registerExportCommand(program: Command): void {
  const cmd = program
    .command("export")
    .description("Export all non-rejected notes to Markdown")
    .option("--out <dir>", "output directory (default: data/notes)")
    .action(async (opts: { out?: string }) => {
      let ctx: AppContext | undefined;
      try {
        ctx = createContext({});
        const outDir = path.resolve(opts.out ?? "data/notes");
        const summary = exportAll(ctx, outDir);
        console.log(renderExportSummary(summary));
      } catch (err) {
        handleError(cmd, err);
      } finally {
        ctx?.db.close();
      }
    });
}
