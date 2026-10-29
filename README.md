# 3D Animation with Toggle

Explore the vault as a 3D graph and watch notes appear in creation-date order. Folder clusters get distinct colors, and a 2D/3D switch brings you back to Obsidian's graph.

## Requirements and installation

Requires **desktop Obsidian 1.7.2 or newer**, the core **Graph view** plugin, and working WebGL. Mobile is not supported. Large graphs require more GPU and CPU work; switching back to 2D disposes the 3D scene.

This is a local submission candidate, not a published community release. To install in a test vault:

1. Run `npm ci` and `npm run qa` in this repository (Node.js 22.13+ or 24 recommended for development).
2. Create `<vault>/<config-dir>/plugins/three-d-animation-with-toggle/`. The config directory is normally `.obsidian`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into it.
4. Reload Obsidian and enable **3D Animation with Toggle** under **Settings → Community plugins**.

The submission ID is now `three-d-animation-with-toggle` to use only lowercase letters and hyphens. If testing an older local build in `3d-animation-with-toggle`, disable it before installing this one. Its only saved preference is 2D/3D mode; choose that mode again in the new installation. No notes need migration.

## Open and use the graph

Open the **global graph**, then close its graph-settings panel. Below the timelapse wand are a cube button and a **2D / 3D** toggle. They are native buttons and can also be activated with the keyboard.

- **3D** shows the current vault. **2D** returns to the standard graph. This preference is saved and applies to all open global graph panes.
- The cube, **Start 3D animation**, replays the vault from its oldest note. From 2D, it switches to 3D first.
- Drag to rotate freely; scroll to zoom; right-drag to pan.
- Double-click to zoom toward the clicked spot. Alt-double-click zooms out.
- Hold the left button still for a quarter-second, then drag to slide the picture without rotating it.
- Hover a dot for its note and cluster names. Click a dot to open its note.

The top-left label shows the day, date, and note count. The legend identifies each cluster. Return to 2D to stop playback. Closing a pane or disabling the plugin cancels pending loads and disposes its scene. If scene initialization fails, the plugin releases resources already acquired, shows a notice, and restores 2D.

## Clusters and dates

A subvault is a folder containing a configuration directory with the same name as the parent vault's config directory (normally `.obsidian`). If none exist, top-level folders become clusters. Notes outside those folders share a cluster named after the vault. Nested clusters use the deepest matching folder, and full paths distinguish folders with the same name.

Day 1 is the oldest Markdown file's creation date. Copied or restored files may have different creation dates from their original writing dates. Playback takes 60 ms per day, with a minimum of 8 seconds and maximum of 40 seconds.

Only Markdown notes and resolved links between them are shown. Graph filters, core graph groups, attachments, and local graphs do not apply to this 3D view. A metadata refresh updates the graph when playback is idle; camera placement may reset when the graph changes.

## Data and privacy

The plugin reads local file metadata, resolved links, and folder/config-directory existence. It never modifies notes. Its `data.json` stores only the view preference. No accounts, network calls, telemetry, external fonts, or paid services are used. Rendering libraries are bundled locally.

## Development and review

- `npm run dev`: rebuild while editing.
- `npm run lint`: official Obsidian ESLint rules and TypeScript-aware checks.
- `npm test`: graph grouping, creation days, link deduplication, bounded folder scans, accessible controls, stale-load cancellation, 2D fallback, and actual scene initialization/teardown with injected dependency failures.
- `npm run build`: strict TypeScript check and production bundle.
- `npm run qa`: all checks plus manifest/package/version and artifact validation.

The controls attach to internal graph DOM selectors, which can change between Obsidian versions. Tests exercise the actual scene constructor with an instrumented renderer, controls, observer, DOM and scheduler, plus separate checks using the installed TrackballControls implementation. They do not certify native WebGL rendering. Real-app checks are listed in [docs/REVIEW.md](docs/REVIEW.md).

## License

MIT; see [LICENSE](LICENSE). Three.js, d3-force-3d, and their bundled runtime dependencies retain their MIT/ISC licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), also embedded in `main.js`.
