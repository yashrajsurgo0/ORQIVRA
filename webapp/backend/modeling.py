"""Leakage-resistant model selection, independent evaluation and scenario inference."""
import math
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin, clone
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler, PolynomialFeatures
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor, ExtraTreesRegressor, GradientBoostingRegressor
from sklearn.model_selection import KFold, train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.inspection import permutation_importance
from data import OPTIONAL_NUMERIC


class CropBaseline(RegressorMixin, BaseEstimator):
    """Crop means learned on the training fold; unseen crops use its global mean."""
    def fit(self, X, y):
        self.mean_ = float(np.mean(y))
        self.means_ = pd.DataFrame({'Crop': X['Crop'].to_numpy(), 'y': np.asarray(y)}).groupby('Crop').y.mean().to_dict()
        return self

    def predict(self, X):
        return X['Crop'].map(self.means_).fillna(self.mean_).to_numpy(dtype=float)


def features(df):
    return ['Rainfall_mm', 'Avg_Temperature_C'] + [c for c in OPTIONAL_NUMERIC if c in df], ['Crop'] + [c for c in ['District', 'Season'] if c in df]


def candidates(df):
    numeric, categorical = features(df)
    def pipeline(model, polynomial=False):
        numeric_steps = [('scale', StandardScaler())]
        if polynomial:
            numeric_steps = [('polynomial', PolynomialFeatures(degree=2, include_bias=False)), ('scale', StandardScaler())]
        pre = ColumnTransformer([('numeric', Pipeline(numeric_steps), numeric), ('category', OneHotEncoder(handle_unknown='ignore', sparse_output=False), categorical)])
        return Pipeline([('preprocess', pre), ('model', model)])
    return {
        'crop_baseline': ('Crop-mean baseline', CropBaseline()),
        'ridge': ('Regularized linear model', pipeline(Ridge(alpha=10))),
        'quadratic_ridge': ('Climate-interaction ridge', pipeline(Ridge(alpha=10), True)),
        'random_forest': ('Random forest', pipeline(RandomForestRegressor(n_estimators=120, min_samples_leaf=2, max_depth=12, random_state=42, n_jobs=1))),
        'extra_trees': ('Extra trees', pipeline(ExtraTreesRegressor(n_estimators=120, min_samples_leaf=2, max_depth=14, random_state=42, n_jobs=1))),
        'gradient_boosting': ('Gradient boosting', pipeline(GradientBoostingRegressor(n_estimators=140, learning_rate=.04, max_depth=2, min_samples_leaf=3, loss='huber', random_state=42)))
    }


def split_dataset(df):
    years = np.sort(df.Year.unique())
    idx = np.arange(len(df))
    temporal = False
    if len(years) >= 5:
        n = max(1, math.ceil(len(years) * .2))
        train = idx[df.Year.isin(years[:-2*n])]
        calibration = idx[df.Year.isin(years[-2*n:-n])]
        test = idx[df.Year.isin(years[-n:])]
        temporal = len(train) >= 12 and len(calibration) >= 2 and len(test) >= 2
    if not temporal:
        train, rest = train_test_split(idx, test_size=.4, random_state=42)
        calibration, test = train_test_split(rest, test_size=.5, random_state=42)
    training = df.iloc[train]
    folds = []
    if temporal:
        training_years = np.sort(training.Year.unique())
        for year in training_years[1:]:
            a = np.flatnonzero(training.Year.to_numpy() < year)
            b = np.flatnonzero(training.Year.to_numpy() == year)
            if len(a) >= 6 and len(b) >= 2:
                folds.append((a, b))
        folds = folds[-4:]
    if len(folds) < 2:
        # Never use shuffled CV for a temporal partition with inadequate early years.
        if temporal:
            folds = folds[-1:]
        else:
            folds = list(KFold(n_splits=3, shuffle=True, random_state=42).split(training))
    return train, calibration, test, folds, temporal


def metrics(actual, predicted):
    return {'mae': float(mean_absolute_error(actual, predicted)), 'rmse': float(np.sqrt(mean_squared_error(actual, predicted))),
            'r2_score': float(r2_score(actual, predicted)) if len(actual) >= 2 and np.var(actual) > 0 else None}


def conformal_radius(residuals, coverage=.9):
    rank = math.ceil((len(residuals) + 1) * coverage)
    if rank > len(residuals):
        return None
    return float(np.sort(residuals)[rank - 1])


