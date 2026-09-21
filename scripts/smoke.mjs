// Usage: npm run build && BITBUCKET_EMAIL=... BITBUCKET_API_TOKEN=... BITBUCKET_WORKSPACE=... npm run smoke
import { loadConfig } from "../dist/config.js";
import { BitbucketClient } from "../dist/client.js";

const config = loadConfig();
const client = new BitbucketClient(config);

if (config.auth.mode === "basic") {
  const me = await client.get("/user", { fields: "display_name,nickname,uuid" });
  console.log("user:", JSON.stringify(me));
} else {
  console.log("user: skipped (access tokens are not users)");
}

const ws = client.resolveWorkspace();
const repos = await client.get(`/repositories/${encodeURIComponent(ws)}`, {
  pagelen: 5,
  sort: "-updated_on",
  fields: "size,values.slug,values.full_name,values.updated_on"
});
console.log(`repos in ${ws} (${repos.size ?? "?"} total):`);
for (const r of repos.values ?? []) console.log(`- ${r.full_name} (${r.updated_on})`);
