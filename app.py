"""TMRS Pattern Maker - Flask Backend"""
import os
import io
import json
import uuid
import zipfile
from flask import Flask, render_template, request, jsonify, send_file
import openpyxl

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config')
TEMPLATES_FILE = os.path.join(CONFIG_DIR, 'templates.json')
HEX_DIGITS = [str(i) for i in range(10)] + list('ABCDEF')


# ── Template helpers ──────────────────────────────────────────────
def _identity_matrix():
    return {d: d for d in HEX_DIGITS}


def get_default_template():
    m = _identity_matrix()
    return {
        "id": "default_1",
        "name": "기본 템플릿",
        "file_pattern": "TMRS%(code)s.asc",
        "body": (
            "여기는 풀 코드 자리 입니다 : %(filename_code)s\n"
            "여기는 TMRS 이름 입니다 : %(tmrs_name)s\n"
            "여기는 첫번째 자리 입니다. %(val1)s\n"
            "여기는 두번째 자리 입니다. %(val2)s\n"
            "여기는 세번째 자리 입니다. %(val3)s\n"
            "완료"
        ),
        "use_same_matrix": True,
        "matrix": {"shared": dict(m), "pos1": dict(m), "pos2": dict(m), "pos3": dict(m)},
    }


def load_templates():
    if os.path.exists(TEMPLATES_FILE):
        with open(TEMPLATES_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    data = {"templates": [get_default_template()]}
    save_templates(data)
    return data


def save_templates(data):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(TEMPLATES_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── Core logic ────────────────────────────────────────────────────
def is_valid_hex(s):
    return bool(s) and len(s) == 3 and all(c in '0123456789ABCDEFabcdef' for c in s)


def apply_template(tmpl, code, name):
    """Return (filename, content) for one code entry."""
    code = code.upper()
    d1, d2, d3 = code[0], code[1], code[2]

    matrix = tmpl.get('matrix', {})
    if tmpl.get('use_same_matrix', True):
        m = matrix.get('shared', {})
        v1, v2, v3 = m.get(d1, d1), m.get(d2, d2), m.get(d3, d3)
    else:
        v1 = matrix.get('pos1', {}).get(d1, d1)
        v2 = matrix.get('pos2', {}).get(d2, d2)
        v3 = matrix.get('pos3', {}).get(d3, d3)

    reps = {
        'filename_code': code, 'tmrs_name': name,
        'val1': v1, 'val2': v2, 'val3': v3, 'code': code,
    }

    body = tmpl['body']
    fname = tmpl.get('file_pattern', 'TMRS%(code)s.asc')
    for k, v in reps.items():
        ph = f'%({k})s'
        body = body.replace(ph, str(v))
        fname = fname.replace(ph, str(v))
    return fname, body


# ── Routes ────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify(error="파일이 없습니다"), 400
    f = request.files['file']
    if not (f.filename or '').lower().endswith(('.xlsx', '.xls')):
        return jsonify(error="엑셀 파일(.xlsx)만 지원합니다"), 400

    try:
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        ws = wb.active
        data = []
        for row in ws.iter_rows(min_row=1, max_col=2, values_only=True):
            raw = str(row[0]).strip() if row[0] is not None else ""
            nm = str(row[1]).strip() if row[1] is not None else ""
            if raw and len(raw) < 3 and all(c in '0123456789ABCDEFabcdef' for c in raw):
                raw = raw.zfill(3)
            if is_valid_hex(raw):
                data.append({"code": raw.upper(), "name": nm})
        wb.close()
        return jsonify(filename=f.filename, total=len(data), preview=data[:30], data=data)
    except Exception as e:
        return jsonify(error=f"파일 처리 오류: {e}"), 400


@app.route('/api/templates', methods=['GET'])
def get_templates():
    return jsonify(load_templates())


@app.route('/api/templates', methods=['POST'])
def create_template():
    t = request.json
    t['id'] = str(uuid.uuid4())[:8]
    d = load_templates()
    d['templates'].append(t)
    save_templates(d)
    return jsonify(t), 201


@app.route('/api/templates/<tid>', methods=['PUT'])
def update_template(tid):
    t = request.json
    t['id'] = tid
    d = load_templates()
    for i, x in enumerate(d['templates']):
        if x['id'] == tid:
            d['templates'][i] = t
            save_templates(d)
            return jsonify(t)
    return jsonify(error="템플릿 없음"), 404


@app.route('/api/templates/<tid>', methods=['DELETE'])
def delete_template(tid):
    d = load_templates()
    d['templates'] = [t for t in d['templates'] if t['id'] != tid]
    save_templates(d)
    return jsonify(success=True)


@app.route('/api/preview', methods=['POST'])
def preview():
    req = request.json
    item = req.get('code_item', {'code': '000', 'name': 'sample'})
    tmpl = req.get('template')
    if not tmpl:
        return jsonify(error="템플릿 필요"), 400
    fname, content = apply_template(tmpl, item['code'], item['name'])
    return jsonify(filename=fname, content=content)


@app.route('/api/generate', methods=['POST'])
def generate():
    req = request.json
    codes = req.get('data', [])
    tids = req.get('template_ids', [])
    input_fn = req.get('input_filename', 'output')

    if not codes:
        return jsonify(error="데이터 없음"), 400
    if not tids:
        return jsonify(error="템플릿을 선택하세요"), 400

    d = load_templates()
    selected = [t for t in d['templates'] if t['id'] in tids]
    if not selected:
        return jsonify(error="선택된 템플릿 없음"), 400

    buf = io.BytesIO()
    multi = len(selected) > 1
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for tmpl in selected:
            for item in codes:
                fn, body = apply_template(tmpl, item['code'], item['name'])
                path = f"{tmpl['name']}/{fn}" if multi else fn
                zf.writestr(path, body)
    buf.seek(0)

    base = input_fn.rsplit('.', 1)[0] if '.' in input_fn else input_fn
    return send_file(buf, mimetype='application/zip', as_attachment=True,
                     download_name=f"{base}_output.zip")


if __name__ == '__main__':
    print("🚀 TMRS Pattern Maker: http://localhost:5000")
    app.run(debug=True, port=5000, host='0.0.0.0')
