"""Regional evidence from Open-Meteo plus transparent, backtested crop outlooks."""
from collections import OrderedDict
from datetime import datetime, timezone
import json
import math
import os
import ssl
import threading
import time
from urllib.parse import urlencode
from urllib.request import urlopen, Request
from urllib.error import URLError
import numpy as np
from werkzeug.exceptions import ServiceUnavailable
from operations import number

SOURCE = 'https://open-meteo.com/en/docs'
_cache = OrderedDict()
_cache_lock = threading.Lock()


def fetch_json(host, params, ttl=900):
    # Hosts are constants supplied only by server code. No arbitrary URL proxy.
    url = host + '?' + urlencode(params)
    with _cache_lock:
        cached = _cache.get(url)
        if cached and time.monotonic() - cached[0] < ttl:
            return cached[1]
    # Python.org macOS installations may lack a linked CA bundle; retain TLS
    # verification using the OS trust bundle when available.
    tls = ssl.create_default_context()
    if os.path.isfile('/etc/ssl/cert.pem'):
        tls.load_verify_locations('/etc/ssl/cert.pem')
    try:
        with urlopen(Request(url, headers={'User-Agent': 'ORQIVRA/2.1'}), timeout=15, context=tls) as response:
            data = json.loads(response.read(2_000_000))
        if not isinstance(data, dict) or data.get('error'):
            raise ValueError('Invalid provider response')
    except (URLError, TimeoutError, ValueError, OSError):
        raise ServiceUnavailable('Weather provider is unavailable. Retry shortly; no synthetic weather has been substituted.') from None
    data['_orqivra_fetched_at'] = datetime.now(timezone.utc).isoformat()
    with _cache_lock:
        _cache[url] = (time.monotonic(), data)
        while len(_cache) > 64:
            _cache.popitem(last=False)
    return data


def locations(query):
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 100:
        raise ValueError('Enter a place name of 2–100 characters.')
    data = fetch_json('https://geocoding-api.open-meteo.com/v1/search', {'name': query.strip(), 'count': 8, 'language': 'en', 'format': 'json'}, 86400)
    keys = ['id', 'name', 'latitude', 'longitude', 'country', 'admin1', 'timezone']
    return [{key: row.get(key) for key in keys} for row in data.get('results', [])]


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def weather(payload):
    lat = number(payload.get('latitude'), 'Latitude', -90, 90)
    lon = number(payload.get('longitude'), 'Longitude', -180, 180)
    label = payload.get('name', 'Selected coordinates')
    if not isinstance(label, str) or not 1 <= len(label) <= 200:
        raise ValueError('Supply a location label of up to 200 characters.')
    params = {'latitude': lat, 'longitude': lon, 'timezone': 'auto', 'past_days': 7, 'forecast_days': 7,
              'current': 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
              'daily': 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,et0_fao_evapotranspiration',
              'hourly': 'soil_temperature_6cm,soil_moisture_3_to_9cm', 'wind_speed_unit': 'kmh'}
    raw = fetch_json('https://api.open-meteo.com/v1/forecast', params)
    current = raw.get('current') or {}
    current_time = current.get('time')
    if not isinstance(current_time, str):
        raise ServiceUnavailable('Provider returned no current weather timestamp. Try again later.')
    daily = raw.get('daily') or {}
    rows = []
    for i, day in enumerate(daily.get('time', [])):
        row = {'date': day, 'period': 'past model data' if day < current_time[:10] else 'forecast'}
        for key in params['daily'].split(','):
            values = daily.get(key) or []
            row[key] = values[i] if i < len(values) and finite(values[i]) else None
        rows.append(row)
    if not rows:
        raise ServiceUnavailable('Provider returned no daily weather. Try again later.')
    hourly = raw.get('hourly') or {}
    candidates = [(i, stamp) for i, stamp in enumerate(hourly.get('time', [])) if stamp <= current_time]
    soil = {'time': None, 'temperature_c': None, 'moisture_m3_m3': None, 'depth': 'Temperature: 6 cm; moisture: 3–9 cm'}
    if candidates:
        index, stamp = max(candidates, key=lambda item: item[1])
        soil['time'] = stamp
        for output, key in [('temperature_c', 'soil_temperature_6cm'), ('moisture_m3_m3', 'soil_moisture_3_to_9cm')]:
            values = hourly.get(key) or []
            soil[output] = values[index] if index < len(values) and finite(values[index]) else None
    return {'location': {'name': label, 'latitude': lat, 'longitude': lon}, 'grid': {'latitude': raw.get('latitude'), 'longitude': raw.get('longitude'), 'elevation_m': raw.get('elevation')},
            'timezone': raw.get('timezone'), 'utc_offset_seconds': raw.get('utc_offset_seconds', 0), 'current': current, 'current_units': raw.get('current_units', {}),
            'daily': rows, 'soil': soil, 'retrieved_at': raw.get('_orqivra_fetched_at', datetime.now(timezone.utc).isoformat()),
            'source': SOURCE, 'attribution': 'Weather data by Open-Meteo (CC BY 4.0). Free endpoint for non-commercial use.',
            'limitations': ['Current conditions and recent history are weather-model estimates, not your field sensor measurements.',
                           'Soil moisture is volumetric modeled water content, not a soil fertility or irrigation requirement measurement.',
                           'Forecasts cover today and the next six days. Longer-range crop outlooks below use uploaded history, not this short-term weather.']}


