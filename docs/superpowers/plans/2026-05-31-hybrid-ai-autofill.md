# Hybrid AI Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw HTML sending in AI mode with a compact indexed field manifest — run heuristic fill first, then send only unfilled/low-confidence fields to AI.

**Architecture:** `runAiAutofill()` now runs heuristic fill first via a shared `runHeuristicFill()` helper, builds a compact JSON manifest of remaining fields (label + type + options), sends that to AI, and applies results back by array index. No CSS selectors. No raw HTML.

**Tech Stack:** Vanilla JS, Chrome MV3, OpenAI-compatible API

---

## File Map

| File | Change |
|---|---|
| `autofill-engine/AutofillOrchestrator.js` | Extract `runHeuristicFill()`, add `buildFieldManifest()`, rewrite `runAiAutofill()` |
| `autofill-engine/FormFiller.js` | Store autofill score on `dataset.autofillScore` in `applyConfidenceStyle()` |
| `autofill-engine/ai-service.js` | Replace `pageContent` param with `fieldManifest`; rewrite prompt |

---

### Task 1: Store confidence score on filled elements

**Files:**
- Modify: `autofill-engine/FormFiller.js:97-103`

- [ ] Add `element.dataset.autofillScore = String(score)` inside `applyConfidenceStyle()` so later code can read what confidence each fill had.

```js
function applyConfidenceStyle(element, score) {
    element.dataset.autofillScore = String(score);
    if (score > 0.9) {
        element.style.border = '2px solid #28a745';
    } else {
        element.style.border = '2px solid #ffc107';
    }
}
```

- [ ] Commit: `git commit -m "feat: store autofill confidence score on dataset"`

---

### Task 2: Extract `runHeuristicFill()` from `runLocalHeuristicAutofill()`

**Files:**
- Modify: `autofill-engine/AutofillOrchestrator.js`

- [ ] Extract the field-filling loop from `runLocalHeuristicAutofill()` into a standalone `runHeuristicFill(allPageFields, mapping)` function. `runLocalHeuristicAutofill()` calls it. No behavior change.

```js
// New shared helper — fills fields using heuristic, returns nothing
function runHeuristicFill(allPageFields, mapping) {
    for (const fieldName in mapping) {
        if (!mapping[fieldName]) continue;
        const value = mapping[fieldName];
        const fieldKeyword = fieldName.toLowerCase();

        const hasRadioGroup = allPageFields.some(f =>
            (f.element.type === 'radio' || f.element.type === 'checkbox') &&
            (f.name.includes(fieldKeyword) || f.label.includes(fieldKeyword) || f.id.includes(fieldKeyword))
        );

        if (hasRadioGroup) {
            fillRadioOrCheckbox(allPageFields, fieldKeyword, value);
            continue;
        }

        const match = findBestMatch(fieldName, allPageFields);
        if (match?.field?.element) {
            const element = match.field.element;
            if (element.tagName === 'SELECT') {
                fillSelect(element, value);
            } else {
                fill(element, value);
            }
            applyConfidenceStyle(element, match.score);
            element.dataset.autofilled = 'true';
        }
    }
}

// Updated — delegates to shared helper
async function runLocalHeuristicAutofill() {
    const userData = await loadUserData();
    const allPageFields = getAllFields();
    console.log(`[AutoApplyMax] Local parser found ${allPageFields.length} fields.`);
    const mapping = createFieldMapping(userData);

    runHeuristicFill(allPageFields, mapping);

    await handleResumeUpload(allPageFields);

    const icimsFrames = document.querySelectorAll('iframe[src*="icims.com"]');
    if (icimsFrames.length > 0) {
        chrome.runtime.sendMessage({ action: 'autofillIcims', userData });
        console.log('[AutoApplyMax] Sent autofill message to iCIMS iframe content script.');
    }

    highlightRequiredFields(allPageFields);
    const filledCount = allPageFields.filter(f => f.element.dataset.autofilled === 'true').length;
    const requiredUnfilled = allPageFields.filter(f => f.isRequired && !f.element.dataset.autofilled && !f.element.value).length;
    console.log(`[AutoApplyMax] Done. Filled: ${filledCount} fields. Required unfilled: ${requiredUnfilled}.`);
}
```

