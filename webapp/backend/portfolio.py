"""Descriptive crop stability and diversification comparison; not crop-suitability advice."""
import numpy as np
import pandas as pd
from operations import number
from history import select, linear_trend


def crop_portfolio(frame, payload):
    if set(payload) - {'district', 'season', 'year_min', 'year_max', 'crops'}:
        raise ValueError('Unsupported portfolio option.')
    selected, pooled = select(frame, {**payload, 'crop': None}, pooled_keys=('crop', 'district', 'season'))
    low = number(payload.get('year_min', int(frame.Year.min())), 'Start year', int(frame.Year.min()), int(frame.Year.max()), True)
    high = number(payload.get('year_max', int(frame.Year.max())), 'End year', int(frame.Year.min()), int(frame.Year.max()), True)
    if low >= high:
        raise ValueError('Choose a start year earlier than the end year.')
    selected = selected[selected.Year.between(low, high)]
    crops = payload.get('crops') or sorted(selected.Crop.unique())
    if not isinstance(crops, list) or any(not isinstance(c, str) or c not in frame.Crop.unique() for c in crops) or len(set(crops)) != len(crops):
        raise ValueError('Choose valid, distinct crops.')
    if not 2 <= len(crops) <= 8:
        raise ValueError('Choose two to eight crops to compare.')
    selected = selected[selected.Crop.isin(crops)]
    annual = selected.groupby(['Year', 'Crop']).agg(yield_value=('Crop_Yield', 'mean'), rainfall=('Rainfall_mm', 'mean')).reset_index()
    wide = annual.pivot(index='Year', columns='Crop', values='yield_value')
    rain = annual.pivot(index='Year', columns='Crop', values='rainfall')
    summary = []
    for crop in crops:
        series = wide[crop].dropna() if crop in wide else pd.Series(dtype=float)
        if len(series) < 4:
            summary.append({'crop': crop, 'years': int(len(series)), 'status': 'Withheld: fewer than four observed years'})
            continue
        mean, std = float(series.mean()), float(series.std(ddof=1))
        trend = linear_trend(series.index, series.to_numpy(dtype=float))
        rain_r = series.corr(rain[crop].loc[series.index]) if len(series) >= 5 and rain[crop].loc[series.index].nunique() > 1 and series.nunique() > 1 else None
        summary.append({'crop': crop, 'years': int(len(series)), 'status': 'Available', 'mean_yield': mean, 'cv_percent': std / mean * 100 if mean > 0 else None,
                        'worst_year': int(series.idxmin()), 'worst_shortfall_percent': (series.min() / mean - 1) * 100 if mean > 0 else None,
                        'low_years_percent': float((series < mean - std).mean() * 100) if std > 0 else 0.0,
                        'trend_percent_per_year': trend['slope_per_year'] / mean * 100 if trend['slope_per_year'] is not None and mean > 0 else None,
                        'trend_status': trend['status'], 'rainfall_r': float(rain_r) if rain_r is not None and np.isfinite(rain_r) else None})
    usable = [row['crop'] for row in summary if row['status'] == 'Available' and row.get('cv_percent') is not None]
    if len(usable) < 2:
        raise ValueError('At least two crops need four or more observed years with positive yields for these filters.')
    shared = wide[usable].dropna()
    correlations = []
    for i, a in enumerate(usable):
        for b in usable[i + 1:]:
            ok = len(shared) >= 5 and shared[a].nunique() > 1 and shared[b].nunique() > 1
            correlations.append({'crop_a': a, 'crop_b': b, 'pearson_r': float(shared[a].corr(shared[b])) if ok else None, 'years': int(len(shared))})
    diversification = None
    if len(shared) >= 5:
        relative = shared / shared.mean()
        index = relative.mean(axis=1)
        portfolio_cv = float(index.std(ddof=1) / index.mean() * 100)
        average_cv = float((shared.std(ddof=1) / shared.mean()).mean() * 100)
        diversification = {'years': int(len(shared)), 'portfolio_cv_percent': portfolio_cv, 'average_crop_cv_percent': average_cv,
                           'reduction_percent': (1 - portfolio_cv / average_cv) * 100 if average_cv > 0 else None,
                           'index': [{'Year': int(y), 'index': float(v)} for y, v in index.items()],
                           'note': 'Equal-weighted index of each crop’s yield relative to its own mean over shared years. Lower variability than the average crop suggests yields did not move together historically.'}
    warnings = ['Yields of different crops are not compared directly; coefficients of variation and relative changes are unit-free.',
                'Descriptive history only. Area, prices, inputs and market access are not considered, so this is not a recommendation to plant any crop.']
    locations = [c.lower() + 's' for c in pooled if c != 'Crop']
    if locations:
        warnings.append('Pooled across all ' + ' and '.join(locations) + '. Changes in which locations or seasons were observed each year can shift annual values.')
    if diversification is None:
        warnings.append('Fewer than five years shared by all usable crops: correlations and the diversification index are withheld.')
    return {'filters': payload, 'crops': crops, 'summary': summary, 'correlations': correlations, 'diversification': diversification,
            'annual': [{'Year': int(y), **{c: (None if pd.isna(v) else float(v)) for c, v in row.items()}} for y, row in wide[usable].iterrows()],
            'shared_years': [int(y) for y in shared.index], 'warnings': warnings}
