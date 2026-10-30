"""Transparent planning calculations; no causal, weather or market forecasts."""
import math
from datetime import date


def number(value, name, low, high, integer=False):
    if isinstance(value, bool) or value is None:
        raise ValueError(f'{name} must be a number.')
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise ValueError(f'{name} must be a number.') from None
    if not math.isfinite(result) or not low <= result <= high or (integer and result % 1):
        raise ValueError(f'{name} must be {"a whole number " if integer else ""}between {low} and {high}.')
    return int(result) if integer else result


def review_settings(payload, df):
    if not isinstance(payload, dict):
        raise ValueError('Supply a review settings object.')
    defaults = {'year': int(df.Year.max()), 'history_years': 5, 'rainfall_drop': 20, 'temperature_rise': 1, 'yield_drop': 15}
    if set(payload) - set(defaults):
        raise ValueError('Unknown review setting.')
    limits = {'year': (int(df.Year.min()), int(df.Year.max()), True), 'history_years': (3, 10, True),
              'rainfall_drop': (1, 100, False), 'temperature_rise': (.1, 10, False), 'yield_drop': (1, 100, False)}
    settings = {key: number(payload.get(key, value), key, *limits[key]) for key, value in defaults.items()}
    if settings['year'] not in df.Year.unique():
        raise ValueError('Selected review year has no observations.')
    return settings


def benchmark(df, payload):
    crop = payload.get('crop')
    if crop not in df.Crop.unique():
        raise ValueError('Choose a crop in this dataset.')
    if 'District' not in df:
        raise ValueError('District comparisons require a District column.')
    districts = payload.get('districts')
    if not isinstance(districts, list) or not 2 <= len(districts) <= 6 or any(not isinstance(x, str) for x in districts) or len(set(districts)) != len(districts):
        raise ValueError('Choose two to six distinct districts.')
    selected = df[df.Crop == crop]
    season = payload.get('season')
    if 'Season' in df:
        if season not in selected.Season.unique():
            raise ValueError('Choose a season represented for this crop.')
        selected = selected[selected.Season == season]
    low = number(payload.get('year_min', int(df.Year.min())), 'Start year', int(df.Year.min()), int(df.Year.max()), True)
    high = number(payload.get('year_max', int(df.Year.max())), 'End year', int(df.Year.min()), int(df.Year.max()), True)
    if low > high:
        raise ValueError('Start year must not exceed end year.')
    selected = selected[selected.Year.between(low, high)]
    sets = [set(selected[selected.District == district].Year) for district in districts]
    common = sorted(set.intersection(*sets))
    if not common:
        raise ValueError('No shared observation years for these selections. Broaden the period or change districts.')
    records, summary = [], []
    for district in districts:
        subset = selected[(selected.District == district) & selected.Year.isin(common)]
        annual = subset.groupby('Year').agg(yield_mean=('Crop_Yield', 'mean'), rainfall=('Rainfall_mm', 'mean'), temperature=('Avg_Temperature_C', 'mean'), rows=('Crop', 'size')).reset_index()
        summary.append({'district': district, 'rows': len(subset), 'years': len(common), 'yield_mean': float(annual.yield_mean.mean()),
                        'rainfall_mean': float(annual.rainfall.mean()), 'temperature_mean': float(annual.temperature.mean())})
        records.extend([{**row, 'district': district} for row in annual.to_dict('records')])
    return {'crop': crop, 'season': season, 'common_years': common, 'requested_period': [low, high], 'summary': summary, 'annual': records,
            'note': 'Each shared year has equal weight. Differences are descriptive, not evidence of crop suitability or district effects. Sampling, varieties and management may differ.',
            'warnings': ['Only one shared year; year-to-year consistency cannot be assessed.'] if len(common) == 1 else []}


def production_plan(payload):
    area = number(payload.get('area_ha'), 'Area (ha)', .001, 1000000)
    expected = number(payload.get('yield_per_ha'), 'Assumed yield', 0, 10000000)
    loss = number(payload.get('loss_percent', 0), 'Loss allowance (%)', 0, 100)
    unit = payload.get('yield_unit')
    if unit not in ['t/ha', 'kg/ha']:
        raise ValueError('Select t/ha or kg/ha explicitly for the assumed yield.')
    gross = area * expected / (1000 if unit == 'kg/ha' else 1)
    return {'area_ha': area, 'yield_per_ha': expected, 'yield_unit': unit, 'loss_percent': loss,
            'gross_tonnes': gross, 'loss_tonnes': gross * loss / 100, 'available_tonnes': gross * (1-loss/100),
            'note': 'Arithmetic from your assumptions, not a model forecast or guaranteed production. Loss allowance is user supplied, not estimated from the dataset.'}


