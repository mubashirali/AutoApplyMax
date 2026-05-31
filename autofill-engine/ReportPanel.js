function showReportPanel(allPageFields) {
    const existing = document.getElementById('autoapplymax-panel');
    if (existing) existing.remove();

    const required = allPageFields.filter(f => f.isRequired && f.label);
    const optional = allPageFields.filter(f => !f.isRequired && f.label && (f.element.type !== 'hidden') && (f.element.type !== 'file'));

    const isFilled = (f) => f.element.dataset.autofilled === 'true' || !!f.element.value;
    const requiredFilled = required.filter(isFilled).length;
    const pct = required.length > 0 ? Math.round((requiredFilled / required.length) * 100) : 100;

    const panel = document.createElement('div');
    panel.id = 'autoapplymax-panel';
    panel.style.cssText = [
        'position:fixed', 'top:20px', 'right:20px', 'width:320px',
        'max-height:80vh', 'background:#fff', 'border-radius:14px',
        'box-shadow:0 6px 32px rgba(0,0,0,0.18)', 'z-index:2147483647',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'font-size:14px', 'display:flex', 'flex-direction:column', 'overflow:hidden',
    ].join(';');

    // --- Header ---
    const header = document.createElement('div');
    header.style.cssText = 'padding:14px 16px 10px;cursor:pointer;user-select:none;';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';

    const logo = document.createElement('span');
    logo.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.5px;color:#6b7280;text-transform:uppercase;';
    logo.textContent = 'AutoApplyMax';

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'background:none;border:none;font-size:18px;color:#9ca3af;cursor:pointer;line-height:1;padding:0;margin-left:8px;';
    closeBtn.onclick = (e) => { e.stopPropagation(); panel.remove(); };

    topRow.appendChild(logo);
    topRow.appendChild(closeBtn);

    const statsRow = document.createElement('div');
    statsRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';

    const statsText = document.createElement('span');
    statsText.style.cssText = 'font-weight:600;color:#111827;font-size:14px;';
    statsText.textContent = `${requiredFilled}/${required.length} required fields filled`;

    const pctArrow = document.createElement('span');
    pctArrow.style.cssText = 'font-weight:700;color:#111827;font-size:14px;display:flex;align-items:center;gap:6px;';
    pctArrow.innerHTML = `${pct}% <span id="aam-arrow" style="color:#6b7280;font-size:12px;font-weight:400;">▼</span>`;

    statsRow.appendChild(statsText);
    statsRow.appendChild(pctArrow);

    const barTrack = document.createElement('div');
    barTrack.style.cssText = 'height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;';
    const barFill = document.createElement('div');
    barFill.style.cssText = `height:100%;width:${pct}%;background:#22c55e;border-radius:3px;`;
    barTrack.appendChild(barFill);

    header.appendChild(topRow);
    header.appendChild(statsRow);
    header.appendChild(barTrack);

    // --- Field list ---
    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;padding:6px 0 10px;flex:1;';

    const renderField = (field, showOptionalTag) => {
        const filled = isFilled(field);
        const label = field.label || field.id || field.name || '';
        if (!label) return;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:7px 16px;';

        const dot = document.createElement('div');
        dot.style.cssText = [
            'width:22px', 'height:22px', 'border-radius:50%', 'flex-shrink:0', 'margin-top:1px',
            'display:flex', 'align-items:center', 'justify-content:center',
            filled ? 'background:#22c55e' : 'background:#e5e7eb;border:2px solid #d1d5db',
        ].join(';');

        if (filled) {
            dot.innerHTML = '<svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1.5 5L4.5 8L10.5 1.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        }

        const text = document.createElement('span');
        text.style.cssText = 'color:#111827;line-height:1.45;flex:1;';
        text.textContent = label;

        if (showOptionalTag) {
            const tag = document.createElement('span');
            tag.style.cssText = 'color:#9ca3af;font-size:11px;margin-left:4px;';
            tag.textContent = '(optional)';
            text.appendChild(tag);
        }

        row.appendChild(dot);
        row.appendChild(text);
        list.appendChild(row);
    };

    if (required.length > 0) {
        required.forEach(f => renderField(f, false));
    }
    if (optional.length > 0) {
        const divider = document.createElement('div');
        divider.style.cssText = 'height:1px;background:#f3f4f6;margin:6px 16px;';
        list.appendChild(divider);
        optional.forEach(f => renderField(f, true));
    }

    // --- Collapse toggle ---
    let collapsed = false;
    header.onclick = () => {
        collapsed = !collapsed;
        list.style.display = collapsed ? 'none' : 'block';
        const arrow = panel.querySelector('#aam-arrow');
        if (arrow) arrow.textContent = collapsed ? '▶' : '▼';
    };

    panel.appendChild(header);
    panel.appendChild(list);
    document.body.appendChild(panel);
}
