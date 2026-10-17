# Third-party notices

Canvas Forge ships the following third-party software. Versions are pinned in `package.json` / `package-lock.json`.

## Runtime (included in the packaged application)

| Component | Version | Purpose | Licence |
|---|---|---|---|
| Electron | 43.7.7 | Desktop runtime (Chromium + Node.js) | MIT. Electron's distribution includes `LICENSES.chromium.html` with the licences of Chromium and its dependencies; electron-builder copies it into the packaged app. |
| React | 19.3.0 | UI rendering | MIT |
| React DOM | 19.3.0 | UI rendering | MIT |
| scheduler | 0.28.0 | React dependency | MIT |
| Zustand | 5.0.15 | State stores | MIT |
| fflate | 0.8.3 | ZIP/deflate for `.cforge`, brush packs and PNG encoding | MIT |
| gifenc | 1.0.3 | Animated GIF export | MIT |
| @capacitor/core | 8.5.2 | Android app only: bridge between the WebView and Android | MIT |
| @capacitor/android | 8.5.2 | Android app only: native WebView shell | MIT |
| @capacitor/filesystem | 8.1.4 | Android app only: saving documents, exports and recovery files | MIT |
| AndroidX libraries (AppCompat, CoordinatorLayout, Core, Core SplashScreen, WebKit) | see `android/variables.gradle` | Android app only | Apache-2.0 |

The renderer bundle (Vite) and the main-process bundle (esbuild) contain the JavaScript of React, React DOM, scheduler, Zustand, fflate and gifenc. The renderer bundle also contains the JavaScript of @capacitor/core and @capacitor/filesystem; it is only active inside the Android app.

## Development only (not shipped)

TypeScript (Apache-2.0), Vite (MIT), @vitejs/plugin-react (MIT), Vitest (MIT), ESLint (MIT), typescript-eslint (MIT/BSD-2-Clause), eslint-plugin-react-hooks (MIT), globals (MIT), Prettier (MIT), esbuild (MIT), Playwright (Apache-2.0), electron-builder (MIT), @capacitor/cli (MIT), axe-core (MPL-2.0, used only by the accessibility test), @types/* (MIT).

## Assets

All icons, the app icon, brush tips, paper/canvas textures, brush presets and palettes are original to Canvas Forge. Brush tips and textures are generated procedurally at runtime from seeds; no third-party brush packs or images are included. Built-in palette colours were chosen for Canvas Forge.

## MIT licence text (applies to the MIT-licensed components above)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Copyright holders: Electron (GitHub Inc. and contributors), Capacitor core and Android (Drifty Co.), Capacitor Filesystem (Ionic), React/React DOM/scheduler (Meta Platforms, Inc. and affiliates), Zustand (Paul Henschel and contributors), fflate (Arjun Barrett), gifenc (Matt DesLauriers).
