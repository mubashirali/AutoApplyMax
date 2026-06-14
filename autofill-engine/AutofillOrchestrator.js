async function runAutofill() {
    console.log('[AutoApplyMax] Autofill process initiated...');

    // Workday requires a dedicated adapter (custom dropdowns, data-automation-id fields)
    if (typeof isWorkday === 'function' && isWorkday()) {
        console.log('[AutoApplyMax] Workday detected — using Workday adapter.');
        await runWorkdayAutofill();
        return;
    }

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

    // Trigger autofill inside iCIMS cross-origin iframes via declared content script
    chrome.runtime.sendMessage({ action: 'triggerIcimsAutofill', userData });

    highlightRequiredFields(allPageFields);
    showReportPanel(allPageFields);
}

function showStatusToast(msg, color = '#0a66c2') {
    let toast = document.getElementById('__aam_toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = '__aam_toast';
        Object.assign(toast.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
            background: color, color: '#fff', padding: '10px 18px',
            borderRadius: '8px', fontSize: '13px', fontFamily: 'sans-serif',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)', transition: 'opacity 0.4s',
        });
        document.body.appendChild(toast);
    }
    toast.style.background = color;
    toast.style.opacity = '1';
    toast.textContent = msg;
}

function hideStatusToast() {
    const toast = document.getElementById('__aam_toast');
    if (toast) { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }
}

async function runAiAutofill() {
    const userData = await loadUserData();
    const { workHistory, educationHistory, profileMarkdown } = await chrome.storage.local.get(['workHistory', 'educationHistory', 'profileMarkdown']);
    const pageContext = { title: document.title, url: window.location.href };

    const allPageFields = getAllFields();
    console.log(`[AutoApplyMax] AI mode — found ${allPageFields.length} fields. Running heuristic first.`);
    runHeuristicFill(allPageFields, createFieldMapping(userData));

    const manifest = buildFieldManifest(allPageFields);
    console.log(`[AutoApplyMax] Heuristic done. ${manifest.length} fields queued for AI.`);

    if (manifest.length === 0) {
        console.log('[AutoApplyMax] No fields left for AI. Done.');
        await handleResumeUpload(allPageFields);
        highlightRequiredFields(allPageFields);
        showReportPanel(allPageFields);
        return;
    }

    showStatusToast(`AutoApplyMax: asking AI to fill ${manifest.length} fields…`);
    console.log(`[AutoApplyMax] Sending ${manifest.length} fields to AI...`, manifest);

    try {
        const aiResult = await getAiFieldAnalysis(manifest, userData, workHistory, educationHistory, profileMarkdown, pageContext);
        console.log('[AutoApplyMax] AI response:', aiResult);
        if (!aiResult?.fields?.length) {
            console.warn('[AutoApplyMax] AI returned no fields to fill.');
            showStatusToast('AutoApplyMax: AI returned no answers.', '#f59e0b');
            setTimeout(hideStatusToast, 3000);
            return;
        }

        let aiFilledCount = 0;
        for (const { i, value } of aiResult.fields) {
            if (i == null || !value || !allPageFields[i]) continue;

            const el = allPageFields[i].element;
            const tagName = el.tagName.toLowerCase();
            const inputType = el.type?.toLowerCase();

            if (inputType === 'radio') {
                // The manifest stores the first radio's index; find the matching option by value/label
                const match = allPageFields.find(f =>
                    f.element.type === 'radio' &&
                    f.element.name === el.name &&
                    (f.element.value.toLowerCase() === value.toLowerCase() ||
                     f.label.toLowerCase() === value.toLowerCase())
                );
                if (match) {
                    match.element.checked = true;
                    match.element.dispatchEvent(new Event('change', { bubbles: true }));
                    match.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    match.element.dataset.autofilled = 'true';
                    applyConfidenceStyle(match.element, 0.99);
                    aiFilledCount++;
                }
            } else if (inputType === 'checkbox') {
                const shouldCheck = /^(true|yes|1)$/i.test(value);
                el.checked = shouldCheck;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dataset.autofilled = 'true';
                applyConfidenceStyle(el, 0.99);
                aiFilledCount++;
            } else if (tagName === 'select') {
                fillSelect(el, value);
                el.dataset.autofilled = 'true';
                applyConfidenceStyle(el, 0.99);
                aiFilledCount++;
            } else {
                // text, email, tel, url, textarea
                fill(el, value);
                el.dataset.autofilled = 'true';
                applyConfidenceStyle(el, 0.99);
                aiFilledCount++;
            }
        }
        console.log(`[AutoApplyMax] AI filled ${aiFilledCount} fields.`);
        showStatusToast(`AutoApplyMax: filled ${aiFilledCount} fields via AI`, '#10b981');
        setTimeout(hideStatusToast, 4000);

    } catch (err) {
        console.error('[AutoApplyMax] AI analysis failed:', err);
        showStatusToast(`AutoApplyMax AI error: ${err.message}`, '#dc3545');
        setTimeout(hideStatusToast, 6000);
    } finally {
        await handleResumeUpload(allPageFields);
        highlightRequiredFields(allPageFields);
        showReportPanel(allPageFields);
    }
}

