import { requestUrl, RequestUrlResponse } from 'obsidian';
import { AwsV4Signer } from 'aws4fetch';

export interface R2Config {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

export interface RemoteObject {
	etag: string;
	size: number;
	lastModified: number;
}

const unquote = (etag: string) => etag.replace(/"/g, '');

// RFC 3986 encoding, same as the signer's canonical form, so "file (1).pdf" signs correctly.
const encode = (s: string) =>
	encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function header(res: RequestUrlResponse, name: string): string | undefined {
	const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name);
	return key === undefined ? undefined : res.headers[key];
}

function tag(el: Element | Document, name: string): string {
	return el.getElementsByTagName(name)[0]?.textContent ?? '';
}

// Minimal S3 client for R2: signs with aws4fetch, sends with requestUrl (no CORS issues on desktop or mobile).
export class R2 {
	constructor(private cfg: R2Config) {}

	private async send(
		method: string,
		key: string,
		opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: ArrayBuffer } = {},
	): Promise<RequestUrlResponse> {
		const path = [this.cfg.bucket, ...(key ? key.split('/') : [])].map(encode).join('/');
		// Build the query by hand: URLSearchParams turns spaces into '+', which breaks the signature.
		const query = Object.entries(opts.query ?? {})
			.map(([k, v]) => `${encode(k)}=${encode(v)}`)
			.join('&');
		const url = `${this.cfg.endpoint.replace(/\/+$/, '')}/${path}${query ? `?${query}` : ''}`;
		const signed = await new AwsV4Signer({
			url,
			method,
			headers: opts.headers,
			body: opts.body,
			accessKeyId: this.cfg.accessKeyId,
			secretAccessKey: this.cfg.secretAccessKey,
			service: 's3',
			region: 'auto',
		}).sign();
		const headers: Record<string, string> = {};
		signed.headers.forEach((v, k) => (headers[k] = v));
		const res = await requestUrl({ url, method, headers, body: opts.body, throw: false });
		if (res.status >= 300 && res.status !== 404 && res.status !== 412) {
			let detail = '';
			try {
				detail = res.text.slice(0, 300);
			} catch {
				/* binary or empty body */
			}
			throw new Error(`R2 ${method} ${key || '/'} failed: ${res.status} ${detail}`);
		}
		return res;
	}

	async list(prefix: string): Promise<Map<string, RemoteObject>> {
		const out = new Map<string, RemoteObject>();
		let token = '';
		do {
			const query: Record<string, string> = { 'list-type': '2', prefix };
			if (token) query['continuation-token'] = token;
			const res = await this.send('GET', '', { query });
			if (res.status === 404) throw new Error(`R2 bucket "${this.cfg.bucket}" not found`);
			const doc = new DOMParser().parseFromString(res.text, 'application/xml');
			for (const c of Array.from(doc.getElementsByTagName('Contents'))) {
				out.set(tag(c, 'Key'), {
					etag: unquote(tag(c, 'ETag')),
					size: Number(tag(c, 'Size')),
					lastModified: Date.parse(tag(c, 'LastModified')),
				});
			}
			token = tag(doc, 'IsTruncated') === 'true' ? tag(doc, 'NextContinuationToken') : '';
		} while (token);
		return out;
	}

	async get(key: string): Promise<{ data: ArrayBuffer; etag: string }> {
		const res = await this.send('GET', key);
		if (res.status === 404) throw new Error(`R2 object ${key} disappeared`);
		return { data: res.arrayBuffer, etag: unquote(header(res, 'etag') ?? '') };
	}

	/** SHA-256 stored at upload time, or null if the object is missing or was not uploaded by this plugin. */
	async sha256(key: string): Promise<string | null> {
		const res = await this.send('HEAD', key);
		return res.status === 404 ? null : (header(res, 'x-amz-meta-sha256') ?? null);
	}

	/**
	 * Conditional PUT: overwrite only `ifMatch`, or only create when it's undefined.
	 * Returns the new etag, or null when another device wrote first (412).
	 */
	async put(key: string, body: ArrayBuffer, sha256: string, ifMatch?: string): Promise<string | null> {
		const headers: Record<string, string> = {
			'x-amz-content-sha256': sha256,
			'x-amz-meta-sha256': sha256,
			...(ifMatch ? { 'if-match': `"${ifMatch}"` } : { 'if-none-match': '*' }),
		};
		const res = await this.send('PUT', key, { headers, body });
		return res.status === 412 ? null : unquote(header(res, 'etag') ?? '');
	}

	async del(key: string): Promise<void> {
		await this.send('DELETE', key);
	}
}
