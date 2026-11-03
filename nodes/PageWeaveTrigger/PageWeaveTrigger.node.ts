import { createHash } from 'node:crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { listAll } from '../PageWeave/shared/pagination';
import { encodeSegment, resourceLocatorValue } from '../PageWeave/shared/parameters';
import { rethrowAsPageWeaveError } from '../PageWeave/shared/errors';
import {
	EVENT_OPTIONS,
	websiteLocator,
} from '../PageWeave/shared/properties';
import {
	pageWeaveRequest,
	stableStringify,
} from '../PageWeave/shared/request';
import { validateWebhookUrl } from '../PageWeave/shared/webhookUrl';
import { verifySignature } from './signature';

type Slot = 'live' | 'test';

interface EndpointState {
	id?: string;
	secret?: string;
	url?: string;
	events?: string[];
	formIds?: string[];
}

interface EndpointConfig {
	url: string;
	events: string[];
	formIds: string[];
}

const SLOT_FIELDS: Record<Slot, { id: string; secret: string; url: string; events: string; formIds: string }> =
	{
		live: {
			id: 'webhookId',
			secret: 'webhookSecret',
			url: 'webhookUrl',
			events: 'webhookEvents',
			formIds: 'webhookFormIds',
		},
		test: {
			id: 'testWebhookId',
			secret: 'testWebhookSecret',
			url: 'testWebhookUrl',
			events: 'testWebhookEvents',
			formIds: 'testWebhookFormIds',
		},
	};

function readState(staticData: IDataObject, slot: Slot): EndpointState {
	const fields = SLOT_FIELDS[slot];
	return {
		id: staticData[fields.id] as string | undefined,
		secret: staticData[fields.secret] as string | undefined,
		url: staticData[fields.url] as string | undefined,
		events: staticData[fields.events] as string[] | undefined,
		formIds: staticData[fields.formIds] as string[] | undefined,
	};
}

function writeState(staticData: IDataObject, slot: Slot, state: EndpointState): void {
	const fields = SLOT_FIELDS[slot];
	Object.assign(staticData, {
		[fields.id]: state.id,
		[fields.secret]: state.secret,
		[fields.url]: state.url,
		[fields.events]: state.events,
		[fields.formIds]: state.formIds,
	});
}

function clearState(staticData: IDataObject, slot: Slot): void {
	const fields = SLOT_FIELDS[slot];
	for (const key of Object.values(fields)) delete staticData[key];
}

function isNotFound(error: unknown): boolean {
	return (error as { httpCode?: string } | undefined)?.httpCode === '404';
}

function sameSet(left: unknown, right: string[]): boolean {
	if (!Array.isArray(left)) return right.length === 0;
	const leftValues = left.map(String).sort();
	const rightValues = [...right].sort();
	return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
}

function parseFormIds(raw: unknown): string[] {
	if (typeof raw !== 'string') return [];
	return raw
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
}

function webhooksPath(websiteId: string): string {
	return `/api/v1/websites/${encodeSegment(websiteId)}/webhooks`;
}

function requireWebsite(context: IHookFunctions): string {
	const websiteId = resourceLocatorValue(context.getNodeParameter('websiteId', ''));
	if (!websiteId) {
		throw new NodeOperationError(context.getNode(), 'Website is required.');
	}
	return websiteId;
}

function desiredConfig(context: IHookFunctions): EndpointConfig {
	const url = context.getNodeWebhookUrl('default');
	if (!url) {
		throw new NodeOperationError(context.getNode(), 'n8n did not provide a webhook URL.');
	}

	const events = (context.getNodeParameter('events', []) as string[]) ?? [];
	if (!Array.isArray(events) || events.length === 0) {
		throw new NodeOperationError(context.getNode(), 'Choose at least one event.');
	}

	return {
		url,
		events,
		formIds: parseFormIds(context.getNodeParameter('formIds', '')),
	};
}

function publicUrl(context: IHookFunctions): string {
	const { url } = desiredConfig(context);
	try {
		return validateWebhookUrl(url);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), 'PageWeave cannot deliver to this n8n URL.', {
			description: `${(error as Error).message} Expose n8n through a public HTTPS hostname or tunnel before activating the workflow.`,
		});
	}
}

function idempotencyKey(context: IHookFunctions, payload: unknown): string {
	const node = context.getNode();
	const workflowId = String(context.getWorkflow().id ?? 'workflow');
	const hash = createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 32);
	return `n8n-${workflowId}-${node.id ?? node.name}-${hash}`.slice(0, 255);
}

