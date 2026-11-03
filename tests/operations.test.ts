import { describe, expect, it } from 'vitest';

import { executeCustomApi } from '../nodes/PageWeave/resources/customApi';
import { executeRow } from '../nodes/PageWeave/resources/row';
import { executeTable } from '../nodes/PageWeave/resources/table';
import { executeWebhook } from '../nodes/PageWeave/resources/webhook';
import { isPrivateHost, validateWebhookUrl } from '../nodes/PageWeave/shared/webhookUrl';
import { createExecuteContext } from './helpers';

const websiteId = { mode: 'id', value: 'site-1' };
const tableId = { mode: 'id', value: 'table-1' };

describe('validateWebhookUrl', () => {
	it('accepts a public HTTPS URL', () => {
		expect(validateWebhookUrl('https://hooks.example.com/pageweave')).toBe(
			'https://hooks.example.com/pageweave',
		);
	});

	it('rejects plain HTTP', () => {
		expect(() => validateWebhookUrl('http://hooks.example.com')).toThrow(/https/);
	});

	it('rejects loopback and private hosts', () => {
		expect(isPrivateHost('localhost')).toBe(true);
		expect(isPrivateHost('127.0.0.1')).toBe(true);
		expect(isPrivateHost('192.168.1.10')).toBe(true);
		expect(isPrivateHost('10.0.0.5')).toBe(true);
		expect(isPrivateHost('::1')).toBe(true);
		expect(isPrivateHost('hooks.example.com')).toBe(false);
	});

	it('rejects URLs with embedded credentials', () => {
		expect(() => validateWebhookUrl('https://user:pass@hooks.example.com')).toThrow(
			/credentials/,
		);
	});
});

describe('executeWebhook', () => {
	it('creates an endpoint with parsed form IDs', async () => {
		const { context, requests } = createExecuteContext(
			{
				websiteId,
				url: 'https://hooks.example.com/pageweave',
				events: ['form.submission.created'],
				formIds: 'form-1, form-2',
				activateImmediately: false,
			},
			[{ statusCode: 201, body: { id: 'wh-1', secret: 'shh' } }],
		);

		const [item] = await executeWebhook(context, 'create', 0);

		expect(item.json).toEqual({ id: 'wh-1', secret: 'shh' });
		expect(requests[0].body).toBe(
			JSON.stringify({
				url: 'https://hooks.example.com/pageweave',
				events: ['form.submission.created'],
				form_ids: ['form-1', 'form-2'],
			}),
		);
		expect(requests[0].headers).toMatchObject({
			'Idempotency-Key': expect.stringContaining('n8n-exec-1-node-1-0-'),
		});
	});

	it('activates a newly created endpoint when asked', async () => {
		const { context, requests } = createExecuteContext(
			{
				websiteId,
				url: 'https://hooks.example.com/pageweave',
				events: ['form.submission.created'],
				formIds: '',
				activateImmediately: true,
			},
			[
				{ statusCode: 201, body: { id: 'wh-1', secret: 'shh' } },
				{ statusCode: 200, body: { id: 'wh-1', active: true } },
			],
		);

		const [item] = await executeWebhook(context, 'create', 0);

		expect(item.json).toEqual({ id: 'wh-1', secret: 'shh', active: true });
		expect(requests[1].method).toBe('PATCH');
		expect(requests[1].body).toBe(JSON.stringify({ active: true }));
	});

	it('rejects a private URL before calling PageWeave', async () => {
		const { context, requests } = createExecuteContext(
			{
				websiteId,
				url: 'https://localhost:5678/webhook/pageweave',
				events: ['form.submission.created'],
				formIds: '',
				activateImmediately: false,
			},
			[],
		);

		await expect(executeWebhook(context, 'create', 0)).rejects.toThrow(/private|loopback/);
		expect(requests).toHaveLength(0);
	});

	it('clears the form filter when Form IDs is added empty', async () => {
		const { context, requests } = createExecuteContext(
			{ websiteId, webhookId: { mode: 'id', value: 'wh-1' }, updateFields: { formIds: '' } },
			[{ statusCode: 200, body: { id: 'wh-1', form_ids: [] } }],
		);

		await executeWebhook(context, 'update', 0);
		expect(requests[0].body).toBe(JSON.stringify({ form_ids: [] }));
	});
});

