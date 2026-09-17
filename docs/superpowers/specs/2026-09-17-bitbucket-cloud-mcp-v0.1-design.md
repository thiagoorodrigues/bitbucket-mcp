# Design — `bitbucket-cloud-mcp` v0.1 (Leitura + escrita de pull requests)

**Data:** 2026-09-17
**Status:** Aprovado (brainstorming)
**Próximo passo:** Plano de implementação

---

## 1. Contexto e objetivo

Construir um servidor MCP (Model Context Protocol) que exponha a API REST do Bitbucket Cloud (`https://api.bitbucket.org/2.0`) ao Claude e outros clientes MCP. Casos de uso primários do agente:

- Navegar repositórios, branches, commits e arquivos do workspace da South.
- Acompanhar e operar pull requests: listar, ler diff, comentar, aprovar, mergear, declinar.
- Acompanhar pipelines e ler logs de steps para apoiar o fluxo de deploy.

Este spec cobre a **v0.1**: leitura dos recursos centrais (conta, workspace, repositórios, código, PRs, pipelines) e **escrita em pull requests**. Versões futuras terão specs próprios:

- v0.2 — pipelines escrita (disparar, parar) e variáveis.
- v0.3 — administração: webhooks, branch restrictions, permissões, projetos.
- Fora do roadmap imediato: issues, snippets, OAuth 2.0.

O projeto segue o padrão do `runrun-it-mcp` (irmão em `../runrun-mcp`): mesma stack, mesma estrutura de pastas, mesmo README multi-cliente.

## 2. Decisões arquiteturais

| Decisão | Escolha | Justificativa |
|---|---|---|
| Nome do pacote / bin | `bitbucket-cloud-mcp` | Deixa claro que é Cloud, não Data Center |
| Linguagem | TypeScript estrito | SDK MCP oficial é TS; mesmo padrão do runrun-it-mcp |
| Transport | STDIO | Uso local por agente; sem hospedagem |
| Distribuição | npm público + GitHub público, MIT | Instala com `npx -y bitbucket-cloud-mcp` |
| HTTP client | `fetch` nativo (Node 18+) | Sem dependência externa |
| Validação | `zod` | Padrão em MCPs TS |
| Testes | `vitest` + mock de `fetch` | Sem integração contra API real no CI |
| Build | `tsc` | Sem bundler |
| Base URL | `https://api.bitbucket.org/2.0`, override `BITBUCKET_BASE_URL` | Permite proxy/testes |
| Autenticação | Bearer (access token) ou Basic (email + API token) | App passwords estão deprecated; OAuth fica para depois |
| Workspace padrão | `BITBUCKET_WORKSPACE` opcional | Menos parâmetros no dia a dia sem impedir multi-workspace |
| Identificação de repo | Sempre `repo_slug` | UUID é pouco útil para o agente |
| Resposta enxuta | `fields=-links,-values.links` por padrão em GETs JSON | Bloco `links` infla muito o payload |
| Paginação | `page?` (number \| string) e `pagelen?` (1–100, default 25) | Commits usa cursor opaco em `page` |
| Filtro | `q?` e `sort?` repassados direto | Linguagem de filtro nativa da API |
| Logs | Só stderr | stdout é o canal MCP |

## 3. Configuração

Variáveis de ambiente lidas em `src/config.ts` e validadas com zod:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `BITBUCKET_ACCESS_TOKEN` | Uma das duas formas | Repository/Project/Workspace access token. Usa `Authorization: Bearer <token>` |
| `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` | Uma das duas formas | E-mail Atlassian + API token pessoal. Usa `Authorization: Basic base64(email:token)` |
| `BITBUCKET_WORKSPACE` | Não | Workspace padrão quando a tool não recebe `workspace` |
| `BITBUCKET_BASE_URL` | Não | Default `https://api.bitbucket.org/2.0` |
| `BITBUCKET_TIMEOUT_MS` | Não | Default `30000` |
| `LOG_LEVEL` | Não | `debug` \| `info` \| `warn` \| `error`, default `info` |

Regras:

- Se `BITBUCKET_ACCESS_TOKEN` e o par email/API token existirem, `bearer` vence e o logger emite `warn`.
- Se `BITBUCKET_EMAIL` existir sem `BITBUCKET_API_TOKEN` (ou vice-versa), erro de config nomeando a variável faltante.
- Sem nenhuma credencial: erro de config no boot com as duas opções descritas; processo sai com código 1.
- `Config` resultante: `{ auth: { mode: "bearer", token } | { mode: "basic", email, token }, workspace?, baseUrl, timeoutMs, logLevel }`.

## 4. Cliente HTTP (`src/client.ts`)

