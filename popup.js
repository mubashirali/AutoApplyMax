document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupTabs();
    setupAutoSave();
    setupStartButton();
    setupParserSelection();
    setupResumeUpload();
    document.getElementById('add-work-btn').addEventListener('click', addWorkEntry);
    document.getElementById('add-edu-btn').addEventListener('click', addEduEntry);
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
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'stateProvince', 'postalCode', 'country', 'skills',
        'linkedinUrl', 'websiteUrl',
        'gender', 'race', 'veteranStatus', 'disabilityStatus', 'pronouns',
        'parserType', 'aiProviderUrl', 'aiModel', 'aiApiKey'
    ]);
    const localData = await chrome.storage.local.get(['workHistory', 'educationHistory', 'profileMarkdown', 'resumeFileName']);

    for (const key in syncData) {
        const element = document.getElementById(key);
        if (element) element.value = syncData[key] || '';
    }

    const parserType = syncData.parserType || 'local';
    document.getElementById('parserType').value = parserType;
    document.getElementById('ai-settings').style.display = parserType === 'ai' ? 'block' : 'none';

    const profileMarkdownEl = document.getElementById('profileMarkdown');
    if (profileMarkdownEl) profileMarkdownEl.value = localData.profileMarkdown || '';

    setResumeDisplay(localData.resumeFileName || null);

    renderWorkHistory(localData.workHistory || []);
    renderEduHistory(localData.educationHistory || []);
}

function setupAutoSave() {
    const fieldsToSave = [
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'stateProvince', 'postalCode', 'country', 'skills',
        'linkedinUrl', 'websiteUrl',
        'gender', 'race', 'veteranStatus', 'disabilityStatus', 'pronouns',
        'aiProviderUrl', 'aiModel', 'aiApiKey'
    ];
    fieldsToSave.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('input', saveConfig);
    });
    document.getElementById('parserType').addEventListener('change', saveConfig);
    const profileMarkdownEl = document.getElementById('profileMarkdown');
    if (profileMarkdownEl) profileMarkdownEl.addEventListener('input', saveConfig);
}

