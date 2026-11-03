import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeSignature(secret: string, body: Buffer | string): string {
	return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verifies `X-Webhook-Signature: sha256=<hex>` over the raw request body.
 * Length-safe: timingSafeEqual throws when the buffers differ in length.
 */
export function verifySignature(
	rawBody: Buffer | string | undefined,
	header: string | undefined,
	secret: string | undefined,
): boolean {
	if (!rawBody || !header || !secret) return false;

	const match = header.trim().match(/^sha256=([a-f0-9]{64})$/i);
	if (!match) return false;

	const expected = Buffer.from(computeSignature(secret, rawBody), 'hex');
	const received = Buffer.from(match[1], 'hex');

	return expected.length === received.length && timingSafeEqual(expected, received);
}
