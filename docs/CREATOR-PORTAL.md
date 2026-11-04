# Creator Portal submission

Internal notes for the n8n Creator Portal. Not part of the npm package.

## Package

| Field | Value |
|---|---|
| npm package | `@pageweave/n8n-nodes-pageweave` |
| Display name | PageWeave |
| Categories | Data & Storage, Marketing & Content |
| Repository | https://github.com/PageWeave/n8n-nodes-pageweave |
| Documentation | https://pageweave.dev/docs/n8n |
| License | MIT |
| Runtime dependencies | none (`n8n-workflow` peer only) |
| Provenance | GitHub Actions trusted publishing, `publish.yml` |

## Reviewer notes

- The action node covers submissions, forms, tables, rows, webhooks, and a Custom API Call escape hatch.
- Read operations expose **Simplify** for the wider submission, table, and webhook shapes. It is off by default; raw output remains available.
- The trigger registers a PageWeave webhook at the n8n URL, verifies `X-Webhook-Signature` over the raw body, and deletes the endpoint on deactivation.
- PageWeave delivers to public HTTPS only. n8n Cloud works out of the box; self-hosted reviewers need a public hostname or tunnel for the trigger.
- A free PageWeave account can create the API key needed for both nodes. The credential test calls `GET /api/v1/me`.

## Demo video outline (60-90 seconds)

1. Open the PageWeave dashboard, create an API key scoped to one website.
2. In n8n, add the **PageWeave API** credential and run **Test**.
3. Add **PageWeave Trigger**, pick the website and `Form Submission Created`, activate the workflow.
4. Submit the live PageWeave form.
5. Show the execution with `data.fields` and the `event`/`test`/`delivery_id` envelope.
6. Add **PageWeave → Row → Create** to write the submission into a table, then show the new row in PageWeave.
7. Show **Row → Export** producing a CSV binary item.
8. Close on the operations list and the `/docs/n8n` page.

Keep the recording to the product surfaces. Do not show API keys or personal data.

## Release checklist

1. Deploy the PageWeave docs page at `/docs/n8n` first. The npm homepage, both codex files, the credential help link, and the Creator Portal notes all point at it.
2. Trusted publisher configured: GitHub Actions, `PageWeave/n8n-nodes-pageweave`, workflow `publish.yml`, `npm publish` allowed.
3. Tag `vX.Y.Z`; `publish.yml` runs lint, tests, build, then `npm publish --provenance --access public`.
4. Verify npm shows the provenance badge and the SLSA attestation.
5. Run `npx @n8n/scan-community-package @pageweave/n8n-nodes-pageweave@X.Y.Z`; it must exit 0.
6. After the first successful publish: npm package settings → Publishing access → require 2FA and disallow tokens.
7. Submit the package in the Creator Portal with the demo video and documentation URL.
8. Address review findings in a new patch release; never move a published tag.
