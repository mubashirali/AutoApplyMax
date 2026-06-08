async function getAiFieldAnalysis(fieldManifest, userMapping, workHistory, educationHistory) {
    const config = await chrome.storage.sync.get(['aiProviderUrl', 'aiApiKey', 'aiModel']);
    const url = config.aiProviderUrl?.trim();
    const apiKey = config.aiApiKey?.trim();
    const model = config.aiModel?.trim() || 'deepseek/deepseek-chat';

    if (!url || !apiKey) {
        throw new Error('AI Provider URL or API Key is not configured.');
    }

    const profileMarkdown = buildProfileMarkdown(userMapping, workHistory, educationHistory);
    const manifestJson = JSON.stringify(fieldManifest, null, 2);

    const prompt = `You are a job application assistant. Fill the form fields below using the applicant's profile.

## Applicant Profile
${profileMarkdown}

## Form Fields (only those needing AI judgment)
${manifestJson}

## Rules
- Answer fields based on the profile. Use the job descriptions from the work history to answer experience-related questions.
- For SELECT fields, the value must exactly match one of the provided options.
- For open text fields (textarea), answer factually and concisely based on the profile.
- Acknowledge consent/privacy policy fields with an affirmative answer.
- Skip file inputs. Only include fields you can answer confidently.

## Output
Return ONLY valid JSON: { "fields": [{ "i": <index>, "value": "<answer>" }] }`;

    const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
    };

    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    if (url.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://github.com/AutoApplyMax/AutoApplyMax';
        headers['X-Title'] = 'AutoApplyMax';
    }

    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });

    // Some models (e.g. older DeepSeek) don't support response_format — retry without it
    if (!response.ok && response.status === 400) {
        const errText = await response.text();
        if (errText.includes('response_format')) {
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

function buildProfileMarkdown(user, work, edu) {
    let markdown = `# Applicant Profile\n\n`;
    markdown += `## Personal\n- Name: ${user.firstName || ''} ${user.lastName || ''}\n- Email: ${user.email || ''}\n- Phone: ${user.phone || ''}\n- Location: ${user.city || ''}, ${user.country || ''}\n\n`;
    markdown += `## Professional Summary\n- Skills: ${user.skills || ''}\n- Expected Salary: ${user.expectedSalary || ''}\n- Available Start Date: ${user.startDate || ''}\n\n`;
    markdown += `## Work Authorization\n- Authorized to work in the US: ${user.isAuthorizedInUS || 'Yes'}\n- Requires sponsorship: ${user.requireSponsorship || 'No'}\n\n`;

    if (edu?.length) {
        markdown += `## Education\n`;
        edu.forEach(e => {
            markdown += `- **${e.degree}** from ${e.school}\n`;
        });
        markdown += '\n';
    }

    if (work?.length) {
        markdown += `## Work Experience\n`;
        work.forEach(w => {
            markdown += `### ${w.title} at ${w.company} (${w.startDate} - ${w.isCurrent ? 'Present' : w.endDate})\n`;
            markdown += `${w.description}\n\n`;
        });
    }
    return markdown;
}

function extractJson(content) {
    try { return JSON.parse(content); } catch (_) {}
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) { try { return JSON.parse(fenceMatch[1].trim()); } catch (_) {} }
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch (_) {} }
    throw new Error(`Could not parse JSON from AI response.`);
}
