import type { INodePropertyMode, INodeType } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { PageWeave } from '../nodes/PageWeave/PageWeave.node';
import { PageWeaveTrigger } from '../nodes/PageWeaveTrigger/PageWeaveTrigger.node';

const nodes: Array<[string, INodeType]> = [
	['PageWeave', new PageWeave()],
	['PageWeave Trigger', new PageWeaveTrigger()],
];

/**
 * n8n resolves `searchListMethod` on the node type at runtime and throws when
 * the method is missing. Trigger nodes reused the shared website locator
 * without registering `searchWebsites`, which broke the Website list in the
 * editor while lint, typecheck, tests, and the scanner stayed green.
 */
describe('node descriptions', () => {
	it.each(nodes)('%s declares every listSearch method its resource locators use', (_name, node) => {
		const declared = new Set(Object.keys(node.methods?.listSearch ?? {}));
		const used = new Set<string>();

		for (const property of node.description.properties ?? []) {
			for (const mode of property.modes ?? []) {
				const method = (mode as INodePropertyMode).typeOptions?.searchListMethod;
				if (typeof method === 'string') used.add(method);
			}
		}

		expect(used.size).toBeGreaterThan(0);
		expect([...used].filter((method) => !declared.has(method))).toEqual([]);
	});
});
