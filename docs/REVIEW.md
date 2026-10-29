# Local review checklist

Prepared on 2026-10-28. Nothing was submitted, tagged, pushed, or released.

## Automated checks

Run `npm ci`, then `npm run qa` from this repository. QA runs the official Obsidian ESLint recommendations with zero warnings, regression tests, the TypeScript/production build, and metadata/artifact validation. The optional recommendation to adopt the newer declarative settings API is disabled to retain Obsidian 1.7.2 compatibility; imperative settings remain supported there.

The tracked `main.js`, `manifest.json`, and `styles.css` are the local installation files. The build embeds bundled dependency licenses. `versions.json` preserves prior entries and records this candidate's minimum app version.

## Before a later submission

Perform the real-app checks below in a disposable vault on the declared minimum version and the current stable version. Automated host mocks cannot verify Obsidian's private explorer/graph implementation or physical input devices. Then, when separately authorized, publish a GitHub release whose tag exactly matches `manifest.json` (no `v` prefix), attach the three installation files, and use the official submission workflow. Directory name/ID availability and the hosted review are checked at that time. No release or submission was part of this work.

References checked:

- [Manifest](https://docs.obsidian.md/Reference/Manifest)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Official local lint rules](https://github.com/obsidianmd/eslint-plugin)
- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)

## Real-app smoke checks still to run

- Open the global graph, close graph settings, and find the cube plus 2D/3D buttons. Verify focus and Enter/Space activation.
- Test an empty vault, linked/unlinked notes, nested clusters, and a representative large vault.
- Play, rotate, zoom, hold-to-pan, right-drag, and open a note. A right-click must not open a note.
- Rapidly toggle 2D/3D, close a graph while scanning folders, replay, and disable the plugin. There must be no leftover overlay or animation.
- Use multiple graph panes and a detached window; check resize, theme changes, and graph controls remaining clickable.
- Check a system without WebGL, and compare GPU/CPU use before enable and after disable.

## Review — 2026-10-28

Agent decision, 2026-10-28: review the seven completed local preparations before adding features, because their shared explorer behavior and remaining host checks need validation.

Fresh `npm run qa` passed: 10 tests, TypeScript, production build, and package checks. The existing graph/lifecycle tests, official lint configuration, build, and metadata checks still pass. No graph code changed in this review.

This is automated local evidence, not a live Obsidian or minimum-version certification. The real-app checklist above remains open. Nothing was installed into the personal vault, pushed, released, or submitted.

## Initialization cleanup — 2026-10-28

agent decision 2026-10-28: register cleanup immediately after acquiring each resource and connect controls only after retaining their instance, because failures during configuration previously escaped before the caller could own the scene. Constructor failure now unwinds the acquired resources and rethrows the original error. Destruction is idempotent; it cancels scheduled work, ignores stale callbacks, removes scene listeners, disconnects the observer, disposes controls/meshes/renderer, releases the renderer context and removes the overlay. Each cleanup action is attempted independently; errors are logged without replacing the initialization error or skipping later cleanup.

Regression evidence: against baseline `1a4dce6`, injecting `renderer.setClearColor` into the actual constructor left one overlay, one renderer and one context unreleased; `node --test tests/scene-lifecycle.test.mjs` failed (0 passed, 1 failed). The same regression passes after the fix. The expanded matrix covers DOM setup, renderer configuration, controls setup/connection/listeners, observer creation/observation, initial sizing, frame scheduling, controls update and first render. It checks successful retry, repeated destruction, pending timers and retained callbacks, and cleanup failures.

The matrix loads actual `src/scene.ts`, keeps Three scene/camera/math objects, and substitutes WebGLRenderer, TrackballControls, ResizeObserver and window scheduling with instrumented doubles. DOM comes from JSDOM with synthetic Obsidian element helpers. Against a saved copy of baseline `1a4dce6:src/scene.ts`, all three supplementary tests failed: partial connection retained five listeners, resizing retained six, and active-drag teardown retained six scene listeners. The supplementary `tests/real-controls-lifecycle.test.mjs` uses the installed TrackballControls and real Three objects with a renderer double, JSDOM and controlled scheduling/observer; it checks real control listener removal. Existing plugin-level 2D fallback tests still use a whole-scene double. No test creates a real WebGL context or runs Obsidian.

Ownership boundaries: a dependency that throws before returning an object must clean its own hidden partial allocation; GraphScene cannot dispose an object it never received. Controls are constructed without a DOM element so connection/initial sizing failures occur after ownership transfers. Likewise, a scheduling API that queues work but throws before returning its cancellation handle, or a cleanup method that throws before actually freeing its resource, cannot be certified by these doubles. Cleanup-error tests establish that other cleanup actions continue and diagnostics survive; their doubles release before throwing. This change covers scene construction/teardown, not recovery from arbitrary later animation-frame errors.

Current official [lifecycle guidance](https://docs.obsidian.md/plugins/guides/lifecycle-management), [popout guidance](https://docs.obsidian.md/plugins/guides/pop-out-windows) and [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) were checked on 2026-10-28. The cleanup contract addresses owned resources. Popout behavior (including the installed controls' global-window listeners), actual WebGL rendering, physical inputs and the declared minimum app version still require the existing real-app checklist. This is local regression evidence, not community acceptance or live compatibility certification.

Final validation: `npm run qa` passed all **41 tests** (10 existing, 28 instrumented scene cases, three real-controls cases), zero-warning lint, TypeScript, production build and package checks. `git diff --check` passed. The tracked production `main.js` was rebuilt; `manifest.json` and `styles.css` needed no changes. Independent source review found no blocking issues.

## Review — 2026-10-29

agent decision 2026-10-28: retain the implementation and existing regression suites because inspection of `1a4dce6` → `e811a84` found no concrete regression in the accepted initialization/teardown contract. Reviewed `src/scene.ts`, plugin ownership/fallback in `src/main.ts`, the instrumented scene suite, installed-controls suite and behavior suite together; no duplicate fault matrix or speculative test was added.

The installed Three.js 0.186.1 controls set their DOM element before connecting listeners; retaining the disconnected instance lets scene cleanup unwind a partially completed connection. The constructor catches setup failures after overlay acquisition, retains cleanup before mutable setup, and rethrows the original failure. Destruction drains owned cleanup once; retained frame, resize and hold/open callbacks cannot revive the destroyed scene. Plugin request generations and alive/unloaded guards separately prevent stale folder scans from creating scenes, while construction errors restore 2D. Those plugin fallback checks use a whole-scene double; they are not a composed native WebGL/Obsidian test.

Fresh `npm run qa` passed **41/41 tests**, zero-warning lint, TypeScript, production build and package validation. The rebuild left tracked production assets unchanged. `npm ls --omit=dev --all` confirmed the installed runtime dependency versions match the notices; package, lockfile (including its root package), manifest and current versions entry agree on version 1.2.1 and minimum Obsidian 1.7.2. README manual-install files and desktop-only requirements match the candidate. `git diff --check` passed. Only this review record changed.

All real-app checks above remain open, including actual WebGL, popout/global-window controls, physical input and minimum-version behavior. The earlier ownership boundaries still apply: unreturned allocations or cancellation handles, dependency cleanup that fails before releasing its own resources, and arbitrary later animation-frame failures are not certified. No new app-access attempt, installation, release or submission was made.

Official manifest, submission requirements, developer policies, plugin guidelines and release instructions were rechecked on 2026-10-29. Local metadata, disclosures and licensing checks do not establish minimum-version runtime compatibility, directory name availability or community approval.
