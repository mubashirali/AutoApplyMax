# ATS Autofill Application Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical bugs in the autofill engine and expand ATS compatibility to cover Workday, Greenhouse, Lever, Ashby, Workable, and iCIMS with high fill rates.

**Architecture:** Phase-based delivery — Phase 1 fixes showstopper bugs (ReferenceError, React form failures, hardcoded personal data) before shipping to any user; Phase 2 improves core coverage (aria-labels, radios/checkboxes, SELECT fuzzy matching); Phase 3 adds platform-specific adapters for the hardest ATSes; Phase 4 wires the existing ai-service.js into the orchestrator. Each phase ships independently and leaves the extension in a working, testable state.

**Tech Stack:** Chrome MV3 scripting API, `nativeInputValueSetter` pattern (MAIN world), `DataTransfer` API, `MutationObserver`, Dice coefficient string similarity (existing vendor lib), `chrome.storage.sync/local`.

---

## Executive Summary

AutoApplyMax v2.3.1 has a working heuristic engine but currently fails silently on every modern ATS. Three reasons:

1. `runLocalHeuristicAutofill()` throws `ReferenceError: createReportButton is not defined` at the end of every run — the autofill appears to complete but the browser's console shows the error and any post-fill cleanup is skipped.
2. `fill()` sets `input.value = x` directly, which does not trigger React's synthetic event system. Every Workday, Greenhouse, Ashby, and Workable form ignores the fill — fields look filled but submit empty.
3. The first-install pre-population overwrites every new user's profile with the developer's personal data.

Fix these three issues and the engine becomes genuinely usable on server-rendered ATS platforms (Lever, older iCIMS pages). Then the platform-specific work (Phases 2–3) lifts coverage to the modern React-based ATSes.

---

## Current Capabilities Inventory

| Capability | Status | Notes |
|---|---|---|
| Field detection (input/textarea/select) | ✅ Working | Scans DOM + same-origin iframes |
| Label extraction (parent label, label[for], prev sibling) | ⚠️ Partial | Missing aria-label, aria-labelledby, placeholder |
| Fuzzy field matching (Dice coefficient) | ✅ Working | Threshold 0.6 — slightly too low |
| Text input filling | ✅ Server-rendered | Fails silently on React inputs |
| SELECT filling | ⚠️ Partial | Exact-only option matching; no event dispatch after set |
| Radio/checkbox filling | ❌ Absent | getAllFields collects them; fill() does nothing |
| Resume upload (DataTransfer) | ✅ Working | |
| Required field highlighting | ✅ Working | |
| Confidence visualization | ✅ Working | Green/yellow/red borders |
| Multi-step form support | ❌ Absent | No MutationObserver; only fills what's visible on load |
| Custom dropdown support | ❌ Absent | div/button dropdowns invisible to engine |
| Cross-origin iframe support | ❌ Absent | Silent CORS failure in getAllFields() |
| AI-enhanced parsing | ❌ Stub | ai-service.js exists but is not called |

---

## ATS Compatibility Assessment

| ATS | Rendering | Key DOM Signals | Expected Coverage After All Phases |
|---|---|---|---|
| **Lever** | Server-rendered | Named `<input>` fields, `<label>` elements | 90%+ (Phase 1 sufficient) |
| **Greenhouse** | Server-rendered + React hydration | `data-qa` attributes, clear label structure | 85%+ (Phase 2 for aria-labels) |
| **Workday** | React SPA | `data-automation-id`, custom `div` dropdowns | 70%+ (needs Phase 3 adapter) |
| **Workable** | SSR + React | Clear `name` attributes, `<label>` elements | 80%+ (Phase 1+2 sufficient) |
| **Ashby** | React | React Select portals, `aria-label` everywhere | 75%+ (Phase 2+3 required) |
| **iCIMS** | Cross-origin iframes | `iCIMS_` CSS class prefix inside iframe | 60%+ (Phase 3 requires `all_frames` content script) |
| **LinkedIn** | Disabled in UI | content-simple.js exists but not wired | Not in scope |

---

## Gap Analysis

**Showstopper (blocks all users):**
- `createReportButton` undefined → ReferenceError after every fill
- `fill()` React incompatibility → fills appear visually but submit empty on Workday/Greenhouse/Ashby/Workable
- Hardcoded personal data overwrites every new user's profile on install

**High Impact (fixes most remaining ATS failures):**
- `aria-label` / `aria-labelledby` not used for label extraction — Ashby uses these exclusively
- Radio/checkbox not handled — all EEO questions (gender, race, veteran, disability) are never filled
- SELECT exact-only matching — "No" never matches "I do not require sponsorship"
- SELECT missing event dispatch after `element.value = x` — React SELECT elements ignore the change
- Dice coefficient threshold 0.6 is too low — "phone" matches "photo"

