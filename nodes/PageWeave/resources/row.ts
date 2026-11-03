import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import { listAll } from '../shared/pagination';
import { encodeSegment, parseJsonObject, resourceLocatorValue } from '../shared/parameters';
import {
	limitField,
	returnAllField,
	tableLocator,
	websiteLocator,
} from '../shared/properties';
import {
	makeIdempotencyKey,
	pageWeaveDownload,
	pageWeaveRequest,
} from '../shared/request';

const RESOURCE = { resource: ['row'] };
const IMPORT_POLL_INTERVAL_MS = 2000;
const IMPORT_TIMEOUT_MS = 10 * 60 * 1000;

const publishedFilter: INodeProperties = {
	displayName: 'Published',
	name: 'published',
	type: 'options',
	options: [
		{ name: 'Any', value: 'any' },
		{ name: 'Published', value: 'true' },
		{ name: 'Unpublished', value: 'false' },
	],
	default: 'any',
	description: 'Filter by publish state',
};

const searchField: INodeProperties = {
	displayName: 'Search',
	name: 'search',
	type: 'string',
	default: '',
	description: 'Search string and text fields, up to 200 characters',
};

const filterField: INodeProperties = {
	displayName: 'Filter',
	name: 'filter',
	type: 'json',
	default: '',
	placeholder: '{"price_gte": 10, "name_cont": "widget"}',
	description:
		'Field filters as a JSON object. Operators include eq, cont, gte, lte, and null checks.',
};

const sortField: INodeProperties = {
	displayName: 'Sort',
	name: 'sort',
	type: 'string',
	default: '',
	placeholder: 'e.g. -created_at',
	description: 'Sort expression. Prefix the column with - for descending order.',
};

export const rowOperations: INodeProperties[] = [
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
				description: 'Create a row',
				action: 'Create a row',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Permanently delete a row and its versions',
				action: 'Delete a row',
			},
			{
				name: 'Export',
				value: 'export',
				description: 'Export filtered rows as a CSV file',
				action: 'Export table rows',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a row',
				action: 'Get a row',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List rows in a table',
				action: 'Get many rows',
			},
			{
				name: 'Import',
				value: 'import',
				description: 'Import rows from a URL or CSV content',
				action: 'Import table rows',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Merge data into a row or change its publish state',
				action: 'Update a row',
			},
		],
		default: 'getAll',
	},
];

