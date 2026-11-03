import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { parseJsonObject } from '../shared/parameters';
import {
	makeIdempotencyKey,
	normalizeApiPath,
	pageWeaveRequest,
} from '../shared/request';

const BLOCKED_HEADERS = ['authorization', 'host', 'content-length'];

export const customApiOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['customApi'],
			},
		},
		options: [
			{
				name: 'Call',
				value: 'call',
				description: 'Call any PageWeave API endpoint',
				action: 'Make an API request',
			},
		],
		default: 'call',
	},
];

export const customApiFields: INodeProperties[] = [
	{
		displayName: 'Method',
		name: 'method',
		type: 'options',
		default: 'GET',
		displayOptions: {
			show: {
				resource: ['customApi'],
			},
		},
		options: [
			{ name: 'DELETE', value: 'DELETE' },
			{ name: 'GET', value: 'GET' },
			{ name: 'PATCH', value: 'PATCH' },
			{ name: 'POST', value: 'POST' },
		],
		description: 'The HTTP method to use',
	},
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. /api/v1/websites',
		displayOptions: {
			show: {
				resource: ['customApi'],
			},
		},
		description:
			'A path relative to the base URL, starting with /api/v1/. Do not include a scheme, host, or query string.',
	},
	{
		displayName: 'Query Parameters',
		name: 'query',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: {
				resource: ['customApi'],
			},
		},
		description: 'Query string parameters as a JSON object',
	},
	{
		displayName: 'Body',
		name: 'body',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: {
				resource: ['customApi'],
				method: ['POST', 'PATCH'],
			},
		},
		description: 'Request body as a JSON object',
	},
	{
		displayName: 'Headers',
		name: 'headers',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: {
				resource: ['customApi'],
			},
		},
		description:
			'Additional request headers as a JSON object. Authorization and host headers cannot be overridden.',
	},
	{
		displayName: 'Response Format',
		name: 'responseFormat',
		type: 'options',
		default: 'json',
		displayOptions: {
			show: {
				resource: ['customApi'],
			},
		},
		options: [
			{ name: 'JSON', value: 'json' },
			{ name: 'Text', value: 'text' },
		],
		description: 'How to return the response body',
	},
];

function isPlainObject(value: unknown): value is IDataObject {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toItems(result: unknown, itemIndex: number): INodeExecutionData[] {
	if (Array.isArray(result)) {
		return result.map((entry) => ({
			json: isPlainObject(entry) ? entry : { data: entry as never },
			pairedItem: { item: itemIndex },
		}));
	}
	if (isPlainObject(result)) {
		return [{ json: result, pairedItem: { item: itemIndex } }];
	}
	return [{ json: { data: (result ?? null) as never }, pairedItem: { item: itemIndex } }];
}

export async function executeCustomApi(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const method = context.getNodeParameter('method', itemIndex, 'GET') as
		| 'GET'
		| 'POST'
		| 'PATCH'
		| 'DELETE';
	const rawPath = context.getNodeParameter('path', itemIndex, '') as string;

	let path: string;
	try {
		path = normalizeApiPath(rawPath);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), (error as Error).message, { itemIndex });
	}

	const query = parseJsonObject(
		context.getNode(),
		context.getNodeParameter('query', itemIndex, '{}'),
		'Query Parameters',
		itemIndex,
	);
	const headers = parseJsonObject(
		context.getNode(),
		context.getNodeParameter('headers', itemIndex, '{}'),
		'Headers',
		itemIndex,
	);

	for (const name of Object.keys(headers ?? {})) {
		if (BLOCKED_HEADERS.includes(name.toLowerCase())) {
			throw new NodeOperationError(
				context.getNode(),
				`The ${name} header cannot be set. PageWeave authenticates with the selected credential.`,
				{ itemIndex },
			);
		}
	}

	const body =
		method === 'POST' || method === 'PATCH'
			? parseJsonObject(
					context.getNode(),
					context.getNodeParameter('body', itemIndex, '{}'),
					'Body',
					itemIndex,
				)
			: undefined;

	const idempotencyKey =
		method === 'POST'
			? makeIdempotencyKey(context, itemIndex, { method, path, query, body })
			: undefined;

	const responseFormat = context.getNodeParameter('responseFormat', itemIndex, 'json') as string;

	const result = await pageWeaveRequest<unknown>(context, {
		method,
		path,
		qs: query,
		body,
		headers,
		idempotencyKey,
		itemIndex,
		encoding: responseFormat === 'text' ? 'text' : 'json',
		timeout: method === 'GET' ? 60_000 : 120_000,
	});

	return toItems(result, itemIndex);
}
