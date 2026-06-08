// Service worker for AutoApplyMax
chrome.runtime.onInstalled.addListener(async (details) => {
    // Seed profileMarkdown from profile-default.md if not yet done.
    // Runs on both first install and first reload after this feature was added.
    const { profileMarkdownSeeded } = await chrome.storage.local.get('profileMarkdownSeeded');
    if (!profileMarkdownSeeded) {
        try {
            const url = chrome.runtime.getURL('profile-default.md');
            const res = await fetch(url);
            if (res.ok) {
                const profileMarkdown = await res.text();
                await chrome.storage.local.set({ profileMarkdown, profileMarkdownSeeded: true });
                console.log('[AutoApplyMax] Profile seeded from profile-default.md.');
            }
        } catch (e) {
            console.warn('[AutoApplyMax] Could not load profile-default.md:', e.message);
        }
    }

    // Structured fields: only pre-populate on first install.
    if (details.reason === 'install') {
        const { profilePrepopulated } = await chrome.storage.local.get('profilePrepopulated');
        if (!profilePrepopulated) {
            console.log('AutoApplyMax First Install: Pre-populating profile data.');
            await prePopulateProfileData();
            await chrome.storage.local.set({ profilePrepopulated: true });
        }
    }
});

async function prePopulateProfileData() {
    // Initialize with empty values so new users see a blank profile to fill in.
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
        // profileMarkdown is seeded separately from profile-default.md
    };
    await chrome.storage.sync.set(syncData);
    await chrome.storage.local.set(localData);
    console.log('[AutoApplyMax] Profile initialized. Fill in your details in the extension popup.');
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'injectAutofillScripts') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab) {
                    throw new Error("Could not find an active tab to inject scripts into.");
                }
                const tabId = tab.id;
                await chrome.scripting.executeScript({
                    target: { tabId },
                    // ISOLATED world (default) — chrome.storage and chrome.runtime are available here.
                    // nativeInputValueSetter still works from ISOLATED world: the DOM element is shared,
                    // and calling the isolated prototype setter bypasses React's instance-level override
                    // just as effectively, while DOM events still bubble to MAIN world React listeners.
                    files: [
                        'autofill-engine/vendor/string-similarity.js',
                        'autofill-engine/ai-service.js',
                        'autofill-engine/FormFiller.js',
                        'autofill-engine/HeuristicParser.js',
                        'autofill-engine/ReportPanel.js',
                        'autofill-engine/adapters/WorkdayAdapter.js',
                        'autofill-engine/AutofillOrchestrator.js'
                    ],
                });
                await chrome.scripting.executeScript({
                    target: { tabId },
                    function: () => runAutofill(),
                });
                sendResponse({ success: true });
            } catch (error) {
                console.error('[AutoApplyMax] Error injecting autofill scripts:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Indicates an async response
    }

    if (message.action === 'triggerIcimsAutofill') {
        // Broadcast to all content scripts in the active tab, including iCIMS iframes.
        // content-icims.js (declared in manifest with all_frames: true) will handle it.
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'autofillIcims',
                        userData: message.userData,
                    });
                }
            } catch (e) {
                // iCIMS may not be present — silently ignore
            }
        })();
        sendResponse({ success: true });
        return false;
    }
});