async function rotateSecret(
	context: IHookFunctions,
	websiteId: string,
	webhookId: string,
): Promise<string> {
	const rotated = await pageWeaveRequest<{ secret?: string }>(context, {
		method: 'POST',
		path: `${webhooksPath(websiteId)}/${encodeSegment(webhookId)}/rotate_secret`,
		idempotencyKey: idempotencyKey(context, { action: 'rotate_secret', webhookId }),
	});

	if (!rotated?.secret) {
		throw new NodeOperationError(
			context.getNode(),
			'PageWeave did not return a signing secret for the webhook.',
		);
	}
	return rotated.secret;
}

async function syncEndpoint(
	context: IHookFunctions,
	websiteId: string,
	webhookId: string,
	config: EndpointConfig,
	includeUrl: boolean,
): Promise<void> {
	const body: IDataObject = {
		events: config.events,
		form_ids: config.formIds,
		active: true,
	};
	if (includeUrl) body.url = config.url;

	await pageWeaveRequest(context, {
		method: 'PATCH',
		path: `${webhooksPath(websiteId)}/${encodeSegment(webhookId)}`,
		body,
	});
}

async function findEndpointIdByUrl(
	context: IHookFunctions,
	websiteId: string,
	url: string,
): Promise<string | undefined> {
	const endpoints = await listAll<IDataObject>(context, webhooksPath(websiteId), {
		returnAll: true,
	});
	const match = endpoints.find((endpoint) => endpoint.url === url);
	return match?.id ? String(match.id) : undefined;
}

