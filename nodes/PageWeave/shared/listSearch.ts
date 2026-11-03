import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import { resourceLocatorValue } from './parameters';
import type { PageWeaveCollection } from './request';
import { pageWeaveRequest } from './request';

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

export async function searchWebsites(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const qs: IDataObject = { limit: 100 };
	const search = (filter ?? '').trim();
	if (search) qs.q = search;

	const page = await pageWeaveRequest<PageWeaveCollection<WebsiteSummary>>(this, {
		method: 'GET',
		path: '/api/v1/websites',
		qs,
	});

	return {
		results: (page.data ?? []).map((website) => {
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

	const page = await pageWeaveRequest<PageWeaveCollection<FormSummary>>(this, {
		method: 'GET',
		path: `/api/v1/websites/${encodeURIComponent(websiteId)}/forms`,
		qs: { limit: 100 },
	});

	const search = (filter ?? '').trim().toLowerCase();
	const forms = (page.data ?? []).filter(
		(form) => !search || form.name.toLowerCase().includes(search),
	);

	return {
		results: forms.map((form) => ({
			name: form.name,
			value: form.id,
			url: form.submit_url,
		})),
	};
}
