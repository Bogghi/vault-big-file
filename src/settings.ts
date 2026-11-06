import { PluginSettingTab, SettingDefinitionItem } from 'obsidian';

export interface VaultBigFileSettings {
	endpoint: string;
	bucket: string;
	prefix: string;
	thresholdMB: number;
	intervalMinutes: number;
	// Names of entries in Obsidian's secret storage, never the secrets themselves.
	accessKeyIdSecret: string;
	secretAccessKeySecret: string;
}

export const DEFAULT_SETTINGS: VaultBigFileSettings = {
	endpoint: '',
	bucket: '',
	prefix: '',
	thresholdMB: 5,
	intervalMinutes: 5,
	accessKeyIdSecret: '',
	secretAccessKeySecret: '',
};

type Key = keyof VaultBigFileSettings;

const atLeastOne = (v: number) => (Number.isFinite(v) && v >= 1 ? undefined : 'Must be at least 1.');

const trimmed = (v: string) => (v !== v.trim() ? 'Remove leading or trailing spaces.' : undefined);

// Declarative settings: Obsidian renders them, makes them searchable, and persists plugin.settings.
export class VaultBigFileSettingTab extends PluginSettingTab {
	getSettingDefinitions(): SettingDefinitionItem<Key>[] {
		return [
			{
				name: 'Endpoint',
				desc: 'For example https://<account-id>.r2.cloudflarestorage.com',
				control: {
					type: 'text',
					key: 'endpoint',
					validate: (v) =>
						v === '' || /^https:\/\/[^/\s]+\/?$/.test(v) ? undefined : 'Use https://host with no path.',
				},
			},
			{
				name: 'Bucket',
				desc: 'Name of the R2 bucket.',
				control: { type: 'text', key: 'bucket', validate: trimmed },
			},
			{
				name: 'Prefix',
				desc: 'Folder inside the bucket for this vault. Changing it starts a fresh sync.',
				control: {
					type: 'text',
					key: 'prefix',
					validate: (v) => (v.startsWith('/') ? 'Must not start with /.' : trimmed(v)),
				},
			},
			{
				name: 'Access key ID',
				desc: "Stored in this device's secret storage. Not synced.",
				control: { type: 'secret', key: 'accessKeyIdSecret' },
			},
			{
				name: 'Secret access key',
				desc: "Stored in this device's secret storage. Not synced.",
				control: { type: 'secret', key: 'secretAccessKeySecret' },
			},
			{
				name: 'Size threshold (MB)',
				desc: 'Files larger than this are synced through R2.',
				control: { type: 'number', key: 'thresholdMB', min: 1, step: 1, validate: atLeastOne },
			},
			{
				name: 'Check interval (minutes)',
				desc: 'How often to look for changes from other devices.',
				control: { type: 'number', key: 'intervalMinutes', min: 1, step: 1, validate: atLeastOne },
			},
		];
	}
}