**ATS-Specific (needed for full coverage):**
- Workday: `data-automation-id` for field discovery; click-to-open custom dropdowns
- iCIMS: cross-origin iframe → must declare `all_frames` content script (different solution than on-demand injection)
- Ashby: React Select — must dispatch keyboard/pointer events on the portal container

**Nice to Have:**
- MutationObserver for multi-step forms (fill page 2 after page 1 submits)
- Remove dead `AutofillTrigger.js` stub from manifest
- Raise Dice threshold from 0.6 to 0.7

---

## Recommended Architecture

### Core changes (Phases 1–2)

Keep the existing 4-file engine structure. Modifications only:

```
autofill-engine/
  FormFiller.js           ← add nativeInputValueSetter, radio/checkbox fill, SELECT event dispatch
  HeuristicParser.js      ← add aria-label/aria-labelledby/placeholder extraction; raise threshold to 0.7
  AutofillOrchestrator.js ← remove createReportButton call; route radio/checkbox separately
background.js             ← remove hardcoded personal data; replace with empty strings
```

### Platform adapters (Phase 3)

Add one new file per platform. Each adapter exports a single `detect()` and `fill()` function. Orchestrator tries the platform adapter before falling back to heuristic.

```
autofill-engine/
  adapters/
    WorkdayAdapter.js     ← data-automation-id discovery, click-based custom dropdown fill
    AshbyAdapter.js       ← aria-label discovery, React Select portal interaction
```

iCIMS is different — cross-origin iframe requires a declared content script with `all_frames: true`. Add a new `content-icims.js` and declare it in `manifest.json`.

### AI integration (Phase 4)

Modify `AutofillOrchestrator.js` to call `getAiFieldAnalysis()` when `parserType === 'ai'`, use the returned field→selector map to fill fields, then fall back to heuristic for any unmapped fields.

---

## Third-Party Tools & Libraries

| Tool | Purpose | Verdict |
|---|---|---|
| `nativeInputValueSetter` pattern | React input filling | Use — built into browser, no dependency |
| `MutationObserver` | Multi-step form detection | Use — built into browser, no dependency |
| `DataTransfer` API | File input filling | Already used — keep |
| `string-similarity.js` | Fuzzy label matching | Already vendored — keep |
| Playwright/Puppeteer | Automated ATS testing | Development-only, not bundled |
| `@floating-ui` / `Popper` | Custom dropdown interaction | Not needed — click simulation is sufficient |
| OpenAI SDK | AI field analysis | Already handled by custom fetch in ai-service.js |

No new runtime dependencies. Keep the zero-dependency policy.

---

## File Map

| File | Action | Change |
|---|---|---|
| `background.js` | Modify | Replace personal data with empty strings in `prePopulateProfileData()` |
| `autofill-engine/FormFiller.js` | Modify | Add `nativeInputValueSetter` to `fill()`; add `fillRadioOrCheckbox()`; add SELECT event dispatch |
| `autofill-engine/HeuristicParser.js` | Modify | Add `aria-label`, `aria-labelledby`, `placeholder` to label extraction; raise threshold 0.6→0.7 |
| `autofill-engine/AutofillOrchestrator.js` | Modify | Remove `createReportButton` call; split radio/checkbox path; wire AI branch |
| `autofill-engine/adapters/WorkdayAdapter.js` | Create | Workday-specific field detection and custom dropdown filling |
| `autofill-engine/adapters/AshbyAdapter.js` | Create | Ashby aria-label discovery + React Select interaction |
| `content-icims.js` | Create | iCIMS cross-origin iframe autofill content script |
| `manifest.json` | Modify | Add `content-icims.js` content script; remove `AutofillTrigger.js` from web_accessible_resources; add adapters |
| `autofill-engine/AutofillTrigger.js` | Delete | Dead stub — remove file and manifest reference |

---

## Phase 1: Critical Bug Fixes

### Task 1: Fix `createReportButton` ReferenceError

**Files:**
- Modify: `autofill-engine/AutofillOrchestrator.js:56`

- [ ] **Step 1: Verify the bug**

  Open any job page, click Start Autofill, open DevTools console. Confirm:
  ```
  Uncaught ReferenceError: createReportButton is not defined
  ```

- [ ] **Step 2: Remove the call and add a log placeholder**

  In `AutofillOrchestrator.js`, replace line 56:
  ```javascript
  // Remove:
  createReportButton(allPageFields);
  
  // Replace with:
  const filledCount = allPageFields.filter(f => f.element.dataset.autofilled === 'true').length;
  const requiredUnfilled = allPageFields.filter(f => f.isRequired && !f.element.dataset.autofilled && !f.element.value).length;
  console.log(`[AutoApplyMax] Done. Filled: ${filledCount} fields. Required unfilled: ${requiredUnfilled}.`);
  ```

