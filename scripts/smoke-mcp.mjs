#!/usr/bin/env node
// Smoke test for the real MCP stdio server: spawns `node dist/cli/index.js mcp`
// as a child process (not an in-process test double) and talks to it over
// stdio via the official SDK Client, the same way a real MCP client would.
//
// Usage: npm run smoke   (builds nothing itself -- run `npm run build` first)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliEntry = path.join(repoRoot, "dist", "cli", "index.js");

if (!fs.existsSync(cliEntry)) {
  console.error(`✗ ${cliEntry} not found. Run "npm run build" first.`);
  process.exit(1);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentpress-smoke-"));
let step = "startup";
let passed = 0;

function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`assertion failed at step "${step}": ${message}`);
  }
}

async function main() {
  console.log(`[smoke-mcp] data dir: ${dataDir}`);
  console.log(`[smoke-mcp] spawning: node ${cliEntry} mcp --data-dir ${dataDir}`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntry, "mcp", "--data-dir", dataDir],
    env: { ...process.env, AGENTPRESS_ACTOR: "agent:smoke-test" },
    stderr: "pipe",
  });

  // The CLI writes startup logs to stderr (stdout is reserved for MCP frames);
  // surface them so a hang is easy to diagnose.
  transport.stderr?.on("data", (chunk) => {
    process.stderr.write(`[server stderr] ${chunk}`);
  });

  const client = new Client({ name: "agentpress-smoke-test", version: "0.0.0" }, { capabilities: {} });

  try {
    step = "connect";
    await client.connect(transport);
    ok("connected to MCP server over stdio");

    step = "tools/list";
    const toolList = await client.listTools();
    const toolNames = toolList.tools.map((t) => t.name).sort();
    const expected = [
      "create_note_draft",
      "get_note",
      "get_registry_overview",
      "get_review_item",
      "list_review_items",
      "propose_note_update",
      "search_notes",
      "update_draft",
    ];
    assert(
      expected.every((name) => toolNames.includes(name)),
      `expected all 8 tools, got: ${toolNames.join(", ")}`,
    );
    assert(toolNames.length === 8, `expected exactly 8 tools, got ${toolNames.length}: ${toolNames.join(", ")}`);
    ok(`tools/list returned all 8 expected tools: ${toolNames.join(", ")}`);

    step = "get_registry_overview";
    const overview = await client.callTool({ name: "get_registry_overview", arguments: {} });
    assert(!overview.isError, `get_registry_overview returned isError: ${JSON.stringify(overview)}`);
    assert(overview.structuredContent?.schema_version === "1", "schema_version should be '1'");
    assert(Array.isArray(overview.structuredContent?.recommended_first_steps), "recommended_first_steps should be an array");
    ok(`get_registry_overview: schema_version=${overview.structuredContent.schema_version} server_version=${overview.structuredContent.server_version} scopes=${overview.structuredContent.scopes.length}`);

    step = "search_notes (0 results)";
    const emptySearch = await client.callTool({ name: "search_notes", arguments: { query: "存在しないキーワード" } });
    assert(!emptySearch.isError, "search_notes should not error on a fresh db");
    assert(emptySearch.structuredContent?.no_results === true, "expected no_results:true on a fresh db");
    assert(Array.isArray(emptySearch.structuredContent?.suggested_next_tools), "expected suggested_next_tools array");
    ok(`search_notes on empty db: no_results=true, guidance="${emptySearch.structuredContent.guidance.slice(0, 30)}..."`);

    step = "create_note_draft";
    const created = await client.callTool({
      name: "create_note_draft",
      arguments: {
        title: "スモークテスト用ノート",
        summary: "MCP stdio疎通確認のために作成した十分な長さのあるテストノートの要約文です。",
        body: "# 概要\nスモークテスト用の本文です。\n\n# 正本回答\nMCP経由で作成されました。",
        tags: ["smoke-test"],
        source: [{ type: "manual", title: "smoke-mcp.mjs" }],
        confidence: "medium",
      },
    });
    assert(!created.isError, `create_note_draft returned isError: ${JSON.stringify(created)}`);
    const noteId = created.structuredContent?.id;
    assert(typeof noteId === "string" && noteId.startsWith("note_"), `expected a note_ id, got ${noteId}`);
    assert(created.structuredContent?.status === "draft", "a freshly created note should be status:draft");
    ok(`create_note_draft: id=${noteId} status=${created.structuredContent.status} slug_adjusted=${created.structuredContent.slug_adjusted}`);

    step = "get_review_item";
    const reviewItem = await client.callTool({ name: "get_review_item", arguments: { id: noteId } });
    assert(!reviewItem.isError, `get_review_item returned isError: ${JSON.stringify(reviewItem)}`);
    assert(reviewItem.structuredContent?.usable_as_context === false, "usable_as_context must always be false");
    assert(reviewItem.structuredContent?.kind === "note", "kind should be 'note' for a note_ id");
    ok(`get_review_item: kind=${reviewItem.structuredContent.kind} usable_as_context=${reviewItem.structuredContent.usable_as_context}`);

    step = "get_note on a draft (should error not_verified)";
    const getDraftAsNote = await client.callTool({ name: "get_note", arguments: { id: noteId } });
    assert(getDraftAsNote.isError === true, "get_note on a draft id should be isError:true");
    // Error results intentionally carry no structuredContent (see toolResponse.ts's errorResult
    // for why: the SDK client validates structuredContent against the tool's outputSchema even
    // on isError:true, and an error payload's shape never matches a success outputSchema). The
    // JSON is still available via the text content block.
    assert(getDraftAsNote.structuredContent === undefined, "error results should not set structuredContent");
    const errorPayload = JSON.parse(getDraftAsNote.content[0].text);
    assert(errorPayload.code === "not_verified", `expected not_verified, got ${errorPayload.code}`);
    ok(`get_note on a draft correctly errors: code=${errorPayload.code}`);

    console.log(`\n[smoke-mcp] PASSED (${passed} checks)`);
  } finally {
    await client.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n[smoke-mcp] FAILED at step "${step}"`);
  console.error(err);
  process.exitCode = 1;
});
