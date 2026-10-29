# Local review checklist

Latest local checkpoint: [Pending-scan ownership — 2026-10-29](#pending-scan-ownership--2026-10-29). Earlier entries below remain dated history.

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


## Scheduled-frame failure containment — 2026-10-29

agent decision 2026-10-28: retain the synchronous constructor error path and wrap only scheduled animation frames, because baseline injection after successful setup reproduced a separate failure boundary. Reuse scene destruction and the plugin's existing global 2D fallback. Match the failing scene by identity, rather than a scan request number, because a still-current scene can fail while a newer scan is pending.

Baseline `9c70e6b`: `node --test --test-name-pattern='scheduled frame contains|actual plugin and scene' tests/scene-lifecycle.test.mjs` failed all three cases (exit 1). Both controls-update and renderer-render injections occurred after construction, graph loading and one successful queued frame. Each left one overlay, renderer, context, controls instance, observer and queued frame, eight listeners and two timers. The composed actual-main/actual-scene case remained in 3D. These are controlled exceptions, not reproduced native WebGL defects.

Scheduled failures now destroy the scene before notifying its owner. Cleanup cancels the next frame and timers, stops the simulation, releases meshes/listeners/controls/observer/renderer/context and removes the overlay. Retained callbacks and repeated destruction are inert. Only the current, live scene can trigger the existing 2D fallback; all panes stop, pending scans are invalidated, controls/preferences return to 2D, and one original-error diagnostic plus one notice are attempted. No automatic retry occurs. An explicit 3D/cube action creates fresh ownership. Cleanup errors are separately diagnosed; failures in logging, notice creation or the scene failure hook cannot interrupt remaining cleanup or start a notification loop.

Seven new focused cases pass: two actual-scene frame failures with real Three mesh/material disposal and d3 simulation-stop checks, one composed plugin/scene recovery case, one throwing cleanup/hook/logger case, and three composed reporting-channel failures (console, notice, both) with observer cleanup exceptions. The recovery case covers both panes, pending refresh and animation scans, late callbacks after fallback/replacement/detach/unload, repeated teardown, pressed-state/preferences, preservation of a synthetic core-graph element, and deliberate cube playback. Constructor-failure cases still rethrow their original errors without the scheduled-failure hook. Existing successful construction and installed TrackballControls coverage remain intact.

Test limits: the composed suite bundles actual `src/main.ts`, `src/scene.ts` and graph-building code. It uses JSDOM/synthetic Obsidian helpers, host/persistence doubles, a non-delaying debounce double, controlled frame/timer/observer scheduling, and renderer/controls doubles. It verifies state, ownership, DOM overlay removal and scan invalidation; it cannot prove the real core graph is usable on screen. The separate installed-controls suite still exercises the real dependency, but no test creates a native WebGL context or runs Obsidian. A dependency that fails before returning ownership/handles, or before releasing its own resource during cleanup, retains the previously documented limits. Cleanup-error doubles release their resource before throwing. This section extends the earlier initialization-only contract, without claiming full context-loss recovery, arbitrary asynchronous-event containment, popout, physical-input or minimum-version compatibility.

Validation: `npm run qa` passes **48/48 tests**, zero-warning lint, TypeScript, production build and package checks; `git diff --check` passes. Tracked `main.js` is rebuilt from the candidate source; manifest and styles are unchanged. Independent read-only review found no blocking issue. All real-app checks above remain open. No app-access retry, installation, push, tag, release or submission occurred.

## Follow-up quality review — 2026-10-29

agent decision 2026-10-28: retain the accepted implementations and existing fault matrices because independent read-only review found no concrete regression; reconcile evidence and correct documentation against source and locked dependencies.

Reviewed `9c70e6b` → `1264ff5` against surrounding main/scene code and installed controls. Current-scene identity correctly handles a newer pending scan; all-pane 2D fallback invalidates pending loads, clears scene ownership before cleanup, and permits deliberate fresh retry. Independent cleanup and diagnostic guards agree with the composed tests. No concrete implementation regression was found.

Fresh `npm run qa` passes **48/48 tests**: ten behavior/graph, 28 existing lifecycle, three installed-controls and seven scheduled-frame cases; zero-warning lint, TypeScript, production build and package checks pass. README development instructions now match locked JSDOM 30.1.3's Node engine range (`^22.22.2 || ^24.15.0 || >=26.0.0`) and name the tested Node 24.22.0; the prior 22.13+/unspecified-24 recommendation was too broad. This corrects documentation, not the Obsidian compatibility floor.

The existing real-app checklist remains open for native WebGL/context loss, physical input, popouts and minimum-version behavior. Tests do not certify allocations/handles that never return or cleanup failures before a dependency releases itself.

Rechecked current official manifest, submission requirements, developer policies, plugin guidelines and submission instructions linked in this record. Local metadata, licensing and automated checks do not establish directory availability, minimum-version runtime compatibility or community approval. Production assets match the reviewed source and remain byte-identical to this review's starting candidate; `git diff --check` passes. No tests were added because no new implementation defect was reproduced. No app-access retry, installation, push, tag, release or submission occurred.

## Four-fix quality REVIEW — 2026-10-29

agent decision 2026-10-28: accept this bounded local REVIEW only after independent source/contract review and fresh checks; preserve live/community gates because synthetic hosts and local packaging cannot establish them.

Corrected a reproduced control-ownership defect; details and baseline replay below. The other scene, graph-building and dependency behavior remains unchanged.

Fresh `npm run qa` passed **65/65 tests**, TypeScript, production build and package checks. Configured official lint passed with zero warnings. This QA ran once for this REVIEW; standalone results across all seven are **382 tests**, plus **12 shared cases**. The preceding 365-plus-12 figure was an arithmetic intake expectation; the 17 new graph cases account for the difference.

README installation/development requirements, manifest/package/lock/root-lock/version-map agreement, licenses/notices, dependency classification and production artifacts were checked against actual configuration. Current official [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin%20guidelines), [developer policies](https://docs.obsidian.md/community-directory/developer-policies), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [manifest schema](https://docs.obsidian.md/Reference/Manifest) and [submission instructions](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) were rechecked. Declared minimums remain unverified runtime gates; local consistency is not hosted-scanner or community approval.

Existing live checklists and recovery protocols above remain their sole homes; no app-access retry, personal-vault installation, push, tag, release or submission occurred. Production JS was rebuilt for the ownership repair; CSS, dependencies and metadata are unchanged.

### Graph control ownership repair

The planning lead was reproduced before production edits. At baseline `2642013`, a connected cube concealed a removed toggle; stale cube/mode handlers could save global mode and start or stop scenes after pane removal, toolbar/wand replacement or unload. The first persisted suite failed 11/12 cases. Independent review also reproduced the detached individual mode-button case; a moved-button check caught the intermediate repair leaving that owned node outside its toggle. The final suite replay against exported original source fails **15/17**, with two unchanged/delayed-layout controls passing. Raw baseline output is [tests/evidence/control-ownership-baseline.txt](../tests/evidence/control-ownership-baseline.txt).

`Attached` now owns the exact wand, cube, toggle, two mode options and listener-removal callbacks. Reconciliation requires connected nondeferred current panes and complete direct-parent ownership. Clicks check current map/inventory/DOM identity before affecting mode or playback. Retirement invalidates ownership, removes listeners and all owned controls (including moved options), and uses existing scene cancellation/destruction. It adds no historical plugin-lifetime listener registry. Existing graph-data, scene and global-mode policy are unchanged.

The 17 new tests use actual `src/main.ts` through lifecycle callbacks, native JSDOM listeners/clicks and measured saves/scene dispatch. They cover incomplete toggles, connected replaced toolbars/wands, disconnected/deferred/out-of-inventory panes, moved controls/options, retained callbacks, independent surviving panes, delayed scans, fresh enable, duplicate delivery and 30 detach/reattach cycles with exact active listener counts. The older accessible-control fixture now supplies the real wand selector and current host inventory; its assertions are unchanged. Candidate tests all pass; the 48 prior tests also pass in QA.

Baseline replay (no checkout mutation):

```sh
graph_review_baseline=$(mktemp -d)
trap 'rm -rf "$graph_review_baseline"' EXIT
git show 2642013:src/main.ts > "$graph_review_baseline/main.ts"
git show 2642013:src/vault-graph.ts > "$graph_review_baseline/vault-graph.ts"
GRAPH_MAIN_SOURCE="$graph_review_baseline/main.ts" node --test tests/control-ownership.test.mjs
```

Expected baseline exit 1, 15 failures / 17 cases. Candidate: `node --test tests/control-ownership.test.mjs`, 17 pass. These commands do not run real Obsidian or WebGL. GraphScene, host inventory/events, icons/tooltips and vault scans are controlled doubles; scene-destroy counts establish dispatch, not native GPU release. Prior scene/dependency suites retain their separate evidence. Ownership is reconciled at delivered layout events and checked at clicks, not continuously; native event ordering, real DOM recreation/popouts and minimum-version behavior remain open in the existing real-app checklist. Include control replacement and unload/fresh-enable there when access permits.


## Pending-scan ownership — 2026-10-29

**agent decision 2026-10-28:** reuse the established current-owner predicate at scan success and failure consumption, because request/lifecycle checks alone permit stale work before layout reconciliation. Keep the guard after `await`: `attach()` starts saved-3D rendering before the attachment enters the map, and the asynchronous continuation observes the completed insertion. No initialization reordering, polling, graph-data, scene teardown, frame-failure or global-mode policy change is needed. Already issued filesystem reads are not cancelled.

Actual `src/main.ts` and `src/vault-graph.ts` run with deferred adapter reads in [tests/pending-scan-ownership.test.mjs](../tests/pending-scan-ownership.test.mjs). The initial 42-case baseline at `070f22e` failed 30 cases before production edits; the final 48-case replay fails **33/48**, with fifteen preservation controls passing. [Persisted baseline output](../tests/evidence/pending-scan-ownership-baseline.txt) includes the original source head, command, exit 1 and assertions. Candidate focused tests pass **48/48**.

The matrix changes workspace inventory, pane connectivity/deferred status, wand/toolbar identity, cube/toggle placement and individual option identity/placement while a scan is pending. It resolves or rejects before delivering layout-change. Stale success allocates/shows/plays nothing; stale rejection leaves global and persisted mode, independent healthy scenes and notices unchanged. Existing scenes cannot consume obsolete refresh/play results; layout reconciliation still retires them. Fresh ownership shows and plays normally. Controls cover immediate/delayed saved-3D startup and new panes, startup/current-owner failure and deliberate retry, 2D/unload/reconciliation, and superseded requests completing both before and after newer playback. Assertions measure actual scene dispatch counts, shape retention, saves, pressed states and original-error diagnostics.

Replay without mutating the checkout:

```sh
graph_scan_baseline=$(mktemp -d)
trap 'rm -rf "$graph_scan_baseline"' EXIT
git show 070f22e:src/main.ts > "$graph_scan_baseline/main.ts"
git show 070f22e:src/vault-graph.ts > "$graph_scan_baseline/vault-graph.ts"
GRAPH_MAIN_SOURCE="$graph_scan_baseline/main.ts" node --test tests/pending-scan-ownership.test.mjs
```

Expected baseline exit 1, 33 failures / 48 cases. Candidate: `node --test tests/pending-scan-ownership.test.mjs`.

The host double deliberately separates inventory/DOM changes from event delivery; the same-view deferred flag is a conservative synthetic scenario, not a claim about native DeferredView replacement. Installed Obsidian declarations describe immediate-or-queued layout readiness and deferred leaves (since 1.7.2); neither declarations nor these tests establish real event ordering. Native JSDOM events/DOM, actual graph building and promise continuations are exercised; GraphScene, persistence, debounce timing, host inventory and lifecycle events are doubles. Scene counts establish dispatch, not WebGL allocation/release. Earlier actual-scene/installed-controls suites retain separate evidence. Live WebGL, popout, physical-input and minimum-version gates above remain open, including saved-3D startup and ownership changes during reads. No blocked app launch was retried.

Final `npm run qa` ran once and passed **113/113 tests** (48 new plus 65 retained), zero-warning lint, TypeScript, production build and package checks. An independent read-only reviewer found no blocker and separately ran all 48 focused cases successfully. The rebuilt `main.js` exactly matches an in-memory build using the production configuration; its diff contains only the matching comment and two guards. `git diff --check` passes. Dependencies, metadata, styles and scene/graph implementations are unchanged. Nothing was installed, pushed, tagged, released or submitted.
