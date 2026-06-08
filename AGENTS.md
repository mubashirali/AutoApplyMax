# AutoApplyMax — Claude Context

## What this is

Chrome MV3 extension that automates LinkedIn Easy Apply job applications. No backend, no build step, no bundler. All data stays local in Chrome storage. The extension is open-source (AGPL-3.0); a paid Chrome Web Store version with AI features exists separately.

---

## File Map

| File | Role |
|---|---|
| `manifest.json` | Permissions, entry points. LinkedIn-only host permission (`https://www.linkedin.com/*`). Declares version `1.5.3`. |
| `background.js` | Service worker. Initializes storage on install. Has three message handlers (`incrementCount`, `incrementSkippedCount`, `setRunning`) — but see note below. |
| `popup.html` | Extension popup shell. Loads scripts via `<script>` tags — no module system. |
| `popup.css` | Popup styling. LinkedIn blue (#0a66c2) design system, 8px grid. |
| `popup-improvements.js` | Toast notifications, field validation, first-run onboarding modal. **Must be loaded before `popup.js`**; exposes functions via `window.*`. |
| `popup.js` | Popup UI logic. Reads/writes Chrome storage, injects content script, sends messages to bot, listens for messages from content script. |
| `content-simple.js` | The entire bot engine (~2000 lines). Injected on demand when user clicks Start. Never loaded passively. |

**Note on `background.js` message handlers:** The `incrementCount` and `incrementSkippedCount` handlers in `background.js` are dead code. The content script never sends those message types. Counter updates go directly to `chrome.storage.local` and directly to the popup via `chrome.runtime.sendMessage`. The background's `setRunning` handler is the only one still used.

**Note on version strings:** Version numbers are not synchronized across files. `manifest.json` is the authoritative version. `background.js` logs `v1.3.1` on install, `content-simple.js` logs `v1.5.0` in its startup banner. Do not use these strings to identify what version is running — they lag behind.

---

## Dev Setup

1. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select the repo root.
2. After editing **popup files**: click the reload icon on the extension card in `chrome://extensions`.
3. After editing **`content-simple.js`**: reload the extension AND reload the LinkedIn tab (the old injected script lives in the tab until the tab reloads).
4. Bot logs appear in the **LinkedIn tab's DevTools console** (not the popup console) under the `[LinkedIn Bot]` prefix.
5. Popup logs appear in the popup's own DevTools (right-click the popup → Inspect).

---

## Business Logic

### Bot decision flow (`mainLoop()` in `content-simple.js`)

```
while running:
  1. Check daily limit → auto-stop + alert if hit
  2. Check stuck (no activity > 2 min) → refresh page and continue
  3. Find job cards: li[data-occludable-job-id]
  4. For each card:
     a. Filter by blacklist keywords → skip if matched
     b. Filter by years required vs user's maxYearsRequired → skip if over
        (reads job card DOM only — title + metadata chip, NOT the full job detail panel)
     c. Click job link → wait for detail panel
     d. Dismiss "Job search safety reminder" modal if present (LinkedIn may show this)
     e. Click "Easy Apply" button
     f. Fill multi-step modal (up to 10 steps)
     g. Submit → find and click Done button
  5. Go to next page (pagination or infinite scroll depending on page type)
```

**`autoNextPage` config field:** This field is shown in the popup Settings tab and saved to sync storage, but the content script does not read it. `mainLoop()` always attempts pagination unconditionally. The field is currently a no-op in the bot engine.

### Message channels

The content script communicates directly with the popup — it does not route through the background:

| Message type | Direction | Purpose |
|---|---|---|
| `start` / `stop` | popup → content | Start/stop the bot |
| `resetCounters` / `clearAppliedJobs` | popup → content | Data management |
| `botStarted` / `botStopped` | content → popup | Update UI state |
| `updateCount` / `updateSkippedCount` | content → popup | Update live counters |

### LinkedIn Easy Apply — form types handled

| Form type | How it's handled |
|---|---|
| Text inputs | `fill()` — sets `.value` then fires `input` + `change` events (required for React/Vue to register the value) |
| File input (resume) | `DataTransfer` API to set `files` property; uploads once on first application, then selects existing CV |
| Checkboxes | Auto-checked (consent/terms boxes) |
| Radio buttons | Answered from user config: visa sponsorship, work auth, relocation, driver's license |
| Custom dropdowns | LinkedIn non-native dropdowns require focus → open → select; `.value` assignment alone does not work |
| Language proficiency | Detected by label text, set to a sane default |

### Page modes

| Mode | URL pattern | Pagination |
|---|---|---|
| Search | `/jobs/search/` | Page numbers + Next button |
| Collections | `/jobs/collections/` | Infinite scroll; fallback selectors apply only here |

Collections mode uses `.jobs-search-results__list-item, .scaffold-layout__list-item` as fallbacks when `li[data-occludable-job-id]` returns nothing. These fallbacks are **collections-only** — do not apply them to search pages.

### Job filtering

- **Blacklist**: comma-separated keywords matched case-insensitively against job title + company name. Any match → skip.
- **Experience filter**: extracts years from the job card's title element (`.job-card-list__title`) and metadata chip (`.job-card-container__metadata-item`) using multilingual regex (EN/FR/ES/DE/IT). Runs on the card in the list **before the job is opened** — it does not have access to the full job description. If LinkedIn moves years-required data out of the card metadata, this filter silently stops working. If no years found → do not skip.
- **Daily limit**: scans `document.body.innerText` + LinkedIn error elements for known limit strings. On detection: alert the user, stop the bot.

### Storage keys

| Key | Storage area | Written by | Purpose |
|---|---|---|---|
| `firstName`, `lastName`, `email`, `phone`, `phoneCountryCode`, `city`, `yearsOfExperience`, `maxYearsRequired`, `blacklistKeywords`, `autoNextPage`, `expectedSalary`, `visaSponsorship`, `legallyAuthorized`, `willingToRelocate`, `driversLicense` | sync | popup.js | User config (shared across Chrome profiles) |
| `resumeFile` | local | popup.js | Resume as base64 data URL (up to 5MB) |
| `resumeFileName` | local | popup.js | Original filename for display |
| `resumeFileType` | local | popup.js | MIME type; used by `base64ToFile()` to reconstruct the File object |
| `appliedCount`, `skippedCount` | local | content-simple.js | Session counters |
| `appliedJobs` | local | content-simple.js | Array of applied job objects |
| `isRunning` | local | both | Bot state flag (written by both; content script clears it on load) |
| `onboardingCompleted` | local | popup-improvements.js | First-run flag |

---

## Architecture Decisions

### Why `content-simple.js` is one ~2000-line file

MV3 content scripts don't support ES modules without a bundler. This project has no build step — files are loaded directly as unpacked. Splitting would require introducing a bundler (webpack, esbuild, etc.), which is a deliberate infrastructure decision, not a casual refactor. Add logic to this file. Do not introduce a bundler without an explicit decision.

### Why the content script is injected on demand, not in `manifest.json`

Declaring it in the manifest would auto-inject it on every LinkedIn page load, running passively before the user acts. Instead, `popup.js` calls `chrome.scripting.executeScript()` only when the user clicks Start. **This is a hard security requirement** — the bot must never act without explicit user intent.

### Why `fill()` and `click()` have dual security guards

Two flags protect every automated action:
- `isRunning` — can be set by storage
- `userExplicitlyClickedStart` — **only** set in the `start` message handler, cannot be set by storage manipulation or a race

If either flag is false, `fill()`/`click()` log a security violation and return early without acting. This exists because content scripts on LinkedIn have access to real form fields and real Apply buttons — an accidental automated click is not recoverable.

### Why `discardApplication()` mixes direct `btn.click()` and the guarded `click()`

`discardApplication()` uses **direct** `btn.click()` for the modal dismiss button (the X / Close button) because discard is cleanup — `isRunning` may already be false when it runs. However, other buttons within the same discard flow (e.g. "Continue applying" on LinkedIn's safety reminder modal) go through the guarded `click()`. Rule: any path that requires `isRunning=true` must use the guarded `click()`; cleanup/abort buttons that need to work even after Stop use direct `btn.click()`.

### Why storage is split between `sync` and `local`

`chrome.storage.sync` has an 8KB per-item limit and 100KB total — sufficient for text config (name, email, settings). The resume file can be up to 5MB and cannot fit in sync. Rule: **config → sync** (persists across Chrome profiles), **resume + counters + applied jobs → local**.

### Why `popup-improvements.js` exposes functions via `window.*`

No module system in the popup. `popup-improvements.js` is loaded before `popup.js` via `<script>` tags in `popup.html`. The full export list: `window.showToast`, `window.validateField`, `window.validateAllFields`, `window.setupValidation`, `window.checkOnboarding`. Load order in `popup.html` matters — do not reorder these `<script>` tags.

### Why `background.js` is minimal

MV3 service workers are ephemeral — they terminate when idle and cannot hold long-running state. The background worker only initializes storage on install. All stateful bot logic lives in the content script, which runs in the tab context and stays alive as long as the tab is open. Counter updates and UI state messages go directly between the content script and popup, bypassing the background entirely.

---

## Common Pitfalls

- **Selector changes**: LinkedIn updates its DOM frequently. If the bot stops finding job cards or buttons, first check whether `li[data-occludable-job-id]`, `.artdeco-button`, or modal selectors have changed.
- **Custom dropdowns**: LinkedIn's dropdowns are not native `<select>` elements. Setting `.value` directly will not work — the UI won't update and the value won't register. Always use the focus/open/click sequence.
- **`fill()` without events**: Setting `input.value` alone is not enough on React-rendered fields. `fill()` must fire `input` and `change` events or the form framework ignores the value.
- **Double-injection**: If the content script is injected twice (user clicks Start on an already-running tab), the IIFE at the bottom of `content-simple.js` resets `isRunning=false` and `userExplicitlyClickedStart=false`. The popup UI may still show "Running" (it received `botStarted` from the first injection and has not been cleared). The bot does **not** auto-restart — the user must click Start again.
- **Resume upload**: `DataTransfer` API for setting file inputs is not universally supported. If LinkedIn changes how their file input works, `fillFileInput()` is the place to look.
- **`autoNextPage` is a no-op**: The setting is saved and loaded in the popup but not read by the content script. Do not assume it controls pagination.
