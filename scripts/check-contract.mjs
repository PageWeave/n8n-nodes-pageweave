#!/usr/bin/env node
// Verifies that every PageWeave API operation this package calls still exists
// with the same operationId, HTTP method, and path.
//
// Usage: node scripts/check-contract.mjs
// Override the source with OPENAPI_URL, e.g. a local file served over HTTP.

const OPENAPI_URL = process.env.OPENAPI_URL ?? 'https://pageweave.dev/openapi.json';

const REQUIRED_OPERATIONS = [
	// Submission
	['listFormSubmissions', 'get', '/api/v1/websites/{website_id}/forms/{form_id}/submissions'],
	['getSubmission', 'get', '/api/v1/websites/{website_id}/forms/{form_id}/submissions/{id}'],
	['updateSubmission', 'patch', '/api/v1/websites/{website_id}/forms/{form_id}/submissions/{id}'],
	['deleteSubmission', 'delete', '/api/v1/websites/{website_id}/forms/{form_id}/submissions/{id}'],
	// Form
	['listForms', 'get', '/api/v1/websites/{website_id}/forms'],
	['getForm', 'get', '/api/v1/websites/{website_id}/forms/{id}'],
	// Table
	['listTables', 'get', '/api/v1/websites/{website_id}/tables'],
	['createTable', 'post', '/api/v1/websites/{website_id}/tables'],
	['getTable', 'get', '/api/v1/websites/{website_id}/tables/{id}'],
	['updateTable', 'patch', '/api/v1/websites/{website_id}/tables/{id}'],
	['deleteTable', 'delete', '/api/v1/websites/{website_id}/tables/{id}'],
	// Row
	['listTableRows', 'get', '/api/v1/websites/{website_id}/tables/{table_id}/rows'],
	['createTableRow', 'post', '/api/v1/websites/{website_id}/tables/{table_id}/rows'],
	['getTableRow', 'get', '/api/v1/websites/{website_id}/tables/{table_id}/rows/{id}'],
	['updateTableRow', 'patch', '/api/v1/websites/{website_id}/tables/{table_id}/rows/{id}'],
	['deleteTableRow', 'delete', '/api/v1/websites/{website_id}/tables/{table_id}/rows/{id}'],
	['createRowImport', 'post', '/api/v1/websites/{website_id}/tables/{table_id}/row_imports'],
	['exportTableRows', 'get', '/api/v1/websites/{website_id}/tables/{table_id}/rows/export'],
	// Webhook
	['listWebhooks', 'get', '/api/v1/websites/{website_id}/webhooks'],
	['createWebhook', 'post', '/api/v1/websites/{website_id}/webhooks'],
	['getWebhook', 'get', '/api/v1/websites/{website_id}/webhooks/{id}'],
	['updateWebhook', 'patch', '/api/v1/websites/{website_id}/webhooks/{id}'],
	['deleteWebhook', 'delete', '/api/v1/websites/{website_id}/webhooks/{id}'],
	['rotateWebhookSecret', 'post', '/api/v1/websites/{website_id}/webhooks/{id}/rotate_secret'],
	['testWebhook', 'post', '/api/v1/websites/{website_id}/webhooks/{id}/send_test'],
	['listWebhookDeliveries', 'get', '/api/v1/websites/{website_id}/webhooks/{webhook_id}/deliveries'],
	['getWebhookDelivery', 'get', '/api/v1/websites/{website_id}/webhooks/{webhook_id}/deliveries/{id}'],
	['redeliverWebhook', 'post', '/api/v1/websites/{website_id}/webhooks/{webhook_id}/deliveries/{id}/redeliver'],
	// Credential test and resource locators
	['getMe', 'get', '/api/v1/me'],
	['listWebsites', 'get', '/api/v1/websites'],
];

async function main() {
	const response = await fetch(OPENAPI_URL, { headers: { accept: 'application/json' } });
	if (!response.ok) {
		throw new Error(`Could not load ${OPENAPI_URL}: HTTP ${response.status}`);
	}

	const document = await response.json();
	const paths = document?.paths ?? {};
	const failures = [];

	for (const [operationId, method, path] of REQUIRED_OPERATIONS) {
		const operation = paths?.[path]?.[method];
		if (!operation) {
			failures.push(`${operationId}: ${method.toUpperCase()} ${path} is missing`);
			continue;
		}
		if (operation.operationId !== operationId) {
			failures.push(
				`${method.toUpperCase()} ${path} has operationId "${operation.operationId}", expected "${operationId}"`,
			);
		}
	}

	if (failures.length) {
		console.error(`PageWeave API contract drift (${failures.length} issue(s)):`);
		for (const failure of failures) console.error(`  - ${failure}`);
		process.exit(1);
	}

	console.log(`PageWeave API contract OK: ${REQUIRED_OPERATIONS.length} operations verified.`);
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
