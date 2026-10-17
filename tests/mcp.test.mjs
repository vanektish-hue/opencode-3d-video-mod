// MCP protocol tests: spawn the real stdio server, list tools, call tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function makeClient(proc) {
  let buf = "";
  const pending = new Map();
  proc.stdout.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });
  const req = (method, params) => new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return { req, notify };
}

test("MCP server initializes, lists tools, and models a mouse", async (t) => {
  const proc = spawn(process.execPath, [join(ROOT, "bin", "mcp.js")], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => proc.kill());

  const { req, notify } = makeClient(proc);

  const init = await req("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "creator-test", version: "1.0.0" },
  });
  assert.equal(init.result.serverInfo.name, "creator-mod");
  notify("notifications/initialized", {});

  const list = await req("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  for (const expected of ["modeling_add_mouse", "modeling_preview", "modeling_export_glb", "video_add_clip", "video_render", "video_logo", "ui_open", "showreel"]) {
    assert.ok(names.includes(expected), `exposes tool '${expected}'`);
  }
  // every tool must declare an input schema
  for (const tool of list.result.tools) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} has object schema`);
  }

  const newScene = await req("tools/call", { name: "modeling_new_scene", arguments: { name: "mcp-test" } });
  assert.ok(!newScene.result.isError, "new scene ok");

  const addMouse = await req("tools/call", { name: "modeling_add_mouse", arguments: { cable: true } });
  assert.ok(!addMouse.result.isError, "add mouse ok");
  assert.match(addMouse.result.content[0].text, /Mouse model added/);

  const preview = await req("tools/call", { name: "modeling_preview", arguments: { width: 128, height: 72, aa: 1 } });
  assert.ok(!preview.result.isError, "preview ok");
  const imageBlock = preview.result.content.find((c) => c.type === "image");
  assert.ok(imageBlock, "preview returns an image content block");
  assert.equal(imageBlock.mimeType, "image/png");
  assert.ok(imageBlock.data.length > 500, "image base64 payload present");
  assert.ok(Buffer.from(imageBlock.data, "base64").slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "PNG magic bytes");

  const summary = await req("tools/call", { name: "project_summary", arguments: {} });
  assert.ok(!summary.result.isError);
  const parsed = JSON.parse(summary.result.content[0].text);
  assert.equal(parsed.scene.name, "mcp-test");
  assert.ok(parsed.scene.stats.nodes > 10);
});
