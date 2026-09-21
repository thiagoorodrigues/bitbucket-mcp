#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { BitbucketClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";

const SERVER_NAME = "bitbucket-cloud-mcp";
const SERVER_VERSION = "0.1.0";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    process.stderr.write(`${SERVER_NAME}: configuration error: ${(e as Error).message}\n`);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  for (const w of config.warnings) logger.warn(w);
  logger.info(
    `${SERVER_NAME} starting (auth=${config.auth.mode}, baseUrl=${config.baseUrl}, workspace=${config.workspace ?? "<none>"})`
  );

  const client = new BitbucketClient(config);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAllTools(server, client);
  logger.info("Registered all tools");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Connected to STDIO transport, ready");
}

main().catch((e) => {
  process.stderr.write(`${SERVER_NAME}: fatal error: ${(e as Error).message}\n`);
  process.exit(1);
});
