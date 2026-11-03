import type { INode } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/**
 * Re-throws PageWeave errors unchanged and wraps everything else.
 *
 * Request and response helpers already produce NodeApiError with the HTTP
 * status and RFC 9457 problem body. A second wrap would drop that context.
 */
export function rethrowAsPageWeaveError(node: INode, error: unknown, itemIndex: number): never {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		throw error;
	}

	throw new NodeOperationError(node, error as Error, { itemIndex });
}
