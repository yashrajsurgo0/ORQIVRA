"""Descriptive, equal-year-weighted historical analysis; never a forecast."""
import math
import numpy as np
from scipy import stats
from operations import number

METRICS = ['Crop_Yield', 'Rainfall_mm', 'Avg_Temperature_C', 'Market_Price']
ALLOWED = {'crop', 'district', 'season', 'year_min', 'year_max', 'split_year', 'yield_threshold',
           'aggregation', 'rolling_window', 'anomaly_z'}


def select(frame, payload, pooled_keys=('district', 'season')):
    """Filter by crop and optional district/season. An empty district or season pools all values."""
    selected, pooled = frame, []
    for column, key in [('Crop', 'crop'), ('District', 'district'), ('Season', 'season')]:
        value = payload.get(key)
        if column not in frame:
            if value:
                raise ValueError(f'{column} is unavailable in this dataset.')
            continue
        if key in pooled_keys and value in (None, ''):
            if frame[column].nunique() > 1:
                pooled.append(column)
            continue
        if not isinstance(value, str) or value not in frame[column].unique():
            raise ValueError(f'Choose a valid {key}.')
        selected = selected[selected[column] == value]
    return selected, pooled


def linear_trend(years, values):
    """Ordinary least-squares slope across observed years (descriptive only)."""
    valid = ~np.isnan(values)
    x, y = np.asarray(years, dtype=float)[valid], np.asarray(values, dtype=float)[valid]
    if len(x) < 5 or np.unique(y).size < 2:
        return {'slope_per_year': None, 'slope_per_decade': None, 'r_squared': None, 'p_value': None, 'years': int(len(x)),
                'status': 'Withheld: need five years and variation'}
    fit = stats.linregress(x, y)
    p = float(fit.pvalue) if math.isfinite(fit.pvalue) else None
    status = 'Clear linear tendency (p < 0.05)' if p is not None and p < .05 else 'No clear linear tendency'
    return {'slope_per_year': float(fit.slope), 'slope_per_decade': float(fit.slope * 10), 'r_squared': float(fit.rvalue ** 2),
            'p_value': p, 'years': int(len(x)), 'status': status}