def crop_history(frame, payload):
    crop, district, season = payload.get('crop'), payload.get('district', ''), payload.get('season', '')
    if not isinstance(crop, str) or crop not in frame.Crop.unique():
        raise ValueError('Select a crop from the dataset.')
    selected = frame[frame.Crop == crop]
    for key, value in [('District', district), ('Season', season)]:
        if key in frame:
            if not isinstance(value, str) or value not in selected[key].unique():
                raise ValueError(f'Select a {key.lower()} represented for this crop and location.')
            selected = selected[selected[key] == value]
    annual = selected.groupby('Year').agg(yield_mean=('Crop_Yield', 'mean'), rainfall_mm=('Rainfall_mm', 'mean'), temperature_c=('Avg_Temperature_C', 'mean'), rows=('Crop', 'size')).reset_index()
    land = {}
    for key in ['Soil_pH', 'Irrigation_mm', 'Humidity_Percent']:
        if key in selected:
            land[key] = {'median': float(selected[key].median()), 'min': float(selected[key].min()), 'max': float(selected[key].max())}
    return {'crop': crop, 'district': district, 'season': season, 'annual': annual.to_dict('records'), 'land_history': land,
            'rows': len(selected), 'years': len(annual), 'last_year': int(annual.Year.max())}


def outlook(history):
    rows = history['annual']
    if len(rows) < 8:
        return {'available': False, 'reason': 'At least eight observed years for this crop/location/season are required for a rolling backtest.'}
    x = np.array([row['Year'] for row in rows], dtype=float)
    y = np.array([row['yield_mean'] for row in rows], dtype=float)
    def trend(a, b, target):
        slope, intercept = np.polyfit(a - a[0], b, 1)
        return np.maximum(0, intercept + slope * (np.asarray(target) - a[0]))
    folds = []
    for i in range(max(5, len(x)-5), len(x)):
        folds.append({'year': int(x[i]), 'actual': float(y[i]), 'trend': float(trend(x[:i], y[:i], x[i])), 'last_observed': float(y[i-1])})
    errors = {key: float(np.mean([abs(row[key]-row['actual']) for row in folds])) for key in ['trend', 'last_observed']}
    chosen = min(errors, key=errors.get)
    future = np.arange(int(x[-1])+1, int(x[-1])+4)
    predictions = trend(x, y, future) if chosen == 'trend' else np.repeat(y[-1], 3)
    max_error = max(abs(row[chosen]-row['actual']) for row in folds)
    return {'available': True, 'method': chosen, 'backtest_mae': errors, 'backtest': folds,
            'projection': [{'year': int(year), 'yield': float(value), 'stress_low': max(0, float(value)-max_error), 'stress_high': float(value)+max_error} for year, value in zip(future, predictions)],
            'note': 'The lower rolling-backtest MAE chooses linear trend or last-observed yield. Backtest scores are used for selection, not independent validation. Stress bounds use the largest selected-model backtest error; they are not confidence intervals and do not grow with horizon. Future climate, pests, area and management are unknown.'}


