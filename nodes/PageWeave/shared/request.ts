import { createHash } from 'node:crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'pageWeaveApi';
export const DEFAULT_BASE_URL = 'https://pageweave.dev';

const DEFAULT_TIMEOUT = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;
const PROBLEM_KEYS = ['type', 'title', 'status', 'detail', 'instance', 'request_id', 'errors'];

export type PageWeaveContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

export interface PageWeavePagination {
	limit: number;
	has_more: boolean;
	next_cursor: string | null;
}

export interface PageWeaveCollection<T> {
	data: T[];
	pagination: PageWeavePagination;
}

export interface PageWeaveProblem {
	type?: string;
	title?: string;
	status?: number;
	detail?: string;
	request_id?: string;
	errors?: Array<{ field?: string; detail?: string }>;
	[key: string]: unknown;
}

export interface PageWeaveRequestOptions {
	method: IHttpRequestMethods;
	path: string;
	qs?: IDataObject;
	body?: unknown;
	headers?: IDataObject;
	idempotencyKey?: string;
	itemIndex?: number;
	encoding?: 'json' | 'text' | 'arraybuffer';
	timeout?: number;
}

interface PageWeaveHttpResponse {
	body: unknown;
	headers: IDataObject;
	statusCode: number;
	statusMessage?: string;
}

const STATUS_HINTS: Record<number, string> = {
	400: 'The request did not match the PageWeave API contract. Check the operation parameters.',
	401: 'The API key is missing, invalid, or revoked. Update the PageWeave API credential.',
	403: 'The API key lacks the permission or scope this operation requires, or it cannot access this website.',
	404: 'The resource was not found, or the API key cannot access it.',
	409: 'The resource changed or is in use. Refresh the data and try again.',
	412: 'The resource changed since it was read. Read it again and retry.',
	413: 'The request body is larger than PageWeave accepts.',
	422: 'PageWeave rejected the values. Check the message and try again.',
	429: 'The PageWeave rate limit was reached. Retry after the indicated delay.',
	503: 'PageWeave is temporarily unavailable. Retry shortly.',
};

export function normalizeBaseUrl(raw: string): string {
	const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
	if (!URL.canParse(trimmed)) {
		throw new Error('The PageWeave base URL is not a valid URL.');
	}
	const parsed = new URL(trimmed);

	const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
	const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
		throw new Error('The PageWeave base URL must use https://.');
	}
	if (parsed.pathname !== '/' && parsed.pathname !== '') {
		throw new Error('The PageWeave base URL must not include a path.');
	}

	return `${parsed.protocol}//${parsed.host}`;
}

export function getBaseUrl(context: PageWeaveContext): string {
	const credentials = context.getCredentials(CREDENTIAL_NAME) as { baseUrl?: string };
	const raw = credentials.baseUrl ?? DEFAULT_BASE_URL;
	try {
		return normalizeBaseUrl(raw);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), error as Error, {
			description: 'Set the base URL to the HTTPS address of your PageWeave instance.',
		});
	}
}

export function normalizeApiPath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed.startsWith('/api/v1/')) {
		throw new Error('The request path must start with /api/v1/.');
	}
	if (trimmed.includes('..') || trimmed.includes('//')) {
		throw new Error('The request path must not contain ".." or "//".');
	}
	return trimmed;
}

function bodyToText(body: unknown): string {
	if (typeof body === 'string') return body;
	if (Buffer.isBuffer(body)) return body.toString('utf8');
	if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
	return '';
}

export function parseProblem(body: unknown): PageWeaveProblem | null {
	if (body && typeof body === 'object' && !Array.isArray(body)) {
		return body as PageWeaveProblem;
	}
	const text = bodyToText(body).trim();
	if (!text.startsWith('{')) return null;
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as PageWeaveProblem)
			: null;
	} catch {
		return null;
	}
}

function problemDescription(problem: PageWeaveProblem | null, status: number, rawBody: unknown): string {
	const parts: string[] = [];
	if (problem?.detail) {
		parts.push(problem.detail);
	} else {
		const text = bodyToText(rawBody).trim();
		if (text && text.length <= 500) parts.push(text);
	}

	if (problem?.errors?.length) {
		const fields = problem.errors
			.map((error) => (error.field ? `${error.field}: ${error.detail}` : error.detail))
			.filter(Boolean);
		if (fields.length) parts.push(fields.join('; '));
	}

	const extensions = Object.keys(problem ?? {}).filter((key) => !PROBLEM_KEYS.includes(key));
	if (extensions.length) {
		parts.push(
			extensions
				.map((key) => `${key}: ${JSON.stringify(problem?.[key])}`)
				.join('; '),
		);
	}

	const hint = STATUS_HINTS[status];
	if (hint) parts.push(hint);
	if (problem?.request_id) parts.push(`Request ID: ${problem.request_id}`);

	return parts.join('\n\n');
}

