/* ── TMRS Pattern Maker – Frontend Logic ──────────────────────── */

const HEX = ['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F'];

// ── State ────────────────────────────────────────────────────────
const state = {
    uploadedData: null,   // { filename, total, data:[{code,name},...] }
    templates: [],
    selectedIds: new Set(),
    editingId: null,      // null = new, string = editing existing
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
});

function bindEvents() {
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

    // Templates
    $('#addTemplateBtn').addEventListener('click', () => openEditor(null));
    $('#closeEditorBtn').addEventListener('click', closeEditor);
    $('#cancelEditorBtn').addEventListener('click', closeEditor);
    $('#saveTemplateBtn').addEventListener('click', saveTemplate);
    $('#useSameMatrix').addEventListener('change', () => renderMatrix());

    // Placeholder hints – click to insert into textarea
    document.querySelectorAll('.placeholder-hints code').forEach(el => {
        el.addEventListener('click', () => {
            const ta = $('#tmplBody');
            const start = ta.selectionStart;
            const before = ta.value.substring(0, start);
            const after = ta.value.substring(ta.selectionEnd);
            ta.value = before + el.textContent + after;
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + el.textContent.length;
        });
    });

    // Generate
    $('#previewBtn').addEventListener('click', doPreview);
    $('#generateBtn').addEventListener('click', doGenerate);
}

// ── Toast ────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3000);
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
    outputPreview.style.display = 'none';
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

    // Checkbox events
    templateList.querySelectorAll('.tmpl-check').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.target.dataset.id;
            if (e.target.checked) state.selectedIds.add(id);
            else state.selectedIds.delete(id);
            renderTemplateList();
            updateButtons();
        });
    });
}

function openEditor(id) {
    state.editingId = id;
    const t = id ? state.templates.find(x => x.id === id) : null;

    $('#editorTitle').textContent = t ? `템플릿 편집: ${t.name}` : '새 템플릿 만들기';
    $('#tmplName').value = t ? t.name : '';
    $('#tmplFilePattern').value = t ? t.file_pattern : 'TMRS%(code)s.asc';
    $('#tmplBody').value = t ? t.body : '';
    $('#useSameMatrix').checked = t ? t.use_same_matrix !== false : true;

    // Store current matrix data for rendering
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
        headers = '<th>HEX</th><th>1번째 자리</th><th>2번째 자리</th><th>3번째 자리</th>';
    }

    const rows = HEX.map(h => {
        const cells = cols.map(c => {
            const val = (mat[c] && mat[c][h]) || h;
            return `<td><input type="text" value="${esc(val)}" data-col="${c}" data-hex="${h}"></td>`;
        }).join('');
        return `<tr><td class="matrix-hex">${h}</td>${cells}</tr>`;
    }).join('');

    matrixContainer.innerHTML = `<table class="matrix-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;

    // Sync inputs back to state on change
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

    // Read matrix from inputs
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

async function doPreview() {
    if (!state.uploadedData || state.selectedIds.size === 0) return;

    const first = state.uploadedData.data[0];
    const cards = [];

    for (const tid of state.selectedIds) {
        const tmpl = state.templates.find(t => t.id === tid);
        if (!tmpl) continue;
        try {
            const res = await fetch('/api/preview', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ code_item: first, template: tmpl })
            });
            const json = await res.json();
            cards.push({ tmplName: tmpl.name, filename: json.filename, content: json.content });
        } catch (e) { /* skip */ }
    }

    if (cards.length === 0) { toast('미리보기 생성 실패', 'error'); return; }

    previewCards.innerHTML = cards.map(c => `
        <div class="preview-card">
            <div class="preview-card-header">
                <span class="fname">${esc(c.filename)}</span>
                <span class="tmpl-tag">${esc(c.tmplName)}</span>
            </div>
            <pre>${esc(c.content)}</pre>
        </div>
    `).join('');
    outputPreview.style.display = '';
    outputPreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('미리보기 생성 (첫번째 코드 기준)', 'info');
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

        // Download blob
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const disposition = res.headers.get('content-disposition') || '';
        const match = disposition.match(/filename[^;=\n]*=(['\"]?)(.+?)\1(;|$)/);
        a.download = match ? decodeURIComponent(match[2]) : 'output.zip';
        a.href = url;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        const total = state.uploadedData.data.length * state.selectedIds.size;
        toast(`✅ ${total}개 파일 생성 완료!`, 'success');
        setStatus('생성 완료');
    } catch (e) {
        toast('생성 중 오류 발생', 'error');
        setStatus('오류');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '🚀 파일 생성 & 다운로드';
        updateButtons();
    }
}

// ── Helpers ──────────────────────────────────────────────────────
function setStatus(text) {
    const badge = $('#statusBadge');
    badge.textContent = text;
    if (text.includes('오류')) { badge.style.color = 'var(--red)'; badge.style.borderColor = 'rgba(248,113,113,0.2)'; badge.style.background = 'rgba(248,113,113,0.12)'; }
    else if (text.includes('완료') || text.includes('준비')) { badge.style.color = 'var(--green)'; badge.style.borderColor = 'rgba(52,211,153,0.2)'; badge.style.background = 'rgba(52,211,153,0.12)'; }
    else { badge.style.color = 'var(--accent-bright)'; badge.style.borderColor = 'rgba(99,102,241,0.2)'; badge.style.background = 'rgba(99,102,241,0.12)'; }
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