export class PageWeaveTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PageWeave Trigger',
		name: 'pageWeaveTrigger',
		icon: {
			light: 'file:../PageWeave/pageweave.svg',
			dark: 'file:../PageWeave/pageweave.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when PageWeave sends a webhook event',
		defaults: {
			name: 'PageWeave Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'pageWeaveApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'pageweave',
			},
		],
		properties: [
			{
				displayName:
					'PageWeave delivers to public HTTPS URLs only. Expose n8n through a tunnel or public hostname before activating this workflow.',
				name: 'publicUrlNotice',
				type: 'notice',
				default: '',
			},
			websiteLocator({}),
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: EVENT_OPTIONS,
				default: ['form.submission.created'],
				required: true,
				description: 'The events that start this workflow',
			},
			{
				displayName: 'Form IDs',
				name: 'formIds',
				type: 'string',
				default: '',
				description:
					'Comma-separated form IDs. Leave empty to receive submissions from every form.',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const slot: Slot = this.getMode() === 'manual' ? 'test' : 'live';
				const state = readState(staticData, slot);

				if (!state.id || !state.secret) return false;

				const websiteId = requireWebsite(this);
				const config = desiredConfig(this);

				let endpoint: IDataObject;
				try {
					endpoint = await pageWeaveRequest<IDataObject>(this, {
						method: 'GET',
						path: `${webhooksPath(websiteId)}/${encodeSegment(state.id)}`,
					});
				} catch (error) {
					if (isNotFound(error)) {
						clearState(staticData, slot);
						return false;
					}
					throw rethrowAsPageWeaveError(this.getNode(), error);
				}

				const urlChanged = endpoint.url !== config.url || state.url !== config.url;
				if (urlChanged) {
					try {
						validateWebhookUrl(config.url);
					} catch (error) {
						this.logger.warn(
							`PageWeave Trigger cannot register the current n8n URL: ${(error as Error).message}`,
						);
						// create() reports the tunnel requirement with actionable guidance.
						return false;
					}
				}

				const needsSync =
					urlChanged ||
					endpoint.active !== true ||
					endpoint.auto_disabled === true ||
					!sameSet(endpoint.events, config.events) ||
					!sameSet(endpoint.form_ids, config.formIds);

				if (needsSync) {
					await syncEndpoint(this, websiteId, state.id, config, urlChanged);
					writeState(staticData, slot, { ...state, ...config });
				}

				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const slot: Slot = this.getMode() === 'manual' ? 'test' : 'live';
				const state = readState(staticData, slot);
				const websiteId = requireWebsite(this);

				const url = publicUrl(this);
				const events = (this.getNodeParameter('events', []) as string[]) ?? [];
				if (!Array.isArray(events) || events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Choose at least one event.');
				}

				const config: EndpointConfig = {
					url,
					events,
					formIds: parseFormIds(this.getNodeParameter('formIds', '')),
				};

				// Reuse the endpoint this workflow already registered. Rotating gives
				// n8n a secret it can verify with even when static data kept only the ID.
				if (state.id) {
					try {
						const secret = await rotateSecret(this, websiteId, state.id);
						await syncEndpoint(this, websiteId, state.id, config, true);
						writeState(staticData, slot, { id: state.id, secret, ...config });
						return true;
					} catch (error) {
						if (!isNotFound(error)) {
							throw rethrowAsPageWeaveError(this.getNode(), error);
						}
						clearState(staticData, slot);
					}
				}

				// Adopt an endpoint that already points at this n8n URL. Without the
				// stored ID this is the only way to avoid an orphan duplicate.
				const existingId = await findEndpointIdByUrl(this, websiteId, url);
				if (existingId) {
					const secret = await rotateSecret(this, websiteId, existingId);
					await syncEndpoint(this, websiteId, existingId, config, false);
					writeState(staticData, slot, { id: existingId, secret, ...config });
					return true;
				}

				const body: IDataObject = { url, events };
				if (config.formIds.length) body.form_ids = config.formIds;

				const created = await pageWeaveRequest<IDataObject>(this, {
					method: 'POST',
					path: webhooksPath(websiteId),
					body,
					idempotencyKey: idempotencyKey(this, body),
				});

				const webhookId = created?.id ? String(created.id) : '';
				const secret = typeof created?.secret === 'string' ? created.secret : '';

				if (!webhookId || !secret) {
					throw new NodeOperationError(
						this.getNode(),
						'PageWeave did not return a webhook ID and signing secret.',
					);
				}

				try {
					await syncEndpoint(this, websiteId, webhookId, config, false);
				} catch (error) {
					await pageWeaveRequest(this, {
						method: 'DELETE',
						path: `${webhooksPath(websiteId)}/${encodeSegment(webhookId)}`,
					}).catch(() => undefined);
					throw rethrowAsPageWeaveError(this.getNode(), error);
				}

				writeState(staticData, slot, { id: webhookId, secret, ...config });
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const url = this.getNodeWebhookUrl('default');
				if (!url) return true;

				const websiteId = requireWebsite(this);

				// Test cleanup runs with mode "internal", so identify the slot by URL.
				// When n8n moved to a new hostname, the stored URL no longer matches;
				// fall back to the slot whose webhook URL kind matches the request.
				const slots: Slot[] = ['live', 'test'];
				const matched = slots.find((candidate) => readState(staticData, candidate).url === url);
				const slot: Slot = matched ?? (url.includes('/webhook-test/') ? 'test' : 'live');
				let webhookId = readState(staticData, slot).id;

				if (!webhookId) {
					webhookId = await findEndpointIdByUrl(this, websiteId, url);
				}

				if (!webhookId) {
					clearState(staticData, slot);
					return true;
				}

				try {
					await pageWeaveRequest(this, {
						method: 'DELETE',
						path: `${webhooksPath(websiteId)}/${encodeSegment(webhookId)}`,
					});
				} catch (error) {
					if (!isNotFound(error)) {
						throw rethrowAsPageWeaveError(this.getNode(), error);
					}
				}

				clearState(staticData, slot);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const staticData = this.getWorkflowStaticData('node');
		const isTestMode = this.getMode() === 'manual';
		const slot: Slot = isTestMode ? 'test' : 'live';
		const state = readState(staticData, slot);

		const request = this.getRequestObject() as unknown as { rawBody?: Buffer };
		const rawBody = request.rawBody;
		const headers = this.getHeaderData();
		const signature = headerValue(headers, 'x-webhook-signature');
		const eventHeader = headerValue(headers, 'x-webhook-event');
		const deliveryId = headerValue(headers, 'x-webhook-delivery-id');

		const secret =
			state.secret ?? readState(staticData, slot === 'test' ? 'live' : 'test').secret;

		if (!verifySignature(rawBody, signature, secret)) {
			this.logger.warn(
				'PageWeave Trigger rejected a request with an invalid signature. If the signing secret was rotated outside n8n, deactivate and reactivate the workflow.',
			);
			const response = this.getResponseObject();
			response.status(401).send('Invalid signature').end();
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData() as IDataObject;
		const event = typeof body.event === 'string' ? body.event : eventHeader;

		if (!event || (eventHeader && eventHeader !== event)) {
			const response = this.getResponseObject();
			response.status(400).send('Event header does not match the payload').end();
			return { noWebhookResponse: true };
		}

		if (deliveryId) {
			const recent = Array.isArray(staticData.recentDeliveryIds)
				? (staticData.recentDeliveryIds as string[])
				: [];
			if (recent.includes(deliveryId)) {
				return { webhookResponse: 'OK' };
			}
			staticData.recentDeliveryIds = [...recent, deliveryId].slice(-50);
		}

		const data = (body.data ?? {}) as IDataObject;

		return {
			workflowData: [
				this.helpers.returnJsonArray([
					{
						event,
						timestamp: body.timestamp,
						data,
						test: isTestMode || data.test === true,
						...(deliveryId ? { delivery_id: deliveryId } : {}),
					},
				]),
			],
		};
	}
}

function headerValue(
	headers: ReturnType<IWebhookFunctions['getHeaderData']>,
	name: string,
): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return value.length ? value[0] : undefined;
	return value ?? undefined;
}
