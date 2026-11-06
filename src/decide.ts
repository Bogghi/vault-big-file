// Pure three-way sync decision: local file vs remote object vs this device's last-synced base.
// No obsidian imports so it can be tested with plain node (see test/decide.test.ts).

export interface LocalStat {
	size: number;
	mtime: number;
}

export interface RemoteStat {
	etag: string;
}

export interface BaseEntry {
	size: number;
	mtime: number;
	etag: string;
}

export type Action =
	| 'none'
	| 'forget'
	| 'upload'
	| 'download'
	| 'delete-remote'
	| 'trash-local'
	| 'compare';

export function decide(local?: LocalStat, remote?: RemoteStat, base?: BaseEntry): Action {
	if (!base) {
		// Never synced on this device: no way to tell deletions apart, so only add.
		if (local && remote) return 'compare';
		if (local) return 'upload';
		return remote ? 'download' : 'none';
	}
	if (!local) {
		if (!remote) return 'forget';
		return remote.etag !== base.etag ? 'download' : 'delete-remote';
	}
	const localChanged = local.size !== base.size || local.mtime !== base.mtime;
	if (!remote) return localChanged ? 'upload' : 'trash-local';
	const remoteChanged = remote.etag !== base.etag;
	if (localChanged && remoteChanged) return 'compare';
	if (localChanged) return 'upload';
	return remoteChanged ? 'download' : 'none';
}