- [ ] **Step 3: Verify**

  Reload extension, click Start Autofill on any page, confirm no `ReferenceError` in console. Confirm summary log appears.

- [ ] **Step 4: Commit**
  ```bash
  git add autofill-engine/AutofillOrchestrator.js
  git commit -m "fix: remove undefined createReportButton call, add fill summary log"
  ```

---

### Task 2: Remove hardcoded personal data from background.js

**Files:**
- Modify: `background.js:14-34`

- [ ] **Step 1: Read the current state**

  Confirm lines 14–34 contain real name, email, address, salary, work history.

- [ ] **Step 2: Replace with empty/placeholder values**

  Replace the entire `prePopulateProfileData()` body:
  ```javascript
  async function prePopulateProfileData() {
      const syncData = {
          firstName: '', lastName: '', email: '', phone: '',
          city: '', addressLine1: '', postalCode: '', country: '',
          gender: '', disabilityStatus: '', veteranStatus: '', race: '',
          pronouns: '', isAuthorizedInUS: '', requireSponsorship: '',
          expectedSalary: '', startDate: '', skills: '',
      };
      const localData = {
          educationHistory: [],
          workHistory: [],
      };
      await chrome.storage.sync.set(syncData);
      await chrome.storage.local.set(localData);
      console.log('[AutoApplyMax] Profile initialized with empty values. Fill in your details in the extension popup.');
  }
  ```

- [ ] **Step 3: Verify**

  Load extension fresh (or clear `profilePrepopulated` from `chrome.storage.local`), confirm popup fields are empty and no personal data appears in `chrome.storage.sync`.

- [ ] **Step 4: Commit**
  ```bash
  git add background.js
  git commit -m "fix: remove hardcoded developer personal data from prePopulateProfileData"
  ```

---

### Task 3: Fix `fill()` to use `nativeInputValueSetter` for React inputs

**Files:**
- Modify: `autofill-engine/FormFiller.js:2-6`
- Modify: `background.js` — change injection world to MAIN

**Context:** React tracks input state internally via a synthetic event system. Setting `input.value = x` bypasses this, so React sees the field as empty on submit. The fix uses the native setter via `Object.getOwnPropertyDescriptor` before dispatching events. This requires the script to run in the MAIN world (not the default ISOLATED world) to access the page's React instance.

- [ ] **Step 1: Update `fill()` in FormFiller.js**

  Replace the current `fill()` function:
  ```javascript
  function fill(input, value) {
      // Use native setter to trigger React's synthetic event system.
      // Direct assignment (input.value = x) bypasses React's internal state tracker.
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      
      if (nativeSetter) {
          nativeSetter.call(input, value);
      } else {
          input.value = value; // Fallback for non-React inputs
      }
      
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  ```

- [ ] **Step 2: Switch injection world to MAIN in background.js**

  In `background.js`, in the `executeScript` call that injects the engine files, add `world: 'MAIN'`:
  ```javascript
  await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',  // Required for nativeInputValueSetter to access page's React instance
      files: [
          'autofill-engine/vendor/string-similarity.js',
          'autofill-engine/ai-service.js',
          'autofill-engine/FormFiller.js',
          'autofill-engine/HeuristicParser.js',
          'autofill-engine/AutofillOrchestrator.js'
      ],
  });
  await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',  // Must match the world where runAutofill is defined
      function: () => runAutofill(),
  });
  ```

- [ ] **Step 3: Add SELECT event dispatch to the orchestrator**

  In `AutofillOrchestrator.js`, after setting `element.value = bestOption.value` for SELECTs, add event dispatch:
  ```javascript
  if (bestOption) {
      element.value = bestOption.value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ```

- [ ] **Step 4: Verify on a React-based ATS**

  Open a Greenhouse job application (e.g., search "greenhouse.io apply" for any open role). Click Start Autofill. Check that:
  - Text inputs show the value AND React's state reflects it (try submitting — fields should not be blank)
  - No `ReferenceError` in console (Task 1 must be done first)

- [ ] **Step 5: Commit**
  ```bash
  git add autofill-engine/FormFiller.js background.js autofill-engine/AutofillOrchestrator.js
  git commit -m "fix: use nativeInputValueSetter for React input compatibility; run engine in MAIN world"
  ```

---

## Phase 2: Core Coverage Improvements

### Task 4: Expand label extraction in HeuristicParser.js

**Files:**
- Modify: `autofill-engine/HeuristicParser.js:9-45`