def train_models(df):
    if len(df) < 30 or df.Crop_Yield.nunique() < 2:
        return {'available': False, 'reason': 'Model training needs at least 30 valid observations and two distinct yield values. Data exploration remains available.'}, None
    train, cal, test, folds, temporal = split_dataset(df)
    if not folds:
        return {'available': False, 'reason': 'Not enough early-year observations for leakage-free model selection. Add more historical data.'}, None
    numeric, categorical = features(df)
    cols = numeric + categorical
    X, y = df[cols], df.Crop_Yield
    scores, fitted, predictions = {}, {}, {}
    candidate_models = candidates(df)
    # Candidate ranking uses development folds only; final test never selects a model.
    for key, (name, estimator) in candidate_models.items():
        fold_scores = []
        for a, b in folds:
            model = clone(estimator).fit(X.iloc[train].iloc[a], y.iloc[train].iloc[a])
            fold_scores.append(mean_absolute_error(y.iloc[train].iloc[b], model.predict(X.iloc[train].iloc[b])))
        scores[key] = {'name': name, 'cv_mae': float(np.mean(fold_scores)), 'cv_std': float(np.std(fold_scores)), 'fold_mae': [float(v) for v in fold_scores]}
    chosen = min(scores, key=lambda key: scores[key]['cv_mae'])
    for key, (_, estimator) in candidate_models.items():
        fitted[key] = clone(estimator).fit(X.iloc[train], y.iloc[train])
        pred = fitted[key].predict(X.iloc[test])
        predictions[key] = pred.tolist()
        scores[key].update(metrics(y.iloc[test], pred))
    champion = fitted[chosen]
    residuals = np.abs(y.iloc[cal].to_numpy() - champion.predict(X.iloc[cal]))
    radius = conformal_radius(residuals)
    selected_predictions = np.asarray(predictions[chosen])
    covered = None if radius is None else np.abs(y.iloc[test].to_numpy() - selected_predictions) <= radius
    interval = {'nominal_coverage': .9, 'radius': radius, 'calibration_rows': len(cal),
                'test_coverage': None if covered is None else float(covered.mean()),
                'note': 'Split conformal residual interval. Nominal coverage requires exchangeability; temporal drift and regional differences can violate it. This is not a confidence interval for a causal effect.'}
    baseline_mae = scores['crop_baseline']['mae']
    gain = None if baseline_mae == 0 else 100 * (baseline_mae - scores[chosen]['mae']) / baseline_mae
    subgroup = []
    for category in categorical:
        for value in sorted(X.iloc[test][category].unique()):
            mask = X.iloc[test][category].to_numpy() == value
            subgroup.append({'dimension': category, 'group': value, 'rows': int(mask.sum()),
                             **metrics(y.iloc[test].to_numpy()[mask], selected_predictions[mask]),
                             'coverage': None if covered is None else float(covered[mask].mean())})
    # Explain the champion on held-out data; never feed this back into model selection.
    importance = permutation_importance(champion, X.iloc[test], y.iloc[test], scoring='neg_mean_absolute_error', n_repeats=5, random_state=42, n_jobs=1)
    explanation = sorted([{'feature': col, 'importance': float(importance.importances_mean[i]), 'std': float(importance.importances_std[i])} for i, col in enumerate(cols)], key=lambda item: item['importance'], reverse=True)
    warnings = []
    if not temporal:
        warnings.append('Random splits were necessary. These scores do not establish future-year or new-region accuracy.')
    if len(test) < 30:
        warnings.append('Fewer than 30 final test rows: reported performance has limited statistical stability.')
    if gain is not None and gain <= 0:
        warnings.append('The selected model did not improve on the crop-mean baseline on the final test. Treat scenarios as exploratory.')
    if radius is None:
        warnings.append('Too few calibration rows for a finite 90% conformal interval; no interval is shown.')
    if covered is not None and covered.mean() < .8:
        warnings.append('Observed test coverage is below 80%; nominal 90% intervals are not reliable for this dataset.')
    for col in categorical:
        unseen = sorted(set(X.iloc[test][col]) - set(X.iloc[train][col]))
        if unseen:
            warnings.append(f'Test data contains unseen {col} categories: {", ".join(unseen)}.')
    records = df.iloc[test][['Year'] + categorical].copy()
    records['Actual_yield'] = y.iloc[test].to_numpy()
    records['Predicted_yield'] = selected_predictions
    records['Residual'] = records.Actual_yield - records.Predicted_yield
    records['Interval_lower'] = np.nan if radius is None else selected_predictions - radius
    records['Interval_upper'] = np.nan if radius is None else selected_predictions + radius
    result = {'available': True, 'models': scores, 'selected_model': chosen, 'selected_name': scores[chosen]['name'],
              'baseline_improvement_percent': gain, 'uncertainty': interval, 'warnings': warnings,
              'evaluation': {'method': 'Chronological years' if temporal else 'Random development / calibration / test',
                             'temporal': temporal, 'train_rows': len(train), 'calibration_rows': len(cal), 'test_rows': len(test),
                             'cv_folds': len(folds), 'selection_metric': 'Lowest development cross-validation MAE', 'features': cols,
                             'splits': [{'name': name, 'rows': len(indices), 'years': sorted(df.iloc[indices].Year.unique().tolist())} for name, indices in [('Development', train), ('Calibration', cal), ('Final test', test)]],
                             'folds': [{'train_years': sorted(df.iloc[train].iloc[a].Year.unique().tolist()), 'validation_years': sorted(df.iloc[train].iloc[b].Year.unique().tolist())} for a, b in folds]},
              'predictions': {'actual': y.iloc[test].tolist(), **predictions}, 'test_records': records.to_dict('records'),
              'subgroups': subgroup, 'permutation_importance': explanation}
    artifact = {'model': champion, 'training': df.iloc[train].copy(), 'numeric': numeric, 'categorical': categorical, 'radius': radius, 'name': scores[chosen]['name'], 'warnings': warnings}
    return result, artifact


