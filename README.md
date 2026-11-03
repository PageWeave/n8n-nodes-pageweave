# @pageweave/n8n-nodes-pageweave

Official n8n nodes for [PageWeave](https://pageweave.dev), the agent-native web platform for building and hosting websites.

Use this package to:

- start workflows when a PageWeave form receives a submission;
- move submissions and table rows into the rest of your stack;
- read and manage forms, tables, rows, and webhook endpoints;
- export table rows as CSV, or import CSV rows into a table;
- call any other PageWeave API endpoint from the same credential.

## Requirements

- n8n 2.x, self-hosted (n8n Cloud once the package is listed as a verified community node)
- A PageWeave account with an API key
- For the trigger: n8n reachable at a **public HTTPS URL** (PageWeave rejects localhost and private addresses)

## Installation

### n8n Cloud

n8n Cloud installs verified community nodes. Once the package is listed, install **PageWeave** from the nodes panel.

### Self-hosted n8n

1. Open **Settings → Community nodes**.
2. Select **Install a community node**.
3. Enter `@pageweave/n8n-nodes-pageweave` and confirm.

Or from the command line in your n8n instance:

```bash
npm install @pageweave/n8n-nodes-pageweave
```

## Credentials

1. In PageWeave, open **Settings → API keys** and create a key. Choose read or read and write access; a read-only key cannot create, update, or delete records.
2. In n8n, create a **PageWeave API** credential and paste the key.
3. Leave **Base URL** at `https://pageweave.dev` unless PageWeave support gave you another address.
4. Select **Test**. The credential calls `GET /api/v1/me`.

API keys carry `read` or `write` access. A read-only key cannot create, update, or delete records. PageWeave end users cannot create OAuth clients, so API keys are the supported credential.

## Nodes

### PageWeave Trigger

Starts the workflow on `form.submission.created`.

- **Registration.** Activating the workflow creates a PageWeave webhook endpoint that points at the n8n webhook URL, then activates it. Deactivating deletes it. Test mode registers a separate endpoint for the test URL.
- **Recovery.** If static data is lost, the trigger adopts the endpoint that already points at this n8n URL and rotates its signing secret instead of leaving an orphan.
- **Sync.** Changes to events or form IDs are applied on activation. An endpoint that PageWeave auto-disabled after delivery failures is re-enabled, which also resets the failure streak.
- **Signature.** Every request must carry `X-Webhook-Signature: sha256=<HMAC-SHA256>` over the raw body. Invalid signatures get `401` before the workflow runs.
- **Delivery IDs.** When PageWeave sends `X-Webhook-Delivery-Id`, the trigger drops repeated deliveries of the same ID and exposes `delivery_id` in the output.

Output:

```json
{
  "event": "form.submission.created",
  "timestamp": "2026-11-03T10:00:00Z",
  "data": {
    "submission_id": "019f9c2a-...",
    "form_id": "019f9c2a-...",
    "form_name": "Contact",
    "fields": { "name": "Ada", "email": "ada@example.com" },
    "files": [
      {
        "field": "attachment",
        "filename": "brief.pdf",
        "size": 48000,
        "content_type": "application/pdf",
        "checksum_md5": "0123456789abcdef0123456789abcdef",
        "url": "https://pageweave.dev/..."
      }
    ],
    "submitted_at": "2026-11-03T09:59:59Z",
    "spam": { "verdict": "ham", "score": 0, "signals": {} }
  },
  "test": false,
  "delivery_id": "..."
}
```

Discarded spam is never dispatched. Quarantined spam is delivered with `spam.verdict = "quarantined"`. Test deliveries carry `test: true` and sample values.

**Local n8n cannot receive PageWeave deliveries.** Expose n8n through a tunnel or public hostname before activating the trigger. PageWeave rejects `http://`, localhost, and private network addresses.

### PageWeave

| Resource | Operations |
|---|---|
| Submission | Get, Get Many, Update, Delete |
| Form | Get, Get Many |
| Table | Get, Get Many, Create, Update, Delete |
| Row | Get, Get Many, Create, Update, Delete, Import, Export |
| Webhook | Get, Get Many, Create, Update, Delete, Rotate Secret, Send Test, Get Many Deliveries, Get Delivery, Redeliver |
| Custom API Call | Any relative `/api/v1/...` path |

Highlights:

- **Submissions** carry filters for spam verdict and read state. Detail includes uploads and spam signals. Responses are `Cache-Control: no-store` because they contain personal data.
- **Rows** accept JSON `data`, publish state (`Draft`, `Publish Now`, `Schedule`), filters, search, sort, and a `published` filter.
- **Row import** accepts a public HTTPS CSV URL or inline CSV content, `create` or `create or update` mode, and a column mapping. Up to 25,000 rows run synchronously; larger URL imports return a run that the node can poll to completion.
- **Row export** streams a CSV file into the binary field of your choice. Formula escaping is on unless you turn it off.
- **Webhooks** are created paused and return the signing secret once. **Rotate Secret** invalidates the previous secret immediately. **Send Test** works while the endpoint is paused.
- **Custom API Call** reaches every other endpoint, including pages, releases, domains, assets, and analytics. It allows only relative `/api/v1` paths and blocks overriding the `Authorization` header.

## Pagination

**Get Many** operations expose **Return All** and **Limit**. PageWeave uses keyset cursors; the node follows `next_cursor` automatically, up to 100 records per request. Cursors expire after 24 hours, which does not affect a running execution.

## Rate limits

PageWeave enforces per-credential limits:

| Bucket | Limit |
|---|---|
| Read | 600 requests/minute |
| Write | 120 requests/minute |
| CSV export | 10 requests/minute |

The node retries `429`, `503`, and concurrent idempotency `409` responses using `Retry-After`. POST requests carry an automatic `Idempotency-Key` derived from the execution, node, item, and body, so **Retry On Fail** within the same execution does not create a duplicate record. Retrying the whole execution starts a new execution ID and therefore a new key.

## Errors

Errors use PageWeave's RFC 9457 problem body: title, detail, field errors, extensions such as `template_pages`, and the PageWeave `request_id`. Enable **Continue On Fail** to emit errors as items instead of stopping the workflow.

## Privacy and security

- The node sends credentials only to the configured base URL over HTTPS.
- Redirects are disabled, so the `Authorization` header cannot follow a redirect to another host.
- The trigger verifies signatures over the raw body with a constant-time comparison.
- Set an n8n execution data retention period that matches your privacy policy; submissions contain personal data.

## AI agents

The action node can be used as an AI tool, including write and delete operations. For approval-aware automation, prefer PageWeave's MCP server at `https://pageweave.dev/mcp` through the **MCP Client Tool** node: PageWeave's tool descriptions and write controls live there. Form submissions are untrusted input; never let an agent act on submission content without review.

## Examples

The [`examples/`](examples/) directory contains importable workflows:

- [Form submissions to a table](https://github.com/PageWeave/n8n-nodes-pageweave/blob/main/examples/form-submission-to-table.json)
- [Export a table to CSV on a schedule](https://github.com/PageWeave/n8n-nodes-pageweave/blob/main/examples/scheduled-table-export.json)
- [Audit webhook deliveries](https://github.com/PageWeave/n8n-nodes-pageweave/blob/main/examples/webhook-delivery-audit.json)
- [Import rows from a CSV URL](https://github.com/PageWeave/n8n-nodes-pageweave/blob/main/examples/row-import-from-url.json)

Replace the placeholder website, form, and table IDs after importing.

## Development

```bash
npm install
npm run build
npm run lint
npm test
npm run contract:check
```

`npm run contract:check` verifies that every operation the node uses still exists in PageWeave's published OpenAPI document at `https://pageweave.dev/openapi.json`. The check also runs weekly in CI.

## Resources

- [PageWeave documentation](https://pageweave.dev/docs)
- [PageWeave API reference](https://pageweave.dev/docs/api)
- [PageWeave webhooks guide](https://pageweave.dev/docs/webhooks)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
