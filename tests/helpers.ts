import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { vi } from 'vitest';

export const testNode = {
	id: 'node-1',
	name: 'PageWeave',
	type: '@pageweave/n8n-nodes-pageweave.pageWeave',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
} as INode;

export interface MockResponse {
	statusCode: number;
	body?: unknown;
	headers?: Record<string, unknown>;
	statusMessage?: string;
}

export function createContext(
	responses: MockResponse[],
	credentials: { baseUrl?: string; apiKey?: string } = {
		baseUrl: 'https://pageweave.dev',
		apiKey: 'pw_test',
	},
) {
	const requests: Array<Record<string, unknown>> = [];
	const remaining = [...responses];

	const httpRequestWithAuthentication = vi.fn(
		async (_credentialName: string, options: Record<string, unknown>) => {
			requests.push(options);
			const next = remaining.shift();
			if (!next) throw new Error('No mocked response left for this request');
			return {
				statusCode: next.statusCode,
				body: next.body,
				headers: next.headers ?? {},
				statusMessage: next.statusMessage ?? '',
			};
		},
	);

	const context = {
		getNode: () => testNode,
		getCredentials: () => credentials,
		getExecutionId: () => 'exec-1',
		helpers: { httpRequestWithAuthentication },
	};

	return {
		context: context as unknown as IExecuteFunctions,
		requests,
		httpRequestWithAuthentication,
	};
}
