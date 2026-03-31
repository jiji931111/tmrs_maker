/* ── TMRS Pattern Maker – Frontend Logic v2 ───────────────────── */

const HEX = ['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F'];

// ── Available Variables ──────────────────────────────────────────
const VARIABLES = [
    { code: '%(filename_code)s', label: '전체 코드', desc: 'Excel A열의 3자리 HEX 코드 (예: A8C)', target: 'body' },
    { code: '%(tmrs_name)s',     label: 'TMRS 이름', desc: 'Excel B열의 이름 값', target: 'body' },
    { code: '%(code)s',          label: '코드',      desc: '전체 HEX 코드 (filename_code와 동일)', target: 'both' },
    { code: '%(val1)s',          label: '변환값 1',   desc: '첫번째 자리 매트릭스 변환값', target: 'body' },
    { code: '%(val2)s',          label: '변환값 2',   desc: '두번째 자리 매트릭스 변환값', target: 'body' },
    { code: '%(val3)s',          label: '변환값 3',   desc: '세번째 자리 매트릭스 변환값', target: 'body' },
];

// ── State ────────────────────────────────────────────────────────
const state = {
    uploadedData: null,
    templates: [],
    selectedIds: new Set(),
    editingId: null,
    _editMatrix: null,
    _previewDebounce: null,
};

// ── DOM refs ─────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const dropzone       = $('#dropzone');
const fileInput       = $('#fileInput');
const uploadInfo      = $('#uploadInfo');
const dataPreview     = $('#dataPreview');
const templateList    = $('#templateList');
const templateEditor  = $('#templateEditor');
const matrixContainer = $('#matrixContainer');
const outputPreview   = $('#outputPreview');
const previewCards    = $('#previewCards');
const toastContainer  = $('#toastContainer');

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await loadTemplates();
    bindEvents();
    renderVariableChips();
    renderFilePatternChips();
});

function bindEvents() {
    // Input mode tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchInputMode(btn.dataset.mode));
    });

    // Upload
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleUpload(e.target.files[0]); });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault(); dropzone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
    });
    $('#clearFileBtn').addEventListener('click', clearUpload);

    // Paste
    $('#parsePasteBtn').addEventListener('click', handlePaste);
    $('#clearPasteBtn').addEventListener('click', () => { $('#pasteInput').value = ''; clearUpload(); });

    // Templates
    $('#addTemplateBtn').addEventListener('click', () => openEditor(null));
    $('#closeEditorBtn').addEventListener('click', closeEditor);
    $('#cancelEditorBtn').addEventListener('click', closeEditor);
    $('#saveTemplateBtn').addEventListener('click', saveTemplate);
    $('#useSameMatrix').addEventListener('change', () => renderMatrix());

    // Template body - live preview on input
    $('#tmplBody').addEventListener('input', () => scheduleLivePreview());

    // Template body - drag over support
    const tmplBody = $('#tmplBody');
    tmplBody.addEventListener('dragover', (e) => {
        e.preventDefault();
        tmplBody.classList.add('drag-over');
    });
    tmplBody.addEventListener('dragleave', () => {
        tmplBody.classList.remove('drag-over');
    });
    tmplBody.addEventListener('drop', (e) => {
        e.preventDefault();
        tmplBody.classList.remove('drag-over');
        const varCode = e.dataTransfer.getData('text/plain');
        if (varCode && varCode.startsWith('%(')) {
            // Insert at drop position
            const rect = tmplBody.getBoundingClientRect();
            // For textarea, we insert at the current cursor or end
            const pos = tmplBody.selectionStart || tmplBody.value.length;
            const before = tmplBody.value.substring(0, pos);
            const after = tmplBody.value.substring(pos);
            tmplBody.value = before + varCode + after;
            tmplBody.focus();
            tmplBody.selectionStart = tmplBody.selectionEnd = pos + varCode.length;
            scheduleLivePreview();
        }
    });

    // File pattern input - drag over support
    const patternInput = $('#tmplFilePattern');
    patternInput.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    patternInput.addEventListener('drop', (e) => {
        e.preventDefault();
        const varCode = e.dataTransfer.getData('text/plain');
        if (varCode && varCode.startsWith('%(')) {
            const pos = patternInput.selectionStart || patternInput.value.length;
            const before = patternInput.value.substring(0, pos);
            const after = patternInput.value.substring(pos);
            patternInput.value = before + varCode + after;
            patternInput.focus();
            patternInput.selectionStart = patternInput.selectionEnd = pos + varCode.length;
        }
    });

    // Generate
    $('#previewBtn').addEventListener('click', doPreview);
    $('#generateBtn').addEventListener('click', doGenerate);
}

