import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../shared/pagination';
import { encodeSegment, resourceLocatorValue } from '../shared/parameters';
import {
	EVENT_OPTIONS,
	limitField,
	returnAllField,
	websiteLocator,
	webhookLocator,
} from '../shared/properties';
import { makeIdempotencyKey, pageWeaveRequest } from '../shared/request';
import { validateWebhookUrl } from '../shared/webhookUrl';

const RESOURCE = { resource: ['webhook'] };

export const webhookOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: RESOURCE,
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a webhook endpoint, paused, and return its signing secret once',
				action: 'Create a webhook',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a webhook endpoint',
				action: 'Delete a webhook',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a webhook endpoint',
				action: 'Get a webhook',
			},
			{
				name: 'Get Delivery',
				value: 'getDelivery',
				description: 'Get a delivery with its payload and response body',
				action: 'Get a webhook delivery',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List webhook endpoints',
				action: 'Get many webhooks',
			},
			{
				name: 'Get Many Deliveries',
				value: 'getAllDeliveries',
				description: 'List deliveries for a webhook endpoint',
				action: 'Get many webhook deliveries',
			},
			{
				name: 'Redeliver',
				value: 'redeliver',
				description: 'Replay a recorded delivery',
				action: 'Redeliver a webhook delivery',
			},
			{
				name: 'Rotate Secret',
				value: 'rotateSecret',
				description: 'Rotate the signing secret and invalidate the old one immediately',
				action: 'Rotate a webhook secret',
			},
			{
				name: 'Send Test',
				value: 'sendTest',
				description: 'Queue a test delivery that works while the endpoint is paused',
				action: 'Send a test webhook delivery',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update the URL, events, form filter, or active state',
				action: 'Update a webhook',
			},
		],
		default: 'getAll',
	},
];

export const webhookFields: INodeProperties[] = [
	websiteLocator({ resource: ['webhook'] }),
	webhookLocator({
		resource: ['webhook'],
		operation: [
			'get',
			'update',
			'delete',
			'rotateSecret',
			'sendTest',
			'getAllDeliveries',
			'getDelivery',
			'redeliver',
		],
	}),
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/webhooks/pageweave',
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'] },
		},
		description: 'A public HTTPS URL that can receive PageWeave deliveries',
	},
	{
		displayName: 'Events',
		name: 'events',
		type: 'multiOptions',
		options: EVENT_OPTIONS,
		default: ['form.submission.created'],
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'] },
		},
		description: 'The events to deliver',
	},
	{
		displayName: 'Form IDs',
		name: 'formIds',
		type: 'string',
		default: '',
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'] },
		},
		description: 'Comma-separated form IDs. Leave empty to deliver submissions from every form.',
	},
	{
		displayName: 'Activate Immediately',
		name: 'activateImmediately',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'] },
		},
		description:
			'Whether to activate the endpoint after creation. PageWeave creates webhooks paused until the signature is verified.',
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { ...RESOURCE, operation: ['update'] },
		},
		options: [
			{
				displayName: 'Active',
				name: 'active',
				type: 'options',
				options: [
					{ name: 'Leave Unchanged', value: 'unchanged' },
					{ name: 'Active', value: 'active' },
					{ name: 'Paused', value: 'paused' },
				],
				default: 'unchanged',
				description:
					'Activating resets the delivery failure streak and re-enables an auto-disabled endpoint',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: EVENT_OPTIONS,
				default: ['form.submission.created'],
				description: 'The events to deliver. At least one event is required.',
			},
			{
				displayName: 'Form IDs',
				name: 'formIds',
				type: 'string',
				default: '',
				description:
					'Comma-separated form IDs. Leave empty to deliver submissions from every form.',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/webhooks/pageweave',
				description: 'A public HTTPS URL that can receive PageWeave deliveries',
			},
		],
	},
	returnAllField({
		resource: ['webhook'],
		operation: ['getAll', 'getAllDeliveries'],
	}),
	limitField({
		resource: ['webhook'],
		operation: ['getAll', 'getAllDeliveries'],
	}),
	{
		displayName: 'Filters',
		name: 'deliveryFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: { ...RESOURCE, operation: ['getAllDeliveries'] },
		},
		options: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'string',
				default: '',
				description: 'Only return deliveries for this event',
			},
			{
				displayName: 'Success',
				name: 'success',
				type: 'options',
				options: [
					{ name: 'Any', value: 'any' },
					{ name: 'Successful', value: 'true' },
					{ name: 'Failed', value: 'false' },
				],
				default: 'any',
				description: 'Filter by delivery outcome',
			},
		],
	},
	{
		displayName: 'Delivery ID',
		name: 'deliveryId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['getDelivery', 'redeliver'] },
		},
		description: 'The ID of the delivery',
	},
];