async function saveConfig() {
    const syncData = {};
    const fieldsToSave = [
        'firstName', 'lastName', 'email', 'phone', 'addressLine1', 'city', 'stateProvince', 'postalCode', 'country', 'skills',
        'linkedinUrl', 'websiteUrl',
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
    const parserTypeSelect = document.getElementById('parserType');
    const aiSettings = document.getElementById('ai-settings');
    parserTypeSelect.addEventListener('change', (e) => {
        aiSettings.style.display = e.target.value === 'ai' ? 'block' : 'none';
    });
}

// ── History Tab CRUD ─────────────────────────────────────────────────────────

let _workHistory = [];
let _eduHistory = [];

function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderWorkHistory(list) {
    _workHistory = list.map(j => ({ ...j }));
    const el = document.getElementById('work-history-list');
    if (!_workHistory.length) {
        el.innerHTML = '<p class="hist-empty">No entries. Click + Add to add one.</p>';
        return;
    }
    el.innerHTML = _workHistory.map((job, i) => `
        <details class="hist-card">
            <summary class="hist-summary">
                <span class="hist-meta">
                    <strong>${escHtml(job.title || 'Untitled')}</strong>
                    ${job.company ? `<em> · ${escHtml(job.company)}</em>` : ''}
                    <span class="hist-dates">${escHtml(job.startDate || '')}${job.isCurrent ? ' – Present' : job.endDate ? ' – ' + escHtml(job.endDate) : ''}</span>
                </span>
                <button class="btn-hist-del" data-t="work" data-i="${i}">✕</button>
            </summary>
            <div class="hist-form">
                <div class="form-row">
                    <div class="form-group"><label>Title</label><input type="text" data-t="work" data-i="${i}" data-f="title" value="${escHtml(job.title||'')}"></div>
                    <div class="form-group"><label>Company</label><input type="text" data-t="work" data-i="${i}" data-f="company" value="${escHtml(job.company||'')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Start</label><input type="text" placeholder="2020" data-t="work" data-i="${i}" data-f="startDate" value="${escHtml(job.startDate||'')}"></div>
                    <div class="form-group"><label>End</label><input type="text" placeholder="2022" data-t="work" data-i="${i}" data-f="endDate" value="${escHtml(job.endDate||'')}"></div>
                </div>
                <div class="form-group">
                    <label class="hist-check-label">
                        <input type="checkbox" data-t="work" data-i="${i}" data-f="isCurrent" ${job.isCurrent ? 'checked' : ''}> Currently working here
                    </label>
                </div>
                <div class="form-group"><label>Description</label><textarea data-t="work" data-i="${i}" data-f="description" rows="4">${escHtml(job.description||'')}</textarea></div>
            </div>
        </details>
    `).join('');
    attachHistListeners(el, 'work');
}

function renderEduHistory(list) {
    _eduHistory = list.map(e => ({ ...e }));
    const el = document.getElementById('education-history-list');
    if (!_eduHistory.length) {
        el.innerHTML = '<p class="hist-empty">No entries. Click + Add to add one.</p>';
        return;
    }
    el.innerHTML = _eduHistory.map((edu, i) => `
        <details class="hist-card">
            <summary class="hist-summary">
                <span class="hist-meta">
                    <strong>${escHtml(edu.degree || 'Untitled')}</strong>
                    ${edu.school ? `<em> · ${escHtml(edu.school)}</em>` : ''}
                </span>
                <button class="btn-hist-del" data-t="edu" data-i="${i}">✕</button>
            </summary>
            <div class="hist-form">
                <div class="form-group"><label>Degree / Qualification</label><input type="text" data-t="edu" data-i="${i}" data-f="degree" value="${escHtml(edu.degree||'')}"></div>
                <div class="form-group"><label>School / Institution</label><input type="text" data-t="edu" data-i="${i}" data-f="school" value="${escHtml(edu.school||'')}"></div>
            </div>
        </details>
    `).join('');
    attachHistListeners(el, 'edu');
}

function attachHistListeners(container, type) {
    container.querySelectorAll('[data-f]').forEach(el => {
        el.addEventListener(el.tagName === 'TEXTAREA' || el.type === 'text' ? 'input' : 'change', onHistChange);
    });
    container.querySelectorAll('.btn-hist-del').forEach(btn => {
        btn.addEventListener('click', onHistDelete);
    });
}

function onHistChange(e) {
    const { t: type, i, f } = e.currentTarget.dataset;
    const arr = type === 'work' ? _workHistory : _eduHistory;
    arr[parseInt(i)][f] = e.currentTarget.type === 'checkbox' ? e.currentTarget.checked : e.currentTarget.value;
    saveHistDebounced();
}

function onHistDelete(e) {
    e.stopPropagation();
    const { t: type, i } = e.currentTarget.dataset;
    if (type === 'work') {
        _workHistory.splice(parseInt(i), 1);
        renderWorkHistory(_workHistory);
    } else {
        _eduHistory.splice(parseInt(i), 1);
        renderEduHistory(_eduHistory);
    }
    saveHistory();
}

function addWorkEntry() {
    _workHistory.push({ company: '', title: '', startDate: '', endDate: '', isCurrent: false, description: '' });
    renderWorkHistory(_workHistory);
    const cards = document.querySelectorAll('#work-history-list .hist-card');
    if (cards.length) cards[cards.length - 1].open = true;
    saveHistory();
}

function addEduEntry() {
    _eduHistory.push({ school: '', degree: '' });
    renderEduHistory(_eduHistory);
    const cards = document.querySelectorAll('#education-history-list .hist-card');
    if (cards.length) cards[cards.length - 1].open = true;
    saveHistory();
}

let _histSaveTimer = null;
function saveHistDebounced() {
    clearTimeout(_histSaveTimer);
    _histSaveTimer = setTimeout(saveHistory, 600);
}

async function saveHistory() {
    await chrome.storage.local.set({ workHistory: _workHistory, educationHistory: _eduHistory });
}

// ─────────────────────────────────────────────────────────────────────────────

function setResumeDisplay(fileName) {
    const nameEl = document.getElementById('resume-name');
    const removeBtn = document.getElementById('resume-remove');
    if (fileName) {
        nameEl.textContent = fileName;
        nameEl.classList.add('has-file');
        removeBtn.style.display = 'inline-flex';
    } else {
        nameEl.textContent = 'No resume uploaded';
        nameEl.classList.remove('has-file');
        removeBtn.style.display = 'none';
    }
}

function setupResumeUpload() {
    const input = document.getElementById('resume-upload');
    const removeBtn = document.getElementById('resume-remove');

    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            await chrome.storage.local.set({
                resumeFile: e.target.result,
                resumeFileName: file.name,
                resumeFileType: file.type,
            });
            setResumeDisplay(file.name);
            console.log('[AutoApplyMax] Resume saved:', file.name);
        };
        reader.readAsDataURL(file);
        input.value = ''; // reset so same file can be re-uploaded
    });

    removeBtn.addEventListener('click', async () => {
        await chrome.storage.local.remove(['resumeFile', 'resumeFileName', 'resumeFileType']);
        setResumeDisplay(null);
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
            const response = await chrome.runtime.sendMessage({ action: 'injectAutofillScripts' });
            if (!response || !response.success) {
                throw new Error(response?.error || 'Failed to inject scripts.');
            }
            window.close();
        } catch (e) {
            console.error('[AutoApplyMax] Error starting autofill:', e);
            alert(`An error occurred: ${e.message}. Please reload the page and try again.`);
            startButton.disabled = false;
            startButton.textContent = 'Start Autofill';
        }
    });
}
