// WorkdayAdapter.js — Platform-specific autofill for Workday ATSes.
//
// Workday identifies fields via data-automation-id attributes, which are stable
// across DOM updates. Native <select> elements don't exist — dropdowns are
// custom div/button components that require click-based interaction.

function isWorkday() {
    return (
        window.location.hostname.includes('myworkdayjobs.com') ||
        window.location.hostname.includes('wd3.myworkday.com') ||
        window.location.hostname.includes('wd5.myworkday.com') ||
        // Fallback: page has Workday-style automation IDs on inputs
        (document.querySelector('[data-automation-id="email"]') !== null &&
         document.querySelector('[data-automation-id]') !== null)
    );
}

function getWorkdayFields() {
    const fields = [];

    // Collect native inputs/textareas that have data-automation-id
    document.querySelectorAll('input[data-automation-id], textarea[data-automation-id]').forEach(el => {
        const automationId = el.getAttribute('data-automation-id');
        const ariaLabel = el.getAttribute('aria-label') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const label = ariaLabel || placeholder || automationId;

        fields.push({
            element: el,
            label: label.toLowerCase(),
            id: automationId.toLowerCase(),
            name: (el.name || automationId).toLowerCase(),
            isRequired: el.required || el.getAttribute('aria-required') === 'true',
            isWorkdayCustomDropdown: false,
        });
    });

    // Collect Workday custom dropdown buttons (combobox role)
    document.querySelectorAll('[data-automation-id][role="combobox"], [data-automation-id] button[aria-haspopup]').forEach(el => {
        const automationId = el.getAttribute('data-automation-id') ||
            el.closest('[data-automation-id]')?.getAttribute('data-automation-id') || '';
        const ariaLabel = el.getAttribute('aria-label') ||
            el.closest('[data-automation-id]')?.getAttribute('aria-label') || '';

        // Find associated label text from the surrounding form group
        let labelText = ariaLabel;
        if (!labelText) {
            const formGroup = el.closest('[data-automation-id]')?.parentElement;
            const labelEl = formGroup?.querySelector('label') || formGroup?.previousElementSibling?.querySelector('label');
            labelText = labelEl?.textContent?.trim() || automationId;
        }

        fields.push({
            element: el,
            label: labelText.toLowerCase(),
            id: automationId.toLowerCase(),
            name: automationId.toLowerCase(),
            isRequired: el.getAttribute('aria-required') === 'true',
            isWorkdayCustomDropdown: true,
        });
    });

    return fields;
}

async function fillWorkdayDropdown(buttonElement, value) {
    // Open the listbox
    buttonElement.click();
    buttonElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // Wait for Workday's async listbox render
    await new Promise(resolve => setTimeout(resolve, 400));

    // Search within the now-visible listbox
    const listbox = document.querySelector('[role="listbox"]');
    if (!listbox) {
        // Close and give up
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
    }

    const options = listbox.querySelectorAll('[role="option"]');
    const valueLower = value.toLowerCase();
    let bestOption = null;

    // Exact match first
    Array.from(options).forEach(option => {
        const text = option.textContent.trim().toLowerCase();
        if (text === valueLower) bestOption = option;
    });

    // Substring match
    if (!bestOption) {
        Array.from(options).forEach(option => {
            const text = option.textContent.trim().toLowerCase();
            if (text.startsWith(valueLower) || text.includes(valueLower)) {
                if (!bestOption) bestOption = option;
            }
        });
    }

    if (bestOption) {
        bestOption.click();
        return true;
    }

    // No match — close the listbox
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
}

async function runWorkdayAutofill() {
    const userData = await chrome.storage.sync.get([
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'postalCode', 'country', 'skills',
        'gender', 'race', 'veteranStatus', 'disabilityStatus', 'pronouns',
        'expectedSalary', 'startDate', 'isAuthorizedInUS', 'requireSponsorship'
    ]);

    // Map Workday's data-automation-id values to profile keys
    const workdayIdMap = {
        'legalNameSection_firstName':    userData.firstName,
        'legalNameSection_lastName':     userData.lastName,
        'email':                         userData.email,
        'phone-number':                  userData.phone,
        'addressSection_addressLine1':   userData.addressLine1,
        'addressSection_city':           userData.city,
        'addressSection_postalCode':     userData.postalCode,
        'addressSection_countryRegion':  userData.country,
        'salaryExpectations':            userData.expectedSalary,
        'availabilityDate':              userData.startDate,
    };

    const allFields = getWorkdayFields();
    let filledCount = 0;

    // Fill by direct data-automation-id lookup first (most reliable)
    for (const [automationId, value] of Object.entries(workdayIdMap)) {
        if (!value) continue;
        const field = allFields.find(f => f.id === automationId.toLowerCase());
        if (!field) continue;

        if (field.isWorkdayCustomDropdown) {
            const filled = await fillWorkdayDropdown(field.element, value);
            if (filled) {
                field.element.dataset.autofilled = 'true';
                filledCount++;
            }
        } else {
            fill(field.element, value);
            field.element.dataset.autofilled = 'true';
            applyConfidenceStyle(field.element, 1.0);
            filledCount++;
        }
    }

    // Fall back to heuristic matching for any remaining fields
    for (const [profileKey, value] of Object.entries(userData)) {
        if (!value) continue;
        const unfilledFields = allFields.filter(f => !f.element.dataset.autofilled);
        const match = findBestMatch(profileKey, unfilledFields);
        if (!match) continue;

        const { field, score } = match;
        if (field.isWorkdayCustomDropdown) {
            const filled = await fillWorkdayDropdown(field.element, value);
            if (filled) {
                field.element.dataset.autofilled = 'true';
                filledCount++;
            }
        } else {
            fill(field.element, value);
            field.element.dataset.autofilled = 'true';
            applyConfidenceStyle(field.element, score);
            filledCount++;
        }
    }

    // Resume upload
    const resumeData = await chrome.storage.local.get(['resumeFile', 'resumeFileName', 'resumeFileType']);
    if (resumeData.resumeFile) {
        const resumeInput = document.querySelector('input[type="file"][data-automation-id*="resume"], input[type="file"]');
        if (resumeInput) {
            const file = base64ToFile(resumeData.resumeFile, resumeData.resumeFileName, resumeData.resumeFileType);
            if (file) await fillFileInput(resumeInput, file);
        }
    }

    console.log(`[AutoApplyMax] Workday fill complete. ${filledCount} fields filled.`);
}