- [ ] Commit: `git commit -m "refactor: extract runHeuristicFill() shared helper"`

---

### Task 3: Add `buildFieldManifest()` to AutofillOrchestrator.js

**Files:**
- Modify: `autofill-engine/AutofillOrchestrator.js`

- [ ] Add `buildFieldManifest(allPageFields)` that produces a compact array of only the fields the AI needs to handle:

```js
// Returns compact manifest of unfilled or low-confidence fields for AI
function buildFieldManifest(allPageFields) {
    const CONFIDENCE_THRESHOLD = 0.85;
    const manifest = [];

    allPageFields.forEach((field, i) => {
        const el = field.element;
        if (el.type === 'file' || el.type === 'hidden') return;

        const score = parseFloat(el.dataset.autofillScore || '0');
        const filled = el.dataset.autofilled === 'true';
        if (filled && score >= CONFIDENCE_THRESHOLD) return;

        const entry = {
            i,
            label: field.label || field.id || field.name || '',
            type: el.tagName === 'SELECT' ? 'select'
                : el.tagName === 'TEXTAREA' ? 'textarea'
                : (el.type || 'text'),
        };

        if (el.tagName === 'SELECT') {
            entry.options = Array.from(el.options)
                .map(o => o.text.trim())
                .filter(t => t && t.length > 0 && !['--', 'select...', 'please select'].includes(t.toLowerCase()));
        }

        if (entry.label || entry.options?.length) {
            manifest.push(entry);
        }
    });

    return manifest;
}
```

- [ ] Commit: `git commit -m "feat: add buildFieldManifest() for compact AI payload"`

---

### Task 4: Update `getAiFieldAnalysis()` to accept field manifest

**Files:**
- Modify: `autofill-engine/ai-service.js`

- [ ] Replace `pageContent` parameter with `fieldManifest` (array). Rewrite the prompt to work with the manifest. AI returns `{ "fields": [{ "i": <index>, "value": "<answer>" }] }`.

```js
async function getAiFieldAnalysis(fieldManifest, userMapping, profileMarkdown) {
    const config = await chrome.storage.sync.get(['aiProviderUrl', 'aiApiKey', 'aiModel']);
    const url = config.aiProviderUrl?.trim();
    const apiKey = config.aiApiKey?.trim();
    const model = config.aiModel?.trim() || 'deepseek/deepseek-chat';

    if (!url || !apiKey) {
        throw new Error('AI Provider URL or API Key is not configured. Open the extension popup → Settings → AI Enhanced.');
    }

    const profileContext = profileMarkdown?.trim()
        ? profileMarkdown.trim()
        : buildFallbackProfile(userMapping);

    const manifestJson = JSON.stringify(fieldManifest, null, 2);

    const prompt = `You are a job application assistant. Fill the form fields below on behalf of the applicant using their profile.

## Applicant Profile
${profileContext}

## Form Fields (only those needing AI judgment)
Each field has: i (index to reference it), label, type, and options (for select fields).

${manifestJson}

## Rules

**Auto-fill without profile lookup:**
- Acknowledgment/consent fields ("I acknowledge", "I agree", "I consent", "privacy policy", "terms") → affirmative option
- "Were you referred" → "N/A"
- "Relatives at company" → "No"
- "Previously worked here" → "No" unless profile work history includes that company

**Map from profile:**
- Authorization to work → profile authorization field
- Salary/pay → profile expected salary
- Start date → profile start date
- Name, city, country → profile address fields

**SELECT fields:** value must exactly match one of the provided options strings.

**Textarea/open text:** answer in 1-3 sentences directly from profile. Be factual.

**Skip** file inputs. Only include fields you can answer confidently.