describe('executeRow', () => {
	it('serializes list filters into the query string', async () => {
		const { context, requests } = createExecuteContext(
			{
				websiteId,
				tableId,
				returnAll: true,
				filters: {
					published: 'true',
					search: '  acme  ',
					sort: '-created_at',
					filter: { price_gte: 10 },
				},
			},
			[
				{
					statusCode: 200,
					body: {
						data: [{ id: 'row-1' }],
						pagination: { limit: 100, has_more: false, next_cursor: null },
					},
				},
			],
		);

		const [item] = await executeRow(context, 'getAll', 0);

		expect(item.json).toEqual({ id: 'row-1' });
		expect(requests[0].qs).toEqual({
			published: true,
			search: 'acme',
			sort: '-created_at',
			filter: '{"price_gte":10}',
			limit: 100,
		});
	});

	it('exports rows as a binary CSV item', async () => {
		const csv = Buffer.from('id,name\n1,Acme\n');
		const { context, requests } = createExecuteContext(
			{
				websiteId,
				tableId,
				exportFilters: { published: 'any', sanitize: true },
				binaryPropertyName: 'csv',
			},
			[
				{
					statusCode: 200,
					body: csv,
					headers: { 'content-disposition': 'attachment; filename="leads.csv"' },
				},
			],
		);

		const [item] = await executeRow(context, 'export', 0);

		expect(item.binary?.csv).toMatchObject({
			fileName: 'leads.csv',
			mimeType: 'text/csv',
			data: csv.toString('base64'),
		});
		expect(requests[0].headers).toMatchObject({ Accept: 'text/csv' });
	});

	it('rejects an empty Row ID before calling PageWeave', async () => {
		const { context, requests } = createExecuteContext(
			{ websiteId, tableId, rowId: '   ' },
			[],
		);

		await expect(executeRow(context, 'get', 0)).rejects.toThrow(/Row ID is required/);
		expect(requests).toHaveLength(0);
	});

	it('returns the async import run when Wait for Completion is off', async () => {
		const { context } = createExecuteContext(
			{
				websiteId,
				tableId,
				importSource: 'content',
				content: 'id,name\n1,Acme\n',
				importMode: 'create',
				columnMapping: '',
				waitForCompletion: false,
			},
			[{ statusCode: 202, body: { async: true, import: { id: 'imp-1', state: 'pending' } } }],
		);

		const [item] = await executeRow(context, 'import', 0);

		expect(item.json).toEqual({ async: true, import: { id: 'imp-1', state: 'pending' } });
	});
});

describe('executeTable', () => {
	it('creates a table with a parsed field schema', async () => {
		const { context, requests } = createExecuteContext(
			{
				websiteId,
				name: 'Leads',
				additionalFields: {
					slug: 'leads',
					fieldsSchema: { fields: [{ name: 'email', type: 'string' }] },
				},
			},
			[{ statusCode: 201, body: { id: 'table-1', name: 'Leads' } }],
		);

		const [item] = await executeTable(context, 'create', 0);

		expect(item.json).toEqual({ id: 'table-1', name: 'Leads' });
		expect(requests[0].body).toBe(
			JSON.stringify({
				name: 'Leads',
				slug: 'leads',
				fields_schema: { fields: [{ name: 'email', type: 'string' }] },
			}),
		);
	});
});

describe('executeCustomApi', () => {
	it('forwards a relative path, query parameters, and headers', async () => {
		const { context, requests } = createExecuteContext(
			{
				method: 'GET',
				path: '/api/v1/websites',
				query: { limit: 2 },
				headers: { 'X-Test': 'yes' },
				responseFormat: 'json',
			},
			[{ statusCode: 200, body: [{ id: '1' }, { id: '2' }] }],
		);

		const items = await executeCustomApi(context, 0);

		expect(items.map((item) => item.json)).toEqual([{ id: '1' }, { id: '2' }]);
		expect(requests[0]).toMatchObject({ method: 'GET', qs: { limit: 2 } });
		expect(requests[0].headers).toMatchObject({ 'X-Test': 'yes' });
	});

	it('rejects an absolute URL', async () => {
		const { context, requests } = createExecuteContext(
			{
				method: 'GET',
				path: 'https://evil.example/api/v1/websites',
				query: {},
				headers: {},
				responseFormat: 'json',
			},
			[],
		);

		await expect(executeCustomApi(context, 0)).rejects.toThrow(/must start with \/api\/v1\//);
		expect(requests).toHaveLength(0);
	});

	it('blocks overriding the Authorization header', async () => {
		const { context, requests } = createExecuteContext(
			{
				method: 'GET',
				path: '/api/v1/me',
				query: {},
				headers: { Authorization: 'Bearer stolen' },
				responseFormat: 'json',
			},
			[],
		);

		await expect(executeCustomApi(context, 0)).rejects.toThrow(/cannot be set/);
		expect(requests).toHaveLength(0);
	});

	it('adds an idempotency key on POST and returns text', async () => {
		const { context, requests } = createExecuteContext(
			{
				method: 'POST',
				path: '/api/v1/websites/site-1/tables',
				query: {},
				body: { name: 'Leads' },
				headers: {},
				responseFormat: 'text',
			},
			[{ statusCode: 201, body: 'created' }],
		);

		const items = await executeCustomApi(context, 0);

		expect(items[0].json).toEqual({ data: 'created' });
		expect(requests[0].headers).toMatchObject({
			'Idempotency-Key': expect.stringContaining('n8n-exec-1-node-1-0-'),
			'Content-Type': 'application/json',
		});
		expect(requests[0].encoding).toBe('text');
	});
});