def briefing(frame, metadata, weather_data, payload):
    history = crop_history(frame, payload)
    future = outlook(history)
    question = payload.get('question', 'Summarize my region')
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 1000:
        raise ValueError('Ask a question of 1–1000 characters.')
    stage = payload.get('stage', 'Unknown')
    if stage not in ['Unknown', 'Planning', 'Establishment', 'Vegetative', 'Flowering', 'Harvest']:
        raise ValueError('Choose a listed crop stage.')
    soil_ph = payload.get('soil_ph')
    soil_ph = None if soil_ph in [None, ''] else number(soil_ph, 'Soil pH', 0, 14)
    texture = payload.get('texture', 'Unknown')
    if texture not in ['Unknown', 'Sandy', 'Loamy', 'Clayey', 'Mixed']:
        raise ValueError('Choose a listed soil texture.')
    sections, actions, gaps = [], [], []
    unit = metadata.get('yield_unit', 'unspecified')
    latest = history['annual'][-1]
    sections.append({'topic': 'history', 'title': 'Crop and regional history', 'text': f"{history['crop']} / {history['district'] or 'all locations'}: {history['rows']} rows over {history['years']} years. Latest annual mean yield: {latest['yield_mean']:.2f} {unit} in {history['last_year']}. Annual climate columns retain the uploaded period definitions; they are not compared directly with a seven-day forecast.", 'source': 'Uploaded dataset; source declaration: ' + metadata['source_type']})
    if metadata['source_type'] == 'synthetic':
        gaps.append('Crop history is synthetic: its yields and projections do not establish real regional performance.')
    if history['last_year'] < datetime.now(timezone.utc).year-1:
        gaps.append('Crop records are outdated. Projection years begin immediately after the last observed year, and may already be in the past.')
    if weather_data:
        stamp = datetime.fromisoformat(weather_data['retrieved_at'])
        age = (datetime.now(timezone.utc)-stamp).total_seconds()/3600
        model_stamp = datetime.fromisoformat(weather_data['current']['time']).replace(tzinfo=timezone.utc).timestamp() - weather_data.get('utc_offset_seconds', 0)
        stale = age > 3 or time.time()-model_stamp > 6*3600
        if stale:
            gaps.append('Weather snapshot is stale (retrieved over three hours ago or model timestamp over six hours old). Refresh it before using it for decisions.')
        forecast = [row for row in weather_data['daily'] if row['period'] == 'forecast']
        rain = [r['precipitation_sum'] for r in forecast if finite(r['precipitation_sum'])]
        et0 = [r['et0_fao_evapotranspiration'] for r in forecast if finite(r['et0_fao_evapotranspiration'])]
        temps = [r['temperature_2m_max'] for r in forecast if finite(r['temperature_2m_max'])]
        complete = len(rain) == len(et0) == len(forecast) == 7
        current_temp = weather_data['current'].get('temperature_2m')
        summary = f"{weather_data['location']['name']}: model time {weather_data['current']['time']} ({weather_data['timezone']}). Temperature {current_temp if finite(current_temp) else 'unavailable'} °C. "
        summary += f"Seven-day precipitation total {sum(rain):.1f} mm; reference ET₀ {sum(et0):.1f} mm." if complete else 'Seven-day totals withheld because daily precipitation or ET₀ values are incomplete.'
        wind = weather_data['current'].get('wind_speed_10m')
        humidity = weather_data['current'].get('relative_humidity_2m')
        summary += f" Current wind: {wind if finite(wind) else 'unavailable'} km/h; relative humidity: {humidity if finite(humidity) else 'unavailable'}%."
        sections.append({'topic': 'weather', 'title': 'Present conditions and seven-day outlook', 'text': summary, 'source': SOURCE})
        recent = [row for row in weather_data['daily'] if row['period'] == 'past model data']
        recent_rain = [row['precipitation_sum'] for row in recent if finite(row['precipitation_sum'])]
        recent_text = f"The preceding seven days ({recent[0]['date']} to {recent[-1]['date']}) total {sum(recent_rain):.1f} mm modeled precipitation. This is archived model data, not station measurements or a climate normal." if len(recent) == len(recent_rain) == 7 else 'Recent seven-day precipitation total is unavailable because daily data are incomplete.'
        sections.append({'topic': 'weather', 'title': 'Recent regional weather history', 'text': recent_text, 'source': SOURCE})
        if not complete:
            gaps.append('Some forecast values are missing; missing data are never treated as zero.')
        if not stale:
            if temps and max(temps) >= 35:
                actions.append({'title': 'Review heat exposure', 'evidence': f"Forecast maximum reaches {max(temps):.1f} °C (generic screening threshold: 35 °C).", 'suggestion': f'Check local heat advisories and crop-stage sensitivity ({stage.lower()}); inspect the field before changing management.'})
            cold = [r['temperature_2m_min'] for r in forecast if finite(r['temperature_2m_min']) and r['temperature_2m_min'] <= 0]
            if cold:
                actions.append({'title': 'Check frost preparedness', 'evidence': f'Forecast minimum reaches {min(cold):.1f} °C.', 'suggestion': 'Consult local frost guidance; crop damage depends on stage, exposure and actual canopy temperature.'})
            wet = [r for r in forecast if finite(r['precipitation_sum']) and r['precipitation_sum'] >= 25]
            if wet:
                actions.append({'title': 'Inspect drainage and field access', 'evidence': f"{len(wet)} forecast day(s) exceed the generic 25 mm/day review threshold.", 'suggestion': 'Inspect drainage and reassess field-access plans using local forecasts. This is not a flood warning.'})
            if complete and sum(et0) > sum(rain):
                actions.append({'title': 'Check root-zone water availability', 'evidence': f"Reference ET₀ exceeds precipitation by {sum(et0)-sum(rain):.1f} mm over seven days.", 'suggestion': 'Measure soil moisture and review irrigation availability. ET₀ minus rainfall is a screening balance, not an irrigation dose; crop coefficient, effective rain and soil storage are missing.'})
        sections.append({'topic': 'soil', 'title': 'Land and soil evidence', 'text': f"Modeled soil moisture at 3–9 cm: {weather_data['soil']['moisture_m3_m3']} m³/m³; soil temperature at 6 cm: {weather_data['soil']['temperature_c']} °C. These describe a weather grid cell, not soil chemistry, drainage or root-zone conditions at the farm.", 'source': SOURCE})
        gaps.append('Weather coordinates and the selected historical district are linked by you, not verified geographic matching. Confirm the location before interpreting both together.')
    else:
        gaps.append('No regional weather snapshot loaded. Search and select a location to add current conditions and forecasts.')
    land_labels = {'Soil_pH': 'pH', 'Irrigation_mm': 'irrigation (mm per uploaded period)', 'Humidity_Percent': 'humidity (%)'}
    land_text = '; '.join(f"{land_labels[key]}: median {value['median']:.2f}, range {value['min']:.2f}–{value['max']:.2f}" for key, value in history['land_history'].items()) or 'none supplied'
    sections.append({'topic': 'soil', 'title': 'Field observations supplied by you', 'text': f"Crop stage: {stage}; texture: {texture}; measured pH: {soil_ph if soil_ph is not None else 'not supplied'}. These values are unverified. Historical land fields: {land_text}. No fertilizer, pesticide, crop suitability or irrigation dose can be established from this evidence alone.", 'source': 'User-entered field context and uploaded historical columns'})
    gaps.append('Soil nutrients, salinity, drainage, cultivar, pest observations and management records are needed for field-specific agronomic prescriptions.')
    if future['available']:
        first = future['projection'][0]
        text = f"History-only outlook for {first['year']}: {first['yield']:.2f} {unit}, using {future['method'].replace('_', ' ')}. Three projection years are available below. {future['note']}"
    else:
        text = future['reason']
    sections.append({'topic': 'future', 'title': 'Longer-term crop outlook', 'text': text, 'source': 'Uploaded crop history; rolling chronological backtest'})
    query = question.lower()
    intents = {'weather': ['weather', 'rain', 'temperature', 'heat', 'cold', 'wind', 'water', 'irrigat'], 'soil': ['soil', 'land', 'ph', 'fertili', 'nutrient'], 'history': ['history', 'past', 'crop', 'yield'], 'future': ['future', 'forecast', 'predict', 'outlook', 'next', 'yield']}
    topics = [key for key, words in intents.items() if any(word in query for word in words)]
    broad = any(word in query for word in ['summar', 'suggest', 'insight', 'priorit', 'plan', 'region', 'risk'])
    supported = broad or bool(topics)
    answer_sections = sections if broad else [section for section in sections if section['topic'] in topics]
    if not supported:
        answer_sections = [{'topic': 'scope', 'title': 'Available evidence', 'text': 'I can summarize regional weather, soil evidence, crop history, water-review priorities and the history-only yield outlook. I cannot answer this question reliably from the available data. Try one of the suggested questions.', 'source': 'Assistant scope'}]
    if not actions:
        actions.append({'title': 'Collect field observations', 'evidence': 'No actionable weather screening result is available, or no configured threshold was crossed.', 'suggestion': 'Record crop stage, soil-test results, moisture and pest observations. Absence of a flag does not establish low risk.'})
    return {'question': question, 'mode': 'Evidence assistant — deterministic retrieval and calculations, not a general-purpose LLM', 'sections': answer_sections,
            'actions': actions if supported else [], 'gaps': gaps, 'history': history, 'outlook': future,
            'context': {'crop': history['crop'], 'district': history['district'], 'season': history['season'], 'stage': stage, 'texture': texture, 'soil_ph': soil_ph},
            'generated_at': datetime.now(timezone.utc).isoformat(), 'weather_retrieved_at': weather_data['retrieved_at'] if weather_data else None,
            'rules': 'Heat ≥35 °C, frost ≤0 °C, precipitation ≥25 mm/day, or ET₀ exceeding rainfall trigger generic reviews, not calibrated crop-specific risk probabilities.'}
