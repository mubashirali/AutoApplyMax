// Service worker for AutoApplyMax
chrome.runtime.onInstalled.addListener(async (details) => {
    // Only pre-populate on first install — not on extension updates.
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
                    world: 'MAIN', // Required for nativeInputValueSetter to access the page's React instance
                    files: [
                        'autofill-engine/vendor/string-similarity.js',
                        'autofill-engine/ai-service.js',
                        'autofill-engine/FormFiller.js',
                        'autofill-engine/HeuristicParser.js',
                        'autofill-engine/adapters/WorkdayAdapter.js',
                        'autofill-engine/AutofillOrchestrator.js'
                    ],
                });
                await chrome.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN', // Must match the world where runAutofill is defined
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
});