function headerValue(headers: IDataObject, name: string): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
	if (value === undefined || value === null) return undefined;
	return String(value);
}

function parseRetryAfter(headers: IDataObject): number | undefined {
	const raw = headerValue(headers, 'retry-after');
	if (!raw) return undefined;

	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

	const date = Date.parse(raw);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	return undefined;
}

function shouldRetry(status: number, headers: IDataObject): boolean {
	if (status === 429 || status === 503) return true;
	// A 409 with Retry-After is a concurrent request using the same Idempotency-Key.
	return status === 409 && parseRetryAfter(headers) !== undefined;
}

async function wait(ms: number): Promise<void> {
	await sleep(Math.min(ms, MAX_RETRY_DELAY_MS));
}

export interface PageWeaveDownload {
	data: Buffer;
	headers: IDataObject;
}

async function sendRequest(
	context: PageWeaveContext,
	options: PageWeaveRequestOptions,
): Promise<PageWeaveHttpResponse> {
	const url = `${getBaseUrl(context)}${normalizeApiPath(options.path)}`;
	const headers: IDataObject = {
		Accept: 'application/json',
		...options.headers,
	};

	let body: string | undefined;
	if (options.body !== undefined) {
		body = JSON.stringify(options.body);
		headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
	}

	if (options.idempotencyKey) {
		headers['Idempotency-Key'] = options.idempotencyKey;
	}

	let lastResponse: PageWeaveHttpResponse | undefined;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const response = (await context.helpers.httpRequestWithAuthentication.call(
			context,
			CREDENTIAL_NAME,
			{
				method: options.method,
				url,
				qs: options.qs,
				body,
				headers,
				timeout: options.timeout ?? DEFAULT_TIMEOUT,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
				disableFollowRedirect: true,
				encoding:
					options.encoding === undefined || options.encoding === 'json'
						? undefined
						: options.encoding,
			},
		)) as PageWeaveHttpResponse;

		lastResponse = response;

		if (response.statusCode >= 200 && response.statusCode < 300) return response;

		if (attempt < MAX_ATTEMPTS && shouldRetry(response.statusCode, response.headers ?? {})) {
			const retryAfter = parseRetryAfter(response.headers ?? {}) ?? 1000 * 2 ** (attempt - 1);
			await wait(retryAfter);
			continue;
		}

		break;
	}

	const response = lastResponse;
	if (!response) {
		throw new NodeOperationError(context.getNode(), 'The PageWeave request did not run.');
	}

	const status = response.statusCode;
	const problem = parseProblem(response.body);
	const description = problemDescription(problem, status, response.body);
	const message = problem?.title ?? `PageWeave API request failed (HTTP ${status})`;

	throw new NodeApiError(
		context.getNode(),
		{ message, description, httpCode: String(status) },
		{ itemIndex: options.itemIndex, httpCode: String(status), message, description },
	);
}

export async function pageWeaveRequest<T = unknown>(
	context: PageWeaveContext,
	options: PageWeaveRequestOptions,
): Promise<T> {
	const response = await sendRequest(context, options);

	if (response.statusCode === 204) return undefined as T;
	if (options.encoding === 'arraybuffer') return response.body as T;
	if (options.encoding === 'text') return bodyToText(response.body) as T;
	if (options.encoding === 'json') {
		if (response.body && typeof response.body === 'object') return response.body as T;
		const text = bodyToText(response.body).trim();
		return (text ? JSON.parse(text) : undefined) as T;
	}
	return response.body as T;
}

export async function pageWeaveDownload(
	context: PageWeaveContext,
	options: PageWeaveRequestOptions,
): Promise<PageWeaveDownload> {
	const response = await sendRequest(context, {
		...options,
		encoding: 'arraybuffer',
		headers: { Accept: 'text/csv', ...options.headers },
	});
	const body = response.body;

	const data = Buffer.isBuffer(body)
		? body
		: body instanceof ArrayBuffer
			? Buffer.from(body)
			: Buffer.from(bodyToText(body), 'utf8');

	return { data, headers: response.headers ?? {} };
}

export function makeIdempotencyKey(
	context: IExecuteFunctions,
	itemIndex: number,
	payload: unknown,
): string {
	const node = context.getNode();
	const executionId = context.getExecutionId();
	const fingerprint = createHash('sha256')
		.update(stableStringify(payload))
		.digest('hex')
		.slice(0, 32);

	return `n8n-${executionId}-${node.id ?? node.name}-${itemIndex}-${fingerprint}`.slice(0, 255);
}

export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, entry]) => entry !== undefined)
		.sort(([left], [right]) => left.localeCompare(right));

	return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}
