"""Dataset contracts, row-level audit and reproducible synthetic demonstration data."""
import hashlib
import numpy as np
import pandas as pd

REQUIRED = ['Year', 'Crop', 'Rainfall_mm', 'Avg_Temperature_C', 'Crop_Yield', 'Market_Price']
NUMERIC = ['Year', 'Rainfall_mm', 'Avg_Temperature_C', 'Crop_Yield', 'Market_Price']
OPTIONAL_NUMERIC = ['Humidity_Percent', 'Soil_pH', 'Irrigation_mm']
CATEGORIES = ['Crop', 'District', 'Season']


def prepare(raw):
    missing = [c for c in REQUIRED if c not in raw]
    if missing:
        raise ValueError('Missing required columns: ' + ', '.join(missing))
    if len(raw) > 10000:
        raise ValueError('Use at most 10,000 rows per workspace.')
    df = raw.copy()
    reasons = pd.Series('', index=df.index, dtype='object')
    def flag(mask, message):
        reasons.loc[mask] += message + '; '
    numeric = NUMERIC + [c for c in OPTIONAL_NUMERIC if c in df]
    for col in numeric:
        df[col] = pd.to_numeric(df[col], errors='coerce').replace([np.inf, -np.inf], np.nan)
        flag(df[col].isna(), f'{col}: missing or not finite')
    for col in [c for c in CATEGORIES if c in df]:
        df[col] = df[col].astype('string').str.strip().replace('', pd.NA)
        flag(df[col].isna(), f'{col}: missing category')
        if df[col].nunique() > 100:
            raise ValueError(f'{col} has too many categories (maximum 100).')
    flag(df['Year'].notna() & ((df['Year'] % 1 != 0) | ~df['Year'].between(1900, 2100)), 'Year: expected whole year between 1900 and 2100')
    for col in ['Rainfall_mm', 'Crop_Yield', 'Market_Price', 'Irrigation_mm']:
        if col in df:
            flag(df[col] < 0, f'{col}: negative value')
    for col, low, high in [('Humidity_Percent', 0, 100), ('Soil_pH', 0, 14), ('Avg_Temperature_C', -60, 65)]:
        if col in df:
            flag(df[col].notna() & ~df[col].between(low, high), f'{col}: outside allowed range')
    # Duplicate detection ignores unrelated notes, so adding a note cannot inflate sample size.
    relevant = numeric + [c for c in CATEGORIES if c in df]
    valid = reasons.eq('')
    duplicates = pd.Series(False, index=df.index)
    duplicates.loc[valid] = df.loc[valid].duplicated(subset=relevant)
    flag(duplicates, 'Duplicate observation')
    accepted = reasons.eq('')
    cleaned = df.loc[accepted].copy().reset_index(drop=True)
    cleaned['Year'] = cleaned['Year'].astype(int)
    counts = {}
    for reason in reasons:
        for item in reason.rstrip('; ').split('; '):
            if item:
                counts[item] = counts.get(item, 0) + 1
    rejected = raw.loc[~accepted].copy()
    rejected.insert(0, 'CSV_row', raw.index[~accepted] + 2)
    rejected['Exclusion_reasons'] = reasons.loc[~accepted].str.rstrip('; ')
    audit = {'original_rows': len(raw), 'valid_rows': len(cleaned), 'removed_rows': len(rejected),
             'retained_percent': round(100 * len(cleaned) / max(1, len(raw)), 1),
             'reasons': counts, 'rejected_preview': rejected.head(50).fillna('').to_dict('records'),
             'missing_values': raw.isna().sum().astype(int).to_dict(),
             'fingerprint': hashlib.sha256(raw.to_csv(index=False).encode()).hexdigest(),
             'warnings': []}
    if cleaned['Year'].nunique() < 5:
        audit['warnings'].append('Fewer than five distinct years: independent temporal validation may be unavailable.')
    if len(cleaned) < 100:
        audit['warnings'].append('Small dataset: subgroup errors and uncertainty estimates can be unstable.')
    if 'District' not in cleaned:
        audit['warnings'].append('No District column: regional coverage and location-specific performance cannot be assessed.')
    if len(cleaned) and cleaned.groupby(['Year', 'Crop'] + (['District'] if 'District' in cleaned else [])).size().max() > 1:
        audit['warnings'].append('Repeated crop/year/location groups found. Confirm these are independent observations, not repeated reports.')
    return cleaned, audit, rejected


def demo_data():
    rng = np.random.default_rng(42)
    rows = []
    districts = [('Nashik', 750, 24), ('Pune', 680, 25), ('Nagpur', 1020, 28), ('Aurangabad', 580, 27)]
    for year in range(2010, 2026):
        for district, rain, temp in districts:
            for crop, baseline, optimum, price in [('Wheat', 3.8, 22, 25000), ('Rice', 4.5, 26, 22000), ('Corn', 4.1, 25, 20000)]:
                rainfall = max(50, rain + rng.normal(0, 160) + 25 * np.sin(year))
                temperature = temp + 0.035 * (year - 2010) + rng.normal(0, 1.1)
                irrigation = max(0, 160 - 0.08 * rainfall + rng.normal(0, 25))
                humidity = np.clip(48 + rainfall / 55 + rng.normal(0, 5), 15, 95)
                ph = np.clip(rng.normal(6.5, .35), 4, 9)
                water = rainfall + irrigation
                yield_value = max(.2, baseline - .000003 * (water - 900) ** 2 - .045 * (temperature - optimum) ** 2 + .012 * (year - 2010) + rng.normal(0, .26))
                rows.append([year, crop, district, round(rainfall, 1), round(temperature, 2), round(yield_value, 3), round(price * (1 + .025 * (year - 2010)) + rng.normal(0, 900), 2), round(humidity, 1), round(ph, 2), round(irrigation, 1)])
    return pd.DataFrame(rows, columns=REQUIRED[:2] + ['District'] + REQUIRED[2:] + OPTIONAL_NUMERIC)
