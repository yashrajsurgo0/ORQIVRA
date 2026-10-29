import unittest
import pandas as pd
import app as backend
from portfolio import crop_portfolio


class PortfolioTest(unittest.TestCase):
    def setUp(self):
        years = list(range(2010, 2018))
        up = [1, 2, 1, 2, 1, 2, 1, 2]
        self.frame = pd.DataFrame({'Year': years * 2, 'Crop': ['A'] * 8 + ['B'] * 8,
                                   'Crop_Yield': [10.0 + x for x in up] + [10.0 + 3 - x for x in up],
                                   'Rainfall_mm': [float(100 + 10 * x) for x in up] * 2, 'Avg_Temperature_C': [25.0] * 16, 'Market_Price': [1.0] * 16})

    def test_offsetting_crops_diversify(self):
        result = crop_portfolio(self.frame, {})
        pair = result['correlations'][0]
        self.assertAlmostEqual(pair['pearson_r'], -1)
        self.assertGreater(result['diversification']['reduction_percent'], 90)
        a = next(row for row in result['summary'] if row['crop'] == 'A')
        self.assertAlmostEqual(a['rainfall_r'], 1)
        self.assertEqual(a['years'], 8)

    def test_validation_and_withheld(self):
        for payload in [{'crops': ['A']}, {'crops': ['A', 'Z']}, {'crops': ['A', 'A']}, {'year_min': 2017, 'year_max': 2017}, {'extra': 1}, {'district': 'X'}]:
            with self.assertRaises(ValueError):
                crop_portfolio(self.frame, payload)
        short = crop_portfolio(self.frame[self.frame.Year < 2014], {})
        self.assertIsNone(short['diversification'])
        self.assertIsNone(short['correlations'][0]['pearson_r'])

    def test_api_demo(self):
        backend.store.clear()
        client = backend.app.test_client()
        data = client.post('/api/demo').get_json()
        headers = {'X-Dataset-ID': data['dataset_id']}
        response = client.post('/api/portfolio', json={'district': data['districts'][0]}, headers=headers)
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(len(body['summary']), 3)
        self.assertEqual(len(body['correlations']), 3)
        self.assertEqual(len(body['shared_years']), 16)
        self.assertEqual(client.post('/api/portfolio', json={}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