**Context:** Many ATS fields (especially Ashby) have no `<label>` element — they use `aria-label` or `aria-labelledby` on the input itself, or rely on `placeholder` text. Without these, `getAllFields()` returns an empty label, and only `id`/`name` scoring applies (which are often auto-generated garbage like `input_3`).

- [ ] **Step 1: Add aria-label, aria-labelledby, and placeholder extraction**

  In `HeuristicParser.js`, replace the label extraction block inside `getAllFields()`:
  ```javascript
  inputs.forEach(input => {
      let label = '';
      
      // 1. Parent <label> wrapping the input
      const parentLabel = input.closest('label');
      if (parentLabel) label = parentLabel.textContent.trim();
      
      // 2. <label for="id"> association
      if (!label && input.id) {
          const labelFor = doc.querySelector(`label[for="${input.id}"]`);
          if (labelFor) label = labelFor.textContent.trim();
      }
      
      // 3. Previous sibling <label>
      if (!label && input.previousElementSibling?.tagName === 'LABEL') {
          label = input.previousElementSibling.textContent.trim();
      }
      
      // 4. aria-label attribute (used by Ashby, some Workday fields)
      if (!label) {
          label = input.getAttribute('aria-label') || '';
      }
      
      // 5. aria-labelledby — find the element by id and use its text
      if (!label) {
          const labelledById = input.getAttribute('aria-labelledby');
          if (labelledById) {
              const labelEl = doc.getElementById(labelledById);
              if (labelEl) label = labelEl.textContent.trim();
          }
      }
      
      // 6. placeholder as last resort (often descriptive on simple forms)
      if (!label) {
          label = input.getAttribute('placeholder') || '';
      }
      
      fields.push({
          element: input,
          label: label.toLowerCase(),
          id: (input.id || '').toLowerCase(),
          name: (input.name || '').toLowerCase(),
          isRequired: isFieldRequired(input, label.toLowerCase()),
      });
  });
  ```

- [ ] **Step 2: Raise the match threshold from 0.6 to 0.7**

  In `findBestMatch()`, change the return guard:
  ```javascript
  // Change:
  if (bestMatch.score > 0.6) {
  // To:
  if (bestMatch.score > 0.7) {
  ```

  Also raise the Dice coefficient check from `> 0.85` to `> 0.80` to compensate (catches more valid fuzzy matches at the higher threshold):
  ```javascript
  else if (compareTwoStrings(field.label, keyword) > 0.80) {
  ```

- [ ] **Step 3: Verify**

  Open an Ashby job application. Before this fix, labels were empty and most fields scored only on id/name. After the fix, fields with `aria-label="First Name"` should score 0.9.

- [ ] **Step 4: Commit**
  ```bash
  git add autofill-engine/HeuristicParser.js
  git commit -m "feat: add aria-label, aria-labelledby, placeholder to label extraction; raise match threshold"
  ```

---

### Task 5: Add radio button and checkbox support

**Files:**
- Modify: `autofill-engine/FormFiller.js` — add `fillRadioOrCheckbox()`
- Modify: `autofill-engine/AutofillOrchestrator.js` — route radio/checkbox to new fill function

**Context:** EEO fields (gender, race, veteran status, disability) are almost always radio groups or checkboxes. `fill()` sets `.value` which does nothing for radios — you must find the specific `<input type="radio">` whose `value` matches the stored answer and click it (or check it).

- [ ] **Step 1: Add `fillRadioOrCheckbox()` to FormFiller.js**

  ```javascript
  function fillRadioOrCheckbox(allPageFields, groupName, value) {
      // For radio groups: find all radios with the same name, click the one matching the value
      const candidates = allPageFields.filter(f => 
          f.element.type === 'radio' && 
          (f.name === groupName || f.label.includes(groupName))
      );
      
      if (candidates.length === 0) return false;
      
      // Try exact value match first, then partial/fuzzy
      let match = candidates.find(f => 
          f.element.value.toLowerCase() === value.toLowerCase() ||
          f.label.toLowerCase() === value.toLowerCase()
      );
      
      // Fuzzy: "No" should match "I do not require sponsorship", "Not a veteran" etc.
      if (!match) {
          match = candidates.find(f => 
              f.element.value.toLowerCase().includes(value.toLowerCase()) ||
              f.label.toLowerCase().includes(value.toLowerCase())
          );
      }
      
      if (match) {
          match.element.checked = true;
          match.element.dispatchEvent(new Event('change', { bubbles: true }));
          match.element.dispatchEvent(new Event('click', { bubbles: true }));
          match.element.dataset.autofilled = 'true';
          applyConfidenceStyle(match.element, 0.9);
          return true;
      }
      
      return false;
  }
  ```

