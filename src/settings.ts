import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type VaultBigFile from './main';

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

export class VaultBigFileSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: VaultBigFile,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		const text = (name: string, desc: string, key: 'endpoint' | 'bucket' | 'prefix', valid: (v: string) => boolean) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setValue(s[key]).onChange(async (v) => {
						v = v.trim();
						if (!valid(v)) return;
						s[key] = v;
						await this.plugin.saveSettings();
					}),
				);
		const number = (name: string, desc: string, key: 'thresholdMB' | 'intervalMinutes') =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setValue(String(s[key])).onChange(async (v) => {
						const n = Number(v);
						if (!Number.isFinite(n) || n < 1) return;
						s[key] = n;
						await this.plugin.saveSettings();
					}),
				);
		const secret = (name: string, key: 'accessKeyIdSecret' | 'secretAccessKeySecret') =>
			new Setting(containerEl)
				.setName(name)
				.setDesc('Stored in this device\'s secret storage. Not synced.')
				.addComponent((el) =>
					new SecretComponent(this.app, el).setValue(s[key]).onChange(async (v) => {
						s[key] = v;
						await this.plugin.saveSettings();
					}),
				);

		text(
			'Endpoint',
			'For example https://<account-id>.r2.cloudflarestorage.com',
			'endpoint',
			(v) => v === '' || /^https:\/\/[^/]+\/?$/.test(v),
		);
		text('Bucket', 'Name of the R2 bucket.', 'bucket', () => true);
		text('Prefix', 'Folder inside the bucket for this vault. Changing it starts a fresh sync.', 'prefix', (v) => !v.startsWith('/'));
		secret('Access key ID', 'accessKeyIdSecret');
		secret('Secret access key', 'secretAccessKeySecret');
		number('Size threshold (MB)', 'Files larger than this are synced through R2.', 'thresholdMB');
		number('Check interval (minutes)', 'How often to look for changes from other devices.', 'intervalMinutes');
	}
}