// ── Variable Chips Rendering ─────────────────────────────────────
function renderVariableChips() {
    const container = $('#varChips');
    container.innerHTML = VARIABLES.map(v => `
        <div class="var-chip" draggable="true" data-code="${esc(v.code)}" data-target="${v.target}">
            <span class="chip-label">${esc(v.label)}</span>
            <span class="chip-code">${esc(v.code)}</span>
            <span class="chip-tooltip">${esc(v.desc)}</span>
        </div>
    `).join('');

    // Click to insert
    container.querySelectorAll('.var-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const code = chip.dataset.code;
            insertAtCursor($('#tmplBody'), code);
            scheduleLivePreview();
        });

        // Drag start
        chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', chip.dataset.code);
            e.dataTransfer.effectAllowed = 'copy';
            chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
        });
    });
}

function renderFilePatternChips() {
    const container = $('#filePatternChips');
    const patternVars = VARIABLES.filter(v => v.target === 'both' || v.target === 'pattern');
    // For file pattern, show code, tmrs_name, val1-3
    const allVars = VARIABLES;
    container.innerHTML = allVars.map(v => `
        <span class="var-chip-sm" data-code="${esc(v.code)}" title="${esc(v.desc)}">${esc(v.label)}</span>
    `).join('');

    container.querySelectorAll('.var-chip-sm').forEach(chip => {
        chip.addEventListener('click', () => {
            insertAtCursor($('#tmplFilePattern'), chip.dataset.code);
        });
    });
}

function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    textarea.value = before + text + after;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
}

// ── Input Mode Switching ─────────────────────────────────────────
function switchInputMode(mode) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (mode === 'paste') {
        $('#tabPaste').classList.add('active');
        $('#fileMode').style.display = 'none';
        $('#pasteMode').style.display = '';
    } else {
        $('#tabFile').classList.add('active');
        $('#fileMode').style.display = '';
        $('#pasteMode').style.display = 'none';
    }
}

// ── Paste Parsing ────────────────────────────────────────────────
function handlePaste() {
    const raw = $('#pasteInput').value.trim();
    if (!raw) { toast('붙여넣기 데이터가 없습니다', 'error'); return; }

    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    const data = [];
    const skipped = [];
    const isHex = s => s && s.length === 3 && /^[0-9A-Fa-f]{3}$/.test(s);

    for (const line of lines) {
        const parts = line.split(/\t|\s{2,}/);
        let code = (parts[0] || '').trim();
        const name = (parts[1] || '').trim();

        if (code && /^\d+\.\d*$/.test(code)) {
            code = code.split('.')[0];
        }
        if (code && code.length < 3 && /^[0-9A-Fa-f]+$/.test(code)) {
            code = code.padStart(3, '0');
        }
        if (isHex(code)) {
            data.push({ code: code.toUpperCase(), name });
        } else if (code) {
            skipped.push(code);
        }
    }

    if (data.length === 0) {
        const reason = skipped.length > 0
            ? `유효한 HEX 코드를 찾지 못했습니다. 건너뛴 값: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''}`
            : '유효한 HEX 코드를 찾지 못했습니다. A열: 3자리 HEX, B열: 이름 형태로 붙여넣어주세요.';
        toast(reason, 'error');
        return;
    }

    if (skipped.length > 0) {
        toast(`${skipped.length}개 항목이 유효하지 않아 건너뜀`, 'warning');
    }

    state.uploadedData = {
        filename: 'pasted_data',
        total: data.length,
        preview: data.slice(0, 30),
        data: data,
    };

    uploadInfo.style.display = 'none';
    const tbody = $('#previewBody');
    tbody.innerHTML = data.slice(0, 30).map((r, i) =>
        `<tr><td>${i + 1}</td><td class="code-cell">${esc(r.code)}</td><td>${esc(r.name)}</td></tr>`
    ).join('');
    $('#previewHint').textContent = data.length > 30 ? `(${data.length}건 중 30건)` : `(${data.length}건)`;
    dataPreview.style.display = '';

    toast(`${data.length}개 코드 파싱 완료`, 'success');
    setStatus('데이터 준비됨');
    updateButtons();
    scheduleLivePreview();
}

