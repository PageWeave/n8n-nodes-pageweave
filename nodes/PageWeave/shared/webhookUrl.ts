const PRIVATE_IPV4_PATTERNS = [
	/^0\./,
	/^10\./,
	/^127\./,
	/^169\.254\./,
	/^192\.168\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
];

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);

export function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

	if (LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost')) return true;
	if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd')) return true;
	if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
		return true;
	}

	return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * PageWeave only delivers to public HTTPS URLs. This preflight catches the
 * common mistakes before an endpoint is created or updated.
 */
export function validateWebhookUrl(raw: string): string {
	const trimmed = (raw ?? '').trim();
	if (!URL.canParse(trimmed)) {
		throw new Error('The webhook URL is not a valid URL.');
	}

	const url = new URL(trimmed);
	if (url.protocol !== 'https:') {
		throw new Error('The webhook URL must use https://.');
	}
	if (url.username || url.password) {
		throw new Error('The webhook URL must not include credentials.');
	}
	if (isPrivateHost(url.hostname)) {
		throw new Error(
			'The webhook URL points to a private or loopback address. Use a public HTTPS tunnel or hostname.',
		);
	}

	return url.toString();
}
