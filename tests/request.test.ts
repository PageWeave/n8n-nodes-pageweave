import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	makeIdempotencyKey,
	normalizeBaseUrl,
	parseProblem,
	pageWeaveRequest,
} from '../nodes/PageWeave/shared/request';
import { createContext } from './helpers';

describe('normalizeBaseUrl', () => {
	it('accepts an HTTPS base URL and removes trailing slashes', () => {
		expect(normalizeBaseUrl('https://pageweave.dev///')).toBe('https://pageweave.dev');
	});

	it('rejects plain HTTP for remote hosts', () => {
		expect(() => normalizeBaseUrl('http://pageweave.dev')).toThrow(/https/);
	});

	it('allows HTTP for local development', () => {
		expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
	});

	it('rejects base URLs with a path', () => {
		expect(() => normalizeBaseUrl('https://pageweave.dev/api')).toThrow(/path/);
	});

	it('rejects values that are not URLs', () => {
		expect(() => normalizeBaseUrl('pageweave')).toThrow(/valid URL/);
	});
});

describe('parseProblem', () => {
	it('parses a JSON problem body from a string', () => {
		expect(parseProblem('{"title":"Validation Error"}')).toEqual({
			title: 'Validation Error',
		});
	});

	it('returns null for non-JSON bodies', () => {
		expect(parseProblem('Bad Gateway')).toBeNull();
	});
});

describe('pageWeaveRequest', () => {
	it('returns the parsed 2xx body', async () => {
		const { context, requests } = createContext([
			{ statusCode: 200, body: { id: 'sub_1', read: false } },
		]);

		const result = await pageWeaveRequest(context, {
			method: 'GET',
			path: '/api/v1/websites',
		});

		expect(result).toEqual({ id: 'sub_1', read: false });
		expect(requests[0].disableFollowRedirect).toBe(true);
	});

	it('maps RFC 9457 problems to a NodeApiError with guidance', async () => {
		const { context } = createContext([
			{
				statusCode: 422,
				body: {
					title: 'Validation Error',
					status: 422,
					detail: 'Validation failed',
					request_id: 'req-1',
					errors: [{ field: 'path', detail: 'has already been taken' }],
				},
			},
		]);

		const request = pageWeaveRequest(context, {
			method: 'PATCH',
			path: '/api/v1/websites/abc',
			body: { name: 'x' },
		});

		await expect(request).rejects.toBeInstanceOf(NodeApiError);
		await expect(request).rejects.toMatchObject({
			message: 'Validation Error',
			description: expect.stringContaining('path: has already been taken'),
		});
		await expect(request).rejects.toMatchObject({
			description: expect.stringContaining('Request ID: req-1'),
		});
	});

	it('retries a 429 using Retry-After', async () => {
		const { context, requests } = createContext([
			{ statusCode: 429, body: { title: 'Too Many Requests' }, headers: { 'retry-after': '0' } },
			{ statusCode: 200, body: { data: [] } },
		]);

		const result = await pageWeaveRequest(context, {
			method: 'GET',
			path: '/api/v1/websites',
		});

		expect(result).toEqual({ data: [] });
		expect(requests).toHaveLength(2);
	});

	it('does not retry a plain 409', async () => {
		const { context, requests } = createContext([
			{ statusCode: 409, body: { title: 'Conflict', detail: 'Table is in use' } },
		]);

		await expect(
			pageWeaveRequest(context, { method: 'DELETE', path: '/api/v1/websites/abc/tables/t1' }),
		).rejects.toBeInstanceOf(NodeApiError);
		expect(requests).toHaveLength(1);
	});

	it('returns an already-parsed JSON body when JSON encoding is requested', async () => {
		const { context } = createContext([{ statusCode: 200, body: { id: 'me-1' } }]);

		const result = await pageWeaveRequest(context, {
			method: 'GET',
			path: '/api/v1/me',
			encoding: 'json',
		});

		expect(result).toEqual({ id: 'me-1' });
	});

	it('sends an Idempotency-Key when provided', async () => {		const { context, requests } = createContext([{ statusCode: 201, body: { id: 't1' } }]);

		await pageWeaveRequest(context, {
			method: 'POST',
			path: '/api/v1/websites/abc/tables',
			body: { name: 'Leads' },
			idempotencyKey: 'key-1',
		});

		expect(requests[0].headers).toMatchObject({ 'Idempotency-Key': 'key-1' });
	});
});

describe('makeIdempotencyKey', () => {
	it('is stable for the same payload regardless of key order', () => {
		const { context } = createContext([]);
		const first = makeIdempotencyKey(context, 0, { a: 1, b: { c: 2, d: 3 } });
		const second = makeIdempotencyKey(context, 0, { b: { d: 3, c: 2 }, a: 1 });
		expect(first).toBe(second);
	});

	it('differs per item index', () => {
		const { context } = createContext([]);
		expect(makeIdempotencyKey(context, 0, { a: 1 })).not.toBe(
			makeIdempotencyKey(context, 1, { a: 1 }),
		);
	});

	it('fits the 255 character header limit', () => {
		const { context } = createContext([]);
		expect(makeIdempotencyKey(context, 0, { a: 'x'.repeat(10_000) }).length).toBeLessThanOrEqual(
			255,
		);
	});
});