- [ ] **Step 2: Route radio/checkbox in the orchestrator**

  In `AutofillOrchestrator.js`, inside the field mapping loop, add a check before calling `fill()`:
  ```javascript
  for (const fieldName in mapping) {
      if (!mapping[fieldName]) continue;
      const value = mapping[fieldName];
      
      // Check if this field is likely a radio group
      const radioFields = allPageFields.filter(f => 
          f.element.type === 'radio' || f.element.type === 'checkbox'
      );
      const fieldKeyword = fieldName.toLowerCase();
      const radioGroupExists = radioFields.some(f => 
          f.label.includes(fieldKeyword) || f.name.includes(fieldKeyword)
      );
      
      if (radioGroupExists) {
          fillRadioOrCheckbox(allPageFields, fieldKeyword, value);
          continue; // Don't also try the text fill path
      }
      
      // ... existing text/select fill logic
  }
  ```

- [ ] **Step 3: Verify**

  Open a Greenhouse or Lever application that has EEO radio buttons (gender/veteran/disability). Set `gender: "Female"` in the popup. Click Start Autofill. Verify the "Female" radio is selected.

- [ ] **Step 4: Commit**
  ```bash
  git add autofill-engine/FormFiller.js autofill-engine/AutofillOrchestrator.js
  git commit -m "feat: add radio/checkbox filling for EEO fields"
  ```

---

### Task 6: Fix SELECT option matching with fuzzy fallback

**Files:**
- Modify: `autofill-engine/AutofillOrchestrator.js:32-42`

**Context:** Stored values like `"No"`, `"Yes"`, `"Asian"` fail to match verbose option text like `"I do not require sponsorship"`, `"Decline to self-identify"`, etc. Need: try exact → try substring → try Dice coefficient.

- [ ] **Step 1: Replace the SELECT option matching block**

  ```javascript
  if (element.tagName === 'SELECT') {
      const options = Array.from(element.options);
      const valueLower = value.toLowerCase();
      
      // 1. Exact match
      let bestOption = options.find(o => 
          o.text.toLowerCase() === valueLower || 
          o.value.toLowerCase() === valueLower
      );
      
      // 2. Substring: stored "No" matches option "No, I do not require..."
      if (!bestOption) {
          bestOption = options.find(o => 
              o.text.toLowerCase().startsWith(valueLower) ||
              o.text.toLowerCase().includes(` ${valueLower}`) ||
              o.value.toLowerCase() === valueLower
          );
      }
      
      // 3. Dice coefficient fuzzy match
      if (!bestOption && typeof compareTwoStrings === 'function') {
          let bestScore = 0;
          options.forEach(o => {
              const score = compareTwoStrings(o.text.toLowerCase(), valueLower);
              if (score > bestScore && score > 0.4) {
                  bestScore = score;
                  bestOption = o;
              }
          });
      }
      
      if (bestOption) {
          element.value = bestOption.value;
          element.dispatchEvent(new Event('change', { bubbles: true }));
          element.dispatchEvent(new Event('input', { bubbles: true }));
          applyConfidenceStyle(element, bestScore || 0.9);
          element.dataset.autofilled = 'true';
      }
  }
  ```

- [ ] **Step 2: Verify**

  On a form with a "Do you require work authorization sponsorship?" SELECT where options are `["Yes", "No, I am authorized to work", "I prefer not to answer"]`, set `requireSponsorship: "No"` in the popup. Verify the "No, I am authorized..." option is selected.

- [ ] **Step 3: Commit**
  ```bash
  git add autofill-engine/AutofillOrchestrator.js
  git commit -m "feat: fuzzy SELECT option matching — substring + Dice coefficient fallback"
  ```

---

### Task 7: Remove AutofillTrigger.js dead stub

**Files:**
- Delete: `autofill-engine/AutofillTrigger.js`
- Modify: `manifest.json` — remove from `web_accessible_resources`

- [ ] **Step 1: Remove from manifest**

  In `manifest.json`, remove `"autofill-engine/AutofillTrigger.js"` from the `web_accessible_resources` resources array. (It currently is NOT there — verify this before any edit to avoid confusion.)

  Check manifest's current resources list. If `AutofillTrigger.js` is not listed, skip manifest edit.

- [ ] **Step 2: Delete the file**
  ```bash
  rm autofill-engine/AutofillTrigger.js
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add -u
  git commit -m "chore: delete AutofillTrigger.js dead stub"
  ```

---

## Phase 3: Platform-Specific Adapters

### Task 8: Workday adapter

**Files:**
- Create: `autofill-engine/adapters/WorkdayAdapter.js`
- Modify: `autofill-engine/AutofillOrchestrator.js` — call adapter when Workday is detected
- Modify: `manifest.json` — add adapter to `web_accessible_resources`
- Modify: `background.js` — add adapter to injection list

