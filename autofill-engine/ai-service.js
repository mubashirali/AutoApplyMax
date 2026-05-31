async function getAiFieldAnalysis(pageContent, userMapping) {
    const config = await chrome.storage.sync.get(['aiProviderUrl', 'aiApiKey', 'aiModel']);
    const url = config.aiProviderUrl?.trim();
    const apiKey = config.aiApiKey?.trim();
    const model = config.aiModel?.trim() || 'deepseek/deepseek-chat';

    if (!url || !apiKey) {
        throw new Error('AI Provider URL or API Key is not configured. Open the extension popup → Settings → AI Enhanced.');
    }

    // Strip scripts/styles and cap HTML to save tokens.
    // 40k chars ≈ ~10k tokens — enough for any ATS form page.
    const compactHtml = pageContent
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .substring(0, 40000);

    const profileJson = JSON.stringify(userMapping, null, 2);

    const prompt = `You are an ATS form autofill assistant. Given job application page HTML and a user profile, identify all fillable form fields and return which profile value should go into each field.

User profile:
${profileJson}

Return ONLY valid JSON, no explanation, no markdown fences:
{ "fields": [ { "selector": "CSS_SELECTOR", "value": "VALUE_FROM_PROFILE" } ] }

Rules:
- Use the most specific stable CSS selector: prefer #id, then [name="x"], then [aria-label="x"]
- Only include fields where you can confidently match a profile value
- For SELECT elements, set value to the exact text of the matching option
- Skip fields with no matching profile data

Page HTML:
${compactHtml}`;

    const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
    };

    // response_format json_object is supported by OpenAI, DeepSeek, and most OpenRouter models.
    // Models that don't support it (some Llama, Claude via OpenRouter) will return an error —
    // we retry without it in that case.
    const SUPPORTS_JSON_FORMAT = true; // Attempt it; retry without if API rejects
    if (SUPPORTS_JSON_FORMAT) {
        requestBody.response_format = { type: 'json_object' };
    }

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };

    // OpenRouter attribution headers (optional but recommended)
    if (url.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://github.com/mubashir-ali/AutoApplyMax';
        headers['X-Title'] = 'AutoApplyMax';
    }

    let response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
    });

    // If the model rejected response_format, retry without it
    if (!response.ok && response.status === 400) {
        const errText = await response.text();
        if (errText.includes('response_format') || errText.includes('json_object')) {
            console.warn('[AutoApplyMax] Model does not support response_format json_object, retrying without it.');
            delete requestBody.response_format;
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
            });
        } else {
            throw new Error(`AI API error ${response.status}: ${errText}`);
        }
    }

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`AI API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
        throw new Error('AI API returned an empty response.');
    }

    return extractJson(rawContent);
}

function extractJson(content) {
    // 1. Try parsing directly (ideal case — model returned clean JSON)
    try {
        return JSON.parse(content);
    } catch (_) {}

    // 2. Strip markdown code fences: ```json ... ``` or ``` ... ```
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }

    // 3. Find the first { ... } block in the string
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
        try { return JSON.parse(braceMatch[0]); } catch (_) {}
    }

    throw new Error(`Could not parse JSON from AI response. Raw: ${content.substring(0, 200)}`);
}
