import path from "node:path";
import type { Command } from "commander";
import { createContext, type AppContext } from "../../core/context.js";
import { importPath as importMarkdown, type ImportSummary } from "../../core/markdown.js";
import { createNoteService } from "../../core/notes.js";
import { createReviewService } from "../../core/reviews.js";
import { handleError, parseSourceTypeOption } from "../context.js";
import { renderImportSummary } from "../render.js";

/** Best-effort scope lookup for the summary breakdown; never fails the command. */
function computeScopeCounts(ctx: AppContext, summary: ImportSummary): Map<string, number> {
  const notes = createNoteService(ctx);
  const reviews = createReviewService(ctx);
  const counts = new Map<string, number>();

  const bump = (scope: string | null) => {
    const key = scope ?? "(no scope)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const id of summary.createdIds) {
    try {
      bump(notes.getNoteForReview(id).scope);
    } catch {
      // note may have been mutated again since import; skip rather than fail the command
    }
  }
  for (const id of summary.proposalIds) {
    try {
      const item = reviews.getReviewItem(id);
      bump(item.targetNoteId ? notes.getNoteForReview(item.targetNoteId).scope : null);
    } catch {
      // same as above
    }
  }

  return counts;
}

export function registerImportCommand(program: Command): void {
  const cmd = program
    .command("import <path>")
    .description("Import Markdown notes as drafts, draft updates, or update proposals")
    .option("--verified", "attempt to verify newly created drafts (human-only)")
    .option("--source <type>", "fallback source type when frontmatter has no source list")
    .option("--commit <sha>", "commit sha to attach to fallback sources")
    .action(async (importTarget: string, opts: { verified?: boolean; source?: string; commit?: string }) => {
      let ctx: AppContext | undefined;
      try {
        const sourceType = parseSourceTypeOption(opts.source);
        ctx = createContext({});
        const summary = importMarkdown(ctx, path.resolve(importTarget), {
          verified: opts.verified,
          sourceType,
          commitSha: opts.commit,
        });
        const scopeCounts = computeScopeCounts(ctx, summary);
        console.log(renderImportSummary(summary, scopeCounts));
      } catch (err) {
        handleError(cmd, err);
      } finally {
        ctx?.db.close();
      }
    });
}