function requireWebsite(context: IExecuteFunctions, itemIndex: number): string {
	const websiteId = resourceLocatorValue(context.getNodeParameter('websiteId', itemIndex));
	if (!websiteId) {
		throw new NodeOperationError(context.getNode(), 'Website is required.', { itemIndex });
	}
	return websiteId;
}

function requireWebhook(context: IExecuteFunctions, itemIndex: number): string {
	const webhookId = resourceLocatorValue(context.getNodeParameter('webhookId', itemIndex));
	if (!webhookId) {
		throw new NodeOperationError(context.getNode(), 'Webhook is required.', { itemIndex });
	}
	return webhookId;
}

function parseFormIds(raw: unknown): string[] {
	if (typeof raw !== 'string') return [];
	return raw
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
}

function safeWebhookUrl(context: IExecuteFunctions, raw: string, itemIndex: number): string {
	try {
		return validateWebhookUrl(raw);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), (error as Error).message, { itemIndex });
	}
}

export async function executeWebhook(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const websiteId = requireWebsite(context, itemIndex);
	const collectionPath = `/api/v1/websites/${encodeSegment(websiteId)}/webhooks`;

	switch (operation) {
		case 'getAll': {
			const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const limit = returnAll
				? undefined
				: (context.getNodeParameter('limit', itemIndex, 50) as number);
			const webhooks = await listAll<IDataObject>(context, collectionPath, {
				returnAll,
				limit,
				itemIndex,
			});
			return webhooks.map((webhook) => ({ json: webhook, pairedItem: { item: itemIndex } }));
		}

		case 'get': {
			const webhookId = requireWebhook(context, itemIndex);
			const webhook = await pageWeaveRequest<IDataObject>(context, {
				method: 'GET',
				path: `${collectionPath}/${encodeSegment(webhookId)}`,
				itemIndex,
			});
			return [{ json: webhook, pairedItem: { item: itemIndex } }];
		}

		case 'create': {
			const body: IDataObject = {
				url: safeWebhookUrl(
					context,
					context.getNodeParameter('url', itemIndex, '') as string,
					itemIndex,
				),
				events: context.getNodeParameter('events', itemIndex, []) as string[],
			};

			if (!Array.isArray(body.events) || body.events.length === 0) {
				throw new NodeOperationError(context.getNode(), 'Choose at least one event.', {
					itemIndex,
				});
			}

			const formIds = parseFormIds(context.getNodeParameter('formIds', itemIndex, ''));
			if (formIds.length) body.form_ids = formIds;

			let webhook = await pageWeaveRequest<IDataObject>(context, {
				method: 'POST',
				path: collectionPath,
				body,
				idempotencyKey: makeIdempotencyKey(context, itemIndex, body),
				itemIndex,
			});

			if (context.getNodeParameter('activateImmediately', itemIndex, false) as boolean) {
				webhook = await pageWeaveRequest<IDataObject>(context, {
					method: 'PATCH',
					path: `${collectionPath}/${encodeSegment(String(webhook.id))}`,
					body: { active: true },
					itemIndex,
				});
			}

			return [{ json: webhook, pairedItem: { item: itemIndex } }];
		}

		case 'update': {
			const webhookId = requireWebhook(context, itemIndex);
			const fields = context.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
			const body: IDataObject = {};

			if (typeof fields.url === 'string' && fields.url.trim()) {
				body.url = safeWebhookUrl(context, fields.url, itemIndex);
			}
			if (Array.isArray(fields.events)) {
				if (fields.events.length === 0) {
					throw new NodeOperationError(context.getNode(), 'Choose at least one event.', {
						itemIndex,
					});
				}
				body.events = fields.events;
			}
			if (typeof fields.formIds === 'string') body.form_ids = parseFormIds(fields.formIds);
			if (fields.active === 'active') body.active = true;
			if (fields.active === 'paused') body.active = false;

			if (Object.keys(body).length === 0) {
				throw new NodeOperationError(context.getNode(), 'Choose at least one field to update.', {
					itemIndex,
				});
			}

			const webhook = await pageWeaveRequest<IDataObject>(context, {
				method: 'PATCH',
				path: `${collectionPath}/${encodeSegment(webhookId)}`,
				body,
				itemIndex,
			});
			return [{ json: webhook, pairedItem: { item: itemIndex } }];
		}

		case 'delete': {
			const webhookId = requireWebhook(context, itemIndex);
			await pageWeaveRequest(context, {
				method: 'DELETE',
				path: `${collectionPath}/${encodeSegment(webhookId)}`,
				itemIndex,
			});
			return [{ json: { id: webhookId, deleted: true }, pairedItem: { item: itemIndex } }];
		}

		case 'rotateSecret': {
			const webhookId = requireWebhook(context, itemIndex);
			const rotated = await pageWeaveRequest<IDataObject>(context, {
				method: 'POST',
				path: `${collectionPath}/${encodeSegment(webhookId)}/rotate_secret`,
				idempotencyKey: makeIdempotencyKey(context, itemIndex, {
					action: 'rotate_secret',
					webhookId,
				}),
				itemIndex,
			});
			return [{ json: rotated, pairedItem: { item: itemIndex } }];
		}

		case 'sendTest': {
			const webhookId = requireWebhook(context, itemIndex);
			const result = await pageWeaveRequest<IDataObject>(context, {
				method: 'POST',
				path: `${collectionPath}/${encodeSegment(webhookId)}/send_test`,
				idempotencyKey: makeIdempotencyKey(context, itemIndex, {
					action: 'send_test',
					webhookId,
				}),
				itemIndex,
			});
			return [{ json: result, pairedItem: { item: itemIndex } }];
		}

		case 'getAllDeliveries': {
			const webhookId = requireWebhook(context, itemIndex);
			const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const limit = returnAll
				? undefined
				: (context.getNodeParameter('limit', itemIndex, 50) as number);
			const filters = context.getNodeParameter('deliveryFilters', itemIndex, {}) as IDataObject;
			const qs: IDataObject = {};

			if (typeof filters.event === 'string' && filters.event.trim()) {
				qs.event = filters.event.trim();
			}
			if (filters.success === 'true') qs.success = true;
			if (filters.success === 'false') qs.success = false;

			const deliveries = await listAll<IDataObject>(
				context,
				`${collectionPath}/${encodeSegment(webhookId)}/deliveries`,
				{ qs, returnAll, limit, itemIndex },
			);
			return deliveries.map((delivery) => ({
				json: delivery,
				pairedItem: { item: itemIndex },
			}));
		}

		case 'getDelivery': {
			const webhookId = requireWebhook(context, itemIndex);
			const deliveryId = context.getNodeParameter('deliveryId', itemIndex, '') as string;
			const delivery = await pageWeaveRequest<IDataObject>(context, {
				method: 'GET',
				path: `${collectionPath}/${encodeSegment(webhookId)}/deliveries/${encodeSegment(
					deliveryId,
				)}`,
				itemIndex,
			});
			return [{ json: delivery, pairedItem: { item: itemIndex } }];
		}

		case 'redeliver': {
			const webhookId = requireWebhook(context, itemIndex);
			const deliveryId = context.getNodeParameter('deliveryId', itemIndex, '') as string;
			const result = await pageWeaveRequest<IDataObject>(context, {
				method: 'POST',
				path: `${collectionPath}/${encodeSegment(webhookId)}/deliveries/${encodeSegment(
					deliveryId,
				)}/redeliver`,
				idempotencyKey: makeIdempotencyKey(context, itemIndex, {
					action: 'redeliver',
					webhookId,
					deliveryId,
				}),
				itemIndex,
			});
			return [{ json: result, pairedItem: { item: itemIndex } }];
		}

		default:
			throw new NodeOperationError(context.getNode(), `Unsupported operation "${operation}".`, {
				itemIndex,
			});
	}
}
