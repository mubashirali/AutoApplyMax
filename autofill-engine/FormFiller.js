
function fill(input, value) {
    // Use the native setter so React's synthetic event system sees the change.
    // Direct assignment (input.value = x) bypasses React's internal state tracker,
    // causing fields to appear filled but submit empty on React-based ATSes.
    const proto = input.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
        nativeSetter.call(input, value);
    } else {
        input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillSelect(element, value) {
    const options = Array.from(element.options);
    const valueLower = value.toLowerCase();

    // 1. Exact match on text or value attribute
    let bestOption = options.find(o =>
        o.text.toLowerCase() === valueLower ||
        o.value.toLowerCase() === valueLower
    );

    // 2. Starts-with or contains substring: "No" matches "No, I do not require..."
    if (!bestOption) {
        bestOption = options.find(o =>
            o.text.toLowerCase().startsWith(valueLower) ||
            o.text.toLowerCase().includes(` ${valueLower}`) ||
            o.value.toLowerCase() === valueLower
        );
    }

    // 3. Dice coefficient fuzzy match as last resort
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
    }
}

function fillRadioOrCheckbox(allPageFields, fieldName, value) {
    // Collect all radios/checkboxes whose label or name is related to this field
    const candidates = allPageFields.filter(f =>
        (f.element.type === 'radio' || f.element.type === 'checkbox') &&
        (f.name.includes(fieldName) || f.label.includes(fieldName) || f.id.includes(fieldName))
    );

    if (candidates.length === 0) return false;

    const valueLower = value.toLowerCase();

    // 1. Exact value or label match
    let match = candidates.find(f =>
        f.element.value.toLowerCase() === valueLower ||
        f.label.toLowerCase() === valueLower
    );

    // 2. Partial/contains match — "No" matches "No, I prefer not to say"
    if (!match) {
        match = candidates.find(f =>
            f.element.value.toLowerCase().startsWith(valueLower) ||
            f.label.toLowerCase().startsWith(valueLower) ||
            f.element.value.toLowerCase().includes(valueLower)
        );
    }

    if (match) {
        match.element.checked = true;
        match.element.dispatchEvent(new Event('change', { bubbles: true }));
        match.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        match.element.dataset.autofilled = 'true';
        applyConfidenceStyle(match.element, 0.9);
        return true;
    }

    return false;
}

function applyConfidenceStyle(element, score) {
    if (score > 0.9) {
        element.style.border = '2px solid #28a745'; // Green for high confidence
    } else {
        element.style.border = '2px solid #ffc107'; // Yellow for medium/low confidence
    }
}

function base64ToFile(base64String, filename, mimeType) {
  try {
    const base64Data = base64String.includes(',') ? base64String.split(',')[1] : base64String;
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const file = new File([bytes], filename, { type: mimeType });
    return file;
  } catch (error) {
    console.error(`[AutoApplyMax] Error converting base64 to file: ${error.message}`);
    return null;
  }
}

async function fillFileInput(fileInput, file) {
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(`[AutoApplyMax] Resume uploaded: ${file.name}`);
    return true;
  } catch (error) {
    console.error(`[AutoApplyMax] Error filling file input: ${error.message}`);
    return false;
  }
}
