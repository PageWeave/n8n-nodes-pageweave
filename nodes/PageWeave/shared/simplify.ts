import type { IDataObject } from 'n8n-workflow';

/**
 * Compact shapes for the `Simplify` option. Keep the identifiers and the
 * fields a workflow branches on; drop timestamps and diagnostic payloads that
 * only matter when inspecting the raw API response.
 */
export function simplifySubmission(submission: IDataObject): IDataObject {
	return {
		id: submission.id,
		form_id: submission.form_id,
		read: submission.read,
		spam_verdict: submission.spam_verdict,
		data: submission.data,
		uploads: submission.uploads,
		created_at: submission.created_at,
	};
}

export function simplifyTable(table: IDataObject): IDataObject {
	return {
		id: table.id,
		name: table.name,
		slug: table.slug,
		row_count: table.row_count,
		template_page: table.template_page,
		created_at: table.created_at,
	};
}

export function simplifyWebhook(webhook: IDataObject): IDataObject {
	return {
		id: webhook.id,
		url: webhook.url,
		events: webhook.events,
		form_ids: webhook.form_ids,
		active: webhook.active,
		auto_disabled: webhook.auto_disabled,
		last_delivery: webhook.last_delivery,
		created_at: webhook.created_at,
	};
}
