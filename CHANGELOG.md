# Changelog

## 0.0.1

Pre-release to validate trusted publishing and npm provenance.

- `PageWeave API` credential with a live credential test against `GET /api/v1/me`
- `PageWeave` action node
  - Submission: Get, Get Many, Update, Delete
  - Form: Get, Get Many
  - Custom API Call: any relative `/api/v1` path
- Cursor pagination with Return All and Limit
- RFC 9457 problem mapping with PageWeave request IDs
- Automatic retries for `429`, `503`, and concurrent idempotency `409` responses
- Automatic `Idempotency-Key` on POST requests