```ts
class BitbucketClient {
  get<T>(path, params?): Promise<T>          // JSON; injeta fields default
  getText(path, params?): Promise<string>    // texto puro; não injeta fields
  post<T>(path, body?, params?): Promise<T>
  put<T>(path, body, params?): Promise<T>
  delete<T>(path, params?): Promise<T>
  resolveWorkspace(input?: string): string   // input ?? config.workspace ?? throw ConfigError
}
```

- **Headers:** `Authorization` conforme modo; `Accept: application/json` em métodos JSON; `Accept: text/plain` em `getText`; `Content-Type: application/json` só quando há body.
- **`fields` default:** em `get`, se `params.fields` for `undefined`, o cliente define `fields=-links,-values.links`. Se o chamador passar `fields`, o valor dele substitui integralmente o default.
- **Encoding de path:** helper `p(...segments)` aplica `encodeURIComponent` em cada segmento variável (branches contêm `/`, ex.: `feature/x`). Para o `path` do endpoint `src`, cada segmento do caminho de arquivo é codificado separadamente mantendo as barras.
- **Query:** parâmetros `undefined` são omitidos. `state` em `prs_list` pode repetir (`state=OPEN&state=MERGED`), então `params` aceita `string[]`.
- **Timeout:** `AbortSignal.timeout(config.timeoutMs)`; erro de abort vira `NetworkError("timeout after Nms")`.
- **Parse de resposta:** `!res.ok` lança `BitbucketApiError`. `204` retorna `{}`. Redirects seguidos (`redirect: "follow"`); logs de pipeline e `src` podem redirecionar.
- **Corpo de erro:** o Bitbucket devolve `{ type: "error", error: { message, detail? } }`. O cliente tenta parsear e guarda `message` em `err.message` e o corpo cru em `err.body`.

## 5. Erros (`src/errors.ts`)

Classes:

- `BitbucketApiError { status, endpoint, message, body, retryAfter? }`
- `ConfigError` (workspace ausente em tempo de tool)
- Erros de rede/timeout: `Error` comum

Resposta MCP (`{ content: [{type:"text", text}], isError: true }`) por status:

| Status | Texto devolvido ao agente |
|---|---|
| 401 | "Não autenticado: token inválido ou expirado. Verifique BITBUCKET_ACCESS_TOKEN ou BITBUCKET_EMAIL/BITBUCKET_API_TOKEN." |
| 403 | "Sem permissão. Escopo provável necessário: `<escopo>`." — escopo vem da tool (ver §7) |
| 404 | "Não encontrado em `<endpoint>`. workspace e repo_slug são case-sensitive; confira também se o token tem acesso ao repositório." |
| 429 | "Rate limit do Bitbucket. Aguarde `<Retry-After>`s e tente novamente." |
| outros | "Bitbucket API error (status N) on <endpoint>: <message>" |

Helpers: `successResponse(data)`, `textResponse(text)`, `genericErrorResponse(err, scopeHint?)`. Nenhuma exceção escapa de um handler.

## 6. Paginação (`src/pagination.ts`)

```ts
paginationFields = {
  page: z.union([z.number().int().min(1), z.string().min(1)]).optional(),
  pagelen: z.number().int().min(1).max(100).optional()  // default 25
}
```

A resposta paginada do Bitbucket (`{ size?, page?, pagelen, next?, previous?, values }`) é devolvida sem transformação. A description das tools instrui o agente a usar `next` (ou `page` incrementado) para continuar.

## 7. Tools expostas (30)

Convenção `recurso_ação`. Inputs comuns:

- `workspace?: string` — em toda tool com `{ws}` no endpoint.
- `repo_slug: string` — em toda tool de repositório.
- `fields?: string` — em toda tool JSON.
- `page?`, `pagelen?` — em toda tool de lista.

Cada tool declara um `scopeHint` usado na mensagem de 403.

### 7.1 Conta e workspace (leitura)

| Tool | Endpoint | Inputs específicos | scopeHint |
|---|---|---|---|
| `user_me` | `GET /user` | — | `account` |
| `workspaces_list` | `GET /workspaces` | `q?`, `sort?` | `account` |
| `projects_list` | `GET /workspaces/{ws}/projects` | `q?`, `sort?` | `project` |

`user_me` com access token retorna 401/403 do Bitbucket; a description avisa que só funciona com API token.

### 7.2 Repositórios (leitura)