export const rowFields: INodeProperties[] = [
	websiteLocator({ resource: ['row'] }),
	tableLocator({ resource: ['row'] }),
	{
		displayName: 'Row ID',
		name: 'rowId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['get', 'update', 'delete'] },
		},
		description: 'The ID of the row',
	},
	{
		displayName: 'Data',
		name: 'data',
		type: 'json',
		default: '{}',
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'] },
		},
		description: 'Row data as a JSON object',
	},
	{
		displayName: 'Publish State',
		name: 'publishState',
		type: 'options',
		options: [
			{ name: 'Draft', value: 'draft' },
			{ name: 'Publish Now', value: 'now' },
			{ name: 'Schedule', value: 'scheduled' },
		],
		default: 'draft',
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'] },
		},
		description: 'When the row becomes visible on the website',
	},
	{
		displayName: 'Publish At',
		name: 'publishAt',
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'], publishState: ['scheduled'] },
		},
		description: 'The date and time to publish the row',
	},
	{
		displayName: 'Data',
		name: 'updateData',
		type: 'json',
		default: '',
		displayOptions: {
			show: { ...RESOURCE, operation: ['update'] },
		},
		description:
			'Fields to merge into the row as a JSON object. Omitted keys stay unchanged; null clears a value.',
	},
	{
		displayName: 'Publish State',
		name: 'updatePublishState',
		type: 'options',
		options: [
			{ name: 'Leave Unchanged', value: 'unchanged' },
			{ name: 'Draft', value: 'draft' },
			{ name: 'Publish Now', value: 'now' },
			{ name: 'Schedule', value: 'scheduled' },
		],
		default: 'unchanged',
		displayOptions: {
			show: { ...RESOURCE, operation: ['update'] },
		},
		description: 'Change when the row is visible on the website',
	},
	{
		displayName: 'Publish At',
		name: 'updatePublishAt',
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: {
			show: {
				...RESOURCE,
				operation: ['update'],
				updatePublishState: ['scheduled'],
			},
		},
		description: 'The date and time to publish the row',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: { ...RESOURCE, operation: ['getAll'] },
		},
		options: [publishedFilter, searchField, filterField, sortField],
	},
	returnAllField({ ...RESOURCE, operation: ['getAll'] }),
	limitField({ ...RESOURCE, operation: ['getAll'] }),
	{
		displayName: 'Source',
		name: 'importSource',
		type: 'options',
		options: [
			{ name: 'URL', value: 'url' },
			{ name: 'CSV Content', value: 'content' },
		],
		default: 'url',
		displayOptions: {
			show: { ...RESOURCE, operation: ['import'] },
		},
		description: 'Where the CSV comes from',
	},
	{
		displayName: 'Source URL',
		name: 'sourceUrl',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['import'], importSource: ['url'] },
		},
		description: 'An HTTPS URL PageWeave fetches the CSV from. Must be publicly reachable.',
	},
	{
		displayName: 'CSV Content',
		name: 'content',
		type: 'string',
		typeOptions: {
			rows: 10,
		},
		default: '',
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['import'], importSource: ['content'] },
		},
		description: 'CSV content with a header row. Up to 10 MB and 25,000 rows.',
	},
	{
		displayName: 'Mode',
		name: 'importMode',
		type: 'options',
		options: [
			{ name: 'Create', value: 'create' },
			{ name: 'Create or Update', value: 'upsert' },
		],
		default: 'create',
		displayOptions: {
			show: { ...RESOURCE, operation: ['import'] },
		},
		description: 'Create adds every row; Create or Update matches on the ID column',
	},
	{
		displayName: 'Column Mapping',
		name: 'columnMapping',
		type: 'json',
		default: '',
		placeholder: '{"Email": "email"}',
		displayOptions: {
			show: { ...RESOURCE, operation: ['import'] },
		},
		description: 'Map CSV column names to table field names as a JSON object',
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['import'] },
		},
		description:
			'Whether to poll until a large import finishes. Turn off to return the import run immediately.',
	},
	{
		displayName: 'Filters',
		name: 'exportFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: { ...RESOURCE, operation: ['export'] },
		},
		options: [
			publishedFilter,
			searchField,
			filterField,
			sortField,
			{
				displayName: 'Sanitize',
				name: 'sanitize',
				type: 'boolean',
				default: true,
				description:
					'Whether to escape values that spreadsheets would evaluate as formulas. Turn off only for raw round-trip data.',
			},
		],
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['export'] },
		},
		description: 'The name of the output binary field that holds the CSV file',
	},
];

function requireWebsite(context: IExecuteFunctions, itemIndex: number): string {
	const websiteId = resourceLocatorValue(context.getNodeParameter('websiteId', itemIndex));
	if (!websiteId) {
		throw new NodeOperationError(context.getNode(), 'Website is required.', { itemIndex });
	}
	return websiteId;
}

function requireTable(context: IExecuteFunctions, itemIndex: number): string {
	const tableId = resourceLocatorValue(context.getNodeParameter('tableId', itemIndex));
	if (!tableId) {
		throw new NodeOperationError(context.getNode(), 'Table is required.', { itemIndex });
	}
	return tableId;
}

function buildRowQuery(context: IExecuteFunctions, itemIndex: number, fields: IDataObject): IDataObject {
	const qs: IDataObject = {};

	if (fields.published === 'true') qs.published = true;
	if (fields.published === 'false') qs.published = false;
	if (typeof fields.search === 'string' && fields.search.trim()) qs.search = fields.search.trim();
	if (typeof fields.sort === 'string' && fields.sort.trim()) qs.sort = fields.sort.trim();

	const filter = parseJsonObject(context.getNode(), fields.filter, 'Filter', itemIndex);
	if (filter) qs.filter = JSON.stringify(filter);

	return qs;
}

