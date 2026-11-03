import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../shared/pagination';
import { formLocator, limitField, returnAllField, websiteLocator } from '../shared/properties';
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
	websiteLocator({ resource: ['form'] }),
	formLocator({ resource: ['form'], operation: ['get'] }),
	returnAllField({ resource: ['form'], operation: ['getAll'] }),
	limitField({ resource: ['form'], operation: ['getAll'] }),
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
