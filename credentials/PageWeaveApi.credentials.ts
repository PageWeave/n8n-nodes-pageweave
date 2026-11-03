import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PageWeaveApi implements ICredentialType {
	name = 'pageWeaveApi';

	displayName = 'PageWeave API';

	documentationUrl = 'https://pageweave.dev/docs/api';

	icon: ICredentialType['icon'] = {
		light: 'file:../nodes/PageWeave/pageweave.svg',
		dark: 'file:../nodes/PageWeave/pageweave.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://pageweave.dev',
			description: 'The HTTPS address of the PageWeave instance',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'A PageWeave API key. Create one under Settings → API keys, scoped to the website this workflow reads or writes.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			url: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}/api/v1/me',
			method: 'GET',
		},
	};
}
