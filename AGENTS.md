# AutoApplyMax — Agent Context

## What this is

Chrome MV3 extension that autofills job application forms across any ATS platform. The user manually navigates to a job posting and clicks **Start Autofill** — the extension detects form fields, maps them to the user's stored profile, fills them, and highlights anything it couldn't fill so the user can review before submitting.

**This is NOT a bot.** The LinkedIn auto-apply bot (`content-simple.js`) is still present in the repo but is not wired to the UI. The product's primary feature is ATS autofill.

No backend. No build step. No bundler. All data stays local in Chrome storage. Open-source (AGPL-3.0).

---

## File Map

| File | Role |
|---|---|
| `manifest.json` | MV3 permissions and entry points. `<all_urls>` host permission. `content_scripts` declares `content-icims.js` for iCIMS iframes. Version `3.0.0`. |
| `background.js` | Service worker. Seeds `profileMarkdown` from `profile-default.md` on install. Handles `injectAutofillScripts` (injects engine into active tab) and `triggerIcimsAutofill` (broadcasts to iCIMS content script). |
| `popup.html` | Extension popup. "Start Autofill" button + tabs: Settings, Personal, EEO, Profile, History. No module system — scripts via `<script>` tags. |
| `popup.css` | Popup styling. |
| `popup.js` | Popup UI logic. Loads/saves profile from storage. Triggers autofill via `injectAutofillScripts` message to background. |
| `profile-default.md` | Default markdown resume template seeded into `profileMarkdown` on first install. |
| `content-icims.js` | Content script auto-injected into `*.icims.com` iframes. Listens for `autofillIcims` message and fills iCIMS-specific field IDs. |
| `autofill-engine/vendor/string-similarity.js` | Dice-coefficient string similarity (`compareTwoStrings`). Self-contained. |
| `autofill-engine/FormFiller.js` | `fill()` (nativeInputValueSetter for React), `fillSelect()` (fuzzy option matching), `fillRadioOrCheckbox()`, `applyConfidenceStyle()`, `base64ToFile()`, `fillFileInput()`. |
| `autofill-engine/HeuristicParser.js` | `getAllFields()` — 6-tier label extraction. `findBestMatch()` — scores fields by label/id/name + Dice coefficient. |
| `autofill-engine/ReportPanel.js` | `showReportPanel()` — floating panel showing fill progress (required vs optional fields). |
| `autofill-engine/adapters/WorkdayAdapter.js` | `isWorkday()`, `getWorkdayFields()`, `fillWorkdayDropdown()`, `runWorkdayAutofill()`. Handles `data-automation-id` fields and click-based custom dropdowns. |
| `autofill-engine/AutofillOrchestrator.js` | Entry point: `runAutofill()` routes to Workday adapter or heuristic/AI fill. |
| `autofill-engine/ai-service.js` | `getAiFieldAnalysis(fieldManifest, userMapping, workHistory, educationHistory)` — calls OpenAI-compatible endpoint. `buildProfileMarkdown()`, `extractJson()`. |
| `content-simple.js` | Old LinkedIn Easy Apply bot (~2000 lines). Not wired to UI. Dead code kept for reference. |

---

## Dev Setup

1. `chrome://extensions` → Developer Mode → Load Unpacked → select repo root.
2. After editing any file: click the reload icon in `chrome://extensions`, then reload the active tab.
3. Engine logs appear in the **active tab's DevTools console** under `[AutoApplyMax]` prefix.
4. Popup logs appear in the popup's own DevTools (right-click popup → Inspect).

---

## Autofill Flow

```
User clicks "Start Autofill" in popup
  → popup.js sends `injectAutofillScripts` to background
  → background.js injects in order:
      1. vendor/string-similarity.js
      2. ai-service.js
      3. FormFiller.js
      4. HeuristicParser.js
      5. ReportPanel.js
      6. adapters/WorkdayAdapter.js
      7. AutofillOrchestrator.js
  → background.js calls runAutofill() in tab context
  → runAutofill():
      - if Workday detected → runWorkdayAutofill()
      - else if parserType='ai' → runAiAutofill()
      - else → runLocalHeuristicAutofill()
  → runLocalHeuristicAutofill():
      1. loadUserData() — reads profile from chrome.storage.sync
      2. getAllFields() — scans DOM + same-origin iframes
      3. createFieldMapping() — maps profile keys to values
      4. runHeuristicFill() — scores and fills fields
      5. handleResumeUpload() — uploads resume from storage
      6. triggerIcimsAutofill message → background → iCIMS content script
      7. highlightRequiredFields() — red border on unfilled required fields
      8. showReportPanel() — floating checklist panel
  → runAiAutofill():
      1. Same heuristic first pass
      2. buildFieldManifest() — collects unfilled fields with index/label/options
      3. getAiFieldAnalysis() — sends manifest to AI, gets index-based fill values
      4. Applies AI results
      5. Resume upload + highlight + report panel
```

