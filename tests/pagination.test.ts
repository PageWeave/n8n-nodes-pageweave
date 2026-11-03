import { describe, expect, it } from 'vitest';

import { listAll } from '../nodes/PageWeave/shared/pagination';
import { createContext } from './helpers';

describe('listAll', () => {
	it('follows every cursor when Return All is enabled', async () => {
		const { context, requests } = createContext([
			{
				statusCode: 200,
				body: {
					data: [{ id: '1' }, { id: '2' }],
					pagination: { limit: 2, has_more: true, next_cursor: 'cursor-2' },
				},
			},
			{
				statusCode: 200,
				body: {
					data: [{ id: '3' }],
					pagination: { limit: 2, has_more: false, next_cursor: null },
				},
			},
		]);

		const rows = await listAll<{ id: string }>(context, '/api/v1/websites/abc/tables/t1/rows', {
			returnAll: true,
		});

		expect(rows.map((row) => row.id)).toEqual(['1', '2', '3']);
		expect(requests[0].qs).toEqual({ limit: 100 });
		expect(requests[1].qs).toEqual({ limit: 100, cursor: 'cursor-2' });
	});

	it('stops at the requested limit', async () => {
		const { context } = createContext([
			{
				statusCode: 200,
				body: {
					data: [{ id: '1' }, { id: '2' }],
					pagination: { limit: 2, has_more: true, next_cursor: 'cursor-2' },
				},
			},
		]);

		const rows = await listAll<{ id: string }>(context, '/api/v1/websites', {
			returnAll: false,
			limit: 1,
		});

		expect(rows).toHaveLength(1);
	});

	it('caps the page size at 100', async () => {
		const { context, requests } = createContext([
			{
				statusCode: 200,
				body: {
					data: [{ id: '1' }],
					pagination: { limit: 100, has_more: false, next_cursor: null },
				},
			},
		]);

		await listAll(context, '/api/v1/websites', { returnAll: false, limit: 500 });
		expect(requests[0].qs).toEqual({ limit: 100 });
	});

	it('throws when PageWeave repeats a cursor', async () => {
		const page = {
			statusCode: 200,
			body: {
				data: [{ id: '1' }],
				pagination: { limit: 1, has_more: true, next_cursor: 'same' },
			},
		};
		const { context } = createContext([page, page, page]);

		await expect(listAll(context, '/api/v1/websites', { returnAll: true })).rejects.toThrow(
			/same pagination cursor/,
		);
	});

	it('rejects an unexpected response shape', async () => {
		const { context } = createContext([{ statusCode: 200, body: { items: [] } }]);

		await expect(listAll(context, '/api/v1/websites', { returnAll: true })).rejects.toThrow(
			/unexpected list response/,
		);
	});
});
