import unittest
import pandas as pd
import app as backend
from history import historical_analysis


class HistoryTest(unittest.TestCase):
    def setUp(self):
        self.frame = pd.DataFrame({'Year': [2018, 2019, 2020, 2021, 2022, 2023], 'Crop_Yield': [0, 0, 0, 2, 4, 6], 'Rainfall_mm': [0, 0, 0, 20, 40, 60], 'Avg_Temperature_C': [25]*6, 'Market_Price': [10]*6, 'Crop': ['Rice']*6})
        self.filters = dict(crop='Rice', year_min=2018, year_max=2023, split_year=2021, yield_threshold=3)

    def test_periods_threshold_and_constant_series(self):
        result = historical_analysis(self.frame, self.filters)
        row = result['comparisons'][0]
        self.assertEqual(row['earlier'], 0)
        self.assertEqual(row['recent'], 4)
        self.assertIsNone(row['change_percent'])
        self.assertEqual(result['threshold']['below_years'], [2018, 2019, 2020, 2021])
        self.assertAlmostEqual(result['associations'][0]['pearson_r'], 1)
        self.assertIsNone(result['associations'][1]['pearson_r'])

    def test_equal_year_weighting_and_missing_years(self):
        repeated = pd.concat([self.frame, self.frame[self.frame.Year == 2023]])
        self.assertEqual(historical_analysis(repeated, self.filters)['comparisons'][0]['recent'], 4)
        sparse = historical_analysis(self.frame[self.frame.Year != 2019], self.filters)
        self.assertTrue(any('2019' in w for w in sparse['warnings']))

    def test_boundaries_and_invalid_filters(self):
        for change in [dict(crop='Other'), dict(year_min=2023), dict(split_year=2019), dict(yield_threshold=True), dict(yield_threshold='nan'), dict(district='Missing'), dict(extra=1)]:
            with self.assertRaises(ValueError):
                historical_analysis(self.frame, {**self.filters, **change})
        zero = self.frame.assign(Crop_Yield=0)
        self.assertIsNone(historical_analysis(zero, self.filters)['variability']['cv_percent'])
        self.assertEqual(historical_analysis(self.frame, {**self.filters, 'yield_threshold': 0})['threshold']['below_years'], [])

    def test_api_workspace_and_provenance(self):
        backend.store.clear()
        client = backend.app.test_client()
        data = client.post('/api/demo').get_json()
        payload = dict(crop=data['crops'][0], district=data['districts'][0], season=(data['seasons'] or [''])[0], year_min=2010, year_max=2025, split_year=2018, yield_threshold=3)
        self.assertEqual(client.post('/api/history', json=payload).status_code, 404)
        headers = {'X-Dataset-ID': data['dataset_id']}
        response = client.post('/api/history', json=payload, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['source_type'], 'synthetic')
        self.assertEqual(response.get_json()['years'], 16)
        self.assertEqual(client.post('/api/history', json=[], headers=headers).status_code, 400)


class HistoryOptionsTest(unittest.TestCase):
    def setUp(self):
        years = list(range(2010, 2020))
        self.frame = pd.DataFrame({'Year': years * 2, 'Crop': ['Rice'] * 20, 'District': ['A'] * 10 + ['B'] * 10,
                                   'Crop_Yield': [float(i) for i in range(10)] + [float(i) + 2 for i in range(10)],
                                   'Rainfall_mm': [100.0] * 20, 'Avg_Temperature_C': [25.0 + i * .1 for i in range(10)] * 2, 'Market_Price': [10.0] * 20})
        self.base = dict(crop='Rice', year_min=2010, year_max=2019, split_year=2015, yield_threshold=3)

    def test_pooled_districts_and_median(self):
        pooled = historical_analysis(self.frame, {**self.base, 'district': ''})
        self.assertEqual(pooled['pooled'], ['District'])
        self.assertEqual(pooled['annual'][0]['Crop_Yield'], 1)
        self.assertTrue(any('Pooled' in w for w in pooled['warnings']))
        single = historical_analysis(self.frame, {**self.base, 'district': 'A', 'aggregation': 'median'})
        self.assertEqual(single['pooled'], [])
        self.assertEqual(single['aggregation'], 'median')
        with self.assertRaises(ValueError):
            historical_analysis(self.frame, {**self.base, 'aggregation': 'max'})

    def test_trend_rolling_and_anomalies(self):
        result = historical_analysis(self.frame, {**self.base, 'district': 'A', 'rolling_window': 3, 'anomaly_z': 1.4})
        trend = next(t for t in result['trends'] if t['metric'] == 'Crop_Yield')
        self.assertAlmostEqual(trend['slope_per_year'], 1)
        self.assertAlmostEqual(trend['slope_per_decade'], 10)
        self.assertAlmostEqual(trend['r_squared'], 1)
        self.assertIsNone(next(t for t in result['trends'] if t['metric'] == 'Rainfall_mm')['slope_per_year'])
        self.assertTrue(pd.isna(result['annual'][1]['Crop_Yield_rolling']))
        self.assertAlmostEqual(result['annual'][2]['Crop_Yield_rolling'], 1)
        self.assertEqual([a['year'] for a in result['anomalies']['years']], [2010, 2019])
        self.assertEqual(result['anomalies']['years'][0]['direction'], 'Low')
        for change in [dict(rolling_window=2), dict(rolling_window=9), dict(anomaly_z=.5)]:
            with self.assertRaises(ValueError):
                historical_analysis(self.frame, {**self.base, 'district': 'A', **change})
