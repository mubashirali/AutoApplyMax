# AutoApplyMax

**A Chrome extension that autofills job application forms on any ATS platform.**

Navigate to a job application page, click **Start Autofill**, and the extension detects form fields, maps them to your stored profile, fills them in, and highlights anything it couldn't fill so you can review before submitting.

No backend. No build step. No bundler. All data stays local in Chrome storage. Open-source (AGPL-3.0).

---

## Install (Developer Mode)

1. Clone this repo: `git clone https://github.com/Azoo92i/AutoApplyMax.git`
2. Open `chrome://extensions/` → enable **Developer mode**
3. Click **Load unpacked** → select the cloned folder
4. Navigate to any job application page → click the extension icon → **Start Autofill**

> After editing any file: click the reload icon on the extension card in `chrome://extensions/`, then reload the job page.

---

## How It Works

```
User clicks "Start Autofill"
  → Extension detects form fields on the page (inputs, selects, textareas)
  → Fields are scored against your profile using label/id/name + fuzzy matching
  → Matched fields are filled; confidence shown via green (high) / yellow (low) borders
  → Resume file input is found and uploaded automatically
  → Report panel shows fill progress (required vs optional fields)
  → Unfilled required fields highlighted in red for manual review
```

---

## Autofill Engines

### Local Heuristic (default, free, private)

Scores each page field against your profile using:
- Exact match on `id` or `name` attribute → score 1.0
- Exact match on label text → 0.9
- Dice-coefficient similarity > 0.80 on label → 0.85
- Word-boundary match → 0.75
- Substring match → 0.6 (only accepted above 0.7 threshold)

Handles: text inputs, `<select>` dropdowns (exact + fuzzy match), radio buttons, checkboxes, file inputs (resume upload).

### AI Enhanced (requires API key)

Runs the heuristic pass first, then sends any unfilled fields to an OpenAI-compatible endpoint (OpenRouter, DeepSeek, OpenAI) for intelligent completion. Useful for open-ended experience questions and company-specific prompts.

**Supported providers:**

| Provider | Endpoint URL | Example Model |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `deepseek/deepseek-chat` |
| DeepSeek | `https://api.deepseek.com/chat/completions` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |

Configure in **Settings → Autofill Engine → AI Enhanced**.

---

## Platform Support

| Platform | Notes |
|---|---|
| **Greenhouse** | Heuristic (standard HTML form) |
| **Lever** | Heuristic (standard HTML form) |
| **Workday** | Dedicated adapter using `data-automation-id`; handles custom dropdown components |
| **Ashby** | Heuristic + `aria-label` extraction |
| **iCIMS** | Dedicated content script runs inside cross-origin iframes |
| **Any ATS** | Heuristic with 6-tier label extraction (label element, `for` association, `aria-label`, `aria-labelledby`, placeholder, ancestor text) |

---

## Setup: Your Profile

Fill in your details once in the extension popup:

- **Personal tab** — name, email, phone, address
- **EEO tab** — gender, race, veteran status, disability status, pronouns
- **Profile tab** — markdown resume context used by the AI engine
- **History tab** — read-only view of saved work and education history

The **Profile tab** is a plain-text markdown file the AI reads when answering experience questions, salary expectations, and company-specific prompts. Edit it directly in the popup — the default template is pre-filled on first install from `profile-default.md`.

### Storage layout

| Data | Storage | Why |
|---|---|---|
| Text profile fields | `chrome.storage.sync` (8KB limit) | Synced across Chrome profiles |
| Resume file (up to 5MB), work history, education, profile markdown | `chrome.storage.local` | Too large for sync quota |

---

## File Map

| File | Role |
|---|---|
| `manifest.json` | MV3 permissions, injection targets, iCIMS content script declaration |
| `background.js` | Service worker: seeds profile on install, handles script injection, forwards iCIMS messages |
| `popup.html` / `popup.js` / `popup.css` | Extension popup UI — profile tabs, settings, start button |
| `profile-default.md` | Default AI profile template seeded on first install |
| `content-icims.js` | Content script auto-injected into iCIMS iframes (`*.icims.com`) |
| `autofill-engine/vendor/string-similarity.js` | Dice-coefficient string similarity (`compareTwoStrings`) |
| `autofill-engine/FormFiller.js` | `fill()` (nativeInputValueSetter for React), `fillSelect()`, `fillRadioOrCheckbox()`, resume upload |
| `autofill-engine/HeuristicParser.js` | `getAllFields()` — 6-tier label extraction; `findBestMatch()` — fuzzy scoring |
| `autofill-engine/ReportPanel.js` | Floating report panel showing field fill progress |
| `autofill-engine/adapters/WorkdayAdapter.js` | Workday-specific adapter: `data-automation-id` lookup, custom dropdown click-fill |
| `autofill-engine/AutofillOrchestrator.js` | Entry point: routes to Workday adapter or heuristic/AI fill |
| `autofill-engine/ai-service.js` | Calls OpenAI-compatible endpoint with field manifest + profile markdown |
| `content-simple.js` | Old LinkedIn Easy Apply bot (~2000 lines). Not wired to UI. Kept for reference. |

---

## Dev Setup

1. Load unpacked from `chrome://extensions/` (see Install above).
2. Engine logs appear in the **active tab's DevTools console** under `[AutoApplyMax]` prefix.
3. Popup logs appear in the popup's own DevTools (right-click popup → Inspect).
4. After any file edit: reload the extension card, then reload the job page.

**Testing:** Open any ATS job application page (Greenhouse, Lever, Workday, etc.), click Start Autofill, watch the console for field matching output and the on-page report panel.

---

## Known Limitations

- **Custom dropdowns (non-Workday)**: Ashby and some Lever pages use `div`-based dropdowns not captured by `getAllFields()`. Workday is handled via the dedicated adapter.
- **Cross-origin iframes**: Only iCIMS is supported via a declared content script. Other ATS platforms that embed forms in cross-origin iframes will not be autofilled.
- **React inputs**: Uses `nativeInputValueSetter` to trigger React's synthetic event system. Works in ISOLATED world (Chrome MV3 default).

---

## Contributing

- Report bugs via [Issues](https://github.com/Azoo92i/AutoApplyMax/issues)
- PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)

---

## License

Licensed under **GNU Affero General Public License v3.0 (AGPL-3.0)** — see [LICENSE](LICENSE).