| Tool | Endpoint | Inputs específicos | scopeHint |
|---|---|---|---|
| `repos_list` | `GET /repositories/{ws}` | `q?`, `sort?`, `role?` (`admin`\|`contributor`\|`member`\|`owner`) | `repository` |
| `repos_get` | `GET /repositories/{ws}/{repo_slug}` | — | `repository` |
| `branches_list` | `GET .../refs/branches` | `q?`, `sort?` | `repository` |
| `tags_list` | `GET .../refs/tags` | `q?`, `sort?` | `repository` |

### 7.3 Código (leitura)

| Tool | Endpoint | Inputs específicos | scopeHint |
|---|---|---|---|
| `commits_list` | `GET .../commits[/{revision}]` | `revision?`, `path?`, `include?: string[]`, `exclude?: string[]` | `repository` |
| `commits_get` | `GET .../commit/{hash}` | `hash` | `repository` |
| `diff_get` | `GET .../diff/{spec}` ou `.../diffstat/{spec}` | `spec` (hash ou `origem..destino`), `path?`, `context?` (linhas), `diffstat?: boolean` | `repository` |
| `src_read` | `GET .../src/{commit}/{path}` | `commit` (branch, tag ou hash), `path` (default `""`), `max_bytes?` (default 200000) | `repository` |

`diff_get`: com `diffstat=false` (default) usa `getText` e devolve o patch; com `true` usa `get` e devolve JSON paginado.

`src_read`: chama `getText`. Se o `Content-Type` da resposta for JSON (diretório), devolve a listagem parseada; senão devolve o conteúdo do arquivo. Se exceder `max_bytes`, trunca e anexa `\n\n[truncado: N bytes de M]`.

### 7.4 Pull requests (leitura)

| Tool | Endpoint | Inputs específicos | scopeHint |
|---|---|---|---|
| `prs_list` | `GET .../pullrequests` | `state?: ("OPEN"\|"MERGED"\|"DECLINED"\|"SUPERSEDED")[]`, `q?`, `sort?` | `pullrequest` |
| `prs_get` | `GET .../pullrequests/{id}` | `id` | `pullrequest` |
| `prs_diff` | `GET .../pullrequests/{id}/diff` ou `/diffstat` | `id`, `diffstat?: boolean` | `pullrequest` |
| `prs_commits` | `GET .../pullrequests/{id}/commits` | `id` | `pullrequest` |
| `prs_comments_list` | `GET .../pullrequests/{id}/comments` | `id` | `pullrequest` |
| `prs_activity` | `GET .../pullrequests/{id}/activity` | `id` | `pullrequest` |
| `prs_statuses` | `GET .../pullrequests/{id}/statuses` | `id` | `pullrequest` |

### 7.5 Pull requests (escrita)

| Tool | Endpoint | Inputs específicos | scopeHint |
|---|---|---|---|
| `prs_create` | `POST .../pullrequests` | `title`, `source_branch`, `destination_branch?`, `description?`, `reviewers?: string[]` (UUIDs), `close_source_branch?`, `draft?` | `pullrequest:write` |
| `prs_update` | `PUT .../pullrequests/{id}` | `id`, e opcionais: `title`, `description`, `destination_branch`, `reviewers`, `close_source_branch`, `draft` | `pullrequest:write` |
| `prs_comment_create` | `POST .../pullrequests/{id}/comments` | `id`, `content` (markdown), `parent_id?`, `inline?: { path, to?, from? }` | `pullrequest` |
| `prs_approve` | `POST .../pullrequests/{id}/approve` | `id` | `pullrequest:write` |
| `prs_unapprove` | `DELETE .../pullrequests/{id}/approve` | `id` | `pullrequest:write` |
| `prs_request_changes` | `POST` ou `DELETE .../pullrequests/{id}/request-changes` | `id`, `revoke?: boolean` | `pullrequest:write` |
| `prs_merge` | `POST .../pullrequests/{id}/merge` | `id`, `merge_strategy?` (`merge_commit`\|`squash`\|`fast_forward`), `message?`, `close_source_branch?` | `pullrequest:write` |
| `prs_decline` | `POST .../pullrequests/{id}/decline` | `id` | `pullrequest:write` |

Corpos montados pelas tools:

- `prs_create`: `{ title, source: { branch: { name } }, destination?: { branch: { name } }, description?, reviewers?: [{ uuid }], close_source_branch?, draft? }`. `destination_branch` omitido deixa o Bitbucket usar a branch principal.
- `prs_update`: mesmo formato, só com os campos informados.
- `prs_comment_create`: `{ content: { raw }, parent?: { id }, inline?: { path, to?, from? } }`.
- `prs_merge`: `{ type: "pullrequest", merge_strategy?, message?, close_source_branch? }`.

### 7.6 Pipelines (leitura)