def historical_analysis(frame, payload):
    if set(payload) - ALLOWED:
        raise ValueError('Unsupported historical analysis option.')
    selected, pooled = select(frame, payload)
    low = number(payload.get('year_min'), 'Start year', int(frame.Year.min()), int(frame.Year.max()), True)
    high = number(payload.get('year_max'), 'End year', int(frame.Year.min()), int(frame.Year.max()), True)
    if low >= high:
        raise ValueError('Choose a start year earlier than the end year.')
    split = number(payload.get('split_year'), 'Recent period starts', low + 1, high, True)
    raw_threshold = payload.get('yield_threshold')
    threshold = None if raw_threshold in (None, '') else number(raw_threshold, 'Yield threshold', 0, 10000000)
    aggregation = payload.get('aggregation', 'mean')
    if aggregation not in ('mean', 'median'):
        raise ValueError('Annual summary must be mean or median.')
    window = number(payload.get('rolling_window', 0), 'Rolling window', 0, 7, True)
    if window == 1 or window == 2:
        raise ValueError('Rolling window must be off (0) or between 3 and 7 years.')
    anomaly_z = number(payload.get('anomaly_z', 1.5), 'Anomaly threshold', 1, 3)
    selected = selected[selected.Year.between(low, high)]
    grouped = selected.groupby('Year')[METRICS]
    annual = (grouped.median() if aggregation == 'median' else grouped.mean()).reset_index()
    if len(annual) < 4:
        raise ValueError('At least four distinct observation years are required for these filters.')
    annual['observations'] = selected.groupby('Year').size().values
    if window:
        # Trailing average over observed years only; early years without a full window stay empty.
        for metric in METRICS:
            annual[f'{metric}_rolling'] = annual[metric].rolling(window, min_periods=window).mean()
    earlier, recent = annual[annual.Year < split], annual[annual.Year >= split]
    if min(len(earlier), len(recent)) < 2:
        raise ValueError('Each comparison period needs at least two observed years.')
    comparisons = []
    for metric in METRICS:
        baseline, latest = float(earlier[metric].mean()), float(recent[metric].mean())
        comparisons.append({'metric': metric, 'earlier': baseline, 'recent': latest,
                            'difference': latest - baseline,
                            'change_percent': (latest / baseline - 1) * 100 if baseline != 0 and metric != 'Avg_Temperature_C' else None})
    yields = annual.Crop_Yield
    mean, std = float(yields.mean()), float(yields.std(ddof=1))
    associations = []
    for metric in ['Rainfall_mm', 'Avg_Temperature_C']:
        valid = len(annual) >= 5 and annual[metric].nunique() > 1 and yields.nunique() > 1
        associations.append({'metric': metric, 'pearson_r': float(annual[metric].corr(yields)) if valid else None,
                             'years': len(annual), 'status': 'Descriptive association' if valid else 'Withheld: need five years and variation in both variables'})
    trends = [{'metric': metric, **linear_trend(annual.Year, annual[metric].to_numpy(dtype=float))} for metric in METRICS]
    anomalies = []
    if std > 0:
        context = {metric: float(annual[metric].mean()) for metric in ['Rainfall_mm', 'Avg_Temperature_C']}
        for row in annual.to_dict('records'):
            z = (row['Crop_Yield'] - mean) / std
            if abs(z) >= anomaly_z:
                anomalies.append({'year': int(row['Year']), 'yield': row['Crop_Yield'], 'z_score': z, 'direction': 'High' if z > 0 else 'Low',
                                  'rainfall_vs_mean': row['Rainfall_mm'] - context['Rainfall_mm'],
                                  'temperature_vs_mean': row['Avg_Temperature_C'] - context['Avg_Temperature_C']})
    missing = sorted(set(range(int(low), int(high) + 1)) - set(annual.Year))
    warnings = ['Associations and trends do not establish causation. Time trends, management and sampling can explain apparent relationships.',
                f'Annual {aggregation}s weight each observed year equally. Missing years are not filled; records within a year may not represent independent fields.',
                'Market prices are nominal; changes are not adjusted for inflation.']
    if pooled:
        warnings.append('Pooled across all ' + ' and '.join(c.lower() + 's' for c in pooled) +
                        '. Changes in which locations or seasons were observed each year can shift annual values.')
    if missing:
        warnings.append('Missing observation years: ' + ', '.join(map(str, missing)))
    if min(len(earlier), len(recent)) < 5:
        warnings.append('At least one period has fewer than five observed years; its average may be unstable.')
    if any(t['p_value'] is not None for t in trends):
        warnings.append('Trend p-values assume independent years; serial correlation in agricultural series can make them optimistic.')
    return {'filters': payload, 'annual': annual.to_dict('records'), 'rows': len(selected), 'years': len(annual),
            'aggregation': aggregation, 'rolling_window': window, 'pooled': pooled,
            'earlier_years': earlier.Year.tolist(), 'recent_years': recent.Year.tolist(), 'comparisons': comparisons,
            'variability': {'mean': mean, 'sample_std': std, 'cv_percent': std / mean * 100 if mean > 0 else None,
                            'minimum': float(yields.min()), 'maximum': float(yields.max())},
            'threshold': None if threshold is None else {'value': threshold, 'below_years': annual.loc[yields < threshold, 'Year'].tolist(),
                          'below_percent': float((yields < threshold).mean() * 100),
                          'note': 'Frequency among observed annual values, not a probability of future crop failure.'},
            'associations': associations, 'trends': trends,
            'anomalies': {'threshold_z': anomaly_z, 'years': anomalies,
                          'note': 'Years whose annual yield lies at least this many sample standard deviations from the selection mean. Weather context is a comparison with the selection average, not a cause.'},
            'warnings': warnings}
