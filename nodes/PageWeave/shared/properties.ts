import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

type Show = NonNullable<IDisplayOptions['show']>;

export function websiteLocator(show: Show): INodeProperties {
	return {
		displayName: 'Website',
		name: 'websiteId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show },
		description: 'The PageWeave website',
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
	};
}

export function formLocator(show: Show): INodeProperties {
	return {
		displayName: 'Form',
		name: 'formId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show },
		typeOptions: {
			loadOptionsDependsOn: ['websiteId.value'],
		},
		description: 'The PageWeave form',
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
	};
}

export function tableLocator(show: Show): INodeProperties {
	return {
		displayName: 'Table',
		name: 'tableId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show },
		typeOptions: {
			loadOptionsDependsOn: ['websiteId.value'],
		},
		description: 'The PageWeave table',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchTables',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 019f9c2a-6a1b-7a3d-8f2e-4b6c8d0e1f23',
			},
			{
				displayName: 'Slug',
				name: 'slug',
				type: 'string',
				placeholder: 'e.g. leads',
			},
		],
	};
}

export function webhookLocator(show: Show): INodeProperties {
	return {
		displayName: 'Webhook',
		name: 'webhookId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show },
		typeOptions: {
			loadOptionsDependsOn: ['websiteId.value'],
		},
		description: 'The PageWeave webhook endpoint',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchWebhooks',
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
	};
}

export function returnAllField(show: Show): INodeProperties {
	return {
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show },
		description: 'Whether to return all results or only up to a given limit',
	};
}

export function limitField(show: Show): INodeProperties {
	return {
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: {
			minValue: 1,
		},
		displayOptions: { show: { ...show, returnAll: [false] } },
		description: 'Max number of results to return',
	};
}

export const EVENT_OPTIONS = [
	{
		name: 'Form Submission Created',
		value: 'form.submission.created',
	},
];
