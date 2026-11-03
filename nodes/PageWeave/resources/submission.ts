import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../shared/pagination';
import { encodeSegment, resourceLocatorValue } from '../shared/parameters';
import { pageWeaveRequest } from '../shared/request';

export const submissionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['submission'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a single submission with uploads and spam signals',
				action: 'Get a submission',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List submissions for a form',
				action: 'Get many submissions',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Mark a submission as read or change its spam verdict',
				action: 'Update a submission',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Permanently delete a submission and its uploads',
				action: 'Delete a submission',
			},
		],
		default: 'getAll',
	},
];

export const submissionFields: INodeProperties[] = [
	{
		displayName: 'Website',
		name: 'websiteId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: {
			show: {
				resource: ['submission'],
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
				resource: ['submission'],
			},
		},
		typeOptions: {
			loadOptionsDependsOn: ['websiteId.value'],
		},
		description: 'The form whose submissions you want to read',
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
		displayName: 'Submission ID',
		name: 'submissionId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['submission'],
				operation: ['get', 'update', 'delete'],
			},
		},
		description: 'The ID of the submission',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['submission'],
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
				resource: ['submission'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: {
				resource: ['submission'],
				operation: ['getAll'],
			},
		},
		options: [
			{
				displayName: 'Read',
				name: 'read',
				type: 'options',
				options: [
					{ name: 'Any', value: 'any' },
					{ name: 'Read', value: 'read' },
					{ name: 'Unread', value: 'unread' },
				],
				default: 'any',
				description: 'Filter by the read state of the submission',
			},
			{
				displayName: 'Spam Verdict',
				name: 'spamVerdict',
				type: 'options',
				options: [
					{ name: 'Any', value: 'any' },
					{ name: 'Discarded', value: 'discarded' },
					{ name: 'Ham', value: 'ham' },
					{ name: 'Incomplete', value: 'incomplete' },
					{ name: 'Quarantined', value: 'quarantined' },
				],
				default: 'any',
				description: 'Filter by the spam verdict PageWeave assigned',
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
			show: {
				resource: ['submission'],
				operation: ['update'],
			},
		},
		options: [
			{
				displayName: 'Read',
				name: 'read',
				type: 'options',
				options: [
					{ name: 'Leave Unchanged', value: 'unchanged' },
					{ name: 'Mark as Read', value: 'read' },
					{ name: 'Mark as Unread', value: 'unread' },
				],
				default: 'unchanged',
				description: 'Change the read state of the submission',
			},
			{
				displayName: 'Spam Verdict',
				name: 'spamVerdict',
				type: 'options',
				options: [
					{ name: 'Leave Unchanged', value: 'unchanged' },
					{ name: 'Ham', value: 'ham' },
					{ name: 'Quarantined', value: 'quarantined' },
				],
				default: 'unchanged',
				description: 'Override the spam verdict PageWeave assigned',
			},
		],
	},
];

function requireValue(
	context: IExecuteFunctions,
	parameterName: string,
	itemIndex: number,
	label: string,
): string {
	const value = resourceLocatorValue(context.getNodeParameter(parameterName, itemIndex));
	if (!value) {
		throw new NodeOperationError(context.getNode(), `${label} is required.`, { itemIndex });
	}
	return value;
}

export async function executeSubmission(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const websiteId = requireValue(context, 'websiteId', itemIndex, 'Website');
	const formId = requireValue(context, 'formId', itemIndex, 'Form');
	const collectionPath = `/api/v1/websites/${encodeSegment(websiteId)}/forms/${encodeSegment(
		formId,
	)}/submissions`;

	switch (operation) {
		case 'getAll': {
			const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const limit = returnAll ? undefined : (context.getNodeParameter('limit', itemIndex, 50) as number);
			const filters = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;
			const qs: IDataObject = {};

			if (typeof filters.spamVerdict === 'string' && filters.spamVerdict !== 'any') {
				qs.spam_verdict = filters.spamVerdict;
			}
			if (filters.read === 'read') qs.read = true;
			if (filters.read === 'unread') qs.read = false;

			const submissions = await listAll<IDataObject>(context, collectionPath, {
				qs,
				returnAll,
				limit,
				itemIndex,
			});

			return submissions.map((submission) => ({
				json: submission,
				pairedItem: { item: itemIndex },
			}));
		}

		case 'get': {
			const submissionId = requireValue(context, 'submissionId', itemIndex, 'Submission ID');
			const submission = await pageWeaveRequest<IDataObject>(context, {
				method: 'GET',
				path: `${collectionPath}/${encodeSegment(submissionId)}`,
				itemIndex,
			});
			return [{ json: submission, pairedItem: { item: itemIndex } }];
		}

		case 'update': {
			const submissionId = requireValue(context, 'submissionId', itemIndex, 'Submission ID');
			const fields = context.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
			const body: IDataObject = {};

			if (fields.read === 'read') body.read = true;
			if (fields.read === 'unread') body.read = false;
			if (fields.spamVerdict === 'ham' || fields.spamVerdict === 'quarantined') {
				body.spam_verdict = fields.spamVerdict;
			}

			if (Object.keys(body).length === 0) {
				throw new NodeOperationError(
					context.getNode(),
					'Choose at least one field to update.',
					{ itemIndex },
				);
			}

			const submission = await pageWeaveRequest<IDataObject>(context, {
				method: 'PATCH',
				path: `${collectionPath}/${encodeSegment(submissionId)}`,
				body,
				itemIndex,
			});
			return [{ json: submission, pairedItem: { item: itemIndex } }];
		}

		case 'delete': {
			const submissionId = requireValue(context, 'submissionId', itemIndex, 'Submission ID');
			await pageWeaveRequest(context, {
				method: 'DELETE',
				path: `${collectionPath}/${encodeSegment(submissionId)}`,
				itemIndex,
			});
			return [
				{
					json: { id: submissionId, deleted: true },
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
