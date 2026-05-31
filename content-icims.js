// content-icims.js — Runs inside iCIMS cross-origin iframes (*.icims.com).
//
// iCIMS embeds job application forms in a cross-origin iframe. The main
// autofill engine can't reach cross-origin iframes due to CORS, so this
// content script is declared with all_frames: true and runs directly inside
// the iframe. It listens for an 'autofillIcims' message from the orchestrator
// and fills the form fields using iCIMS's known field ID patterns.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'autofillIcims') return;

    const userData = message.userData;
    if (!userData) {
        sendResponse({ success: false, error: 'No userData provided' });
        return;
    }

    // iCIMS uses predictable field IDs with an iCIMS_ prefix.
    // Some variants use lowercase or hyphen-separated names.
    const fieldMappings = [
        { selectors: ['#iCIMS_Email', '[name="iCIMS_Email"]', '[name="email"]'],          value: userData.email },
        { selectors: ['#iCIMS_FirstName', '[name="iCIMS_FirstName"]', '[name="firstName"]'], value: userData.firstName },
        { selectors: ['#iCIMS_LastName', '[name="iCIMS_LastName"]', '[name="lastName"]'],   value: userData.lastName },
        { selectors: ['#iCIMS_Phone', '[name="iCIMS_Phone"]', '[name="phone"]'],            value: userData.phone },
        { selectors: ['#iCIMS_City', '[name="iCIMS_City"]', '[name="city"]'],              value: userData.city },
        { selectors: ['#iCIMS_Zip', '[name="iCIMS_Zip"]', '[name="postalCode"]', '[name="zipCode"]'], value: userData.postalCode },
        { selectors: ['[name="iCIMS_Country"]', '[name="country"]'],                        value: userData.country },
        { selectors: ['[name="iCIMS_Address"]', '[name="addressLine1"]'],                  value: userData.addressLine1 },
    ];

    let filledCount = 0;

    fieldMappings.forEach(({ selectors, value }) => {
        if (!value) return;

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;

            if (el.tagName === 'SELECT') {
                const option = Array.from(el.options).find(o =>
                    o.text.toLowerCase() === value.toLowerCase() ||
                    o.value.toLowerCase() === value.toLowerCase()
                );
                if (option) {
                    el.value = option.value;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.style.border = '2px solid #28a745';
                    filledCount++;
                }
            } else {
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.style.border = '2px solid #28a745';
                filledCount++;
            }
            break; // Stop at the first matching selector
        }
    });

    console.log(`[AutoApplyMax] iCIMS iframe: filled ${filledCount} fields.`);
    sendResponse({ success: true, filledCount });
});
