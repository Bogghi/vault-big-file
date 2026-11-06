import { Notice, Plugin, TAbstractFile, debounce } from 'obsidian';
import { DEFAULT_SETTINGS, VaultBigFileSettingTab, VaultBigFileSettings } from './settings';
import { BigFileSync } from './sync';

export default class VaultBigFile extends Plugin {
	settings!: VaultBigFileSettings;
	private syncer!: BigFileSync;

	async onload() {
		await this.loadSettings();
		const status = this.addStatusBarItem();
		this.syncer = new BigFileSync(this.app, () => this.settings, (t) => status.setText(t));
		this.addSettingTab(new VaultBigFileSettingTab(this.app, this));

		this.addCommand({
			id: 'sync-now',
			name: 'Sync big files now',
			callback: () => void this.syncer.run(true),
		});
		this.addCommand({
			id: 'reset-state',
			name: 'Reset sync state on this device',
			callback: () => {
				this.syncer.resetBase();
				new Notice('Vault big file: sync state reset. The next sync only adds files, it never deletes.');
			},
		});

		// Registered after layout ready so the initial vault load doesn't fire a create event per file.
		this.app.workspace.onLayoutReady(() => {
			const later = debounce(() => void this.syncer.run(), 10_000, true);
			const onChange = (file: TAbstractFile, oldPath?: string) => {
				if (this.syncer.isRelevant(file, oldPath)) later();
			};
			this.registerEvent(this.app.vault.on('create', (f) => onChange(f)));
			this.registerEvent(this.app.vault.on('modify', (f) => onChange(f)));
			this.registerEvent(this.app.vault.on('delete', (f) => onChange(f)));
			this.registerEvent(this.app.vault.on('rename', onChange));
			this.registerInterval(
				window.setInterval(() => {
					if (this.syncer.isDue()) void this.syncer.run();
				}, 60_000),
			);
			later(); // first sync ~10s after startup, giving Obsidian Sync a head start
		});
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<VaultBigFileSettings>,
		);
		if (!this.settings.prefix) this.settings.prefix = this.app.vault.getName();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
