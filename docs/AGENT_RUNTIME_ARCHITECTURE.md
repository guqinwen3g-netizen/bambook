# Bambook Agent Runtime Architecture

## 1. Product Boundary

Bambook Agent is not a chatbot embedded in the UI. It is the native automation layer of Bambook.

The assistant window is only one interaction surface. The Agent must be able to read Bambook business objects, operate Bambook workflows, and report its work through the application workspace.

The model API is not the Agent. The Agent is the Bambook runtime around the model:

- identity
- session state
- memory
- retrieval
- tool planning
- tool execution
- approval
- audit
- workspace updates
- final user communication

## 2. Runtime Ownership

Business state belongs to the Bambook data center, not the client.

The client may hold UI state, preferences, temporary draft text, local cache, and media playback state. It must not be the source of truth for:

- account identity
- roles and permissions
- Agent sessions
- Agent messages
- business data
- orders
- product assets
- digital archives
- knowledge documents
- tool execution state
- audit logs

The Agent runtime must recover session history from `AgentSession` and `AgentMessage` on the backend. Frontend-provided `history` is only an optimization, not an authority.

## 2.1 Data Truth Boundary

For account, order, product, knowledge, and Agent audit questions, the production Bambook API is the business truth.

Local `localhost:8081` and local Postgres databases are development runtimes only. They may have empty users, empty product data, stale migrations, or synthetic tool runs. They are useful for validating source code and migrations, but they must not be used to answer questions about current Bambook business state.

Operational checks should use:

```bash
npm run agent:status
```

Local runtime checks must be explicit:

```bash
npm run agent:status:local
```

`/api/agent/status` exposes `dataSource.isBusinessTruth` so callers can distinguish production truth from local development state before interpreting `users`, `audit`, or tool-run counts.

## 3. Agent Run Loop

A real Bambook Agent run follows this structure:

1. Authenticate actor
2. Resolve `ActorContext`
3. Load session state from backend
4. Load relevant user, company, and task memory
5. Understand intent
6. Plan required reads/actions
7. Retrieve knowledge and business objects
8. Select tools
9. Check tool permission and risk
10. Execute allowed tools
11. Create approval requests for risky tools
12. Write `AgentToolRun` audit records
13. Update workspace state/events
14. Save user and model messages
15. Save durable Agent memory when appropriate
16. Return response to the user

The model may help plan and summarize, but the backend runtime owns execution.

## 4. Tool Layer

Bambook has two related but different surfaces:

1. Internal application APIs may be numerous and module-specific.
2. Agent-facing tools must be few, semantic, stable, and composable.

Do not expose every internal API or every new user scenario as a new Agent tool. Tool sprawl makes the Agent worse, because the first task becomes selecting from a large pile of narrow operations.

The preferred Agent-facing shape is:

- `*.query`: find candidates, lists, counts, filters, and sorted pages.
- `*.get`: read one full business object by stable id or unique identifier.
- `*.expand`: expand the context around one resolved object with explicit `include` fields.
- `*.draft`: prepare a proposed write or external action without committing it.
- `*.execute`: perform an approved action.

Current domain primitives should converge toward:

- `relations.query`
- `relations.get`
- `relations.expand`
- `products.query`
- `products.get`
- `products.expand`
- `orders.query`
- `orders.get`
- `orders.expand`
- `knowledge.search`
- `email.query`
- `email.draft`
- `email.execute`

Example:

```json
{
  "tool": "relations.expand",
  "input": {
    "id": "panda001",
    "include": ["profile", "contacts", "people", "orders", "emails", "notes"]
  }
}
```

`expand` is where domain context grows. For example, finding a company contact should not require a narrow `relations.contacts` tool. The planner should resolve the company with `relations.query`, then call `relations.expand` with `include: ["profile", "contacts", "people"]`.

Tools must declare:

- `id`
- `scope`
- `risk`
- input schema
- output schema
- allowed roles
- approval behavior
- audit behavior

Low-risk read tools may execute directly. Write tools and external-action tools require stricter checks. High-risk tools, such as sending email or changing financial/business records, must support approval before execution.

Narrow tools are allowed only as temporary implementation shims behind a domain primitive. They should not remain in the Agent-facing manifest unless they represent a durable domain operation.

## 5. Permissions

Agent never bypasses Bambook permissions.

The Agent acts as the current user unless explicitly running a system job. Every tool call must check:

- actor role
- department
- tool scope
- resource ACL
- risk level
- approval requirement

For example, if Kevin is owner, the Agent can inspect digital archives through `products.*` tools. A viewer may be allowed to search or count products but not modify them.

## 6. Knowledge and Business Retrieval

There are two different retrieval paths:

1. Knowledge retrieval: documents, policies, imported files, company memory.
2. Business retrieval: orders, product assets, relations, emails, system records.

Business questions should prefer structured tools over text RAG.

Example:

User asks: "系统里有多少条面料信息？"

Correct path:

1. Intent: product archive count
2. Tool: `products.query` with `aggregate: "count"` or an internal compatibility count handler behind the product domain primitive
3. Output: exact database count
4. Model: explain result in natural language

Incorrect path:

1. Search text snippets
2. Hope a context chunk contains a count
3. Let model infer the answer

## 7. Application Operation

The Agent must be able to operate Bambook through backend tools, not by pretending to click UI.

For durable business actions, UI automation is not the primary path. The primary path is structured backend tools that use the same domain services as the UI.

The workspace UI should display:

- current task
- opened business object
- tool calls
- intermediate results
- generated drafts
- required confirmations
- approval state
- final changes

The workspace is therefore an Agent work surface, not a decorative browser panel.

## 8. Email and Automation

Email automation is a high-risk capability.

The correct path is:

1. `email.search` reads messages
2. `email.draftReply` prepares a draft
3. user or approval policy reviews
4. `email.send` sends only after permission and approval
5. `AgentToolRun` and `AuditLog` record the action

The Agent must not silently send external communication.

## 9. Current Implementation Status

Current status:

- Agent identity, roles, tool scopes, and database schema exist.
- `AgentSession` and `AgentMessage` exist.
- `AgentTool`, `AgentToolPermission`, and `AgentToolRun` exist.
- Default tool directory exists.
- AI chat uses backend Agent Runtime session preparation.
- Production API exposes data-source truth through `/api/agent/status`.
- Agent-facing MCP manifest is converging on `products.query/get/expand`, `orders.query/get/expand`, `relations.query/get/expand`, `knowledge.search`, and `entities.search/hydrate`.
- Internal compatibility handlers such as `products.count`, `dictionary.query`, and `records.query` still exist for older planner paths and regression safety, but they are no longer the preferred Agent-facing tool contract.
- Tool calls return `ToolResult` context and record `AgentToolRun` plus `AuditLog` where a real `UserAccount` is resolved.

Still incomplete:

- planner is still rule-first and not yet a true long-task task graph
- write tools are not yet organized as `draft -> approval -> execute`
- `AgentToolPermission` is not yet the primary live permission source for every tool call
- approval flow is not yet connected to live tool execution
- workspace event stream is not yet the main Agent work surface
- planner still needs to evolve from rule-first follow-ups into a durable task graph with resumable state

## 10. Required Next Architecture Step

The next implementation step is to introduce a central `AgentRuntime` service:

- owns session load/save
- owns planning state
- owns tool registry
- owns tool execution
- owns approvals
- owns audit writes
- emits workspace events
- calls the model only as one component of the run

After that, AI chat becomes one client of Agent Runtime, not the runtime itself.
