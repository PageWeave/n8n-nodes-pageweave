# Changelog

## 0.1.0

First public release. Documentation: https://pageweave.dev/docs/n8n

- API key help now reflects user-level read/write scopes instead of website scoping
- n8n Cloud availability documented as dependent on verification
- Same node surface as 0.0.1

## 0.0.1

Validates npm trusted publishing and provenance.

- `PageWeave API` credential with a live credential test against `GET /api/v1/me`
- `PageWeave` action node
  - Submission: Get, Get Many, Update, Delete
  - Form: Get, Get Many
  - Table: Get, Get Many, Create, Update, Delete
  - Row: Get, Get Many, Create, Update, Delete, Import, Export
  - Webhook: Get, Get Many, Create, Update, Delete, Rotate Secret, Send Test, Get Many Deliveries, Get Delivery, Redeliver
  - Custom API Call: any relative `/api/v1` path
- `PageWeave Trigger` node
  - Automatic webhook registration, activation, configuration sync, and deletion
  - Endpoint adoption by URL with signing secret rotation after static data loss
  - Re-enables webhooks that PageWeave auto-disabled after delivery failures
  - HMAC-SHA256 signature verification over the raw body
  - Test mode with a separate endpoint and test delivery support
  - Delivery ID deduplication when `X-Webhook-Delivery-Id` is present
- Cursor pagination with Return All and Limit
- CSV row export to binary data and CSV row import with asynchronous polling
- RFC 9457 problem mapping with PageWeave request IDs
- Automatic retries for `429`, `503`, and concurrent idempotency `409` responses
- Automatic `Idempotency-Key` on POST requests