**Context:** Workday uses `data-automation-id` attributes for every form field — this is the most reliable discovery mechanism. Custom dropdowns are `<div role="listbox">` with `<div role="option">` children. Native `<select>` doesn't exist. Clicking the "button" element opens the listbox, then you click the matching option.

- [ ] **Step 1: Create WorkdayAdapter.js**

  ```javascript
  // autofill-engine/adapters/WorkdayAdapter.js
  
  function isWorkday() {
      return !!document.querySelector('[data-automation-id]') &&
             window.location.hostname.includes('myworkdayjobs.com') ||
             window.location.hostname.includes('wd3.myworkday.com') ||
             document.querySelector('[data-automation-id="email"]') !== null;
  }
  
  function getWorkdayFields() {
      const fields = [];
      const elements = document.querySelectorAll('[data-automation-id]');
      
      elements.forEach(el => {
          const automationId = el.getAttribute('data-automation-id');
          // Only collect actual input elements and custom dropdowns
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              fields.push({
                  element: el,
                  label: automationId.toLowerCase(),
                  id: automationId.toLowerCase(),
                  name: (el.name || automationId).toLowerCase(),
                  isRequired: el.required || el.getAttribute('aria-required') === 'true',
                  isWorkday: true,
              });
          }
          // Workday custom dropdown button
          if (el.getAttribute('role') === 'combobox' || el.tagName === 'BUTTON') {
              const labelEl = el.closest('[data-automation-id]')?.previousElementSibling;
              const labelText = el.getAttribute('aria-label') || labelEl?.textContent?.trim() || automationId;
              fields.push({
                  element: el,
                  label: labelText.toLowerCase(),
                  id: automationId.toLowerCase(),
                  name: automationId.toLowerCase(),
                  isRequired: el.getAttribute('aria-required') === 'true',
                  isWorkday: true,
                  isCustomDropdown: true,
              });
          }
      });
      
      return fields;
  }
  
  async function fillWorkdayDropdown(buttonElement, value) {
      // Click to open the listbox
      buttonElement.click();
      buttonElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      
      // Wait for listbox to render (Workday uses async rendering)
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Find the matching option in the now-visible listbox
      const options = document.querySelectorAll('[role="option"]');
      let bestOption = null;
      
      Array.from(options).forEach(option => {
          const text = option.textContent.trim().toLowerCase();
          if (text === value.toLowerCase() || text.includes(value.toLowerCase())) {
              bestOption = option;
          }
      });
      
      if (bestOption) {
          bestOption.click();
          return true;
      }
      
      // Close dropdown if no match found
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
  }
  ```

- [ ] **Step 2: Wire into AutofillOrchestrator.js**

  At the top of `runAutofill()`, check for Workday:
  ```javascript
  async function runAutofill() {
      const config = await chrome.storage.sync.get('parserType');
      const parserType = config.parserType || 'local';
      
      // Platform-specific adapters take priority over heuristic
      if (typeof isWorkday === 'function' && isWorkday()) {
          console.log('[AutoApplyMax] Detected Workday ATS. Using Workday adapter.');
          await runWorkdayAutofill();
          return;
      }
      
      if (parserType === 'ai') {
          // ... AI branch
      } else {
          await runLocalHeuristicAutofill();
      }
  }
  
  async function runWorkdayAutofill() {
      const userData = await loadUserData();
      const mapping = createFieldMapping(userData);
      const allFields = getWorkdayFields(); // From WorkdayAdapter.js
      
      for (const fieldName in mapping) {
          if (!mapping[fieldName]) continue;
          const value = mapping[fieldName];
          const match = findBestMatch(fieldName, allFields);
          if (!match) continue;
          
          const field = match.field;
          if (field.isCustomDropdown) {
              await fillWorkdayDropdown(field.element, value);
          } else {
              fill(field.element, value);
          }
          applyConfidenceStyle(field.element, match.score);
          field.element.dataset.autofilled = 'true';
      }
      
      await handleResumeUpload(allFields);
      highlightRequiredFields(allFields);
      const filled = allFields.filter(f => f.element.dataset.autofilled).length;
      console.log(`[AutoApplyMax] Workday fill complete. ${filled} fields filled.`);
  }
  ```

- [ ] **Step 3: Add to manifest and background.js injection list**

  In `background.js`, add `'autofill-engine/adapters/WorkdayAdapter.js'` to the files array (before `AutofillOrchestrator.js`).

  In `manifest.json` `web_accessible_resources`, add `"autofill-engine/adapters/WorkdayAdapter.js"`.

