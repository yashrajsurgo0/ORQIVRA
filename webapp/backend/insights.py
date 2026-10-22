"""Transparent descriptive signals for field, research and supply-chain workflows."""
import numpy as np

SOURCES = [
    {'name': 'FAO climate-smart agriculture', 'url': 'https://www.fao.org/climate-change/cross-cutting-areas/climate-and-disaster-risk-management/en', 'purpose': 'Context for resilience and climate risk planning. Not a validation of this model.'},
    {'name': 'FAOSTAT', 'url': 'https://www.fao.org/faostat/en/#data/QCL', 'purpose': 'Official crop production statistics. Align geography, crop definitions, years and units before joining.'},
    {'name': 'NASA POWER', 'url': 'https://power.larc.nasa.gov/', 'purpose': 'Meteorological data for agricultural research. Gridded estimates are not field weather observations.'},
    {'name': 'Scikit-learn validation guidance', 'url': 'https://scikit-learn.org/stable/modules/cross_validation.html', 'purpose': 'Why independent test data and time-aware splits matter.'},
    {'name': 'Conformal prediction assumptions', 'url': 'https://arxiv.org/abs/2107.07511', 'purpose': 'Prediction intervals require assumptions; distribution shift can reduce coverage.'}
]


def percent(current, previous):
    return None if previous <= 0 else float(100 * (current - previous) / previous)


def build_insights(df, metadata, settings=None):
    settings = settings or {'year': int(df.Year.max()), 'history_years': 5, 'rainfall_drop': 20, 'temperature_rise': 1, 'yield_drop': 15}
    latest = settings['year']
    df = df[df.Year <= latest]
    groups = ['Crop'] + (['District'] if 'District' in df else []) + (['Season'] if 'Season' in df else [])
    signals = []
    for keys, data in df.groupby(groups):
        if not isinstance(keys, tuple):
            keys = (keys,)
        identity = dict(zip(groups, keys))
        now = data[data.Year == latest]
        history = data[data.Year < latest]
        if now.empty:
            continue
        historical_years = sorted(history.Year.unique())[-settings['history_years']:]
        history = history[history.Year.isin(historical_years)]
        # Equal weight per year so heavily sampled years cannot dominate the comparator.
        yearly = history.groupby('Year')[['Rainfall_mm', 'Avg_Temperature_C', 'Crop_Yield', 'Market_Price']].mean()
        enough = len(yearly) >= 3
        current = now[['Rainfall_mm', 'Avg_Temperature_C', 'Crop_Yield', 'Market_Price']].mean()
        reference = yearly.median()
        rain_change = percent(current.Rainfall_mm, reference.get('Rainfall_mm', 0)) if enough else None
        yield_change = percent(current.Crop_Yield, reference.get('Crop_Yield', 0)) if enough else None
        price_change = percent(current.Market_Price, reference.get('Market_Price', 0)) if enough else None
        temperature_change = float(current.Avg_Temperature_C - reference.Avg_Temperature_C) if enough else None
        flags, actions = [], []
        if rain_change is not None and rain_change <= -settings['rainfall_drop']:
            flags.append('Lower rainfall')
            actions.append('Review local soil moisture, water availability and the seasonal advisory with an extension officer.')
        if temperature_change is not None and temperature_change >= settings['temperature_rise']:
            flags.append('Warmer conditions')
            actions.append('Check crop-stage heat exposure against local agronomic guidance before changing planting or irrigation plans.')
        if yield_change is not None and yield_change <= -settings['yield_drop']:
            flags.append('Yield decline')
            actions.append('Investigate pests, soil fertility, management changes and reporting quality alongside climate factors.')
        if not enough:
            actions.append('Collect at least three earlier years for a comparable local historical reference.')
        if not flags and enough:
            actions.append('Continue field monitoring; absence of these historical flags does not establish low future risk.')
        signals.append({**identity, 'year': latest, 'rows': len(now), 'reference_years': historical_years,
                        'status': 'Review needed' if flags else 'No threshold flags' if enough else 'Insufficient history',
                        'flags': flags, 'actions': actions, 'rainfall_change_percent': rain_change, 'temperature_change_c': temperature_change,
                        'yield_change_percent': yield_change, 'price_change_percent': price_change,
                        'yield': float(current.Crop_Yield), 'price': float(current.Market_Price),
                        'yield_variability_percent': None if len(yearly) < 2 or yearly.Crop_Yield.mean() <= 0 else float(100*yearly.Crop_Yield.std()/yearly.Crop_Yield.mean()),
                        'price_variability_percent': None if len(yearly) < 2 or yearly.Market_Price.mean() <= 0 else float(100*yearly.Market_Price.std()/yearly.Market_Price.mean())})
    signals.sort(key=lambda row: (-len(row['flags']), row['Crop']))
    coverage = []
    for keys, data in df.groupby(groups):
        if not isinstance(keys, tuple):
            keys = (keys,)
        coverage.append({**dict(zip(groups, keys)), 'rows': len(data), 'years': int(data.Year.nunique()), 'first_year': int(data.Year.min()), 'last_year': int(data.Year.max())})
    annual = df.groupby(['Year', 'Crop']).agg(yield_mean=('Crop_Yield', 'mean'), price_mean=('Market_Price', 'mean'), rainfall_mean=('Rainfall_mm', 'mean'), temperature_mean=('Avg_Temperature_C', 'mean'), rows=('Crop', 'size')).reset_index()
    return {'settings': settings, 'latest_year': latest, 'signals': signals, 'coverage': coverage, 'annual': annual.to_dict('records'),
            'review_count': sum(bool(row['flags']) for row in signals),
            'missing_latest_groups': sum(row['last_year'] < latest for row in coverage),
            'signal_method': f"Review year {latest} versus the median of up to {settings['history_years']} earlier annual means for the same crop/location/season. At least three historical years required. Thresholds: rainfall −{settings['rainfall_drop']}%, temperature +{settings['temperature_rise']}°C, yield −{settings['yield_drop']}%. These screening thresholds are not calibrated hazard probabilities.",
            'scope_note': 'Historical associations support investigation, not prescriptions. No weather forecast, crop suitability ranking, water-use efficiency, emissions reduction or food-security impact is inferred from these data.',
            'sources': SOURCES}
