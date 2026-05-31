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

async function runLocalHeuristicAutofill() {
    const userData = await loadUserData();
    const allPageFields = getAllFields();
    
    console.log(`[AutoApplyMax] Local parser found ${allPageFields.length} fields.`);

    const mapping = createFieldMapping(userData);

    // --- Fill Fields ---
    for (const fieldName in mapping) {
        if (!mapping[fieldName]) continue;
        const value = mapping[fieldName];

        // Check if this field maps to a radio/checkbox group on the page
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
        if (match && match.field && match.field.element) {
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

    await handleResumeUpload(allPageFields);

    // iCIMS cross-origin iframe: send profile to the content script running inside the iframe
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

    let aiResult = null;
    try {
        const pageContent = document.documentElement.outerHTML;
        aiResult = await getAiFieldAnalysis(pageContent, mapping);
    } catch (err) {
        console.error('[AutoApplyMax] AI analysis failed, falling back to heuristic:', err);
        await runLocalHeuristicAutofill();
        return;
    }

    if (!aiResult || !Array.isArray(aiResult.fields) || aiResult.fields.length === 0) {
        console.warn('[AutoApplyMax] AI returned no fields. Falling back to heuristic.');
        await runLocalHeuristicAutofill();
        return;
    }

    let filledCount = 0;
    for (const { selector, value } of aiResult.fields) {
        if (!selector || !value) continue;
        const el = document.querySelector(selector);
        if (!el) continue;

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
        filledCount++;
    }

    // Resume upload (AI doesn't handle file inputs)
    const allPageFields = getAllFields();
    await handleResumeUpload(allPageFields);
    highlightRequiredFields(allPageFields);

    console.log(`[AutoApplyMax] AI fill complete. ${filledCount} fields filled.`);
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
