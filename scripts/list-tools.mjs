// Usage: npm run build && npm run list-tools
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, BITBUCKET_ACCESS_TOKEN: process.env.BITBUCKET_ACCESS_TOKEN ?? "dummy-token" },
  stderr: "inherit"
});
const client = new Client({ name: "list-tools", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`${tools.length} tools`);
for (const t of tools) console.log(`- ${t.name}: ${t.description.split(".")[0]}.`);
await client.close();
