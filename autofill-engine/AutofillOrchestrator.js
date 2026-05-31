async function runAutofill() {
    console.log('[AutoApplyMax] Autofill process initiated...');
    const config = await chrome.storage.sync.get('parserType');
    const parserType = config.parserType || 'local';

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
    runHeuristicFill(allPageFields, mapping);
    await handleResumeUpload(allPageFields);
    highlightRequiredFields(allPageFields);
    showReportPanel(allPageFields);
}

async function runAiAutofill() {
    const userData = await loadUserData();
    // **THE FIX IS HERE:** Load work and education history.
    const { workHistory, educationHistory } = await chrome.storage.local.get(['workHistory', 'educationHistory']);

    const allPageFields = getAllFields();
    console.log(`[AutoApplyMax] AI mode — found ${allPageFields.length} fields. Running heuristic first.`);
    runHeuristicFill(allPageFields, createFieldMapping(userData));

    const manifest = buildFieldManifest(allPageFields);
    if (manifest.length === 0) {
        console.log('[AutoApplyMax] No fields left for AI. Done.');
        await handleResumeUpload(allPageFields);
        highlightRequiredFields(allPageFields);
        return;
    }

    console.log(`[AutoApplyMax] Sending ${manifest.length} fields to AI...`);

    try {
        // **THE FIX IS HERE:** Pass the complete history to the AI service.
        const aiResult = await getAiFieldAnalysis(manifest, userData, workHistory, educationHistory);
        if (!aiResult?.fields?.length) {
            console.warn('[AutoApplyMax] AI returned no fields to fill.');
            return;
        }

        let aiFilledCount = 0;
        for (const { i, value } of aiResult.fields) {
            if (i != null && value && allPageFields[i]) {
                const el = allPageFields[i].element;
                fill(el, value); // A generic fill function should handle select/radio/text
                el.dataset.autofilled = 'true';
                applyConfidenceStyle(el, 0.99); // Mark AI fills as high confidence
                aiFilledCount++;
            }
        }
        console.log(`[AutoApplyMax] AI filled ${aiFilledCount} fields.`);

    } catch (err) {
        console.error('[AutoApplyMax] AI analysis failed:', err);
        alert(`AI autofill failed: ${err.message}`);
    } finally {
        await handleResumeUpload(allPageFields);
        highlightRequiredFields(allPageFields);
        showReportPanel(allPageFields);
    }
}

// --- Helper functions (buildFieldManifest, runHeuristicFill, etc.) ---
// These functions are assumed to be correct from the previous file read.

function runHeuristicFill(allPageFields, mapping) {
    for (const fieldName in mapping) {
        if (!mapping[fieldName]) continue;
        const match = findBestMatch(fieldName, allPageFields);
        if (match?.field?.element) {
            fill(match.field.element, mapping[fieldName]);
            applyConfidenceStyle(match.field.element, match.score);
            match.field.element.dataset.autofilled = 'true';
        }
    }
}

function buildFieldManifest(allPageFields) {
    const manifest = [];
    allPageFields.forEach((field, i) => {
        if (field.element.dataset.autofilled) return;
        const entry = {
            i,
            label: field.label || field.id || field.name || '',
            type: field.element.tagName.toLowerCase(),
            options: field.element.tagName === 'SELECT' ? Array.from(field.element.options).map(o => o.text.trim()) : undefined
        };
        if (entry.label || entry.options?.length) manifest.push(entry);
    });
    return manifest;
}

async function loadUserData() {
    return await chrome.storage.sync.get([
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'postalCode', 'country', 'skills',
        'gender', 'race', 'veteranStatus', 'disabilityStatus', 'pronouns',
        'expectedSalary', 'startDate', 'isAuthorizedInUS', 'requireSponsorship'
    ]);
}

function createFieldMapping(userData) {
    const mapping = {};
    for (const key in userData) mapping[key] = userData[key];
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
            }
        }
    }
}

function highlightRequiredFields(allPageFields) {
    allPageFields.filter(f => f.isRequired).forEach(field => {
        if (!field.element.dataset.autofilled && !field.element.value) {
            field.element.style.border = '2px solid #dc3545';
        }
    });
}
