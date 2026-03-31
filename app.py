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
        'ori1': d1, 'ori2': d2, 'ori3': d3,
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


def parse_xlsx(file_bytes):
    """Parse .xlsx file using openpyxl"""
    buf = io.BytesIO(file_bytes)
    wb = openpyxl.load_workbook(buf, read_only=True, data_only=True)
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
    return data


def parse_xls(file_bytes):
    """Parse .xls (Excel 97-2003) file using xlrd"""
    import xlrd
    wb = xlrd.open_workbook(file_contents=file_bytes)
    ws = wb.sheet_by_index(0)
    data = []
    for r in range(ws.nrows):
        raw = str(ws.cell_value(r, 0)).strip() if ws.ncols > 0 else ""
        nm = str(ws.cell_value(r, 1)).strip() if ws.ncols > 1 else ""
        # xlrd may read numbers as float (e.g. 1.0 -> "1.0")
        if '.' in raw:
            raw = raw.split('.')[0]
        if raw and len(raw) < 3 and all(c in '0123456789ABCDEFabcdef' for c in raw):
            raw = raw.zfill(3)
        if is_valid_hex(raw):
            data.append({"code": raw.upper(), "name": nm})
    return data


@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify(error="파일이 없습니다"), 400
    f = request.files['file']
    filename = (f.filename or '').lower()
    if not filename.endswith(('.xlsx', '.xls')):
        return jsonify(error="엑셀 파일(.xlsx, .xls)만 지원합니다"), 400

    try:
        file_bytes = f.read()

        if filename.endswith('.xls') and not filename.endswith('.xlsx'):
            try:
                data = parse_xls(file_bytes)
            except ImportError:
                return jsonify(error=".xls 파일을 읽으려면 xlrd가 필요합니다. pip install xlrd 를 실행해주세요."), 400
        else:
            data = parse_xlsx(file_bytes)

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


@app.route('/api/preview_tmrs_list', methods=['POST'])
def preview_tmrs_list():
    req = request.json
    item = req.get('item')
    tmpl = req.get('template')
    cfg = req.get('cfg', {})
    if not tmpl or not item:
        return jsonify(error="데이터/템플릿 부족"), 400
    content = generate_tmrs_list_content(cfg.get('header', ''), cfg.get('body', ''), tmpl, [item])
    return jsonify(content=content)


def generate_tmrs_list_content(header, body_fmt, tmpl, codes):
    res = []
    if header:
        res.append(header)
    for i, item in enumerate(codes):
        code = item['code']
        code_pad = code.zfill(3) if len(code) < 3 else code
        name = item['name']
        matrix = tmpl.get('matrix', {})
        same = tmpl.get('use_same_matrix', True)
        
        v1, v2, v3 = code_pad[0], code_pad[1], code_pad[2]
        if same:
            sm = matrix.get('shared', {})
            v1, v2, v3 = sm.get(v1, v1), sm.get(v2, v2), sm.get(v3, v3)
        else:
            v1 = matrix.get('pos1', {}).get(v1, v1)
            v2 = matrix.get('pos2', {}).get(v2, v2)
            v3 = matrix.get('pos3', {}).get(v3, v3)
            
        data = {
            'seq': str(i),
            'filename_code': code_pad,
            'tmrs_name': name,
            'code': code_pad,
            'ori1': code_pad[0],
            'ori2': code_pad[1],
            'ori3': code_pad[2],
            'val1': v1,
            'val2': v2,
            'val3': v3
        }
        try:
            res.append(body_fmt % data)
        except Exception as e:
            res.append(f"[Line formatting error row {i}]: {str(e)}")
            
    return '\n'.join(res)


@app.route('/api/generate', methods=['POST'])
def generate():
    req = request.json
    codes = req.get('data', [])
    tids = req.get('template_ids', [])
    input_fn = req.get('input_filename', 'output')
    tmrs_list_cfg = req.get('tmrs_list', None)

    if not codes:
        return jsonify(error="데이터 없음"), 400
    if not tids:
        return jsonify(error="템플릿을 선택하세요"), 400

    d = load_templates()
    selected = [t for t in d['templates'] if t['id'] in tids]
    if not selected:
        return jsonify(error="선택된 템플릿 없음"), 400

    buf = io.BytesIO()
    base = input_fn.rsplit('.', 1)[0] if '.' in input_fn else input_fn
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for tmpl in selected:
            # Provide nested folder behavior if requested
            f_path = tmpl.get('folder', '')
            folder_name = f"{base}_{tmpl['name']}"
            if f_path:
                folder_name = f"{f_path}/{folder_name}"
                
            for item in codes:
                fn, body = apply_template(tmpl, item['code'], item['name'])
                path = f"{folder_name}/{fn}"
                zf.writestr(path, body)
                
        if tmrs_list_cfg and tmrs_list_cfg.get('enabled') and selected:
            list_content = generate_tmrs_list_content(
                tmrs_list_cfg.get('header', ''),
                tmrs_list_cfg.get('body', ''),
                selected[0],
                codes
            )
            zf.writestr('TMRS_LIST.asc', list_content)
    buf.seek(0)

    return send_file(buf, mimetype='application/zip', as_attachment=True,
                     download_name=f"{base}_output.zip")


if __name__ == '__main__':
    import webbrowser
    import threading

    print("🚀 TMRS Pattern Maker: http://localhost:5000")
    threading.Timer(1.5, lambda: webbrowser.open('http://localhost:5000')).start()
    app.run(debug=True, port=5000, host='0.0.0.0')