- [ ] **Step 4: Verify**

  Open a Workday job application (e.g., search "site:myworkdayjobs.com apply now"). Click Start Autofill. Verify that text fields fill and dropdowns open and select.

- [ ] **Step 5: Commit**
  ```bash
  git add autofill-engine/adapters/WorkdayAdapter.js autofill-engine/AutofillOrchestrator.js background.js manifest.json
  git commit -m "feat: add Workday adapter with data-automation-id discovery and custom dropdown filling"
  ```

---

### Task 9: iCIMS cross-origin iframe support

**Files:**
- Create: `content-icims.js`
- Modify: `manifest.json` — declare as content script with `all_frames: true`

**Context:** iCIMS embeds the application form in a cross-origin iframe (`*.icims.com`). `getAllFields()` catches this iframe but `iframe.contentDocument` throws a CORS exception — so the try/catch in HeuristicParser silently swallows it. The solution is a separately declared content script that runs inside the iframe, matching the iframe's origin pattern.

- [ ] **Step 1: Create content-icims.js**

  ```javascript
  // content-icims.js — runs inside iCIMS iframes on *.icims.com
  // Receives profile data from the parent page's extension context.
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action !== 'autofillIcims') return;
      
      const userData = message.userData;
      if (!userData) return;
      
      // iCIMS uses iCIMS_ prefix on most field names
      const icimsMappings = {
          'iCIMS_Email':      userData.email,
          'iCIMS_FirstName':  userData.firstName,
          'iCIMS_LastName':   userData.lastName,
          'iCIMS_Phone':      userData.phone,
          'iCIMS_City':       userData.city,
          'iCIMS_ZipCode':    userData.postalCode,
          'iCIMS_Country':    userData.country,
      };
      
      let filled = 0;
      for (const fieldId in icimsMappings) {
          const el = document.getElementById(fieldId) || document.querySelector(`[name="${fieldId}"]`);
          if (el && icimsMappings[fieldId]) {
              el.value = icimsMappings[fieldId];
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.style.border = '2px solid #28a745';
              filled++;
          }
      }
      
      sendResponse({ success: true, filledCount: filled });
  });
  ```

- [ ] **Step 2: Declare in manifest.json**

  Add to `manifest.json`:
  ```json
  "content_scripts": [
      {
          "matches": ["*://*.icims.com/*"],
          "js": ["content-icims.js"],
          "all_frames": true,
          "run_at": "document_idle"
      }
  ]
  ```

- [ ] **Step 3: Send message from orchestrator when iCIMS iframe is detected**

  In `AutofillOrchestrator.js`, inside `runLocalHeuristicAutofill()`, after the main fill loop:
  ```javascript
  // Check for iCIMS cross-origin iframes and send autofill message
  const icimFrames = document.querySelectorAll('iframe[src*="icims.com"]');
  if (icimFrames.length > 0) {
      const userData = await loadUserData();
      // The content script in the iframe will handle the fill
      chrome.runtime.sendMessage({ action: 'autofillIcims', userData });
      console.log('[AutoApplyMax] Sent autofill message to iCIMS iframe content script.');
  }
  ```

  **Note:** The orchestrator runs in MAIN world of the parent page. Sending `chrome.runtime.sendMessage` from MAIN world requires the content script to be listening. The message goes to all content scripts in the tab matching `*.icims.com`. This is the correct pattern for cross-origin frame communication.

- [ ] **Step 4: Verify**

  Open a job posting on a company site that embeds iCIMS. Verify the fields inside the iframe are filled.

- [ ] **Step 5: Commit**
  ```bash
  git add content-icims.js manifest.json autofill-engine/AutofillOrchestrator.js
  git commit -m "feat: add iCIMS cross-origin iframe autofill via declared content script"
  ```

---

## Phase 4: AI Integration

### Task 10: Wire ai-service.js into the orchestrator

**Files:**
- Modify: `autofill-engine/AutofillOrchestrator.js:6-12` (the empty AI branch)

**Context:** `getAiFieldAnalysis(pageContent)` in `ai-service.js` sends the full page HTML to a configurable AI endpoint and expects a JSON response mapping field selectors to values. The AI branch currently logs a message and exits — it needs to call the function, parse the response, and fill using the returned mapping.