def task_fields(payload, partial=False):
    if not isinstance(payload, dict) or set(payload) - {'title', 'owner', 'due_date', 'status', 'priority', 'notes'}:
        raise ValueError('Supply valid action fields.')
    defaults = {'title': '', 'owner': '', 'due_date': '', 'status': 'Open', 'priority': 'Normal', 'notes': ''}
    result = {}
    for key, default in defaults.items():
        if partial and key not in payload:
            continue
        value = payload.get(key, default)
        if not isinstance(value, str):
            raise ValueError(f'{key} must be text.')
        value = value.strip()
        limit = 2000 if key == 'notes' else 200
        if len(value) > limit:
            raise ValueError(f'{key} exceeds {limit} characters.')
        result[key] = value
    if 'title' in result and not result['title']:
        raise ValueError('An action title is required.')
    if 'status' in result and result['status'] not in ['Open', 'In progress', 'Done']:
        raise ValueError('Invalid action status.')
    if 'priority' in result and result['priority'] not in ['Normal', 'High']:
        raise ValueError('Invalid priority.')
    if result.get('due_date'):
        try:
            parsed = date.fromisoformat(result['due_date'])
            if parsed.isoformat() != result['due_date']:
                raise ValueError()
        except ValueError:
            raise ValueError('Use YYYY-MM-DD for the due date.') from None
    return result


PRICE_UNITS = {'INR/t': ('INR', 1), 'INR/kg': ('INR', 1000), 'USD/t': ('USD', 1), 'USD/kg': ('USD', 1000)}


def recent_reference(df, crop, years=3):
    """Median price and yield over the latest observed years for one crop; a starting point, not a forecast."""
    if crop not in df.Crop.unique():
        raise ValueError('Choose a crop in this dataset.')
    subset = df[df.Crop == crop]
    latest = sorted(subset.Year.unique())[-years:]
    recent = subset[subset.Year.isin(latest)]
    return {'crop': crop, 'years': [int(y) for y in latest], 'rows': len(recent),
            'median_price': float(recent.Market_Price.median()), 'median_yield': float(recent.Crop_Yield.median()),
            'note': 'Median of the latest observed years across all locations and seasons for this crop. Nominal prices; not a price or yield forecast.'}


def profitability(payload):
    area = number(payload.get('area_ha'), 'Area (ha)', .001, 1000000)
    expected = number(payload.get('yield_per_ha'), 'Assumed yield', 0, 10000000)
    price = number(payload.get('price'), 'Assumed price', 0, 1e9)
    cost = number(payload.get('cost_per_ha'), 'Cost per hectare', 0, 1e9)
    loss = number(payload.get('loss_percent', 0), 'Loss allowance (%)', 0, 100)
    step = number(payload.get('sensitivity_step', 10), 'Sensitivity step (%)', 1, 50)
    unit, price_unit = payload.get('yield_unit'), payload.get('price_unit')
    if unit not in ['t/ha', 'kg/ha']:
        raise ValueError('Select t/ha or kg/ha explicitly for the assumed yield.')
    if price_unit not in PRICE_UNITS:
        raise ValueError('Select a price unit: INR/t, INR/kg, USD/t or USD/kg.')
    currency, per_tonne = PRICE_UNITS[price_unit]
    yield_t = expected / (1000 if unit == 'kg/ha' else 1)
    price_t = price * per_tonne

    def margin(y_factor, p_factor):
        tonnes = area * yield_t * y_factor * (1 - loss / 100)
        return tonnes * price_t * p_factor - area * cost

    available = area * yield_t * (1 - loss / 100)
    revenue, total_cost = available * price_t, area * cost
    sellable_share = 1 - loss / 100
    breakeven_yield = None if price_t == 0 or sellable_share == 0 else cost / (price_t * sellable_share) * (1000 if unit == 'kg/ha' else 1)
    breakeven_price = None if available == 0 else total_cost / available / per_tonne
    factors = [1 + step / 100 * k for k in (-2, -1, 0, 1, 2)]
    grid = [{'yield_change_percent': (fy - 1) * 100, 'yield_per_ha': expected * fy,
             'cells': [{'price_change_percent': (fp - 1) * 100, 'price': price * fp, 'margin': margin(fy, fp)} for fp in factors]}
            for fy in factors if fy >= 0]
    return {'currency': currency, 'price_unit': price_unit, 'yield_unit': unit, 'area_ha': area, 'loss_percent': loss,
            'available_tonnes': available, 'revenue': revenue, 'total_cost': total_cost, 'margin': revenue - total_cost,
            'margin_per_ha': (revenue - total_cost) / area, 'margin_percent': (revenue - total_cost) / revenue * 100 if revenue > 0 else None,
            'breakeven_yield': breakeven_yield, 'breakeven_price': breakeven_price,
            'yield_headroom_percent': (expected - breakeven_yield) / expected * 100 if breakeven_yield is not None and expected > 0 else None,
            'price_headroom_percent': (price - breakeven_price) / price * 100 if breakeven_price is not None and price > 0 else None,
            'sensitivity_step': step, 'sensitivity': grid,
            'note': 'Arithmetic from your assumptions only. Not a market, price or yield forecast; costs, prices and losses are user supplied.'}