## Output
Return ONLY valid JSON, no markdown, no explanation:
{ "fields": [{ "i": <index>, "value": "<answer>" }] }`;

    const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };

    if (url.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://github.com/AutoApplyMax/AutoApplyMax';
        headers['X-Title'] = 'AutoApplyMax';
    }

    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });

    if (!response.ok && response.status === 400) {
        const errText = await response.text();
        if (errText.includes('response_format') || errText.includes('json_object')) {
            console.warn('[AutoApplyMax] Model does not support response_format, retrying without it.');
            delete requestBody.response_format;
            response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });
        } else {
            throw new Error(`AI API error ${response.status}: ${errText}`);
        }
    }

    if (!response.ok) {
        throw new Error(`AI API error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error('AI API returned an empty response.');

    return extractJson(rawContent);
}
```

- [ ] Commit: `git commit -m "feat: replace raw HTML with compact field manifest in AI prompt"`

---

### Task 5: Rewrite `runAiAutofill()` as hybrid

**Files:**
- Modify: `autofill-engine/AutofillOrchestrator.js`

- [ ] Rewrite `runAiAutofill()` to: run heuristic first → build manifest → skip AI call if manifest is empty → apply AI results by index.

```js
async function runAiAutofill() {
    const userData = await loadUserData();
    const mapping = createFieldMapping(userData);
    const { profileMarkdown } = await chrome.storage.local.get('profileMarkdown');

    // Step 1: heuristic fills easy fields
    const allPageFields = getAllFields();
    console.log(`[AutoApplyMax] AI mode — found ${allPageFields.length} fields. Running heuristic first.`);
    runHeuristicFill(allPageFields, mapping);

    const heuristicFilled = allPageFields.filter(f => f.element.dataset.autofilled === 'true').length;
    console.log(`[AutoApplyMax] Heuristic filled ${heuristicFilled} fields.`);

    // Step 2: build manifest of remaining / low-confidence fields
    const manifest = buildFieldManifest(allPageFields);

    if (manifest.length === 0) {
        console.log('[AutoApplyMax] No fields left for AI. Done.');
        await handleResumeUpload(allPageFields);
        highlightRequiredFields(allPageFields);
        return;
    }

    console.log(`[AutoApplyMax] Sending ${manifest.length} fields to AI.`);

    // Step 3: AI fills the gaps
    let aiResult = null;
    try {
        aiResult = await getAiFieldAnalysis(manifest, mapping, profileMarkdown || '');
    } catch (err) {
        console.error('[AutoApplyMax] AI analysis failed:', err);
        await handleResumeUpload(allPageFields);
        highlightRequiredFields(allPageFields);
        return;
    }

    if (!aiResult?.fields?.length) {
        console.warn('[AutoApplyMax] AI returned no fields.');
        await handleResumeUpload(allPageFields);
        highlightRequiredFields(allPageFields);
        return;
    }

    // Step 4: apply AI results by index
    let aiFilledCount = 0;
    for (const { i, value } of aiResult.fields) {
        if (i == null || !value || !allPageFields[i]) continue;
        const field = allPageFields[i];
        const el = field.element;

        if (el.tagName === 'SELECT') {
            fillSelect(el, value);
        } else if (el.type === 'radio' || el.type === 'checkbox') {
            el.checked = el.value.toLowerCase() === value.toLowerCase() || value.toLowerCase() === 'true';
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            fill(el, value);
        }

        el.dataset.autofilled = 'true';
        applyConfidenceStyle(el, 0.95);
        aiFilledCount++;
    }

    await handleResumeUpload(allPageFields);
    highlightRequiredFields(allPageFields);

    const totalFilled = allPageFields.filter(f => f.element.dataset.autofilled === 'true').length;
    console.log(`[AutoApplyMax] Done. Total filled: ${totalFilled} (heuristic: ${heuristicFilled}, AI: ${aiFilledCount}).`);
}
```

- [ ] Commit: `git commit -m "feat: hybrid AI autofill — heuristic first, AI fills gaps via field manifest"`