function publishTimestamp(context: IExecuteFunctions, state: string, dateParameter: string, itemIndex: number): string | undefined {
	if (state === 'now') return 'now';
	if (state === 'draft') return 'draft';
	if (state === 'scheduled') {
		const value = context.getNodeParameter(dateParameter, itemIndex, '') as string;
		return value || undefined;
	}
	return undefined;
}

function headerValue(headers: IDataObject, name: string): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
	if (value === undefined || value === null) return undefined;
	return String(value);
}

function exportFilename(headers: IDataObject, tableId: string): string {
	const disposition = headerValue(headers, 'content-disposition');
	const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
	if (match?.[1]) return decodeURIComponent(match[1]);
	return `${tableId}.csv`;
}

async function waitForImport(
	context: IExecuteFunctions,
	importPath: string,
	itemIndex: number,
): Promise<IDataObject> {
	const deadline = Date.now() + IMPORT_TIMEOUT_MS;

	for (;;) {
		const response = await pageWeaveRequest<{ import?: IDataObject }>(context, {
			method: 'GET',
			path: importPath,
			itemIndex,
		});
		const run = response.import;
		const state = String(run?.state ?? '');

		if (state === 'completed' || state === 'failed') return run as IDataObject;
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				context.getNode(),
				'The import is still running after 10 minutes.',
				{
					description:
						'Poll the import run with Custom API Call, or run the node again with Wait for Completion turned off.',
					itemIndex,
				},
			);
		}

		await sleep(IMPORT_POLL_INTERVAL_MS);
	}
}

