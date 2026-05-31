document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupTabs();
    setupAutoSave();
    setupStartButton(); // New function for the main button
    setupParserSelection();
});

function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
        });
    });
}

async function loadConfig() {
    const syncData = await chrome.storage.sync.get([
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'postalCode', 'country', 'skills',
        'gender', 'race', 'veteranStatus', 'disabilityStatus', 'pronouns',
        'parserType', 'aiProviderUrl', 'aiModel', 'aiApiKey'
    ]);
    const localData = await chrome.storage.local.get(['workHistory', 'educationHistory', 'profileMarkdown']);

    for (const key in syncData) {
        const element = document.getElementById(key);
        if (element) element.value = syncData[key] || '';
    }
    
    const parserType = syncData.parserType || 'local';
    document.getElementById('parser-type').value = parserType;
    document.getElementById('ai-settings').style.display = parserType === 'ai' ? 'block' : 'none';

    const profileMarkdownEl = document.getElementById('profileMarkdown');
    if (profileMarkdownEl) profileMarkdownEl.value = localData.profileMarkdown || '';

    const workList = document.getElementById('work-history-list');
    if (localData.workHistory && workList) {
        workList.innerHTML = localData.workHistory.map(job => `
            <div class="history-item">
                <strong>${job.title}</strong> at ${job.company}
                <details><summary>View Description</summary><p>${job.description?.replace(/\n/g, '<br>') || ''}</p></details>
            </div>
        `).join('');
    }
    const eduList = document.getElementById('education-history-list');
    if (localData.educationHistory && eduList) {
        eduList.innerHTML = localData.educationHistory.map(edu => `
            <div class="history-item"><strong>${edu.degree}</strong> from ${edu.school}</div>
        `).join('');
    }
}

function setupAutoSave() {
    const fieldsToSave = [
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'postalCode', 'country', 'skills',
        'gender', 'race', 'veteranStatus', 'disabilityStatus', 'pronouns',
        'aiProviderUrl', 'aiModel', 'aiApiKey'
    ];
    fieldsToSave.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('input', saveConfig);
    });
    document.getElementById('parser-type').addEventListener('change', saveConfig);
    const profileMarkdownEl = document.getElementById('profileMarkdown');
    if (profileMarkdownEl) profileMarkdownEl.addEventListener('input', saveConfig);
}

async function saveConfig() {
    const syncData = {};
    const fieldsToSave = [
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'postalCode', 'country', 'skills',
        'gender', 'race', 'veteranStatus', 'disabilityStatus', 'pronouns',
        'parserType', 'aiProviderUrl', 'aiModel', 'aiApiKey'
    ];
    fieldsToSave.forEach(id => {
        const element = document.getElementById(id);
        if (element) syncData[id] = element.value;
    });
    await chrome.storage.sync.set(syncData);

    // profileMarkdown goes to local storage — too large for sync (8KB limit per key)
    const profileMarkdownEl = document.getElementById('profileMarkdown');
    if (profileMarkdownEl) {
        await chrome.storage.local.set({ profileMarkdown: profileMarkdownEl.value });
    }

    console.log('Configuration saved.');
}

function setupParserSelection() {
    const parserTypeSelect = document.getElementById('parser-type');
    const aiSettings = document.getElementById('ai-settings');
    parserTypeSelect.addEventListener('change', (e) => {
        aiSettings.style.display = e.target.value === 'ai' ? 'block' : 'none';
    });
}

function setupStartButton() {
    const startButton = document.getElementById('start-autofill-btn');
    startButton.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.startsWith('http')) {
            alert('Please open a valid job application page to start autofill.');
            return;
        }

        startButton.disabled = true;
        startButton.textContent = 'Filling...';

        try {
            // The background script will handle injecting all necessary files
            const response = await chrome.runtime.sendMessage({ action: 'injectAutofillScripts' });
            if (!response || !response.success) {
                throw new Error(response?.error || 'Failed to inject scripts.');
            }
            // Close the popup after starting the process
            window.close();
        } catch (e) {
            console.error('[AutoApplyMax] Error starting autofill:', e);
            alert(`An error occurred: ${e.message}. Please reload the page and try again.`);
            startButton.disabled = false;
            startButton.textContent = 'Start Autofill';
        }
    });
}