// ── Toast ────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    const duration = (type === 'error' || type === 'warning') ? 5000 : 3000;
    el.style.animation = `toastIn 0.2s ease, toastOut 0.2s ease ${duration - 200}ms forwards`;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), duration);
}

// ── Upload ───────────────────────────────────────────────────────
async function handleUpload(file) {
    const form = new FormData();
    form.append('file', file);
    setStatus('업로드 중...');

    try {
        const res = await fetch('/api/upload', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) { toast(json.error || '업로드 실패', 'error'); setStatus('오류'); return; }

        state.uploadedData = json;
        showUploadResult(json);
        toast(`${json.total}개 코드 로드 완료`, 'success');
        setStatus('데이터 준비됨');
        updateButtons();
        scheduleLivePreview();
    } catch (e) {
        toast('업로드 중 오류 발생', 'error');
        setStatus('오류');
    }
}

function showUploadResult(data) {
    $('#fileName').textContent = data.filename;
    $('#fileCount').textContent = `${data.total}개`;
    uploadInfo.style.display = 'flex';

    const tbody = $('#previewBody');
    tbody.innerHTML = data.preview.map((r, i) =>
        `<tr><td>${i + 1}</td><td class="code-cell">${esc(r.code)}</td><td>${esc(r.name)}</td></tr>`
    ).join('');
    $('#previewHint').textContent = data.total > 30 ? `(${data.total}건 중 30건)` : `(${data.total}건)`;
    dataPreview.style.display = '';
}

function clearUpload() {
    state.uploadedData = null;
    fileInput.value = '';
    uploadInfo.style.display = 'none';
    dataPreview.style.display = 'none';
    clearPreviewCards();
    setStatus('대기 중');
    updateButtons();
}

// ── Templates ────────────────────────────────────────────────────
async function loadTemplates() {
    try {
        const res = await fetch('/api/templates');
        const json = await res.json();
        state.templates = json.templates || [];
        renderTemplateList();
    } catch (e) { toast('템플릿 로드 실패', 'error'); }
}

function renderTemplateList() {
    templateList.innerHTML = state.templates.map(t => {
        const checked = state.selectedIds.has(t.id) ? 'checked' : '';
        const selClass = state.selectedIds.has(t.id) ? 'selected' : '';
        return `
        <div class="tmpl-card ${selClass}" data-id="${t.id}">
            <input type="checkbox" class="tmpl-check" ${checked} data-id="${t.id}">
            <div class="tmpl-info">
                <div class="tmpl-name">${esc(t.name)}</div>
                <div class="tmpl-pattern">${esc(t.file_pattern)}</div>
            </div>
            <div class="tmpl-actions">
                <button class="btn btn-xs btn-ghost" onclick="openEditor('${t.id}')" title="편집">✏️</button>
                <button class="btn btn-xs btn-ghost" onclick="duplicateTemplate('${t.id}')" title="복제">📋</button>
                <button class="btn btn-xs btn-ghost btn-danger" onclick="deleteTemplate('${t.id}')" title="삭제">🗑</button>
            </div>
        </div>`;
    }).join('');

    templateList.querySelectorAll('.tmpl-check').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.target.dataset.id;
            if (e.target.checked) state.selectedIds.add(id);
            else state.selectedIds.delete(id);
            renderTemplateList();
            updateButtons();
            scheduleLivePreview();
        });
    });
}

