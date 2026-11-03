import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { PageWeaveCollection, PageWeaveContext } from './request';
import { pageWeaveRequest } from './request';

export const MAX_PAGE_SIZE = 100;

export interface ListOptions {
	qs?: IDataObject;
	returnAll: boolean;
	limit?: number;
	itemIndex?: number;
	pageSize?: number;
}

export function resolvePageSize(options: ListOptions): number {
	if (options.returnAll) return options.pageSize ?? MAX_PAGE_SIZE;
	const requested = options.limit ?? 50;
	return Math.min(Math.max(Math.floor(requested), 1), options.pageSize ?? MAX_PAGE_SIZE);
}

export async function listAll<T>(
	context: PageWeaveContext,
	path: string,
	options: ListOptions,
): Promise<T[]> {
	const target = options.returnAll ? Number.POSITIVE_INFINITY : Math.max(options.limit ?? 50, 1);
	const pageSize = resolvePageSize(options);
	const collected: T[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;

	for (;;) {
		const qs: IDataObject = { ...options.qs, limit: pageSize };
		if (cursor) qs.cursor = cursor;

		const page = await pageWeaveRequest<PageWeaveCollection<T>>(context, {
			method: 'GET',
			path,
			qs,
			itemIndex: options.itemIndex,
		});

		if (!Array.isArray(page?.data)) {
			throw new NodeOperationError(
				context.getNode(),
				'PageWeave returned an unexpected list response.',
				{ itemIndex: options.itemIndex },
			);
		}

		collected.push(...page.data);

		const nextCursor = page.pagination?.next_cursor ?? undefined;
		const hasMore = page.pagination?.has_more === true && Boolean(nextCursor);

		if (collected.length >= target || !hasMore) break;

		if (seenCursors.has(nextCursor as string)) {
			throw new NodeOperationError(
				context.getNode(),
				'PageWeave returned the same pagination cursor twice. Stop the run and retry.',
				{ itemIndex: options.itemIndex },
			);
		}
		seenCursors.add(nextCursor as string);
		cursor = nextCursor;
	}

	return collected.length > target ? collected.slice(0, target) : collected;
}
