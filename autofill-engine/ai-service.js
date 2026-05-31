async function getAiFieldAnalysis(fieldManifest, userMapping, profileMarkdown) {
    const config = await chrome.storage.sync.get(['aiProviderUrl', 'aiApiKey', 'aiModel']);
    const url = config.aiProviderUrl?.trim();
    const apiKey = config.aiApiKey?.trim();
    const model = config.aiModel?.trim() || 'deepseek/deepseek-chat';

    if (!url || !apiKey) {
        throw new Error('AI Provider URL or API Key is not configured. Open the extension popup → Settings → AI Enhanced.');
    }

    const profileContext = profileMarkdown?.trim()
        ? profileMarkdown.trim()
        : buildFallbackProfile(userMapping);

    const manifestJson = JSON.stringify(fieldManifest, null, 2);

    const prompt = `You are a job application assistant. Fill the form fields below on behalf of the applicant using their profile.

## Applicant Profile
${profileContext}

## Form Fields (only those needing AI judgment)
Each field has: i (index), label, type, and options (for select fields).

${manifestJson}

## Rules

**Auto-fill without profile lookup:**
- Acknowledgment/consent fields ("I acknowledge", "I agree", "I consent", "privacy policy", "terms") → pick the affirmative option
- "Were you referred / who referred you" → "N/A"
- "Relatives at company" → "No"
- "Previously worked here" → "No" unless profile work history includes that company

**Map from profile:**
- Work authorization / authorized to work → profile authorization field
- Salary / pay expectations → profile expected salary
- Start date / availability → profile start date
- Name, city, country, address → profile address fields

**SELECT fields:** value must exactly match one of the provided options strings.

**Textarea / open text:** answer directly and factually in 1-3 sentences from profile.

**Skip** file inputs. Only include fields you can answer confidently.

## Output
Return ONLY valid JSON, no markdown fences, no explanation:
{ "fields": [{ "i": <index>, "value": "<answer>" }] }`;

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
    try { return JSON.parse(content); } catch (_) {}

    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }

    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
        try { return JSON.parse(braceMatch[0]); } catch (_) {}
    }

    throw new Error(`Could not parse JSON from AI response. Raw: ${content.substring(0, 300)}`);
}
