# @pageweave/n8n-nodes-pageweave

Official n8n nodes for [PageWeave](https://pageweave.dev), the agent-native web platform for building and hosting websites.

Use this package to move PageWeave form submissions into spreadsheets, CRMs, helpdesks, and data tables, and to call the PageWeave API from any n8n workflow.

> **Pre-release.** Version 0.0.1 validates the release pipeline. The `PageWeave Trigger` node, table and row operations, and webhook management ship in 0.1.0.

## Requirements

- n8n 2.x (self-hosted or n8n Cloud)
- A PageWeave account with an API key
- Node.js 22.14 or newer when self-hosting n8n

## Installation

### n8n Cloud and verified community nodes

Install **PageWeave** from the n8n nodes panel once the package is verified. n8n Cloud installs verified community nodes without extra configuration.

### Self-hosted n8n

1. Open **Settings → Community nodes**.
2. Select **Install a community node**.
3. Enter `@pageweave/n8n-nodes-pageweave` and confirm.

Or install from the command line in your n8n instance:

```bash
npm install @pageweave/n8n-nodes-pageweave
```

## Credentials

1. In PageWeave, open **Settings → API keys** and create a key scoped to the website the workflow reads or writes.
2. In n8n, create a **PageWeave API** credential and paste the key.
3. Leave **Base URL** at `https://pageweave.dev` unless PageWeave support gave you a different address.
4. Select **Test** — the credential calls `GET /api/v1/me`.

API keys carry `read` or `write` access. A read-only key cannot create, update, or delete records. PageWeave end users cannot create OAuth clients, so API keys are the supported credential.

## Operations

This release exposes:

| Resource | Operations |
|---|---|
| Submission | Get, Get Many, Update, Delete |
| Form | Get, Get Many |
| Custom API Call | Call any relative `/api/v1/...` path |

Planned for 0.1.0:

| Resource | Operations |
|---|---|
| Table | Get, Get Many, Create, Update, Delete |
| Row | Get, Get Many, Create, Update, Delete, Import, Export |
| Webhook | Get, Get Many, Create, Update, Delete, Rotate Secret, Send Test, Get Many Deliveries, Get Delivery, Redeliver |
| PageWeave Trigger | `form.submission.created` |

Everything not covered by a dedicated operation is reachable through **Custom API Call**, which forwards to any relative PageWeave API path and blocks overriding the credential's `Authorization` header.

## Pagination

**Get Many** operations expose **Return All** and **Limit**. PageWeave uses keyset cursors; the node follows `next_cursor` automatically, up to 100 records per request. Cursors expire after 24 hours, which does not affect a running execution.

## Submission data and privacy

Submission detail includes form fields, file uploads, spam signals, and failure details. PageWeave marks submission responses `Cache-Control: no-store` because they contain personal data.

- Limit the API key to the websites the workflow needs.
- Set an execution data retention period in n8n that matches your privacy policy.
- Do not log submission payloads to third-party services you have not disclosed.

## Rate limits

PageWeave enforces per-credential limits:

| Bucket | Limit |
|---|---|
| Read | 600 requests/minute |
| Write | 120 requests/minute |
| CSV export | 10 requests/minute |

The node retries `429`, `503`, and concurrent `409` responses with `Retry-After` and returns RFC 9457 problem details, including the PageWeave `request_id`, when a request fails.

## Error handling

Errors include the problem title, detail, field errors, PageWeave extensions, and the request ID. Enable **Continue On Fail** on the node to emit errors as items instead of stopping the workflow.

## Security

- The node sends credentials only to the configured base URL over HTTPS.
- Redirects are disabled so the `Authorization` header cannot follow a redirect to another host.
- The trigger (0.1.0) verifies `X-Webhook-Signature` with HMAC-SHA256 over the raw request body.

## Development

```bash
npm install
npm run build
npm run lint
npm test
npm run contract:check
```

`npm run contract:check` verifies that every operation the node uses still exists in PageWeave's published OpenAPI document at `https://pageweave.dev/openapi.json`.

## Resources

- [PageWeave documentation](https://pageweave.dev/docs)
- [PageWeave API reference](https://pageweave.dev/docs/api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
