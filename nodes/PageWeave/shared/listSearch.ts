import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import { listAll } from './pagination';
import { resourceLocatorValue } from './parameters';

interface WebsiteSummary {
	id: string;
	subdomain: string;
	url?: string;
	plan?: string;
	suspended?: boolean;
}

interface FormSummary {
	id: string;
	name: string;
	submit_url?: string;
}

interface TableSummary {
	id: string;
	name: string;
	slug: string;
	row_count?: number;
}

interface WebhookSummary {
	id: string;
	url: string;
	active: boolean;
	auto_disabled?: boolean;
	events?: string[];
}

export async function searchWebsites(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const search = (filter ?? '').trim();
	const qs: IDataObject = search ? { q: search } : {};

	const websites = await listAll<WebsiteSummary>(this, '/api/v1/websites', {
		qs,
		returnAll: true,
	});

	return {
		results: websites.map((website) => {
			const suffix = website.suspended ? ' (suspended)' : '';
			return {
				name: `${website.subdomain}${suffix}`,
				value: website.id,
				url: website.url,
				description: website.plan ? `${website.plan} plan` : undefined,
			};
		}),
	};
}

export async function searchForms(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const websiteId = resourceLocatorValue(this.getCurrentNodeParameter('websiteId'));
	if (!websiteId) return { results: [] };

	const forms = await listAll<FormSummary>(
		this,
		`/api/v1/websites/${encodeURIComponent(websiteId)}/forms`,
		{ returnAll: true },
	);

	const search = (filter ?? '').trim().toLowerCase();
	const matches = forms.filter((form) => !search || form.name.toLowerCase().includes(search));

	return {
		results: matches.map((form) => ({
			name: form.name,
			value: form.id,
			url: form.submit_url,
			description: form.submit_url,
		})),
	};
}

export async function searchTables(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const websiteId = resourceLocatorValue(this.getCurrentNodeParameter('websiteId'));
	if (!websiteId) return { results: [] };

	const tables = await listAll<TableSummary>(
		this,
		`/api/v1/websites/${encodeURIComponent(websiteId)}/tables`,
		{ returnAll: true },
	);

	const search = (filter ?? '').trim().toLowerCase();
	const matches = tables.filter(
		(table) =>
			!search ||
			table.name.toLowerCase().includes(search) ||
			table.slug.toLowerCase().includes(search),
	);

	return {
		results: matches.map((table) => {
			const rowCount =
				typeof table.row_count === 'number' ? `${table.row_count} rows` : undefined;
			return {
				name: table.name,
				value: table.id,
				description: rowCount ? `${rowCount} · slug: ${table.slug}` : `Slug: ${table.slug}`,
			};
		}),
	};
}

export async function searchWebhooks(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const websiteId = resourceLocatorValue(this.getCurrentNodeParameter('websiteId'));
	if (!websiteId) return { results: [] };

	const webhooks = await listAll<WebhookSummary>(
		this,
		`/api/v1/websites/${encodeURIComponent(websiteId)}/webhooks`,
		{ returnAll: true },
	);

	const search = (filter ?? '').trim().toLowerCase();
	const matches = webhooks.filter(
		(webhook) => !search || webhook.url.toLowerCase().includes(search),
	);

	return {
		results: matches.map((webhook) => ({
			name: webhook.url,
			value: webhook.id,
			description: webhook.auto_disabled
				? 'Auto-disabled after delivery failures'
				: webhook.active
					? 'Active'
					: 'Paused',
		})),
	};
}
