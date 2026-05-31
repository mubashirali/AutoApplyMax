
function isFieldRequired(input, label) {
    if (input.required || input.getAttribute('aria-required') === 'true' || label.includes('*') || label.includes('(required)')) {
        return true;
    }
    return false;
}

function getAllFields(doc = document) {
    let fields = [];
    const inputs = doc.querySelectorAll('input, textarea, select');

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

        // 5. aria-labelledby — resolve the referenced element's text
        if (!label) {
            const labelledById = input.getAttribute('aria-labelledby');
            if (labelledById) {
                // aria-labelledby can reference multiple space-separated ids
                label = labelledById.split(' ')
                    .map(id => doc.getElementById(id)?.textContent?.trim() || '')
                    .filter(Boolean)
                    .join(' ');
            }
        }

        // 6. placeholder as last resort
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

    doc.querySelectorAll('iframe').forEach(iframe => {
        try {
            if (iframe.contentDocument) {
                fields = fields.concat(getAllFields(iframe.contentDocument));
            }
        } catch (e) {
            console.warn('[AutoApplyMax] Could not access iframe content.', e.message);
        }
    });

    return fields;
}

function findBestMatch(fieldName, allPageFields) {
    let bestMatch = { score: 0, field: null };

    const fieldKeywords = {
        // Personal
        firstName: ['first name', 'given name'],
        lastName: ['last name', 'family name', 'surname'],
        email: ['email', 'e-mail'],
        phone: ['phone', 'mobile'],
        addressLine1: ['address', 'street'],
        city: ['city', 'town'],
        postalCode: ['postal code', 'zip code'],
        country: ['country'],
        skills: ['skills'],
        resume: ['resume', 'cv', 'curriculum vitae'],
        // EEO
        gender: ['gender'],
        race: ['race', 'ethnicity'],
        veteranStatus: ['veteran'],
        disabilityStatus: ['disability', 'handicap'],
        pronouns: ['pronouns'],
        // Preferences
        expectedSalary: ['salary', 'compensation'],
        startDate: ['start date', 'availability'],
        // Authorization
        isAuthorizedInUS: ['authorized to work', 'work authorization'],
        requireSponsorship: ['sponsorship', 'visa'],
    };

    const keywords = fieldKeywords[fieldName] || [fieldName];

    allPageFields.forEach(field => {
        if (field.element.dataset.autofilled) return;

        let score = 0;
        const combinedText = `${field.label} ${field.id} ${field.name}`;

        keywords.forEach(keyword => {
            if (field.id === keyword || field.name === keyword) score = 1.0;
            else if (field.label === keyword) score = 0.9;
            else if (compareTwoStrings(field.label, keyword) > 0.80) {
                score = Math.max(score, 0.85);
            }
            // Word-boundary match: "resume" matches "s3_upload_for_resume" but not "resumed"
            else if (new RegExp(`\\b${keyword}\\b`).test(combinedText)) score = Math.max(score, 0.75);
            // Raw substring fallback (below threshold — kept for future tuning)
            else if (combinedText.includes(keyword)) score = Math.max(score, 0.6);
        });

        if (score > bestMatch.score) {
            bestMatch = { score, field };
        }
    });

    if (bestMatch.score > 0.7) {
        return bestMatch;
    }
    return null;
}
