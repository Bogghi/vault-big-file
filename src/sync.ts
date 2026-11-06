import { App, Notice, TAbstractFile, TFile, normalizePath } from 'obsidian';
import { BaseEntry, decide } from './decide';
import { R2, RemoteObject } from './r2';
import type { VaultBigFileSettings } from './settings';

// ponytail: whole file is held in memory (twice on upload); move to multipart/streaming to go past this.
const MAX_SIZE = 50_000_000;

type Base = Record<string, BaseEntry>;

async function sha256(data: ArrayBuffer): Promise<string> {
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
	return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

function conflictPath(path: string): string {
	const dot = path.lastIndexOf('.');
	const [stem, ext] = dot > path.lastIndexOf('/') ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
	const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
	return `${stem} (conflict ${stamp})${ext}`;
}

export class BigFileSync {
	private running = false;
	private again = false;
	private lastRun = 0;

	constructor(
		private app: App,
		private settings: () => VaultBigFileSettings,
		private status: (text: string) => void,
	) {}

	private get threshold(): number {
		return this.settings().thresholdMB * 1_000_000;
	}

	// Per-device, per-target state. Lives in localStorage so Obsidian Sync never copies it between devices.
	private get baseKey(): string {
		const s = this.settings();
		return `vault-big-file-base:${s.endpoint}/${s.bucket}/${s.prefix}`;
	}

	private loadBase(): Base {
		return (this.app.loadLocalStorage(this.baseKey) as Base | null) ?? {};
	}

	private saveBase(base: Base): void {
		this.app.saveLocalStorage(this.baseKey, base);
	}

	resetBase(): void {
		this.app.saveLocalStorage(this.baseKey, null);
	}

	/** Cheap filter for vault events so ordinary note edits don't trigger a bucket listing. */
	isRelevant(file: TAbstractFile, oldPath?: string): boolean {
		if (file instanceof TFile && file.stat.size > this.threshold) return true;
		const base = this.loadBase();
		return file.path in base || (oldPath !== undefined && oldPath in base);
	}

	isDue(): boolean {
		return Date.now() - this.lastRun >= this.settings().intervalMinutes * 60_000;
	}

	async run(manual = false): Promise<void> {
		if (this.running) {
			this.again = true;
			return;
		}
		this.running = true;
		try {
			do {
				this.again = false;
				await this.reconcile(manual);
			} while (this.again);
		} finally {
			this.running = false;
		}
	}

	private client(): R2 | null {
		const s = this.settings();
		const accessKeyId = s.accessKeyIdSecret ? this.app.secretStorage.getSecret(s.accessKeyIdSecret) : null;
		const secretAccessKey = s.secretAccessKeySecret
			? this.app.secretStorage.getSecret(s.secretAccessKeySecret)
			: null;
		if (!s.endpoint || !s.bucket || !accessKeyId || !secretAccessKey) return null;
		return new R2({ endpoint: s.endpoint, bucket: s.bucket, accessKeyId, secretAccessKey });
	}

	private async reconcile(manual: boolean): Promise<void> {
		this.lastRun = Date.now();
		const r2 = this.client();
		if (!r2) {
			this.status('Big files: not configured');
			if (manual) new Notice('Vault big file: set the endpoint, bucket and keys in settings first.');
			return;
		}
		const prefix = this.settings().prefix ? `${this.settings().prefix}/` : '';
		this.status('Big files: syncing…');

		let listed: Map<string, RemoteObject>;
		try {
			listed = await r2.list(prefix);
		} catch (e) {
			console.error('[vault-big-file] list failed', e);
			this.status('Big files: offline or error');
			if (manual) new Notice(`Vault big file: ${String(e)}`);
			return;
		}

		// Bucket contents are a trust boundary: only accept plain vault paths outside the config folder.
		const remote = new Map<string, RemoteObject>();
		for (const [key, obj] of listed) {
			const path = key.slice(prefix.length);
			const safe =
				path &&
				!path.endsWith('/') &&
				normalizePath(path) === path &&
				!path.split('/').includes('..') &&
				!path.startsWith(`${this.app.vault.configDir}/`);
			if (safe) remote.set(path, obj);
		}

		const base = this.loadBase();
		if (remote.size === 0 && Object.keys(base).length > 0) {
			this.status('Big files: paused (bucket empty)');
			new Notice(
				'Vault big file: the bucket is empty but files were synced before. Sync is paused so no local files get deleted. Check the bucket and prefix, or reset the sync state from the command palette.',
			);
			return;
		}

		const paths = new Set([...remote.keys(), ...Object.keys(base)]);
		for (const f of this.app.vault.getFiles()) if (f.stat.size > this.threshold) paths.add(f.path);

		let errors = 0;
		let skipped = 0;
		for (const path of paths) {
			if ((this.app.vault.getFileByPath(path)?.stat.size ?? 0) > MAX_SIZE || (remote.get(path)?.size ?? 0) > MAX_SIZE) {
				skipped++;
				continue;
			}
			try {
				await this.syncPath(r2, prefix + path, path, remote.get(path), base);
			} catch (e) {
				errors++;
				console.error(`[vault-big-file] ${path}`, e);
			}
			this.saveBase(base);
		}

		const time = new Date().toLocaleTimeString();
		const over = skipped ? `, ${skipped} over 50 MB skipped` : '';
		this.status(errors ? `Big files: ${errors} failed${over} (${time})` : `Big files: synced${over} ${time}`);
		if (manual) new Notice(errors ? `Vault big file: ${errors} files failed, see console.` : 'Vault big file: synced.');
	}

	private async syncPath(r2: R2, key: string, path: string, remote: RemoteObject | undefined, base: Base) {
		const file = this.app.vault.getFileByPath(path);
		switch (decide(file?.stat, remote, base[path])) {
			case 'none':
				return;
			case 'forget':
				delete base[path];
				return;
			case 'upload':
				if (file) await this.upload(r2, key, file, remote?.etag, base);
				return;
			case 'download':
				await this.download(r2, key, path, base);
				return;
			case 'delete-remote':
				await r2.del(key);
				delete base[path];
				return;
			case 'trash-local':
				if (file) await this.app.fileManager.trashFile(file);
				delete base[path];
				return;
			case 'compare':
				if (file && remote) await this.resolve(r2, key, file, remote, base);
				return;
		}
	}

	private async upload(r2: R2, key: string, file: TFile, remoteEtag: string | undefined, base: Base) {
		// Record the stat from *before* the read: if the file changes mid-upload, the next pass uploads again.
		const { size, mtime } = file.stat;
		const data = await this.app.vault.readBinary(file);
		const etag = await r2.put(key, data, await sha256(data), remoteEtag);
		// null = another device wrote first; the next pass sees the remote change and resolves it.
		if (etag !== null) base[file.path] = { size, mtime, etag };
	}

	private async download(r2: R2, key: string, path: string, base: Base) {
		const { data, etag } = await r2.get(key);
		const file = await this.write(path, data);
		base[path] = { size: file.stat.size, mtime: file.stat.mtime, etag };
	}

	private async write(path: string, data: ArrayBuffer): Promise<TFile> {
		const existing = this.app.vault.getFileByPath(path);
		if (existing) {
			await this.app.vault.modifyBinary(existing, data);
			return existing;
		}
		const dir = path.slice(0, path.lastIndexOf('/'));
		if (dir && !this.app.vault.getFolderByPath(dir)) await this.app.vault.createFolder(dir);
		return this.app.vault.createBinary(path, data);
	}

	/** Both sides exist and differ from what this device last saw: same content, or keep both. */
	private async resolve(r2: R2, key: string, file: TFile, remote: RemoteObject, base: Base) {
		const local = await sha256(await this.app.vault.readBinary(file));
		if (local === (await r2.sha256(key))) {
			base[file.path] = { size: file.stat.size, mtime: file.stat.mtime, etag: remote.etag };
			return;
		}
		// Newer version keeps the path; the other becomes a conflict copy (untracked, so it syncs as a new file).
		const path = file.path;
		if (file.stat.mtime > remote.lastModified) {
			const { data } = await r2.get(key);
			await this.write(conflictPath(path), data);
			await this.upload(r2, key, file, remote.etag, base);
		} else {
			await this.app.vault.rename(file, conflictPath(path));
			await this.download(r2, key, path, base);
		}
		new Notice(`Vault big file: conflict on ${path}, kept both versions.`);
	}
}