- [ ] **Step 1: Implement the AI branch**

  Replace the empty AI block in `runAutofill()`:
  ```javascript
  if (parserType === 'ai') {
      console.log('[AutoApplyMax] Using AI Enhanced parser.');
      const userData = await loadUserData();
      const mapping = createFieldMapping(userData);
      
      try {
          const pageContent = document.documentElement.outerHTML;
          const aiResult = await getAiFieldAnalysis(pageContent, mapping);
          
          if (aiResult && aiResult.fields) {
              for (const { selector, value } of aiResult.fields) {
                  const el = document.querySelector(selector);
                  if (!el) continue;
                  
                  if (el.tagName === 'SELECT') {
                      const option = Array.from(el.options).find(o => 
                          o.text.toLowerCase() === value.toLowerCase()
                      );
                      if (option) {
                          el.value = option.value;
                          el.dispatchEvent(new Event('change', { bubbles: true }));
                      }
                  } else if (el.type === 'radio' || el.type === 'checkbox') {
                      el.checked = value === 'true' || el.value.toLowerCase() === value.toLowerCase();
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                  } else {
                      fill(el, value);
                  }
                  el.dataset.autofilled = 'true';
                  applyConfidenceStyle(el, 0.95);
              }
          }
      } catch (err) {
          console.error('[AutoApplyMax] AI analysis failed, falling back to heuristic:', err);
          await runLocalHeuristicAutofill();
      }
  }
  ```

- [ ] **Step 2: Update getAiFieldAnalysis to accept mapping**

  In `ai-service.js`, update the function signature and prompt to include the user's profile mapping so the AI can fill values directly:
  ```javascript
  async function getAiFieldAnalysis(pageContent, userMapping) {
      // ... existing config loading ...
      const prompt = `You are an ATS form autofill assistant. Given this page HTML and user profile, 
  return a JSON array of { selector, value } pairs for each fillable field.
  
  User profile: ${JSON.stringify(userMapping)}
  
  Return ONLY valid JSON: { "fields": [{ "selector": "CSS_SELECTOR", "value": "VALUE" }] }
  Do not include fields with no matching profile data.`;
      
      // ... rest of existing fetch logic ...
  }
  ```

- [ ] **Step 3: Verify**

  Configure an OpenAI API key in the extension popup's AI settings. Set parser type to "AI". Open a job application. Verify autofill runs and fills fields using AI-returned selectors.

- [ ] **Step 4: Commit**
  ```bash
  git add autofill-engine/AutofillOrchestrator.js autofill-engine/ai-service.js
  git commit -m "feat: wire AI parser branch — call getAiFieldAnalysis and fill from selector map"
  ```

---

## Implementation Roadmap

| Phase | Tasks | Priority | Blocks |
|---|---|---|---|
| **Phase 1** | Tasks 1–3 | 🔴 Ship immediately | Every user is affected |
| **Phase 2** | Tasks 4–7 | 🟡 Next sprint | Greenhouse, Lever, Workable coverage |
| **Phase 3a** | Task 8 (Workday) | 🟡 High | Workday is the most common ATS |
| **Phase 3b** | Task 9 (iCIMS) | 🟠 Medium | iCIMS used by large enterprises |
| **Phase 4** | Task 10 (AI) | 🟢 When Phase 1–2 are done | Power users; optional feature |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| MAIN world injection breaks CSP on some pages | High — extension silently fails | Test on CSP-strict pages (Google Careers, Meta). Add per-site CSP exception if needed. |
| Workday DOM changes in updates | Medium — adapter breaks | Scope `data-automation-id` selectors broadly; add fallback to heuristic parser |
| AI API key exposed in storage | Medium — user privacy | `chrome.storage.sync` is encrypted at rest; key never leaves the browser. Document this. |
| `setTimeout(300)` in Workday adapter too short on slow connections | Low — dropdown doesn't open in time | Use MutationObserver instead of fixed delay for production version |
| iCIMS content script breaks on iCIMS admin/recruiter pages | Low — wrong page autofilled | Scope `matches` to `"*://*.icims.com/jobs/*"` rather than all iCIMS pages |
| `nativeInputValueSetter` undefined in non-Chromium browsers | Low — extension is Chrome-only | Already Chrome MV3; safe assumption |

---

## Testing Checklist

After Phase 1:
- [ ] Greenhouse: Fill name, email, phone on any open role → fields submit with correct values
- [ ] Lever: Fill name, email, phone → same
- [ ] Console: No `ReferenceError` after Start Autofill
- [ ] New install: Profile is empty (no developer personal data)

After Phase 2:
- [ ] Greenhouse EEO section: Gender/race/veteran radio buttons fill correctly
- [ ] Any ATS with aria-label fields: Fields with `aria-label="First name"` match and fill
- [ ] SELECT with verbose options: "No" maps to "No, I do not require sponsorship"

After Phase 3:
- [ ] Workday: Text fields and custom dropdowns fill on a real Workday posting
- [ ] iCIMS: Fields inside the cross-origin iframe are filled

After Phase 4:
- [ ] AI mode: Configure key → open Greenhouse → verify AI-suggested selectors are used
- [ ] AI fallback: Kill the AI endpoint → verify heuristic fills as fallback
