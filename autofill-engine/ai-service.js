async function getAiFieldAnalysis(pageContent, userMapping, profileMarkdown) {
    const config = await chrome.storage.sync.get(['aiProviderUrl', 'aiApiKey', 'aiModel']);
    const url = config.aiProviderUrl?.trim();
    const apiKey = config.aiApiKey?.trim();
    const model = config.aiModel?.trim() || 'deepseek/deepseek-chat';

    if (!url || !apiKey) {
        throw new Error('AI Provider URL or API Key is not configured. Open the extension popup → Settings → AI Enhanced.');
    }

    // Build the context the AI will reason from.
    // Priority: profileMarkdown (rich) → structured fields fallback.
    const profileContext = profileMarkdown?.trim()
        ? profileMarkdown.trim()
        : buildFallbackProfile(userMapping);

    // Strip scripts/styles and cap to save tokens (~40k chars ≈ 10k tokens).
    const compactHtml = pageContent
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .substring(0, 40000);

    const prompt = `You are a job application AI agent. Fill every form field in the HTML below on behalf of the applicant. Use their profile as ground truth.

## Applicant Profile
${profileContext}

## Decision Rules (apply in order for each field)

### Always auto-fill these (no profile lookup needed):
- **Acknowledgment / consent** — any field whose label contains "I acknowledge", "I agree", "I consent", "I certify", "privacy policy", "terms", "pre-employment statement" → select or enter the affirmative option ("I Consent", "Yes", "I Agree", "I acknowledge", "Agree", etc.)
- **Referral** — "Were you referred / who referred you" → "N/A" unless profile states a referral
- **Relatives at company** — "Do you have relatives / family members at [Company]" → "No" unless profile states otherwise
- **Previously worked at [Company]** — "Have you worked for [Company]" → check profile work history; answer "No" if that company is not in the history

### Map from profile:
- **Full legal name** → firstName + " " + lastName
- **City / State / Province** → from address in profile
- **Work authorization** — "Are you authorized to work", "work status" → use profile authorization info; open text fields → write 1-2 sentences from profile
- **Salary / pay expectations** → from profile
- **Start date / availability** → from profile

### AI reasoning required (SELECT fields with experience/skills options):
- Read the question AND all available <option> texts
- Match to the applicant's experience level and skills in the profile
- Pick the option that most accurately reflects their background
- For numbered/lettered experience tiers (A. <1 year, B. 1-3 years, C. 3-5 years, D. 5-10 years, E. 10+ years) → estimate years from profile work history and pick accordingly

### Open text / textarea — generate a concise answer:
- "Please describe your background and how it relates to this role" → 2-3 sentences from work history relevant to the role
- "Describe your work authorization status" → 1 sentence from profile
- Any other open text question → answer directly and factually from profile in 1-3 sentences

## Output Format
Return ONLY valid JSON, no explanation, no markdown fences:
{ "fields": [ { "selector": "MOST_SPECIFIC_CSS_SELECTOR", "value": "ANSWER" } ] }

Selector priority: #id > [name="x"] > [aria-label="x"] > textarea, input, select (with surrounding context)
Only include fields you can answer. Skip file upload inputs.

## Form HTML
${compactHtml}`;

    const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };

    if (url.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://github.com/AutoApplyMax/AutoApplyMax';
        headers['X-Title'] = 'AutoApplyMax';
    }

    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });

    // Some models (Claude via OpenRouter, some Llama variants) reject response_format — retry without it
    if (!response.ok && response.status === 400) {
        const errText = await response.text();
        if (errText.includes('response_format') || errText.includes('json_object')) {
            console.warn('[AutoApplyMax] Model does not support response_format, retrying without it.');
            delete requestBody.response_format;
            response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });
        } else {
            throw new Error(`AI API error ${response.status}: ${errText}`);
        }
    }

    if (!response.ok) {
        throw new Error(`AI API error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error('AI API returned an empty response.');

    return extractJson(rawContent);
}

function buildFallbackProfile(userMapping) {
    // When no profileMarkdown is set, build a minimal profile from the structured fields
    // so the AI still has enough context to make decisions.
    const u = userMapping;
    return `
# Applicant Profile

## Personal
- Full Name: ${u.firstName || ''} ${u.lastName || ''}
- Email: ${u.email || ''}
- Phone: ${u.phone || ''}
- Address: ${u.addressLine1 || ''}, ${u.city || ''}, ${u.country || ''} ${u.postalCode || ''}

## Work Authorization
- Authorized to work: ${u.isAuthorizedInUS || 'Yes'}
- Requires sponsorship: ${u.requireSponsorship || 'No'}

## EEO
- Gender: ${u.gender || ''}
- Race/Ethnicity: ${u.race || ''}
- Veteran Status: ${u.veteranStatus || ''}
- Disability Status: ${u.disabilityStatus || ''}

## Skills
${u.skills || ''}

## Preferences
- Expected Salary: ${u.expectedSalary || ''}
- Available Start Date: ${u.startDate || ''}

## Default Answers
- Referred by: N/A
- Relatives at prospective employer: No
- Previously worked at prospective employer: No (unless listed in work history above)
`.trim();
}

function extractJson(content) {
    // 1. Direct parse (ideal — model returned clean JSON)
    try { return JSON.parse(content); } catch (_) {}

    // 2. Strip markdown code fences: ```json ... ``` or ``` ... ```
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }

    // 3. Find the first { ... } block
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
        try { return JSON.parse(braceMatch[0]); } catch (_) {}
    }

    throw new Error(`Could not parse JSON from AI response. Raw: ${content.substring(0, 300)}`);
}