function openEditor(id) {
    state.editingId = id;
    const t = id ? state.templates.find(x => x.id === id) : null;

    $('#editorTitle').textContent = t ? `편집: ${t.name}` : '새 템플릿';
    $('#tmplName').value = t ? t.name : '';
    $('#tmplFilePattern').value = t ? t.file_pattern : 'TMRS%(code)s.asc';
    $('#tmplBody').value = t ? t.body : '';
    $('#useSameMatrix').checked = t ? t.use_same_matrix !== false : true;

    state._editMatrix = t ? JSON.parse(JSON.stringify(t.matrix)) : defaultMatrix();
    renderMatrix();
    templateEditor.style.display = '';
    templateEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEditor() {
    templateEditor.style.display = 'none';
    state.editingId = null;
    state._editMatrix = null;
}

function defaultMatrix() {
    const m = {}; HEX.forEach(h => m[h] = h);
    return { shared: {...m}, pos1: {...m}, pos2: {...m}, pos3: {...m} };
}

function renderMatrix() {
    const same = $('#useSameMatrix').checked;
    const mat = state._editMatrix || defaultMatrix();

    let cols, headers;
    if (same) {
        cols = ['shared'];
        headers = '<th>HEX</th><th>변환값</th>';
    } else {
        cols = ['pos1', 'pos2', 'pos3'];
        headers = '<th>HEX</th><th>1번째</th><th>2번째</th><th>3번째</th>';
    }

    const rows = HEX.map(h => {
        const cells = cols.map(c => {
            const val = (mat[c] && mat[c][h]) || h;
            return `<td><input type="text" value="${esc(val)}" data-col="${c}" data-hex="${h}"></td>`;
        }).join('');
        return `<tr><td class="matrix-hex">${h}</td>${cells}</tr>`;
    }).join('');

    matrixContainer.innerHTML = `<table class="matrix-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;

    matrixContainer.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', () => {
            if (!state._editMatrix) state._editMatrix = defaultMatrix();
            state._editMatrix[inp.dataset.col][inp.dataset.hex] = inp.value;
        });
    });
}

function collectEditorData() {
    const name = $('#tmplName').value.trim();
    const pattern = $('#tmplFilePattern').value.trim();
    const body = $('#tmplBody').value;
    const useSame = $('#useSameMatrix').checked;

    if (!name) { toast('템플릿 이름을 입력하세요', 'error'); return null; }
    if (!pattern) { toast('파일명 패턴을 입력하세요', 'error'); return null; }
    if (!body) { toast('템플릿 내용을 입력하세요', 'error'); return null; }

    const matrix = state._editMatrix || defaultMatrix();
    return { name, file_pattern: pattern, body, use_same_matrix: useSame, matrix };
}

async function saveTemplate() {
    const data = collectEditorData();
    if (!data) return;

    try {
        let res;
        if (state.editingId) {
            res = await fetch(`/api/templates/${state.editingId}`, {
                method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
            });
        } else {
            res = await fetch('/api/templates', {
                method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
            });
        }
        if (!res.ok) { toast('저장 실패', 'error'); return; }
        toast('템플릿 저장 완료', 'success');
        closeEditor();
        await loadTemplates();
        scheduleLivePreview();
    } catch (e) { toast('저장 중 오류', 'error'); }
}

async function deleteTemplate(id) {
    if (!confirm('이 템플릿을 삭제하시겠습니까?')) return;
    try {
        await fetch(`/api/templates/${id}`, { method: 'DELETE' });
        state.selectedIds.delete(id);
        toast('삭제 완료', 'info');
        if (state.editingId === id) closeEditor();
        await loadTemplates();
        updateButtons();
    } catch (e) { toast('삭제 실패', 'error'); }
}

async function duplicateTemplate(id) {
    const t = state.templates.find(x => x.id === id);
    if (!t) return;
    const copy = JSON.parse(JSON.stringify(t));
    copy.name = t.name + ' (복사)';
    delete copy.id;

    try {
        await fetch('/api/templates', {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(copy)
        });
        toast('복제 완료', 'success');
        await loadTemplates();
    } catch (e) { toast('복제 실패', 'error'); }
}

// ── Preview & Generate ───────────────────────────────────────────
function updateButtons() {
    const hasData = !!state.uploadedData;
    const hasSel = state.selectedIds.size > 0;
    $('#previewBtn').disabled = !(hasData && hasSel);
    $('#generateBtn').disabled = !(hasData && hasSel);
}

function clearPreviewCards() {
    previewCards.innerHTML = '';
    $('#previewEmpty').style.display = '';
    $('#liveIndicator').style.display = 'none';
}

function scheduleLivePreview() {
    clearTimeout(state._previewDebounce);
    state._previewDebounce = setTimeout(() => doLivePreview(), 400);
}

async function doLivePreview() {
    // Live preview: if data + selected templates exist, auto-preview
    if (!state.uploadedData || state.selectedIds.size === 0) return;

    const first = state.uploadedData.data[0];
    if (!first) return;

    const cards = [];
    for (const tid of state.selectedIds) {
        const tmpl = state.templates.find(t => t.id === tid);
        if (!tmpl) continue;

        // If we're currently editing this template, use the editor values
        let tmplToUse = tmpl;
        if (state.editingId === tid) {
            const editorData = {
                ...tmpl,
                body: $('#tmplBody').value,
                file_pattern: $('#tmplFilePattern').value,
                use_same_matrix: $('#useSameMatrix').checked,
                matrix: state._editMatrix || tmpl.matrix,
            };
            tmplToUse = editorData;
        }

        try {
            const res = await fetch('/api/preview', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ code_item: first, template: tmplToUse })
            });
            const json = await res.json();
            if (res.ok) {
                cards.push({ tmplName: tmplToUse.name, filename: json.filename, content: json.content });
            }
        } catch (e) { /* silent for live preview */ }
    }

    if (cards.length > 0) {
        $('#previewEmpty').style.display = 'none';
        $('#liveIndicator').style.display = 'inline-flex';
        previewCards.innerHTML = cards.map(c => `
            <div class="preview-card">
                <div class="preview-card-header">
                    <span class="fname">${esc(c.filename)}</span>
                    <span class="tmpl-tag">${esc(c.tmplName)}</span>
                </div>
                <pre>${esc(c.content)}</pre>
            </div>
        `).join('');
    }
}

async function doPreview() {
    if (!state.uploadedData || state.selectedIds.size === 0) return;

    const first = state.uploadedData.data[0];
    if (!first) {
        toast('미리보기할 데이터가 없습니다', 'error');
        return;
    }

    const cards = [];
    const errors = [];

    for (const tid of state.selectedIds) {
        const tmpl = state.templates.find(t => t.id === tid);
        if (!tmpl) {
            errors.push(`템플릿을 찾을 수 없습니다`);
            continue;
        }
        try {
            const res = await fetch('/api/preview', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ code_item: first, template: tmpl })
            });
            const json = await res.json();
            if (!res.ok) {
                errors.push(`[${tmpl.name}] ${json.error || '서버 오류'}`);
                continue;
            }
            cards.push({ tmplName: tmpl.name, filename: json.filename, content: json.content });
        } catch (e) {
            errors.push(`[${tmpl.name}] 네트워크 오류`);
        }
    }

    if (errors.length > 0) {
        errors.forEach(err => toast(err, 'error'));
    }

    if (cards.length === 0) {
        toast('미리보기 생성 실패', 'error');
        return;
    }

    $('#previewEmpty').style.display = 'none';
    $('#liveIndicator').style.display = 'inline-flex';
    previewCards.innerHTML = cards.map(c => `
        <div class="preview-card">
            <div class="preview-card-header">
                <span class="fname">${esc(c.filename)}</span>
                <span class="tmpl-tag">${esc(c.tmplName)}</span>
            </div>
            <pre>${esc(c.content)}</pre>
        </div>
    `).join('');
    toast('미리보기 생성 완료 (첫번째 코드 기준)', 'info');
}

async function doGenerate() {
    if (!state.uploadedData || state.selectedIds.size === 0) return;

    const btn = $('#generateBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 생성 중...';
    setStatus('파일 생성 중...');

    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                data: state.uploadedData.data,
                template_ids: [...state.selectedIds],
                input_filename: state.uploadedData.filename,
            })
        });

        if (!res.ok) {
            const err = await res.json();
            toast(err.error || '생성 실패', 'error');
            return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const disposition = res.headers.get('content-disposition') || '';
        const match = disposition.match(/filename[^;=\n]*=(['"]?)(.+?)\1(;|$)/);
        a.download = match ? decodeURIComponent(match[2]) : 'output.zip';
        a.href = url;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        const total = state.uploadedData.data.length * state.selectedIds.size;
        toast(`${total}개 파일 생성 완료!`, 'success');
        setStatus('생성 완료');
    } catch (e) {
        toast('생성 중 오류 발생', 'error');
        setStatus('오류');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '파일 생성 & 다운로드';
        updateButtons();
    }
}

// ── Helpers ──────────────────────────────────────────────────────
function setStatus(text) {
    const badge = $('#statusBadge');
    badge.textContent = text;
    if (text.includes('오류')) {
        badge.style.color = 'var(--red)';
        badge.style.background = 'var(--red-bg)';
    } else if (text.includes('완료') || text.includes('준비')) {
        badge.style.color = 'var(--green)';
        badge.style.background = 'var(--green-bg)';
    } else {
        badge.style.color = 'var(--accent-light)';
        badge.style.background = 'var(--accent-bg)';
    }
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
