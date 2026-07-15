#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const manifestPath = path.join(distDir, 'manifest.json');

const manifest = {
  api: '1.0.0',
  // Matches the published Tolgee plugin's identity, so a local/dev build is the
  // same plugin to Figma (shares its stored data) rather than a separate one.
  id: '1212381421658754793',
  name: 'Tolgee',
  main: 'main.js',
  // Per-editor UI bundles: `figma` for design mode, `dev` for the Dev-Mode
  // inspect panel. Figma's manifest schema specifically uses these keys.
  ui: { figma: 'ui.html', dev: 'ui-inspect.html' },
  editorType: ['figma', 'dev'],
  // Required for plugins built after 2024 — forces async page access, which is
  // what our `getNodeByIdAsync` / `page.loadAsync()` code already assumes.
  documentAccess: 'dynamic-page',
  // `vscode` makes the existing read-only inspect panel (above) also launchable
  // from the Figma-for-VS-Code extension — no extra code needed, `figma.vscode`
  // is an empty marker interface. Matches production; dropped here by omission.
  capabilities: ['inspect', 'vscode'],
  networkAccess: {
    allowedDomains: ['*'],
    reasoning: 'Self-hosted Tolgee instances may run on arbitrary domains.',
  },
  // No `menu`: with one, Figma shows a submenu on launch instead of opening the
  // plugin directly.
  relaunchButtons: [
    { command: 'open-on-node', name: 'Edit Tolgee key', multipleSelection: false },
  ],
};

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`Wrote ${path.relative(rootDir, manifestPath)}`);
