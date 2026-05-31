async function getAiFieldAnalysis(pageContent, userMapping) {
    const config = await chrome.storage.sync.get(['aiProviderUrl', 'aiApiKey']);
    const url = config.aiProviderUrl;
    const apiKey = config.aiApiKey;

    if (!url || !apiKey) {
        throw new Error('AI Provider URL or API Key is not configured in the extension settings.');
    }

    // Send a compact version of the HTML — strip scripts and styles to save tokens
    const compactHtml = pageContent
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .substring(0, 40000); // Hard cap at 40k chars

    const profileJson = JSON.stringify(userMapping, null, 2);

    const prompt = `You are an ATS form autofill assistant. Given job application page HTML and a user profile, identify all fillable form fields and return which profile value should go into each field.

User profile:
${profileJson}

Return ONLY valid JSON in this exact format — no explanation, no markdown, no code fences:
{ "fields": [ { "selector": "CSS_SELECTOR", "value": "VALUE_FROM_PROFILE" } ] }

Rules:
- Use the most specific stable CSS selector (prefer id > name > aria-label attribute selectors)
- Only include fields where you can confidently match a profile value
- For SELECT elements, set value to the exact text of the option that best matches (the orchestrator will fuzzy-match it)
- Skip fields with no matching profile data

Page HTML:
${compactHtml}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini', // Cost-effective default; user can point to any OpenAI-compatible endpoint
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`AI API request failed with status ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
}
