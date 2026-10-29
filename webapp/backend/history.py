"""Descriptive, equal-year-weighted historical analysis; never a forecast."""
from operations import number


def historical_analysis(frame, payload):
    allowed = {'crop', 'district', 'season', 'year_min', 'year_max', 'split_year', 'yield_threshold'}
    if set(payload) - allowed:
        raise ValueError('Unsupported historical analysis option.')
    selected = frame
    for column, key in [('Crop', 'crop'), ('District', 'district'), ('Season', 'season')]:
        if column not in frame:
            if payload.get(key):
                raise ValueError(f'{column} is unavailable in this dataset.')
            continue
        value = payload.get(key)
        if not isinstance(value, str) or value not in frame[column].unique():
            raise ValueError(f'Choose a valid {key}.')
        selected = selected[selected[column] == value]
    low = number(payload.get('year_min'), 'Start year', int(frame.Year.min()), int(frame.Year.max()), True)
    high = number(payload.get('year_max'), 'End year', int(frame.Year.min()), int(frame.Year.max()), True)
    if low >= high:
        raise ValueError('Choose a start year earlier than the end year.')
    split = number(payload.get('split_year'), 'Recent period starts', low + 1, high, True)
    threshold = number(payload.get('yield_threshold'), 'Yield threshold', 0, 10000000)
    selected = selected[selected.Year.between(low, high)]
    metrics = ['Crop_Yield', 'Rainfall_mm', 'Avg_Temperature_C', 'Market_Price']
    annual = selected.groupby('Year')[metrics].mean().reset_index()
    if len(annual) < 4:
        raise ValueError('At least four distinct observation years are required for these filters.')
    annual['observations'] = selected.groupby('Year').size().values
    earlier, recent = annual[annual.Year < split], annual[annual.Year >= split]
    if min(len(earlier), len(recent)) < 2:
        raise ValueError('Each comparison period needs at least two observed years.')
    comparisons = []
    for metric in metrics:
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
    missing = sorted(set(range(int(low), int(high) + 1)) - set(annual.Year))
    warnings = ['Associations do not establish causation. Time trends, management and sampling can explain apparent relationships.',
                'Annual means weight each observed year equally. Missing years are not filled; records within a year may not represent independent fields.',
                'Market prices are nominal; changes are not adjusted for inflation.']
    if missing:
        warnings.append('Missing observation years: ' + ', '.join(map(str, missing)))
    if min(len(earlier), len(recent)) < 5:
        warnings.append('At least one period has fewer than five observed years; its average may be unstable.')
    return {'filters': payload, 'annual': annual.to_dict('records'), 'rows': len(selected), 'years': len(annual),
            'earlier_years': earlier.Year.tolist(), 'recent_years': recent.Year.tolist(), 'comparisons': comparisons,
            'variability': {'mean': mean, 'sample_std': std, 'cv_percent': std / mean * 100 if mean > 0 else None,
                            'minimum': float(yields.min()), 'maximum': float(yields.max())},
            'threshold': {'value': threshold, 'below_years': annual.loc[yields < threshold, 'Year'].tolist(),
                          'below_percent': float((yields < threshold).mean() * 100),
                          'note': 'Frequency among observed annual means, not a probability of future crop failure.'},
            'associations': associations, 'warnings': warnings}
