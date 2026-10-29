"""Regression checks for operational planning and isolated action registers."""
import unittest
import pandas as pd
import app as backend
from operations import benchmark, production_plan


class OperationsTest(unittest.TestCase):
    def setUp(self):
        backend.store.clear()
        self.client = backend.app.test_client()
        self.token = self.client.post('/api/demo').get_json()['dataset_id']
        self.headers = {'X-Dataset-ID': self.token}

    def post(self, route, payload):
        return self.client.post('/api/operations/' + route, json=payload, headers=self.headers)

    def test_historical_review_excludes_future_and_preserves_defaults(self):
        result = self.post('review', {'year': 2016, 'history_years': 3}).get_json()
        self.assertEqual(result['latest_year'], 2016)
        self.assertTrue(all(row['Year'] <= 2016 for row in result['annual']))
        self.assertTrue(all(row['reference_years'] == [2013, 2014, 2015] for row in result['signals']))
        default = self.post('review', {}).get_json()
        self.assertEqual(default['settings']['year'], 2025)
        self.assertEqual(default['settings']['history_years'], 5)
        self.assertTrue(all(not row['flags'] for row in self.post('review', {'year': 2010}).get_json()['signals']))

    def test_review_validation(self):
        for payload in [[], {'year': 2030}, {'year': True}, {'history_years': 2}, {'rainfall_drop': -1}, {'temperature_rise': 'nan'}, {'unexpected': 1}]:
            self.assertEqual(self.post('review', payload).status_code, 400)

    def test_common_years_and_equal_year_weighting(self):
        rows = [('A', 2020, 2), ('A', 2020, 4), ('A', 2021, 9), ('A', 2022, 100), ('B', 2020, 4), ('B', 2021, 8)]
        frame = pd.DataFrame(rows, columns=['District', 'Year', 'Crop_Yield']).assign(Crop='Rice', Season='Wet', Rainfall_mm=100, Avg_Temperature_C=25)
        payload = {'crop': 'Rice', 'season': 'Wet', 'districts': ['A', 'B']}
        result = benchmark(frame, payload)
        self.assertEqual(result['common_years'], [2020, 2021])
        self.assertEqual(result['summary'][0]['yield_mean'], 6)
        self.assertEqual(result['summary'][0]['rows'], 3)
        for changes in [{'districts': ['A', 'A']}, {'districts': ['A', 'Missing']}, {'season': 'Dry'}, {'year_min': 2022, 'year_max': 2020}]:
            with self.assertRaises(ValueError):
                benchmark(frame, {**payload, **changes})
        with self.assertRaises(ValueError):
            benchmark(frame.drop(columns='District'), payload)

    def test_production_unit_conversion_and_boundaries(self):
        plan = {'area_ha': 10, 'yield_per_ha': 4000, 'yield_unit': 'kg/ha', 'loss_percent': 10}
        kilos = production_plan(plan)
        tonnes = production_plan({**plan, 'yield_per_ha': 4, 'yield_unit': 't/ha'})
        self.assertEqual(kilos['available_tonnes'], 36)
        self.assertEqual(kilos['gross_tonnes'], tonnes['gross_tonnes'])
        self.assertEqual(production_plan({**plan, 'loss_percent': 100})['available_tonnes'], 0)
        for changes in [{'area_ha': -1}, {'yield_per_ha': True}, {'loss_percent': 101}, {'yield_unit': 'unknown'}, {'area_ha': 'nan'}]:
            self.assertEqual(self.post('production', {**plan, **changes}).status_code, 400)

    def test_actions_update_isolation_and_safe_export(self):
        response = self.post('tasks', {'title': '=SUM(1,2)', 'owner': 'Field team', 'due_date': '2026-11-01'})
        self.assertEqual(response.status_code, 201)
        task = response.get_json()
        path = '/api/operations/tasks/' + task['id']
        changed = self.client.patch(path, json={'status': 'Done'}, headers=self.headers)
        self.assertEqual(changed.get_json()['status'], 'Done')
        second = self.client.post('/api/demo').get_json()['dataset_id']
        self.assertEqual(self.client.patch(path, json={'status': 'Open'}, headers={'X-Dataset-ID': second}).status_code, 404)
        self.assertEqual(self.client.get('/api/operations', headers={'X-Dataset-ID': second}).get_json()['tasks'], [])
        exported = self.client.get('/api/export/actions', headers=self.headers)
        self.assertEqual(exported.status_code, 200)
        self.assertIn("'=SUM", exported.data.decode())
        self.assertIn('Done', exported.data.decode())
        self.assertEqual(self.client.get('/api/operations').status_code, 404)

    def test_action_validation_and_capacity(self):
        for fields in [{}, {'title': ' '}, {'title': 'x', 'due_date': '2026-02-30'}, {'title': 'x', 'status': 'unknown'}, {'title': 'x', 'owner': 1}, {'title': 'x', 'notes': 'x'*2001}]:
            self.assertEqual(self.post('tasks', fields).status_code, 400)
        backend.store.get(self.token).tasks = [{} for _ in range(100)]
        self.assertEqual(self.post('tasks', {'title': 'Over capacity'}).status_code, 400)


