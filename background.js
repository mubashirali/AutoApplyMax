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
        profileMarkdown: DEFAULT_PROFILE_TEMPLATE,
    };
    await chrome.storage.sync.set(syncData);
    await chrome.storage.local.set(localData);
    console.log('[AutoApplyMax] Profile initialized. Fill in your details in the extension popup.');
}

const DEFAULT_PROFILE_TEMPLATE = `# My Profile — AI Resume Context
# The AI uses this file to answer every question on a job application.
# Edit this with your real information. The more detail you add, the better the AI performs.

## Personal Information
- Full Name: [First] [Last]
- Email: [your@email.com]
- Phone: [+1 555 000 0000]
- Address: [Street Address]
- City, State: [City], [State]
- Country: [Country]

## Work Authorization
- I am authorized to work in [Country] without requiring visa sponsorship.
- Sponsorship required: No

## Current Employment
- Currently employed at [Current Company] as [Current Title]

## Work Experience

### [Company Name] — [Job Title] ([Month Year] – Present)
[Describe your responsibilities, achievements, and technologies used. The AI uses this to answer experience-level questions.]

### [Previous Company] — [Job Title] ([Month Year] – [Month Year])
[Description]

## Education
- [Degree], [Major] — [University Name], [Year]

## Technical Skills
[List all skills, technologies, tools — e.g.: Java, Spring Boot, AWS, Kubernetes, PostgreSQL, Python, React]

## Certifications
- [Certification Name], [Issuer], [Year]

## Salary Expectations
- Expected: $[Amount] USD annually

## Availability
- Available to start: [Date or "Immediately"]

## Standard Application Answers
- Referred by anyone: No / N/A
- Relatives at prospective employer: No
- Previously employed at prospective employer: No (unless listed in work history above)
- Agree to background checks: Yes
- Consent to privacy policy / pre-employment statements: Yes / I Consent

## Additional Context for AI
[Add anything else the AI should know when answering unusual questions — e.g., specific achievements, why you're changing roles, preferred work style, notable projects]
`;


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
});
