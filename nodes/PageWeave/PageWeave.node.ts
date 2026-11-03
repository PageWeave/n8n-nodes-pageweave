import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { rethrowAsPageWeaveError } from './shared/errors';

import { searchForms, searchWebsites } from './shared/listSearch';
import {
	customApiFields,
	customApiOperations,
	executeCustomApi,
} from './resources/customApi';
import { executeForm, formFields, formOperations } from './resources/form';
import {
	executeSubmission,
	submissionFields,
	submissionOperations,
} from './resources/submission';

const resourceOptions: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{
			name: 'Custom API Call',
			value: 'customApi',
			description: 'Call any PageWeave API endpoint',
		},
		{
			name: 'Form',
			value: 'form',
			description: 'Read forms and their field definitions',
		},
		{
			name: 'Submission',
			value: 'submission',
			description: 'Read and manage form submissions',
		},
	],
	default: 'submission',
};

export class PageWeave implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PageWeave',
		name: 'pageWeave',
		icon: { light: 'file:pageweave.svg', dark: 'file:pageweave.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read form submissions, forms, and call the PageWeave API',
		defaults: {
			name: 'PageWeave',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'pageWeaveApi',
				required: true,
			},
		],
		properties: [
			resourceOptions,
			...submissionOperations,
			...submissionFields,
			...formOperations,
			...formFields,
			...customApiOperations,
			...customApiFields,
		],
	};

	methods = {
		listSearch: {
			searchForms,
			searchWebsites,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				let results: INodeExecutionData[];
				switch (resource) {
					case 'submission':
						results = await executeSubmission(this, operation, itemIndex);
						break;
					case 'form':
						results = await executeForm(this, operation, itemIndex);
						break;
					case 'customApi':
						results = await executeCustomApi(this, itemIndex);
						break;
					default:
						throw new NodeOperationError(
							this.getNode(),
							`Unsupported resource "${resource}".`,
							{ itemIndex },
						);
				}

				returnData.push(...results);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message } as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw rethrowAsPageWeaveError(this.getNode(), error, itemIndex);
			}
		}

		return [returnData];
	}
}
