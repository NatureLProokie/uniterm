# Win7 frontend build target

The Wails production build remains `npm run build` and is unchanged. For the
experimental Electron 22 / Windows 7 frontend bundle, use:

```sh
npm run build:win7
```

It writes to `dist-win7/`, uses `vite.win7.config.ts`, targets Chromium 108, and
aliases `@wailsio/runtime` to `src/win7/wails-runtime.ts`. It does not provide
the required standalone Go backend by itself. See `../legacy/win7/README.md`.
