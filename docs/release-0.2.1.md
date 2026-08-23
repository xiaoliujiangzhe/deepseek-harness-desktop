# Desktop 0.2.1 release checklist

This patch release fixes the packaged Windows application failing with
`ERR_MODULE_NOT_FOUND` even though development mode worked.

## Required checks

Run from the repository root:

```powershell
npm install
npm run verify:harness
npm test
npm run dist:win
```

The final command is only successful when its post-build check prints:

```text
打包产物校验通过：Harness 0.1.1-rc.2
```

Do not publish the installer when this line is absent, even if electron-builder
printed that the NSIS target was generated.

## Installed-app check

Close the development app and the existing installed app. Install:

```text
release\DeepSeek Harness Setup 0.2.1.exe
```

Verify all of the following from the desktop shortcut:

1. The Electron window opens without an `ERR_MODULE_NOT_FOUND` startup error.
2. The default browser does not open automatically.
3. A normal text turn works.
4. Provider `deepseek-official` with model `deepseek-v4-flash-vision-exp` accepts
   a PNG or JPEG image.

## GitHub release

Publish a new tag and Release named `v0.2.1`. Do not silently replace the
already published `v0.2.0` artifact. Mark `v0.2.0` as superseded and direct
users to `v0.2.1`.