| Tool | Endpoint | Inputs específicos | scopeHint |
|---|---|---|---|
| `pipelines_list` | `GET .../pipelines` | `sort?` (default `-created_on`), `target_branch?` (vira `q=target.ref_name="..."`) | `pipeline` |
| `pipelines_get` | `GET .../pipelines/{uuid}` | `uuid` | `pipeline` |
| `pipelines_steps_list` | `GET .../pipelines/{uuid}/steps` | `uuid` | `pipeline` |
| `pipelines_step_log` | `GET .../pipelines/{uuid}/steps/{step_uuid}/log` | `uuid`, `step_uuid`, `tail_lines?` (default 300) | `pipeline` |

`pipelines_step_log` usa `getText`, mantém só as últimas `tail_lines` linhas e, se cortou, prefixa `[mostrando as últimas N de M linhas]`.

## 8. Estrutura do repositório

```
bitbucket-mcp/
├── src/
│   ├── index.ts            # bootstrap: config → client → registerAllTools → STDIO
│   ├── config.ts
│   ├── client.ts
│   ├── errors.ts
│   ├── pagination.ts
│   ├── logger.ts
│   └── tools/
│       ├── types.ts        # ToolDefinition { name, config, handler, scopeHint }
│       ├── register.ts
│       ├── index.ts
│       ├── account.ts      # user_me, workspaces_list, projects_list
│       ├── repos.ts        # repos_*, branches_list, tags_list
│       ├── code.ts         # commits_*, diff_get, src_read
│       ├── pullrequests.ts # prs_* (leitura e escrita)
│       └── pipelines.ts
├── tests/                  # espelha src/
├── scripts/smoke.ts        # manual, fora do CI: user_me + repos_list com credenciais reais
├── docs/superpowers/{specs,plans}
├── package.json  tsconfig.json  vitest.config.ts
├── .env.example  .gitignore  LICENSE  README.md
```

`package.json`: `name: bitbucket-cloud-mcp`, `version: 0.1.0`, `type: module`, `bin`, `files: [dist, README.md, LICENSE]`, scripts `build`, `postbuild` (chmod), `start`, `test`, `test:watch`, `prepublishOnly`. Dependências: `@modelcontextprotocol/sdk ^1`, `zod ^3`. Dev: `typescript ^5`, `vitest ^1`, `@types/node ^20`. `engines.node >=18`.

## 9. Testes

Todos com `vi.stubGlobal("fetch", mock)`. Sem chamadas reais.

- **config.test.ts** — modo bearer; modo basic; precedência bearer com warn; email sem token e token sem email; nenhuma credencial; defaults de baseUrl, timeout e logLevel; `LOG_LEVEL` inválido.
- **client.test.ts** — header `Basic` com base64 correto; header `Bearer`; `fields` default injetado em `get`; `fields` custom respeitado; `getText` sem `fields` e com `Accept: text/plain`; encoding de branch com `/`; encoding de `path` do `src` preservando barras; `state` repetido na query; `Content-Type` só com body; 204 → `{}`; parse de `{type:"error",error:{message}}`; `Retry-After` capturado; timeout vira erro de rede; `resolveWorkspace` nas três situações.
- **errors.test.ts** — textos de 401/403/404/429/outros; `scopeHint` aparece no 403; erro genérico.
- **pagination.test.ts** — schema aceita number e string em `page`; default de `pagelen`.
- **tools/*.test.ts** — para cada tool: método e URL exatos, query montada, body montado (`prs_create` com e sem destination, `prs_update` parcial, `prs_comment_create` inline e resposta, `prs_merge`), `prs_request_changes` com `revoke`, `diff_get`/`prs_diff` alternando texto e diffstat, `src_read` diretório vs arquivo e truncamento, `pipelines_step_log` tail, `pipelines_list` com `target_branch`, erro de workspace ausente, propagação de `isError`.

## 10. README

Seções: descrição e status; pré-requisitos; instalação por cliente (Claude Code, Claude Desktop, VS Code, Cursor); **como obter credenciais** (API token em id.atlassian.com com escopos; access token de workspace/projeto/repo nas configurações do Bitbucket); tabela de escopos mínimos por grupo de tools (leitura: `repository`, `pullrequest`, `pipeline`, `project`, `account`; escrita: `pullrequest:write`); tabela das 30 tools; variáveis de ambiente; exemplos de prompts; roadmap (v0.2, v0.3); licença.

## 11. Fora de escopo da v0.1

Disparar/parar pipelines, variáveis de pipeline, webhooks, branch restrictions, permissões, criação/edição de repositórios e projetos, issues, snippets, OAuth 2.0, publicação automática no npm (publicação é manual, sob comando do mantenedor).
