// Service worker for AutoApplyMax

const DEFAULT_WORK_HISTORY = [
    { company: 'Delivery Hero', title: 'Senior Software Engineer', startDate: '2022', endDate: '', isCurrent: true, description: 'Owned fintech wallet and accounting microservices serving 3M+ quarterly active users and 83M+ quarterly orders.\nDesigned event-driven financial reconciliation framework using transactional outbox pattern — exactly-once payment processing, zero data inconsistencies across distributed services.\nArchitected high-throughput payment pipelines on AWS (EKS, SNS/SQS, RDS) maintaining 99.9%+ uptime under peak load.\nLed architecture discussions on service decomposition, data consistency strategies, and observability.\nReduced operational overhead 30% through automated reconciliation and self-healing mechanisms.\nMentored engineers via code reviews, design sessions, and pair programming.' },
    { company: 'Friday Versicherung', title: 'Software Engineer', startDate: '2020', endDate: '2022', isCurrent: false, description: 'Built insurance product management, policy lifecycle, and claims processing microservices (Java, Spring Boot, PostgreSQL).\nIntegrated third-party insurance providers and payment gateways for fully digital end-to-end workflows.\nImproved test coverage from <40% to 85%+ (unit, integration, contract testing with Pact).\nAWS cloud migration: deployed services to EKS with automated CI/CD (Jenkins, GitHub Actions).\nCollaborated in fully agile environment with product, QA, and platform teams.' },
    { company: 'Auto1 GmbH', title: 'Software Engineer', startDate: '2019', endDate: '2020', isCurrent: false, description: "Backend services for Europe's largest used-car marketplace — high-volume inventory, pricing, dealer transactions.\nRESTful APIs and event-driven integrations for inventory management and dealer operations.\nIntroduced Redis caching layers reducing average API response times by ~40%.\nOn-call rotations, production stability, post-incident reviews." },
    { company: 'SS&C Primatics', title: 'Senior Software Engineer', startDate: '2016', endDate: '2019', isCurrent: false, description: 'Designed GAAP-compliant loan accounting engines and regulatory reporting pipelines processing millions of financial records for institutional banking clients.\nLed a team of 4 engineers to deliver a major platform release coordinating across US stakeholders.\nBuilt automated financial data validation and reconciliation tools eliminating manual reporting errors.' },
    { company: 'Gameview Studios', title: 'Software Engineer', startDate: '2015', endDate: '2016', isCurrent: false, description: 'Backend game services and REST APIs for real-time multiplayer features, leaderboards, player progression.\nScalable player reward and engagement systems (Java, MySQL) handling concurrent user activity.' },
    { company: 'Softech Worldwide', title: 'Software Engineer', startDate: '2014', endDate: '2015', isCurrent: false, description: 'Enterprise web application backends (Java EE, Spring Framework) for banking and telecom clients.\nREST and SOAP integrations between core banking systems and front-end portals.' },
];

const DEFAULT_EDUCATION_HISTORY = [
    { school: 'FAST – National University of Computer and Emerging Sciences', degree: 'Bachelor of Science in Computer Science' },
];

const DEFAULT_PERSONAL_SYNC = {
    firstName: 'Mubashir', lastName: 'Ali',
    email: 'mubashir.ali.memon@gmail.com', phone: '+1 573-435-2970',
    addressLine1: '', city: 'Columbia', stateProvince: 'Missouri', postalCode: '', country: 'USA',
    linkedinUrl: 'https://linkedin.com/in/mubashir-ali992',
    websiteUrl: 'https://mubashir-ali.netlify.app/',
    skills: 'Java, Kotlin, SQL, Spring Boot, Spring Cloud, Hibernate, JPA, AWS (EKS, SNS/SQS, RDS, S3, Lambda), Docker, Kubernetes, PostgreSQL, MySQL, Redis, MongoDB, Microservices, Event-Driven Architecture, REST APIs, CQRS, Outbox Pattern, GitHub Actions, Jenkins, Drone CI, Argo CD, JUnit 5, Mockito, TestContainers, Contract Testing (Pact), Datadog, Grafana, Kibana, Maven, Gradle',
    gender: '', race: '', veteranStatus: '', disabilityStatus: '', pronouns: '',
    isAuthorizedInUS: 'Yes – J-2 EAD', requireSponsorship: 'No',
    expectedSalary: '$90,000–$200,000 USD', startDate: 'Immediately / flexible',
    parserType: 'local', aiProviderUrl: '', aiModel: 'deepseek/deepseek-chat', aiApiKey: '',
};

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

    // Seed structured work/education history and personal data if not already done.
    // Runs on install AND on extension reload so existing users also get the data.
    const { workHistorySeeded } = await chrome.storage.local.get('workHistorySeeded');
    if (!workHistorySeeded) {
        const existing = await chrome.storage.local.get(['workHistory', 'educationHistory']);
        const localUpdates = { workHistorySeeded: true };
        if (!existing.workHistory?.length) localUpdates.workHistory = DEFAULT_WORK_HISTORY;
        if (!existing.educationHistory?.length) localUpdates.educationHistory = DEFAULT_EDUCATION_HISTORY;
        await chrome.storage.local.set(localUpdates);

        // Seed personal sync fields only if firstName is empty (never manually configured)
        const { firstName } = await chrome.storage.sync.get('firstName');
        if (!firstName) {
            await chrome.storage.sync.set(DEFAULT_PERSONAL_SYNC);
            console.log('[AutoApplyMax] Personal profile data seeded from defaults.');
        }
        console.log('[AutoApplyMax] Work/education history seeded.');
    }

    // Legacy first-install stub (kept for clean initialization on brand new installs).
    if (details.reason === 'install') {
        const { profilePrepopulated } = await chrome.storage.local.get('profilePrepopulated');
        if (!profilePrepopulated) {
            await chrome.storage.local.set({ profilePrepopulated: true });
        }
    }
});


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

    if (message.action === 'aiApiFetch') {
        // Service worker fetches on behalf of the content script to bypass CORS.
        // AI provider endpoints don't include Access-Control-Allow-Origin for job site origins.
        (async () => {
            const { url, headers, requestBody } = message;
            try {
                let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });

                // Some models don't support response_format — retry without it on 400
                if (!response.ok && response.status === 400) {
                    const errText = await response.text();
                    if (errText.includes('response_format')) {
                        const retryBody = { ...requestBody };
                        delete retryBody.response_format;
                        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(retryBody) });
                    } else {
                        sendResponse({ success: false, error: `AI API error ${response.status}: ${errText}` });
                        return;
                    }
                }

                if (!response.ok) {
                    const errText = await response.text();
                    sendResponse({ success: false, error: `AI API error ${response.status}: ${errText}` });
                    return;
                }

                const data = await response.json();
                sendResponse({ success: true, data });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
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