---

## Profile Data Model

**`chrome.storage.sync`** (text fields, 8KB/item limit):

| Key | Purpose |
|---|---|
| `firstName`, `lastName` | Name |
| `email`, `phone` | Contact |
| `addressLine1`, `city`, `postalCode`, `country` | Address |
| `skills` | Comma-separated skills string |
| `gender`, `race`, `veteranStatus`, `disabilityStatus`, `pronouns` | EEO fields |
| `expectedSalary`, `startDate` | Preferences |
| `isAuthorizedInUS`, `requireSponsorship` | Work authorization |
| `parserType` | `'local'` or `'ai'` |
| `aiProviderUrl`, `aiApiKey`, `aiModel` | AI provider config |

**`chrome.storage.local`** (large data):

| Key | Purpose |
|---|---|
| `resumeFile` | Resume as base64 data URL |
| `resumeFileName`, `resumeFileType` | Resume metadata |
| `workHistory` | Array of `{ company, title, startDate, endDate, isCurrent, description }` |
| `educationHistory` | Array of `{ school, degree }` |
| `profileMarkdown` | Markdown resume context for AI engine |
| `profileMarkdownSeeded` | Flag: prevents re-seeding from profile-default.md |
| `profilePrepopulated` | Flag: prevents re-running structured field init on updates |

---

## Field Matching

`findBestMatch(fieldName, allPageFields)`:
- **1.0** — exact match on `field.id` or `field.name`
- **0.9** — exact match on `field.label`
- **0.85** — Dice coefficient > 0.80 on label
- **0.75** — word-boundary match in combined label+id+name
- **0.6** — substring match (below threshold, not returned)

Returns `null` if best score ≤ 0.7. Fields already autofilled (`.dataset.autofilled = 'true'`) are skipped.

`getAllFields()` 6-tier label extraction:
1. Parent `<label>` wrapping the input
2. `<label for="id">` association
3. Previous sibling `<label>`
4. `aria-label` attribute
5. `aria-labelledby` — resolves referenced element text
6. `placeholder` attribute
7. Walk up ancestors for preceding label-like text (covers card-style layouts)

---

## Architecture Decisions

### Why ISOLATED world (not MAIN)

Engine files are injected via `chrome.scripting.executeScript` without `world: 'MAIN'`. ISOLATED world has access to `chrome.*` APIs (storage, runtime). `nativeInputValueSetter` works from ISOLATED world because DOM elements are shared — the isolated prototype setter bypasses React's instance-level value override just as effectively, and DOM events bubble to MAIN world React listeners.

### Why `<all_urls>` host permission

The extension needs to inject into any job application page — Workday, Greenhouse, Lever, Ashby, Workable, custom career pages — all on different domains.

### Why scripts are injected on demand

Scripts are only injected when the user clicks Start Autofill. Declaring them in `manifest.json` content_scripts would auto-inject on every page load, which is unnecessary and intrusive.

### Why storage is split between sync and local

`chrome.storage.sync` has an 8KB per-item quota. Text profile fields fit. Resume (up to 5MB), work history, education, and profile markdown are too large — they go to `local`.

---

## Common Pitfalls

- **React inputs**: `fill()` uses `nativeInputValueSetter` + events. Direct `input.value = x` bypasses React's internal state.
- **Workday**: Always goes through the Workday adapter, not the heuristic engine. `isWorkday()` checks for Workday hostnames and `data-automation-id` presence.
- **iCIMS**: The `content-icims.js` content script is auto-injected by Chrome into iCIMS iframes. The orchestrator sends a message that background forwards to it — no direct frame access needed.
- **Cross-origin iframes**: `getAllFields()` tries `iframe.contentDocument` — silently fails for cross-origin iframes. Only iCIMS is supported via the dedicated content script.
- **String similarity threshold**: Threshold is 0.7. Below that, no match is returned even if a field looks related.
- **`profileMarkdownSeeded` flag**: Set after first seeding from `profile-default.md`. Clear from `chrome.storage.local` to re-trigger seeding on the next extension reload.
- **`parser-type` vs `parserType`**: The select element ID in popup.html is `parserType` (matches the storage key). Don't rename it to `parser-type` — the save loop uses `getElementById(key)` to find elements.
