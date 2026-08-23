# Desktop 0.2.0 release checklist

## 1. Install the pinned Harness

Run from the repository root on a machine that can access the official npm registry:

```powershell
npm install --save-exact "@deepseek-ai/dsh@0.1.1-rc.2" --registry=https://registry.npmjs.org
```

Both `package-lock.json` and `node_modules` must change. Do not hand-edit the
transitive rc.6 entries in the lock file.

## 2. Verify source state

```powershell
npm run verify:harness
npm test
git diff --check
```

`verify:harness` must print `0.1.1-rc.2`. A version mismatch intentionally
blocks both startup and packaging.

## 3. Test migration

Close every existing `dsh` and DeepSeek Harness process, then test:

1. A clean Windows user with no `%USERPROFILE%\.dsh`.
2. An existing rc.6 user with sessions, attachments, settings and credentials.
3. A retry after an interrupted migration.

The migration may create a backup under:

```text
%USERPROFILE%\.dsh\profiles\.desktop-migration\
```

It must not move or rewrite `sessions`, `attachments`, `settings.yaml`,
`.credentials.yaml`, or `profiles\web\cordis.patch.yml`.

## 4. Test DeepSeek vision

In Harness, select provider `deepseek-official` and model
`deepseek-v4-flash-vision-exp`. Verify a normal text turn, a PNG/JPEG image
turn, session reopen, and a second image turn. Account access, price and live
provider limits must be checked against the official DeepSeek documentation.

## 5. Build and test the installer

```powershell
npm run dist:win
```

Install the generated NSIS package on a clean Windows account. Verify the
installed app, not only `npm start`, then publish the tested artifact as the
GitHub `v0.2.0` release.
