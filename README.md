# Vault big file

Obsidian Sync's Standard plan skips files larger than 5 MB. This plugin syncs those files through your own Cloudflare R2 bucket (any S3-compatible storage should work).

## How it works

- Every file larger than the threshold (default 5 MB) is stored in the bucket as `<prefix>/<vault path>`. The prefix defaults to the vault name.
- The bucket listing is the source of truth. A new device downloads whatever is in the bucket and missing locally.
- Each device remembers what it last synced, in local storage that Obsidian Sync never copies. That's how it tells a new file from one deleted on another device.
- **Edits** upload with a conditional PUT, which never overwrites a version it hasn't seen.
- **Deletions** propagate: the file moves to Obsidian's trash on other devices, but only if it hasn't changed there.
- **Conflicts** (edited on two devices): the newer version keeps the name, and the other is saved as `name (conflict <time>).ext`.
- Sync runs about 10 s after startup, about 10 s after a big file changes, and every few minutes (configurable). It also runs on the **Sync big files now** command.
- Files over 50 MB are skipped.

## Setup

1. Create an R2 API token with **Object Read & Write** access to **this bucket only**.
2. In **Settings → Vault big file**, set the endpoint (`https://<account-id>.r2.cloudflarestorage.com`) and the bucket.
3. Pick or create the access key ID and secret access key in secret storage. On each device, create the secrets with the same names.

Requires Obsidian 1.13.0 or later.

## Privacy and network use

The plugin only connects to the endpoint you configure. It uploads files above the size threshold, and nothing else. There's no telemetry.

To find those files, the plugin reads the size of every file in the vault (`vault.getFiles()`). Paths and sizes of smaller files never leave the device. Credentials stay in Obsidian's secret storage on each device and are never written to `data.json`.

## Known limitations

- R2 keeps no version history. An overwritten or deleted object is gone from the bucket (local deletions still go to the trash).
- When a file grows past the threshold, other devices get the new version as a conflict copy instead of an in-place update.
- `A.pdf` and `a.pdf` are different keys in the bucket, but they collide on Windows and macOS.
- Each file is held fully in memory during transfer.

## Development

```bash
npm install
npm run dev     # watch build to main.js
npm run build   # type-check + production build
npm run lint
npm test        # decision table tests (Node 24+)
```

Release: bump the version with `npm version <x.y.z>`, then push the tag. The release workflow builds the plugin and drafts a GitHub release.
