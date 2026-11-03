import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export function resourceLocatorValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && 'value' in value) {
		const inner = (value as { value?: unknown }).value;
		if (typeof inner === 'string') return inner;
		if (typeof inner === 'number') return String(inner);
	}
	return '';
}

export function encodeSegment(value: string): string {
	return encodeURIComponent(value);
}

export function parseJsonObject(
	node: INode,
	raw: unknown,
	fieldName: string,
	itemIndex: number,
): IDataObject | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw === 'object' && !Array.isArray(raw)) return raw as IDataObject;

	const text = String(raw).trim();
	if (!text) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new NodeOperationError(node, `The ${fieldName} field is not valid JSON.`, {
			description: (error as Error).message,
			itemIndex,
		});
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new NodeOperationError(node, `The ${fieldName} field must be a JSON object.`, {
			itemIndex,
		});
	}

	return parsed as IDataObject;
}
