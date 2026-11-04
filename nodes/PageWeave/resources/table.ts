import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../shared/pagination';
import { encodeSegment, parseJsonObject, resourceLocatorValue } from '../shared/parameters';
import {
	limitField,
	returnAllField,
	simplifyField,
	tableLocator,
	websiteLocator,
} from '../shared/properties';
import { simplifyTable } from '../shared/simplify';
import { makeIdempotencyKey, pageWeaveRequest } from '../shared/request';

const RESOURCE = { resource: ['table'] };

export const tableOperations: INodeProperties[] = [
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
				description: 'Create a table',
				action: 'Create a table',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Permanently delete a table, its rows, and its versions',
				action: 'Delete a table',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a table with its field schema',
				action: 'Get a table',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List tables on a website',
				action: 'Get many tables',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a table name, slug, or field schema',
				action: 'Update a table',
			},
		],
		default: 'getAll',
	},
];

export const tableFields: INodeProperties[] = [
	websiteLocator({ resource: ['table'] }),
	tableLocator({ resource: ['table'], operation: ['get', 'update', 'delete'] }),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'] },
		},
		description: 'The table name, up to 100 characters',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { ...RESOURCE, operation: ['create'] },
		},
		options: [
			{
				displayName: 'Slug',
				name: 'slug',
				type: 'string',
				default: '',
				description: 'The URL-safe table identifier, up to 64 characters',
			},
			{
				displayName: 'Fields Schema',
				name: 'fieldsSchema',
				type: 'json',
				default: '',
				placeholder: '{"fields": [{"name": "email", "type": "string"}]}',
				description:
					'Field definitions as JSON. Types are string, text, number, boolean, and datetime.',
			},
		],
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
				displayName: 'Fields Schema',
				name: 'fieldsSchema',
				type: 'json',
				default: '',
				placeholder: '{"fields": [{"name": "email", "type": "string"}]}',
				description:
					'Replacement field definitions as JSON. Types are string, text, number, boolean, and datetime.',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'The table name, up to 100 characters',
			},
			{
				displayName: 'Slug',
				name: 'slug',
				type: 'string',
				default: '',
				description: 'The URL-safe table identifier, up to 64 characters',
			},
		],
	},
	returnAllField({ ...RESOURCE, operation: ['getAll'] }),
	limitField({ ...RESOURCE, operation: ['getAll'] }),
	simplifyField({ ...RESOURCE, operation: ['get', 'getAll'] }),
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

export async function executeTable(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const websiteId = requireWebsite(context, itemIndex);
	const collectionPath = `/api/v1/websites/${encodeSegment(websiteId)}/tables`;

	switch (operation) {
		case 'getAll': {
			const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const limit = returnAll
				? undefined
				: (context.getNodeParameter('limit', itemIndex, 50) as number);
			const tables = await listAll<IDataObject>(context, collectionPath, {
				returnAll,
				limit,
				itemIndex,
			});
			return tables.map((table) => ({
				json:
					context.getNodeParameter('simplify', itemIndex, false) === true
						? simplifyTable(table)
						: table,
				pairedItem: { item: itemIndex },
			}));
		}

		case 'get': {
			const tableId = requireTable(context, itemIndex);
			const table = await pageWeaveRequest<IDataObject>(context, {
				method: 'GET',
				path: `${collectionPath}/${encodeSegment(tableId)}`,
				itemIndex,
			});
			return [
				{
					json:
						context.getNodeParameter('simplify', itemIndex, false) === true
							? simplifyTable(table)
							: table,
					pairedItem: { item: itemIndex },
				},
			];
		}

		case 'create': {
			const body: IDataObject = {
				name: context.getNodeParameter('name', itemIndex, '') as string,
			};
			const additionalFields = context.getNodeParameter(
				'additionalFields',
				itemIndex,
				{},
			) as IDataObject;

			if (typeof additionalFields.slug === 'string' && additionalFields.slug.trim()) {
				body.slug = additionalFields.slug.trim();
			}
			const fieldsSchema = parseJsonObject(
				context.getNode(),
				additionalFields.fieldsSchema,
				'Fields Schema',
				itemIndex,
			);
			if (fieldsSchema) body.fields_schema = fieldsSchema;

			const table = await pageWeaveRequest<IDataObject>(context, {
				method: 'POST',
				path: collectionPath,
				body,
				idempotencyKey: makeIdempotencyKey(context, itemIndex, body),
				itemIndex,
			});
			return [{ json: table, pairedItem: { item: itemIndex } }];
		}

		case 'update': {
			const tableId = requireTable(context, itemIndex);
			const fields = context.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
			const body: IDataObject = {};

			if (typeof fields.name === 'string' && fields.name.trim()) body.name = fields.name.trim();
			if (typeof fields.slug === 'string' && fields.slug.trim()) body.slug = fields.slug.trim();
			const fieldsSchema = parseJsonObject(
				context.getNode(),
				fields.fieldsSchema,
				'Fields Schema',
				itemIndex,
			);
			if (fieldsSchema) body.fields_schema = fieldsSchema;

			if (Object.keys(body).length === 0) {
				throw new NodeOperationError(context.getNode(), 'Choose at least one field to update.', {
					itemIndex,
				});
			}

			const table = await pageWeaveRequest<IDataObject>(context, {
				method: 'PATCH',
				path: `${collectionPath}/${encodeSegment(tableId)}`,
				body,
				itemIndex,
			});
			return [{ json: table, pairedItem: { item: itemIndex } }];
		}

		case 'delete': {
			const tableId = requireTable(context, itemIndex);
			await pageWeaveRequest(context, {
				method: 'DELETE',
				path: `${collectionPath}/${encodeSegment(tableId)}`,
				itemIndex,
			});
			return [{ json: { id: tableId, deleted: true }, pairedItem: { item: itemIndex } }];
		}

		default:
			throw new NodeOperationError(context.getNode(), `Unsupported operation "${operation}".`, {
				itemIndex,
			});
	}
}
