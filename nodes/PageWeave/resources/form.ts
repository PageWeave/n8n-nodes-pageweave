import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../shared/pagination';
import { encodeSegment, resourceLocatorValue } from '../shared/parameters';
import { pageWeaveRequest } from '../shared/request';

export const formOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['form'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a form with its field definitions and settings',
				action: 'Get a form',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List forms on a website',
				action: 'Get many forms',
			},
		],
		default: 'getAll',
	},
];

export const formFields: INodeProperties[] = [
	{
		displayName: 'Website',
		name: 'websiteId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: {
			show: {
				resource: ['form'],
			},
		},
		description: 'The website that owns the form',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchWebsites',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 019f9c2a-6a1b-7a3d-8f2e-4b6c8d0e1f23',
			},
		],
	},
	{
		displayName: 'Form',
		name: 'formId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: {
			show: {
				resource: ['form'],
				operation: ['get'],
			},
		},
		typeOptions: {
			loadOptionsDependsOn: ['websiteId.value'],
		},
		description: 'The form to read',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchForms',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 019f9c2a-6a1b-7a3d-8f2e-4b6c8d0e1f23',
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['form'],
				operation: ['getAll'],
			},
		},
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: {
			minValue: 1,
		},
		displayOptions: {
			show: {
				resource: ['form'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
];

function requireWebsite(context: IExecuteFunctions, itemIndex: number): string {
	const websiteId = resourceLocatorValue(context.getNodeParameter('websiteId', itemIndex));
	if (!websiteId) {
		throw new NodeOperationError(context.getNode(), 'Website is required.', { itemIndex });
	}
	return websiteId;
}

export async function executeForm(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const websiteId = requireWebsite(context, itemIndex);
	const collectionPath = `/api/v1/websites/${encodeSegment(websiteId)}/forms`;

	switch (operation) {
		case 'getAll': {
			const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const limit = returnAll
				? undefined
				: (context.getNodeParameter('limit', itemIndex, 50) as number);
			const forms = await listAll<IDataObject>(context, collectionPath, {
				returnAll,
				limit,
				itemIndex,
			});
			return forms.map((form) => ({ json: form, pairedItem: { item: itemIndex } }));
		}

		case 'get': {
			const formId = resourceLocatorValue(context.getNodeParameter('formId', itemIndex));
			if (!formId) {
				throw new NodeOperationError(context.getNode(), 'Form is required.', { itemIndex });
			}
			const form = await pageWeaveRequest<IDataObject>(context, {
				method: 'GET',
				path: `${collectionPath}/${encodeSegment(formId)}`,
				itemIndex,
			});
			return [{ json: form, pairedItem: { item: itemIndex } }];
		}

		default:
			throw new NodeOperationError(context.getNode(), `Unsupported operation "${operation}".`, {
				itemIndex,
			});
	}
}
