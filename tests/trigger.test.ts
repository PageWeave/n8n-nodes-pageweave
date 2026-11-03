import type { IDataObject, IHookFunctions, IWebhookFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { PageWeaveTrigger } from '../nodes/PageWeaveTrigger/PageWeaveTrigger.node';
import { computeSignature } from '../nodes/PageWeaveTrigger/signature';
import { createContext, testNode } from './helpers';

const WEBHOOK_URL = 'https://n8n.example.com/webhook/pageweave';
const TEST_WEBHOOK_URL = 'https://n8n.example.com/webhook-test/pageweave';

function createHookContext(
	params: Record<string, unknown>,
	responses: Parameters<typeof createContext>[0],
	state: IDataObject = {},
) {
	const base = createContext(responses);
	const context = {
		...base.context,
		getMode: () => params.mode ?? 'internal',
		getWorkflowStaticData: () => state,
		getNodeWebhookUrl: () => params.webhookUrl ?? WEBHOOK_URL,
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getWorkflow: () => ({ id: 'workflow-1' }),
	};

	return {
		context: context as unknown as IHookFunctions,
		requests: base.requests,
		state,
	};
}

function createWebhookContext(options: {
	rawBody: Buffer;
	body: IDataObject;
	headers: Record<string, string>;
	mode?: string;
	state?: IDataObject;
}) {
	const response = {
		statusCode: 200,
		body: '' as string,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		send(body: string) {
			this.body = body;
			return this;
		},
		end() {
			return this;
		},
	};

	const context = {
		getMode: () => options.mode ?? 'webhook',
		getWorkflowStaticData: () => options.state ?? {},
		getRequestObject: () => ({ rawBody: options.rawBody }),
		getHeaderData: () => options.headers,
		getBodyData: () => options.body,
		getResponseObject: () => response,
		getNode: () => testNode,
		getCredentials: () => ({ baseUrl: 'https://pageweave.dev', apiKey: 'pw_test' }),
		helpers: {
			returnJsonArray: (items: IDataObject[]) => items.map((json) => ({ json })),
		},
		logger: { warn: vi.fn() },
	};

	return {
		context: context as unknown as IWebhookFunctions,
		response,
	};
}

describe('PageWeaveTrigger lifecycle', () => {
	it('creates, activates, and stores a webhook endpoint', async () => {
		const trigger = new PageWeaveTrigger();
		const { context, requests, state } = createHookContext(
			{
				websiteId: { mode: 'id', value: 'site-1' },
				events: ['form.submission.created'],
				formIds: 'form-1, form-2',
			},
			[
				{
					statusCode: 200,
					body: {
						data: [],
						pagination: { limit: 100, has_more: false, next_cursor: null },
					},
				},
				{ statusCode: 201, body: { id: 'wh-1', secret: 'secret-1' } },
				{ statusCode: 200, body: { id: 'wh-1', active: true } },
			],
		);

		await expect(
			trigger.webhookMethods.default.create.call(context),
		).resolves.toBe(true);

		expect(requests[1].method).toBe('POST');
		expect(requests[1].body).toBe(
			JSON.stringify({
				url: WEBHOOK_URL,
				events: ['form.submission.created'],
				form_ids: ['form-1', 'form-2'],
			}),
		);
		expect(requests[2].method).toBe('PATCH');
		expect(requests[2].body).toBe(
			JSON.stringify({
				events: ['form.submission.created'],
				form_ids: ['form-1', 'form-2'],
				active: true,
			}),
		);
		expect(state).toMatchObject({
			webhookId: 'wh-1',
			webhookSecret: 'secret-1',
			webhookUrl: WEBHOOK_URL,
		});
	});

	it('reuses the stored endpoint and rotates its secret', async () => {
		const trigger = new PageWeaveTrigger();
		const { context, requests } = createHookContext(
			{
				websiteId: { mode: 'id', value: 'site-1' },
				events: ['form.submission.created'],
				formIds: '',
			},
			[
				{ statusCode: 200, body: { webhook_id: 'wh-1', secret: 'rotated' } },
				{ statusCode: 200, body: { id: 'wh-1', active: true } },
			],
			{ webhookId: 'wh-1', webhookSecret: 'old', webhookUrl: WEBHOOK_URL },
		);

		await trigger.webhookMethods.default.create.call(context);

		expect(requests[0].url).toContain('/webhooks/wh-1/rotate_secret');
		expect(requests[1].body).toContain('"active":true');
	});

	it('reports an existing endpoint as present', async () => {
		const trigger = new PageWeaveTrigger();
		const { context, requests } = createHookContext(
			{
				websiteId: { mode: 'id', value: 'site-1' },
				events: ['form.submission.created'],
				formIds: '',
			},
			[
				{
					statusCode: 200,
					body: {
						id: 'wh-1',
						url: WEBHOOK_URL,
						active: true,
						auto_disabled: false,
						events: ['form.submission.created'],
						form_ids: [],
					},
				},
			],
			{ webhookId: 'wh-1', webhookSecret: 'secret-1', webhookUrl: WEBHOOK_URL },
		);

		await expect(
			trigger.webhookMethods.default.checkExists.call(context),
		).resolves.toBe(true);
		expect(requests).toHaveLength(1);
	});

	it('reactivates an auto-disabled endpoint', async () => {
		const trigger = new PageWeaveTrigger();
		const { context, requests } = createHookContext(
			{
				websiteId: { mode: 'id', value: 'site-1' },
				events: ['form.submission.created'],
				formIds: '',
			},
			[
				{
					statusCode: 200,
					body: {
						id: 'wh-1',
						url: WEBHOOK_URL,
						active: false,
						auto_disabled: true,
						events: ['form.submission.created'],
						form_ids: [],
					},
				},
				{ statusCode: 200, body: { id: 'wh-1', active: true } },
			],
			{ webhookId: 'wh-1', webhookSecret: 'secret-1', webhookUrl: WEBHOOK_URL },
		);

		await expect(
			trigger.webhookMethods.default.checkExists.call(context),
		).resolves.toBe(true);
		expect(requests[1].method).toBe('PATCH');
		expect(requests[1].body).toContain('"active":true');
	});

	it('forgets an endpoint that PageWeave no longer has', async () => {
		const trigger = new PageWeaveTrigger();
		const { context, state } = createHookContext(
			{
				websiteId: { mode: 'id', value: 'site-1' },
				events: ['form.submission.created'],
				formIds: '',
			},
			[{ statusCode: 404, body: { title: 'Not Found' } }],
			{ webhookId: 'gone', webhookSecret: 'secret-1', webhookUrl: WEBHOOK_URL },
		);

		await expect(
			trigger.webhookMethods.default.checkExists.call(context),
		).resolves.toBe(false);
		expect(state).not.toHaveProperty('webhookId');
	});

	it('deletes a test endpoint by URL when static data has no ID', async () => {
		const trigger = new PageWeaveTrigger();
		const { context, requests } = createHookContext(
			{ websiteId: { mode: 'id', value: 'site-1' }, webhookUrl: TEST_WEBHOOK_URL },
			[
				{
					statusCode: 200,
					body: {
						data: [{ id: 'wh-test', url: TEST_WEBHOOK_URL }],
						pagination: { limit: 100, has_more: false, next_cursor: null },
					},
				},
				{ statusCode: 204 },
			],
		);

		await expect(
			trigger.webhookMethods.default.delete.call(context),
		).resolves.toBe(true);
		expect(requests[1].method).toBe('DELETE');
		expect(requests[1].url).toContain('/webhooks/wh-test');
	});
});

describe('PageWeaveTrigger webhook', () => {
	const body: IDataObject = {
		event: 'form.submission.created',
		timestamp: '2026-11-03T10:00:00Z',
		data: {
			submission_id: 'sub-1',
			form_id: 'form-1',
			form_name: 'Contact',
			fields: { email: 'a@example.com' },
			files: [],
			submitted_at: '2026-11-03T09:59:00Z',
			spam: { verdict: 'ham', score: 0, signals: {} },
		},
	};

	it('accepts a valid signature and emits the event', async () => {
		const trigger = new PageWeaveTrigger();
		const rawBody = Buffer.from(JSON.stringify(body));
		const { context } = createWebhookContext({
			rawBody,
			body,
			headers: {
				'x-webhook-signature': `sha256=${computeSignature('secret-1', rawBody)}`,
				'x-webhook-event': 'form.submission.created',
			},
			state: { webhookSecret: 'secret-1' },
		});

		const result = await trigger.webhook.call(context);

		expect(result.workflowData?.[0]?.[0]?.json).toMatchObject({
			event: 'form.submission.created',
			timestamp: '2026-11-03T10:00:00Z',
			data: { submission_id: 'sub-1' },
			test: false,
		});
	});

	it('rejects a tampered body with 401', async () => {
		const trigger = new PageWeaveTrigger();
		const rawBody = Buffer.from(JSON.stringify(body));
		const { context, response } = createWebhookContext({
			rawBody,
			body,
			headers: {
				'x-webhook-signature': `sha256=${computeSignature('secret-1', 'tampered')}`,
			},
			state: { webhookSecret: 'secret-1' },
		});

		const result = await trigger.webhook.call(context);

		expect(result.noWebhookResponse).toBe(true);
		expect(response.statusCode).toBe(401);
	});

	it('rejects a request with no signature at all', async () => {
		const trigger = new PageWeaveTrigger();
		const { context, response } = createWebhookContext({
			rawBody: Buffer.from(JSON.stringify(body)),
			body,
			headers: {},
			state: { webhookSecret: 'secret-1' },
		});

		const result = await trigger.webhook.call(context);
		expect(result.noWebhookResponse).toBe(true);
		expect(response.statusCode).toBe(401);
	});

	it('marks test deliveries', async () => {
		const trigger = new PageWeaveTrigger();
		const testBody: IDataObject = {
			...body,
			data: { ...(body.data as IDataObject), test: true },
		};
		const rawBody = Buffer.from(JSON.stringify(testBody));
		const { context } = createWebhookContext({
			rawBody,
			body: testBody,
			headers: { 'x-webhook-signature': `sha256=${computeSignature('test-secret', rawBody)}` },
			mode: 'manual',
			state: { testWebhookSecret: 'test-secret' },
		});

		const result = await trigger.webhook.call(context);
		expect(result.workflowData?.[0]?.[0]?.json).toMatchObject({ test: true });
	});

	it('ignores a repeated delivery ID', async () => {
		const trigger = new PageWeaveTrigger();
		const rawBody = Buffer.from(JSON.stringify(body));
		const state: IDataObject = {
			webhookSecret: 'secret-1',
			recentDeliveryIds: ['delivery-1'],
		};
		const { context } = createWebhookContext({
			rawBody,
			body,
			headers: {
				'x-webhook-signature': `sha256=${computeSignature('secret-1', rawBody)}`,
				'x-webhook-event': 'form.submission.created',
				'x-webhook-delivery-id': 'delivery-1',
			},
			state,
		});

		const result = await trigger.webhook.call(context);

		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toBe('OK');
	});
});
