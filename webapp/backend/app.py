"""ORQIVRA decision-support API. Run locally with python app.py."""
import json
import os
import uuid
import threading
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
from data import prepare, demo_data
from modeling import train_models, scenario_options, predict_scenario
from regional import locations, weather, briefing
from operations import review_settings, benchmark, production_plan, task_fields
from insights import build_insights
from store import Workspace, WorkspaceStore

app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024
CORS(app, origins=os.environ.get('ORQIVRA_ORIGINS', os.environ.get('AGROSCOPE_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000')).split(','))
store = WorkspaceStore()
training_slot = threading.BoundedSemaphore(1)
app.config['PUBLIC_DEMO'] = os.environ.get('ORQIVRA_PUBLIC_DEMO') == '1'
if app.config['PUBLIC_DEMO']:
    app.config['MAX_CONTENT_LENGTH'] = 64 * 1024
frontend_build = Path(__file__).resolve().parent.parent / 'frontend' / 'build'


def safe(value):
    if isinstance(value, dict):
        return {str(key): safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [safe(item) for item in value]
    if isinstance(value, (float, np.floating)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if value is pd.NA:
        return None
    return value


def respond(value, status=200):
    return jsonify(safe(value)), status


def current():
    token = request.headers.get('X-Dataset-ID', '')
    workspace = store.get(token)
    if not workspace:
        from werkzeug.exceptions import NotFound
        raise NotFound('Workspace expired or unavailable. Upload a dataset or load the demo again.')
    return workspace


def dataset_info(workspace):
    df = workspace.frame
    return {**workspace.metadata, 'rows': workspace.audit['original_rows'], 'valid_rows': len(df),
            'removed_rows': workspace.audit['removed_rows'], 'columns': len(df.columns), 'columns_list': df.columns.tolist(),
            'quality': workspace.audit, 'crops': sorted(df.Crop.unique().tolist()),
            'districts': sorted(df.District.unique().tolist()) if 'District' in df else [],
            'seasons': sorted(df.Season.unique().tolist()) if 'Season' in df else [],
            'year_min': int(df.Year.min()), 'year_max': int(df.Year.max())}


def create_workspace(raw, metadata):
    df, audit, rejected = prepare(raw)
    if len(df) < 10:
        raise ValueError('At least 10 valid, unique rows are required. Review missing values, duplicates and numeric columns.')
    if metadata['source_type'] != 'synthetic':
        audit['warnings'].append('Source provenance is user supplied and has not been independently verified.')
    if metadata['yield_unit'] == 'unspecified':
        audit['warnings'].append('Yield units are unspecified. Do not compare quantities across datasets or estimate production totals.')
    workspace = Workspace(df, audit, rejected, metadata)
    token = store.put(workspace)
    return respond({'dataset_id': token, **dataset_info(workspace)}, 201)


@app.get('/api/health')
def health():
    return respond({'status': 'healthy', 'version': '2.1', 'public_demo': app.config['PUBLIC_DEMO'], 'timestamp': datetime.now(timezone.utc).isoformat()})


@app.post('/api/upload')
def upload():
    if app.config['PUBLIC_DEMO']:
        return respond({'error': 'Uploads are disabled on the public demo. Run locally to analyze your own data.'}, 403)
    file = request.files.get('file')
    if not file or not file.filename or not file.filename.lower().endswith('.csv'):
        raise ValueError('Choose a CSV file with the required columns.')
    try:
        raw = pd.read_csv(file.stream)
    except (pd.errors.ParserError, pd.errors.EmptyDataError, UnicodeDecodeError):
        raise ValueError('Could not read this CSV. Use UTF-8 encoding and a consistent comma-separated header.') from None
    yield_unit = request.form.get('yield_unit', 'unspecified')
    price_unit = request.form.get('price_unit', 'unspecified')
    source_type = request.form.get('source_type', 'unverified')
    if yield_unit not in ['unspecified', 't/ha', 'kg/ha'] or price_unit not in ['unspecified', 'INR/t', 'INR/kg', 'USD/t', 'USD/kg'] or source_type not in ['unverified', 'observed', 'synthetic']:
        raise ValueError('Unsupported unit or source type.')
    return create_workspace(raw, {'filename': file.filename[:200], 'source_type': source_type,
                                  'source_name': request.form.get('source_name', 'User upload')[:300],
                                  'yield_unit': yield_unit, 'price_unit': price_unit,
                                  'uploaded_at': datetime.now(timezone.utc).isoformat()})


@app.post('/api/demo')
def demo():
    return create_workspace(demo_data(), {'filename': 'synthetic-resilience-demo.csv', 'source_type': 'synthetic',
        'source_name': 'Generated demonstration data (seed 42); district names are illustrative',
        'yield_unit': 't/ha', 'price_unit': 'INR/t', 'uploaded_at': datetime.now(timezone.utc).isoformat()})


@app.get('/api/download-sample')
def sample():
    return respond({'csv_sample': demo_data().to_csv(index=False), 'message': 'Synthetic demonstration data: yield t/ha, price INR/t.'})


@app.get('/api/workspace')
def workspace():
    item = current()
    return respond({'dataset': dataset_info(item), 'results': item.results})


@app.post('/api/analyze')
def analyze():
    item = current()
    if not item.lock.acquire(blocking=False):
        return respond({'error': 'Analysis is already running for this workspace.'}, 409)
    try:
        if item.results is not None:
            return respond(item.results)
        df = item.frame
        if not training_slot.acquire(blocking=False):
            return respond({'error': 'Another analysis is running. Please retry shortly.'}, 503)
        try:
            model_results, artifact = train_models(df)
        finally:
            training_slot.release()
        numeric = df.select_dtypes(include='number')
        analysis = {'descriptive_stats': numeric.describe().to_dict(), 'shape': {'rows': len(df), 'columns': len(df.columns)},
                    'quality': item.audit, 'correlations': numeric.corr().to_dict()}
        item.artifact = artifact
        item.results = safe({'analysis': analysis, 'models': model_results, 'insights': build_insights(df, item.metadata),
                             'dataset': dataset_info(item), 'scenario_options': scenario_options(artifact) if artifact else None,
                             'generated_at': datetime.now(timezone.utc).isoformat()})
        return respond(item.results)
    finally:
        item.lock.release()


@app.get('/api/results')
def results():
    item = current()
    if item.results is None:
        raise ValueError('Run the analysis first.')
    return respond(item.results)


@app.get('/api/stats')
def stats():
    item = current()
    return respond({**dataset_info(item), 'dtypes': item.frame.dtypes.astype(str).to_dict()})


@app.post('/api/scenario')
def scenario():
    item = current()
    if item.artifact is None:
        raise ValueError('Run an eligible model analysis before creating scenarios.')
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError('Supply a JSON scenario object.')
    return respond(predict_scenario(item.artifact, payload))


def object_payload():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError('Supply a JSON object.')
    return payload


@app.get('/api/regional/locations')
def regional_locations():
    current()
    return respond({'locations': locations(request.args.get('q', ''))})


@app.get('/api/regional/weather')
def regional_saved_weather():
    return respond({'weather': current().regional_weather})


@app.post('/api/regional/weather')
def regional_weather():
    item = current()
    result = weather(object_payload())
    with item.operation_lock:
        item.regional_weather = result
    return respond(result)


@app.post('/api/regional/assistant')
def regional_assistant():
    item = current()
    result = briefing(item.frame, item.metadata, item.regional_weather, object_payload())
    result['dataset_fingerprint'] = item.audit['fingerprint']
    return respond(result)


@app.post('/api/operations/review')
def custom_review():
    item = current()
    settings = review_settings(object_payload(), item.frame)
    return respond(build_insights(item.frame, item.metadata, settings))


@app.post('/api/operations/benchmark')
def compare_districts():
    item = current()
    return respond(benchmark(item.frame, object_payload()))


@app.post('/api/operations/production')
def calculate_production():
    current()
    return respond(production_plan(object_payload()))


@app.get('/api/operations')
def get_operations():
    item = current()
    with item.operation_lock:
        return respond({'tasks': item.tasks, 'seasons': sorted(item.frame.Season.unique()) if 'Season' in item.frame else [],
                        'years': sorted(item.frame.Year.unique()), 'lifecycle': 'Actions share the workspace expiry. Export before closing or restarting the server.'})


@app.post('/api/operations/tasks')
def add_task():
    item = current()
    fields = task_fields(object_payload())
    with item.operation_lock:
        if len(item.tasks) >= 100:
            raise ValueError('Maximum 100 actions per workspace.')
        task = {**fields, 'id': uuid.uuid4().hex, 'created_at': datetime.now(timezone.utc).isoformat()}
        item.tasks.append(task)
        return respond(task, 201)


@app.patch('/api/operations/tasks/<task_id>')
def update_task(task_id):
    item = current()
    fields = task_fields(object_payload(), partial=True)
    with item.operation_lock:
        task = next((task for task in item.tasks if task['id'] == task_id), None)
        if task is None:
            return respond({'error': 'Action not found in this workspace.'}, 404)
        task.update(fields)
        return respond(task)


@app.get('/api/data')
def data():
    item = current()
    df = item.frame
    for col, param in [('Crop', 'crop'), ('District', 'district')]:
        if request.args.get(param) and col in df:
            df = df[df[col] == request.args[param]]
    for param, operation in [('year_min', 'min'), ('year_max', 'max')]:
        if request.args.get(param):
            year = int(request.args[param])
            df = df[df.Year >= year] if operation == 'min' else df[df.Year <= year]
    page = max(1, int(request.args.get('page', '1')))
    size = min(100, max(1, int(request.args.get('size', '25'))))
    return respond({'rows': df.iloc[(page-1)*size:page*size].fillna('').to_dict('records'), 'total': len(df), 'page': page, 'size': size, 'columns': df.columns.tolist()})


def csv_response(frame, filename):
    # Neutralize spreadsheet formula interpretation of untrusted text on export.
    frame = frame.copy()
    for col in frame.select_dtypes(include=['object', 'string']).columns:
        frame[col] = frame[col].map(lambda value: "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')) else value)
    return Response(frame.to_csv(index=False), mimetype='text/csv', headers={'Content-Disposition': f'attachment; filename="{filename}"'})


@app.get('/api/export/<kind>')
def export(kind):
    item = current()
    if kind == 'actions':
        with item.operation_lock:
            return csv_response(pd.DataFrame(item.tasks, columns=['id', 'title', 'owner', 'due_date', 'status', 'priority', 'notes', 'created_at']), 'orqivra-actions.csv')
    if kind == 'cleaned':
        return csv_response(item.frame, 'orqivra-cleaned.csv')
    if kind == 'rejected':
        return csv_response(item.rejected, 'orqivra-excluded-rows.csv')
    if item.results is None:
        raise ValueError('Run the analysis before exporting reports.')
    if kind == 'predictions':
        if not item.results['models']['available']:
            raise ValueError('This dataset has no model predictions.')
        return csv_response(pd.DataFrame(item.results['models']['test_records']), 'orqivra-test-predictions.csv')
    if kind == 'report':
        return Response(json.dumps(safe(item.results), indent=2, allow_nan=False), mimetype='application/json', headers={'Content-Disposition': 'attachment; filename="orqivra-report.json"'})
    raise ValueError('Unknown export type.')


@app.get('/')
def frontend_index():
    return send_from_directory(frontend_build, 'index.html')


@app.get('/<path:asset>')
def frontend_asset(asset):
    # Serve only actual build assets. Never expose backend source or upload paths.
    return send_from_directory(frontend_build, asset)


@app.after_request
def response_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['X-Frame-Options'] = 'DENY'
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.errorhandler(ValueError)
def validation_error(error):
    return respond({'error': str(error)}, 400)


@app.errorhandler(HTTPException)
def http_error(error):
    return respond({'error': 'Request exceeds this deployment’s size limit.' if error.code == 413 else error.description}, error.code)


@app.errorhandler(Exception)
def unexpected_error(error):
    app.logger.exception('Request failed')
    return respond({'error': 'Analysis could not be completed. Check the server log and dataset schema.'}, 500)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', '5001')))
