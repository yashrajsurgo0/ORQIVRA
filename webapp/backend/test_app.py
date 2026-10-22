"""Meaningful API and statistical regression checks; no network dependencies."""
import io
import json
import time
import unittest
import numpy as np
import pandas as pd
import app as backend
from data import prepare, demo_data
from modeling import train_models, split_dataset, predict_scenario, scenario_options, conformal_radius
from store import WorkspaceStore, Workspace


class AnalysisAPITest(unittest.TestCase):
    def setUp(self):
        backend.store.clear()
        self.client = backend.app.test_client()
        response = self.client.post('/api/demo')
        self.info = response.get_json()
        self.token = self.info['dataset_id']
        self.headers = {'X-Dataset-ID': self.token}
        self.sample = demo_data()

    def upload(self, frame=None, **metadata):
        frame = self.sample if frame is None else frame
        return self.client.post('/api/upload', data={'file': (io.BytesIO(frame.to_csv(index=False).encode()), '../../sample.CSV'), **metadata})

    def test_complete_workflow_and_strict_json(self):
        response = self.client.post('/api/analyze', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data, parse_constant=lambda value: self.fail(value))
        self.assertTrue(data['models']['available'])
        self.assertEqual(len(data['models']['models']), 6)
        self.assertTrue(data['models']['evaluation']['temporal'])
        self.assertEqual(sum(s['rows'] for s in data['models']['evaluation']['splits']), 192)
        self.assertEqual(self.client.get('/api/results', headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/workspace', headers=self.headers).get_json()['dataset']['source_type'], 'synthetic')
        for kind in ['cleaned', 'rejected', 'predictions', 'report']:
            self.assertEqual(self.client.get('/api/export/'+kind, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post('/api/analyze', headers=self.headers).get_json(), data)

    def test_workspace_isolation_and_untrusted_filename(self):
        second = self.upload(self.sample.iloc[:36], source_type='observed', yield_unit='kg/ha')
        self.assertEqual(second.status_code, 201)
        token = second.get_json()['dataset_id']
        self.assertNotEqual(token, self.token)
        self.assertEqual(self.client.get('/api/stats', headers=self.headers).get_json()['valid_rows'], 192)
        self.assertEqual(self.client.get('/api/stats', headers={'X-Dataset-ID': token}).get_json()['valid_rows'], 36)
        self.assertEqual(self.client.get('/api/stats').status_code, 404)
        self.assertEqual(self.client.get('/api/stats', headers={'X-Dataset-ID': 'guessed-token'}).status_code, 404)

    def test_invalid_upload_does_not_replace_workspace(self):
        for frame in [pd.DataFrame({'wrong': [1]}), self.sample.iloc[:3]]:
            self.assertEqual(self.upload(frame).status_code, 400)
        self.assertEqual(self.upload(yield_unit='acres').status_code, 400)
        self.assertEqual(self.client.get('/api/stats', headers=self.headers).get_json()['valid_rows'], 192)
        self.assertEqual(self.client.post('/api/upload').status_code, 400)
        self.assertEqual(self.client.post('/api/upload', data={'file': (io.BytesIO(b''), 'empty.csv')}).status_code, 400)

    def test_small_dataset_exploration_without_overclaiming(self):
        token = self.upload(self.sample.iloc[:15]).get_json()['dataset_id']
        headers = {'X-Dataset-ID': token}
        data = self.client.post('/api/analyze', headers=headers).get_json()
        self.assertFalse(data['models']['available'])
        self.assertEqual(data['analysis']['shape']['rows'], 15)
        self.assertEqual(self.client.post('/api/scenario', headers=headers, json={'inputs': {}}).status_code, 400)
        self.assertEqual(self.client.get('/api/export/predictions', headers=headers).status_code, 400)

    def test_constant_column_is_json_null_and_zero_is_retained(self):
        frame = self.sample.copy()
        frame['Rainfall_mm'] = 0
        token = self.upload(frame).get_json()['dataset_id']
        response = self.client.post('/api/analyze', headers={'X-Dataset-ID': token})
        data = json.loads(response.data, parse_constant=lambda value: self.fail(value))
        self.assertIsNone(data['analysis']['correlations']['Rainfall_mm']['Crop_Yield'])
        self.assertEqual(data['analysis']['descriptive_stats']['Rainfall_mm']['mean'], 0)

    def test_filtered_data_and_audit_export(self):
        response = self.client.get('/api/data?crop=Rice&district=Pune&page=1&size=5', headers=self.headers).get_json()
        self.assertEqual(response['total'], 16)
        self.assertEqual(len(response['rows']), 5)
        self.assertTrue(all(row['Crop'] == 'Rice' and row['District'] == 'Pune' for row in response['rows']))
        self.assertEqual(self.client.get('/api/data?page=bad', headers=self.headers).status_code, 400)
        frame = self.sample.copy()
        frame.loc[2, 'Crop'] = '=HYPERLINK("example")'
        frame.loc[0, 'Rainfall_mm'] = -1
        token = self.upload(frame).get_json()['dataset_id']
        headers = {'X-Dataset-ID': token}
        clean = self.client.get('/api/export/cleaned', headers=headers).data.decode()
        self.assertIn("'=HYPERLINK", clean)
        rejected = pd.read_csv(io.BytesIO(self.client.get('/api/export/rejected', headers=headers).data))
        self.assertEqual(rejected.CSV_row.tolist(), [2])
        self.assertIn('negative', rejected.Exclusion_reasons.iloc[0])

    def test_request_size_and_scenario_input_errors(self):
        old = backend.app.config['MAX_CONTENT_LENGTH']
        try:
            backend.app.config['MAX_CONTENT_LENGTH'] = 20
            self.assertEqual(self.upload().status_code, 413)
        finally:
            backend.app.config['MAX_CONTENT_LENGTH'] = old
        self.client.post('/api/analyze', headers=self.headers)
        for payload in [None, [], {}, {'inputs': {}}]:
            self.assertEqual(self.client.post('/api/scenario', headers=self.headers, json=payload).status_code, 400)

    def test_scenario_endpoint_and_concurrent_analysis_guard(self):
        item = backend.store.get(self.token)
        item.lock.acquire()
        try:
            self.assertEqual(self.client.post('/api/analyze', headers=self.headers).status_code, 409)
        finally:
            item.lock.release()
        result = self.client.post('/api/analyze', headers=self.headers).get_json()
        profile = result['scenario_options']['profiles'][0]
        inputs = {**profile['categories'], **profile['inputs']}
        response = self.client.post('/api/scenario', headers=self.headers, json={'inputs': inputs})
        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(response.get_json()['change'], 0)
        self.assertIsNotNone(response.get_json()['interval'])
        extrapolated = self.client.post('/api/scenario', headers=self.headers, json={'inputs': {**inputs, 'Rainfall_mm': 10000}})
        self.assertEqual(extrapolated.status_code, 200)
        self.assertIsNone(extrapolated.get_json()['interval'])
        self.assertIn('Rainfall_mm', extrapolated.get_json()['out_of_range'])

    def test_source_signal_contract(self):
        result = self.client.post('/api/analyze', headers=self.headers).get_json()
        self.assertEqual(len(result['insights']['coverage']), 12)
        self.assertEqual(result['insights']['latest_year'], 2025)
        self.assertTrue(all(len(row['reference_years']) == 5 for row in result['insights']['signals']))
        self.assertEqual(result['dataset']['yield_unit'], 't/ha')
        self.assertTrue(result['scenario_options']['profiles'])


class StatisticalIntegrityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frame, _, _ = prepare(demo_data())
        cls.result, cls.artifact = train_models(cls.frame)

    def test_temporal_partition_and_folds_have_no_overlap(self):
        train, cal, test, folds, temporal = split_dataset(self.frame)
        self.assertTrue(temporal)
        self.assertLess(self.frame.iloc[train].Year.max(), self.frame.iloc[cal].Year.min())
        self.assertLess(self.frame.iloc[cal].Year.max(), self.frame.iloc[test].Year.min())
        self.assertEqual(len(set(train) | set(cal) | set(test)), len(self.frame))
        for a, b in folds:
            self.assertLess(self.frame.iloc[train].iloc[a].Year.max(), self.frame.iloc[train].iloc[b].Year.min())
        self.assertNotIn('Market_Price', self.result['evaluation']['features'])
        self.assertNotIn('Year', self.result['evaluation']['features'])

    def test_final_test_labels_cannot_select_or_calibrate_model(self):
        changed = self.frame.copy()
        _, _, test, _, _ = split_dataset(changed)
        changed.loc[test, 'Crop_Yield'] *= 50
        result, _ = train_models(changed)
        self.assertEqual(result['selected_model'], self.result['selected_model'])
        self.assertEqual(result['uncertainty']['radius'], self.result['uncertainty']['radius'])
        for key in result['models']:
            self.assertEqual(result['models'][key]['cv_mae'], self.result['models'][key]['cv_mae'])
            self.assertEqual(result['predictions'][key], self.result['predictions'][key])

    def test_conformal_finite_sample_rank_and_small_calibration(self):
        self.assertEqual(conformal_radius(np.arange(9)), 8)
        self.assertIsNone(conformal_radius(np.arange(8)))
        self.assertEqual(conformal_radius(np.arange(19)), 17)

    def test_scenario_local_baseline_and_extrapolation(self):
        profile = scenario_options(self.artifact)['profiles'][0]
        inputs = {**profile['categories'], **profile['inputs']}
        baseline = predict_scenario(self.artifact, {'inputs': inputs})
        self.assertAlmostEqual(baseline['change'], 0)
        self.assertIsNotNone(baseline['interval'])
        extreme = predict_scenario(self.artifact, {'inputs': {**inputs, 'Rainfall_mm': 10000}})
        self.assertIn('Rainfall_mm', extreme['out_of_range'])
        self.assertIsNone(extreme['interval'])
        for invalid in [None, float('nan'), 'abc', True, -1]:
            with self.assertRaises(ValueError):
                predict_scenario(self.artifact, {'inputs': {**inputs, 'Rainfall_mm': invalid}})
        with self.assertRaises(ValueError):
            predict_scenario(self.artifact, {'inputs': {**inputs, 'Crop': 'Unseen crop'}})

    def test_cleaning_row_audit_and_extremes(self):
        frame = demo_data()
        frame.loc[0, 'Rainfall_mm'] = 10000
        frame['Notes'] = None
        cleaned, audit, _ = prepare(frame)
        self.assertEqual(len(cleaned), 192)
        frame.loc[1, 'Crop'] = ' '
        frame.loc[2, 'Crop_Yield'] = -1
        frame = pd.concat([frame, frame.iloc[[3]]], ignore_index=True)
        cleaned, audit, rejected = prepare(frame)
        self.assertEqual(len(cleaned), 190)
        self.assertEqual(audit['removed_rows'], 3)
        self.assertEqual(set(rejected.CSV_row), {3, 4, 194})

    def test_random_fallback_is_explicit(self):
        frame = self.frame.copy()
        frame['Year'] = 2020
        result, _ = train_models(frame)
        self.assertFalse(result['evaluation']['temporal'])
        self.assertTrue(any('Random splits' in message for message in result['warnings']))

    def test_store_capacity_expiration(self):
        store = WorkspaceStore(capacity=1, ttl=10)
        a = store.put(Workspace(None, {}, None, {}))
        b = store.put(Workspace(None, {}, None, {}))
        self.assertIsNone(store.get(a))
        store.items[b].touched = time.monotonic() - 20
        self.assertIsNone(store.get(b))


if __name__ == '__main__':
    unittest.main()