if __name__ == '__main__':
    unittest.main()


class ProfitabilityTest(unittest.TestCase):
    def test_margin_breakeven_and_grid(self):
        from operations import profitability
        result = profitability({'area_ha': 2, 'yield_per_ha': 4000, 'yield_unit': 'kg/ha', 'price': 20, 'price_unit': 'INR/kg',
                                'cost_per_ha': 40000, 'loss_percent': 10, 'sensitivity_step': 10})
        self.assertAlmostEqual(result['available_tonnes'], 7.2)
        self.assertAlmostEqual(result['revenue'], 144000)
        self.assertAlmostEqual(result['margin'], 64000)
        self.assertAlmostEqual(result['breakeven_yield'], 40000 / (20000 * .9) * 1000)
        self.assertAlmostEqual(result['breakeven_price'], 80000 / 7.2 / 1000)
        self.assertEqual(len(result['sensitivity']), 5)
        self.assertAlmostEqual(result['sensitivity'][2]['cells'][2]['margin'], 64000)
        self.assertEqual(result['currency'], 'INR')

    def test_edge_and_invalid_inputs(self):
        from operations import profitability
        base = {'area_ha': 1, 'yield_per_ha': 3, 'yield_unit': 't/ha', 'price': 100, 'price_unit': 'USD/t', 'cost_per_ha': 50}
        self.assertIsNone(profitability({**base, 'loss_percent': 100})['breakeven_yield'])
        self.assertIsNone(profitability({**base, 'yield_per_ha': 0})['breakeven_price'])
        self.assertEqual(len(profitability({**base, 'sensitivity_step': 50})['sensitivity']), 5)
        for change in [dict(price_unit='EUR/t'), dict(price=-1), dict(yield_unit=None), dict(cost_per_ha=True), dict(sensitivity_step=0)]:
            with self.assertRaises(ValueError):
                profitability({**base, **change})

    def test_reference_and_api(self):
        backend.store.clear()
        client = backend.app.test_client()
        data = client.post('/api/demo').get_json()
        headers = {'X-Dataset-ID': data['dataset_id']}
        ref = client.get('/api/operations/reference?crop=Rice', headers=headers).get_json()
        self.assertEqual(ref['years'], [2023, 2024, 2025])
        self.assertEqual(ref['price_unit'], 'INR/t')
        self.assertEqual(client.get('/api/operations/reference?crop=Nope', headers=headers).status_code, 400)
        payload = {'area_ha': 1, 'yield_per_ha': ref['median_yield'], 'yield_unit': 't/ha', 'price': ref['median_price'], 'price_unit': 'INR/t', 'cost_per_ha': 30000}
        self.assertEqual(client.post('/api/operations/profitability', json=payload, headers=headers).status_code, 200)
        self.assertEqual(client.post('/api/operations/profitability', json=payload).status_code, 404)
