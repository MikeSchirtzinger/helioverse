import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initPhysics } from './core/physics';
import wasmUrl from './wasm/helio-core/helio_core_bg.wasm?url';
// Self-hosted instrument typeface: Saira (variable aerospace/technical grotesque)
// for UI + wordmark, IBM Plex Mono for telemetry numerals. Bundled by Vite — no
// runtime font CDN, works offline.
import '@fontsource-variable/saira';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles/global.css';
import './styles/console.css';
import './styles/experience.css';

// The shared Rust→WASM physics core (crates/helio-core, golden-vector verified)
// is the single source of physics truth — DBM, L1 delay, Newell/Dst, go-look,
// ephemeris. Its wrappers in core/physics are synchronous and throw if called
// before instantiation, so the core MUST be ready before the first render.
// Fail loudly rather than silently fall back to unverified numbers.
initPhysics(wasmUrl)
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((err: unknown) => {
    console.error('[helioverse] WASM physics core failed to initialise:', err);
    const root = document.getElementById('root');
    if (root) {
      root.textContent =
        'Failed to initialise the physics core (WASM) — see console. ' + String(err);
    }
  });
