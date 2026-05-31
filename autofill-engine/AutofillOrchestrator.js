async function runAutofill() {
    console.log('[AutoApplyMax] Autofill process initiated...');
    const config = await chrome.storage.sync.get('parserType');
    const parserType = config.parserType || 'local';

    // Platform-specific adapters take priority — they know the DOM better than the heuristic
    if (typeof isWorkday === 'function' && isWorkday()) {
        console.log('[AutoApplyMax] Detected Workday ATS. Using Workday adapter.');
        await runWorkdayAutofill();
        return;
    }

    if (parserType === 'ai') {
        console.log('[AutoApplyMax] Using AI Enhanced parser.');
        await runAiAutofill();
    } else {
        console.log('[AutoApplyMax] Using Local Heuristic parser.');
        await runLocalHeuristicAutofill();
    }
}

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

async function runAiAutofill() {
    const userData = await loadUserData();
    const mapping = createFieldMapping(userData);
    const { profileMarkdown } = await chrome.storage.local.get('profileMarkdown');

    // Step 1: heuristic fills easy/high-confidence fields
    const allPageFields = getAllFields();
    console.log(`[AutoApplyMax] AI mode — found ${allPageFields.length} fields. Running heuristic first.`);
    runHeuristicFill(allPageFields, mapping);

    const heuristicFilled = allPageFields.filter(f => f.element.dataset.autofilled === 'true').length;
    console.log(`[AutoApplyMax] Heuristic filled ${heuristicFilled} fields.`);

    // Step 2: build compact manifest of unfilled / low-confidence fields
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

    // Step 4: apply AI results back by index — no CSS selectors needed
    let aiFilledCount = 0;
    for (const { i, value } of aiResult.fields) {
        if (i == null || !value || !allPageFields[i]) continue;
        const el = allPageFields[i].element;

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

async function loadUserData() {
    // Load all the new fields
    return await chrome.storage.sync.get([
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'postalCode', 'country', 'skills',
        'gender', 'race', 'veteranStatus', 'disabilityStatus', 'pronouns',
        'expectedSalary', 'startDate', 'isAuthorizedInUS', 'requireSponsorship'
    ]);
}

function createFieldMapping(userData) {
    // Create a mapping for all simple fields
    const mapping = {};
    for (const key in userData) {
        mapping[key] = userData[key];
    }
    return mapping;
}

async function handleResumeUpload(allPageFields) {
    const resumeData = await chrome.storage.local.get(['resumeFile', 'resumeFileName', 'resumeFileType']);
    if (resumeData.resumeFile) {
        const resumeMatch = findBestMatch('resume', allPageFields);
        if (resumeMatch?.field?.element) {
            const file = base64ToFile(resumeData.resumeFile, resumeData.resumeFileName, resumeData.resumeFileType);
            if (file) {
                await fillFileInput(resumeMatch.field.element, file);
                applyConfidenceStyle(resumeMatch.field.element, resumeMatch.score);
                resumeMatch.field.element.dataset.autofilled = 'true';
            }
        }
    }
}

function highlightRequiredFields(allPageFields) {
    allPageFields.filter(f => f.isRequired).forEach(field => {
        if (!field.element.dataset.autofilled && !field.element.value) {
            field.element.style.border = '2px solid #dc3545';
            field.element.style.backgroundColor = '#f8d7da';
        }
    });
}

// Dependencies (injected before this file by background.js):
// string-similarity.js → compareTwoStrings()
// ai-service.js        → getAiFieldAnalysis()
// FormFiller.js        → fill(), fillSelect(), fillRadioOrCheckbox(), fillFileInput(), base64ToFile(), applyConfidenceStyle()
// HeuristicParser.js   → getAllFields(), findBestMatch()
// WorkdayAdapter.js    → isWorkday(), runWorkdayAutofill()
