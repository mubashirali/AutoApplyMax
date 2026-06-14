async function getAiFieldAnalysis(fieldManifest, userMapping, workHistory, educationHistory, profileMarkdown, pageContext) {
    const config = await chrome.storage.sync.get(['aiProviderUrl', 'aiApiKey', 'aiModel']);
    const url = config.aiProviderUrl?.trim();
    const apiKey = config.aiApiKey?.trim();
    const model = config.aiModel?.trim() || 'deepseek/deepseek-chat';

    if (!url || !apiKey) {
        throw new Error('AI Provider URL or API Key is not configured.');
    }

    const manifestJson = JSON.stringify(fieldManifest, null, 2);
    const u = userMapping;

    // Use the rich profileMarkdown if available; fall back to structured data only
    const profileSection = profileMarkdown
        ? profileMarkdown
        : buildProfileMarkdown(userMapping, workHistory, educationHistory);

    const prompt = `You are filling out a job application form on behalf of the applicant. Answer as many fields as possible.

## Job Context
- Page: ${pageContext?.title || '(unknown)'}
- URL: ${pageContext?.url || '(unknown)'}

## Applicant's Full Profile
${profileSection}

## Quick Reference
- Name: ${u.firstName || ''} ${u.lastName || ''}
- Email: ${u.email || ''}
- Phone: ${u.phone || ''}
- Location: ${u.city || ''}${u.stateProvince ? ', ' + u.stateProvince : ''}, ${u.country || ''}
- LinkedIn: ${u.linkedinUrl || 'see profile above'}
- Website: ${u.websiteUrl || 'see profile above'}
- Skills: ${u.skills || ''}
- Expected Salary: ${u.expectedSalary || ''}
- Available From: ${u.startDate || ''}
- US Work Auth: ${u.isAuthorizedInUS || 'Yes'}
- Visa Sponsorship Needed: ${u.requireSponsorship || 'No'}

## Unfilled Form Fields
${manifestJson}

## Field Type Rules — STRICTLY FOLLOW THESE
Each field has a "type". Your answer format depends on the type:

- **select** — You MUST pick exactly one string from the "options" array. Do not invent values.
- **radio** — You MUST pick exactly one string from the "options" array. Do not invent values.
- **checkbox** — Answer must be "true" (check it) or "false" (leave unchecked).
- **textarea** — Write a complete, professional multi-sentence answer in first person.
- **text / email / tel / url / number** — Write the appropriate value (email address, phone number, URL, etc.).

## Content Rules
1. Fill ALL fields you can reasonably answer — be comprehensive, not conservative.
2. Write text answers in first person, professional tone.
3. "Why are you interested in [company]?" — Write a compelling 2-3 sentence answer connecting the applicant's experience/skills to the company's domain. Use the page title/URL for company context.
4. LinkedIn URL (type=url or type=text labelled "linkedin") — provide the LinkedIn URL from the profile (search for linkedin.com link).
5. Website/portfolio URL fields — provide the personal website URL from the profile.
6. "How did you hear about us?" open-text follow-ups — write "LinkedIn" or "online job board".
7. Referral name/email fields — if no referral in profile, write "N/A".
8. Conditional questions ("if you answered X, share Y") — only answer if the condition clearly applies.
9. Consent, acknowledgment, agreement fields — always affirm ("Yes", "I agree", or "true" for checkboxes).
10. Salary fields — use the expected salary from quick reference.
11. Skip file upload fields (type=file).

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

    // Fetch is routed through the background service worker to avoid CORS.
    // Content scripts run as the page's origin — AI providers block cross-origin requests.
    // The service worker runs as the extension origin and bypasses CORS entirely.
    const result = await chrome.runtime.sendMessage({
        action: 'aiApiFetch',
        url,
        headers,
        requestBody,
    });

    if (!result.success) {
        throw new Error(result.error);
    }

    const rawContent = result.data.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error('AI API returned an empty response.');
    return extractJson(rawContent);
}

function buildProfileMarkdown(user, work, edu) {
    let markdown = `# Applicant Profile\n\n`;
    markdown += `## Personal\n- Name: ${user.firstName || ''} ${user.lastName || ''}\n- Email: ${user.email || ''}\n- Phone: ${user.phone || ''}\n- Location: ${user.city || ''}${user.stateProvince ? ', ' + user.stateProvince : ''}, ${user.country || ''}\n`;
    if (user.linkedinUrl) markdown += `- LinkedIn: ${user.linkedinUrl}\n`;
    if (user.websiteUrl) markdown += `- Website: ${user.websiteUrl}\n`;
    markdown += '\n';
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