function runHeuristicFill(allPageFields, mapping) {
    for (const fieldName in mapping) {
        if (!mapping[fieldName]) continue;
        const match = findBestMatch(fieldName, allPageFields);
        if (!match?.field?.element) continue;
        const el = match.field.element;
        const tagName = el.tagName.toLowerCase();
        const inputType = el.type?.toLowerCase();

        // Radio/checkbox need option-aware logic — leave them for the AI pass
        if (inputType === 'radio' || inputType === 'checkbox') continue;

        if (tagName === 'select') {
            fillSelect(el, mapping[fieldName]);
        } else {
            fill(el, mapping[fieldName]);
        }

        applyConfidenceStyle(el, match.score);
        el.dataset.autofilled = 'true';
    }
}

function buildFieldManifest(allPageFields) {
    const manifest = [];
    const seenRadioGroups = new Set();

    allPageFields.forEach((field, i) => {
        if (field.element.dataset.autofilled) return;

        const el = field.element;
        const tagName = el.tagName.toLowerCase();
        const inputType = tagName === 'input' ? (el.type || 'text').toLowerCase() : null;

        // Skip fields the AI can't fill
        if (inputType === 'hidden' || inputType === 'file') return;

        // Radio groups: deduplicate by name, collect all option labels
        if (inputType === 'radio') {
            const groupKey = el.name || `radio_${i}`;
            if (seenRadioGroups.has(groupKey)) return;
            seenRadioGroups.add(groupKey);

            const groupRadios = allPageFields.filter(f =>
                f.element.tagName.toLowerCase() === 'input' &&
                f.element.type === 'radio' &&
                f.element.name === el.name
            );
            const options = groupRadios.map(f => f.label || f.element.value).filter(Boolean);
            const label = field.label || groupRadios.find(r => r.label)?.label || groupKey;
            if (label || options.length) manifest.push({ i, label, type: 'radio', options });
            return;
        }

        const entry = { i, label: field.label || field.id || field.name || '' };

        if (tagName === 'select') {
            entry.type = 'select';
            // Exclude the blank placeholder option
            entry.options = Array.from(el.options)
                .filter(o => o.value !== '' && o.text.trim() !== '')
                .map(o => o.text.trim());
        } else if (tagName === 'textarea') {
            entry.type = 'textarea';
        } else if (inputType === 'checkbox') {
            entry.type = 'checkbox';
        } else {
            // text, email, tel, url, number, etc.
            entry.type = inputType || 'text';
        }

        if (entry.label || entry.options?.length) manifest.push(entry);
    });

    return manifest;
}

async function loadUserData() {
    return await chrome.storage.sync.get([
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'stateProvince', 'postalCode', 'country', 'skills',
        'linkedinUrl', 'websiteUrl',
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