export async function executeRow(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const websiteId = requireWebsite(context, itemIndex);
	const tableId = requireTable(context, itemIndex);
	const collectionPath = `/api/v1/websites/${encodeSegment(websiteId)}/tables/${encodeSegment(
		tableId,
	)}/rows`;

	switch (operation) {
		case 'getAll': {
			const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const limit = returnAll
				? undefined
				: (context.getNodeParameter('limit', itemIndex, 50) as number);
			const filters = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;
			const rows = await listAll<IDataObject>(context, collectionPath, {
				qs: buildRowQuery(context, itemIndex, filters),
				returnAll,
				limit,
				itemIndex,
			});
			return rows.map((row) => ({ json: row, pairedItem: { item: itemIndex } }));
		}

		case 'get': {
			const rowId = context.getNodeParameter('rowId', itemIndex, '') as string;
			const row = await pageWeaveRequest<IDataObject>(context, {
				method: 'GET',
				path: `${collectionPath}/${encodeSegment(rowId)}`,
				itemIndex,
			});
			return [{ json: row, pairedItem: { item: itemIndex } }];
		}

		case 'create': {
			const data = parseJsonObject(
				context.getNode(),
				context.getNodeParameter('data', itemIndex, '{}'),
				'Data',
				itemIndex,
			);
			const body: IDataObject = { data: data ?? {} };
			const publishState = context.getNodeParameter('publishState', itemIndex, 'draft') as string;
			const timestamp = publishTimestamp(context, publishState, 'publishAt', itemIndex);
			if (timestamp) body.published_at = timestamp;

			const row = await pageWeaveRequest<IDataObject>(context, {
				method: 'POST',
				path: collectionPath,
				body,
				idempotencyKey: makeIdempotencyKey(context, itemIndex, body),
				itemIndex,
			});
			return [{ json: row, pairedItem: { item: itemIndex } }];
		}

		case 'update': {
			const rowId = context.getNodeParameter('rowId', itemIndex, '') as string;
			const body: IDataObject = {};
			const data = parseJsonObject(
				context.getNode(),
				context.getNodeParameter('updateData', itemIndex, ''),
				'Data',
				itemIndex,
			);
			if (data) body.data = data;

			const publishState = context.getNodeParameter(
				'updatePublishState',
				itemIndex,
				'unchanged',
			) as string;
			const timestamp = publishTimestamp(context, publishState, 'updatePublishAt', itemIndex);
			if (timestamp) body.published_at = timestamp;

			if (Object.keys(body).length === 0) {
				throw new NodeOperationError(
					context.getNode(),
					'Choose data or a publish state to update.',
					{ itemIndex },
				);
			}

			const row = await pageWeaveRequest<IDataObject>(context, {
				method: 'PATCH',
				path: `${collectionPath}/${encodeSegment(rowId)}`,
				body,
				itemIndex,
			});
			return [{ json: row, pairedItem: { item: itemIndex } }];
		}

		case 'delete': {
			const rowId = context.getNodeParameter('rowId', itemIndex, '') as string;
			await pageWeaveRequest(context, {
				method: 'DELETE',
				path: `${collectionPath}/${encodeSegment(rowId)}`,
				itemIndex,
			});
			return [{ json: { id: rowId, deleted: true }, pairedItem: { item: itemIndex } }];
		}

		case 'import': {
			const source = context.getNodeParameter('importSource', itemIndex, 'url') as string;
			const body: IDataObject = {};

			if (source === 'url') {
				body.source_url = (
					context.getNodeParameter('sourceUrl', itemIndex, '') as string
				).trim();
			} else {
				body.content = context.getNodeParameter('content', itemIndex, '') as string;
			}

			const mode = context.getNodeParameter('importMode', itemIndex, 'create') as string;
			if (mode === 'upsert') body.mode = 'upsert';

			const columnMapping = parseJsonObject(
				context.getNode(),
				context.getNodeParameter('columnMapping', itemIndex, ''),
				'Column Mapping',
				itemIndex,
			);
			if (columnMapping) body.column_mapping = columnMapping;

			const response = await pageWeaveRequest<IDataObject>(context, {
				method: 'POST',
				path: `/api/v1/websites/${encodeSegment(websiteId)}/tables/${encodeSegment(
					tableId,
				)}/row_imports`,
				body,
				idempotencyKey: makeIdempotencyKey(context, itemIndex, body),
				itemIndex,
			});

			if (response.async === true && context.getNodeParameter('waitForCompletion', itemIndex, true)) {
				const run = response.import as IDataObject | undefined;
				if (!run?.id) {
					throw new NodeOperationError(
						context.getNode(),
						'PageWeave accepted the import but did not return an import run ID.',
						{ itemIndex },
					);
				}
				const importPath = `/api/v1/websites/${encodeSegment(websiteId)}/tables/${encodeSegment(
					tableId,
				)}/row_imports/${encodeSegment(String(run.id))}`;
				const finished = await waitForImport(context, importPath, itemIndex);
				return [{ json: finished, pairedItem: { item: itemIndex } }];
			}

			return [{ json: response, pairedItem: { item: itemIndex } }];
		}

		case 'export': {
			const filters = context.getNodeParameter('exportFilters', itemIndex, {}) as IDataObject;
			const qs = buildRowQuery(context, itemIndex, filters);
			if (filters.sanitize === false) qs.sanitize = false;

			const { data, headers } = await pageWeaveDownload(context, {
				method: 'GET',
				path: `${collectionPath}/export`,
				qs,
				itemIndex,
				timeout: 120_000,
			});

			const binaryPropertyName = context.getNodeParameter(
				'binaryPropertyName',
				itemIndex,
				'data',
			) as string;
			const binary = await context.helpers.prepareBinaryData(
				data,
				exportFilename(headers, tableId),
				'text/csv',
			);

			return [
				{
					json: {},
					binary: { [binaryPropertyName]: binary },
					pairedItem: { item: itemIndex },
				},
			];
		}

		default:
			throw new NodeOperationError(context.getNode(), `Unsupported operation "${operation}".`, {
				itemIndex,
			});
	}
}
