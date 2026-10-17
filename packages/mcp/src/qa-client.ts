// QA: drive the ask_human MCP tool over stdio, the way Claude Code does.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({ command: "pnpm", args: ["--silent", "exec", "tsx", "src/index.ts"], cwd: new URL("..", import.meta.url).pathname });
const client = new Client({ name: "qa", version: "0" });
await client.connect(transport);
console.log("tools:", (await client.listTools()).tools.map((t) => t.name));
const args = JSON.parse(process.argv[2] ?? "{}");
const res: any = await client.callTool({ name: "ask_human", arguments: args }, undefined, { timeout: 10 * 60_000 });
console.log(res.content?.[0]?.text);
await client.close();