def scenario_options(artifact):
    df = artifact['training']
    profiles = []
    for keys, group in df.groupby(artifact['categorical']):
        if not isinstance(keys, tuple):
            keys = (keys,)
        profiles.append({'categories': dict(zip(artifact['categorical'], keys)),
                         'inputs': {c: float(group[c].median()) for c in artifact['numeric']},
                         'rows': len(group)})
    return {'profiles': profiles, 'categories': {c: sorted(df[c].unique().tolist()) for c in artifact['categorical']},
            'features': {c: {'min': float(df[c].min()), 'max': float(df[c].max()), 'median': float(df[c].median())} for c in artifact['numeric']},
            'model': artifact['name']}


def predict_scenario(artifact, payload):
    numeric, categorical = artifact['numeric'], artifact['categorical']
    frame = artifact['training']
    inputs = payload.get('inputs')
    if not isinstance(inputs, dict):
        raise ValueError('Supply an inputs object with the scenario variables.')
    if set(inputs) != set(numeric + categorical):
        raise ValueError('Scenario inputs must exactly match the model features.')
    record, warnings = {}, list(artifact['warnings'])
    for col in categorical:
        if inputs[col] not in frame[col].unique():
            raise ValueError(f'Unknown {col}; choose a category represented in training data.')
        record[col] = inputs[col]
    for col in numeric:
        if isinstance(inputs[col], bool):
            raise ValueError(f'{col} must be a finite number.')
        try:
            value = float(inputs[col])
        except (ValueError, TypeError):
            raise ValueError(f'{col} must be a finite number.') from None
        if not np.isfinite(value) or abs(value) > 1e6:
            raise ValueError(f'{col} must be finite and within a reasonable numeric range.')
        if col in ['Rainfall_mm', 'Irrigation_mm'] and value < 0:
            raise ValueError(f'{col} cannot be negative.')
        if col == 'Humidity_Percent' and not 0 <= value <= 100:
            raise ValueError('Humidity_Percent must be between 0 and 100.')
        if col == 'Soil_pH' and not 0 <= value <= 14:
            raise ValueError('Soil_pH must be between 0 and 14.')
        if col == 'Avg_Temperature_C' and not -60 <= value <= 65:
            raise ValueError('Avg_Temperature_C must be between -60 and 65.')
        record[col] = value
    matched = frame.copy()
    for col in categorical:
        matched = matched[matched[col] == record[col]]
    if matched.empty:
        raise ValueError('This crop/location/season combination was not observed in training. Choose a supported combination.')
    outside = []
    for col in numeric:
        if not matched[col].min() <= record[col] <= matched[col].max():
            outside.append(col)
    if outside:
        warnings.append('Outside observed ranges for this crop/location: ' + ', '.join(outside) + '. Prediction intervals are withheld for extrapolation.')
    if len(matched) < 10:
        warnings.append(f'Only {len(matched)} training observations support this crop/location combination.')
    baseline = {**{col: float(matched[col].median()) for col in numeric}, **{col: record[col] for col in categorical}}
    model = artifact['model']
    base, predicted = model.predict(pd.DataFrame([baseline, record]))
    if predicted < 0:
        warnings.append('Model predicted a physically implausible negative yield. Do not use this scenario for planning.')
    radius = artifact['radius'] if not outside and predicted >= 0 else None
    sensitivity = []
    # Change one feature at a time over observed local ranges; other inputs stay fixed.
    for col in ['Rainfall_mm', 'Avg_Temperature_C']:
        grid = np.linspace(matched[col].min(), matched[col].max(), 9)
        values = model.predict(pd.DataFrame([{**record, col: float(x)} for x in grid]))
        sensitivity.append({'feature': col, 'points': [{'value': float(x), 'yield': float(y)} for x, y in zip(grid, values)]})
    return {'prediction': float(predicted), 'baseline_prediction': float(base), 'change': float(predicted-base),
            'change_percent': None if base <= 0 else float(100*(predicted-base)/base), 'inputs': record, 'baseline_inputs': baseline,
            'interval': None if radius is None else {'lower': float(predicted-radius), 'upper': float(predicted+radius), 'nominal_coverage': .9},
            'out_of_range': outside, 'support_rows': len(matched), 'warnings': warnings, 'sensitivity': sensitivity,
            'note': 'Conditional model estimate, not a weather forecast or causal estimate. Changing irrigation or rainfall does not establish the impact of an intervention.'}
