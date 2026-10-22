"""Regional provenance, forecasting, missing-data and API failure checks."""
import copy
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch
from urllib.error import URLError
import app as backend
import regional
from data import demo_data


def provider():
    now = datetime.now(timezone.utc)
    days = [(now + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(-7, 7)]
    daily = {'time': days}
    for key, value in [('temperature_2m_max', 36), ('temperature_2m_min', 20), ('precipitation_sum', 1), ('precipitation_probability_max', 30), ('wind_speed_10m_max', 15), ('et0_fao_evapotranspiration', 5)]:
        daily[key] = [value]*14
    return {'latitude':18.5, 'longitude':73.8, 'timezone':'UTC', 'utc_offset_seconds':0, 'current':{'time':now.strftime('%Y-%m-%dT%H:%M'), 'temperature_2m':30}, 'daily':daily,
            'hourly':{'time':[now.strftime('%Y-%m-%dT%H:00')], 'soil_temperature_6cm':[25], 'soil_moisture_3_to_9cm':[0.2]}}


class RegionalTest(unittest.TestCase):
    def setUp(self):
        backend.store.clear()
        self.client = backend.app.test_client()
        self.token = self.client.post('/api/demo').get_json()['dataset_id']
        self.headers = {'X-Dataset-ID': self.token}
        self.context = {'crop':'Rice', 'district':'Pune', 'question':'Summarize my region'}
        self.metadata = {'source_type':'synthetic', 'yield_unit':'t/ha'}

    def snapshot(self, raw=None):
        with patch('regional.fetch_json', return_value=raw or provider()):
            return regional.weather({'latitude':18.52,'longitude':73.85,'name':'Pune'})

    def test_weather_periods_units_and_missing_soil(self):
        snapshot = self.snapshot()
        self.assertEqual(len([r for r in snapshot['daily'] if r['period']=='forecast']), 7)
        self.assertEqual(len([r for r in snapshot['daily'] if r['period']=='past model data']), 7)
        self.assertEqual(snapshot['soil']['moisture_m3_m3'], .2)
        raw = provider(); raw['hourly'] = {}
        self.assertIsNone(self.snapshot(raw)['soil']['moisture_m3_m3'])
        with patch('regional.fetch_json') as fetch:
            with self.assertRaises(ValueError):
                regional.weather({'latitude':91,'longitude':73})
            fetch.assert_not_called()

    def test_evidence_and_missing_values_not_zero(self):
        snapshot = self.snapshot()
        result = regional.briefing(demo_data(), self.metadata, snapshot, self.context)
        self.assertTrue(any('root-zone' in action['title'] for action in result['actions']))
        self.assertTrue(any('synthetic' in gap for gap in result['gaps']))
        self.assertTrue(result['outlook']['available'])
        snapshot['daily'][-1]['precipitation_sum'] = None
        result = regional.briefing(demo_data(), self.metadata, snapshot, self.context)
        self.assertFalse(any('root-zone' in action['title'] for action in result['actions']))
        self.assertTrue(any('withheld' in section['text'] for section in result['sections']))

    def test_stale_weather_does_not_generate_weather_actions(self):
        snapshot = self.snapshot()
        snapshot['retrieved_at'] = (datetime.now(timezone.utc)-timedelta(hours=4)).isoformat()
        result = regional.briefing(demo_data(), self.metadata, snapshot, self.context)
        self.assertEqual(result['actions'][0]['title'], 'Collect field observations')
        self.assertTrue(any('stale' in gap for gap in result['gaps']))

    def test_unknown_question_and_context_rejected(self):
        result = regional.briefing(demo_data(), self.metadata, None, {**self.context, 'question':'Write a birthday poem'})
        self.assertEqual(result['sections'][0]['topic'], 'scope')
        self.assertEqual(result['actions'], [])
        for changes in [{'district':'Missing'}, {'crop':'Missing'}, {'stage':'fake'}, {'soil_ph':15}, {'question':''}]:
            with self.assertRaises(ValueError):
                regional.briefing(demo_data(), self.metadata, None, {**self.context, **changes})

    def test_outlook_backtest_has_no_future_label_leakage(self):
        history = regional.crop_history(demo_data(), self.context)
        original = regional.outlook(history)
        changed = copy.deepcopy(history)
        changed['annual'][-1]['yield_mean'] *= 100
        modified = regional.outlook(changed)
        for a, b in zip(original['backtest'], modified['backtest']):
            self.assertEqual(a['trend'], b['trend'])
            self.assertEqual(a['last_observed'], b['last_observed'])
        self.assertEqual([r['year'] for r in original['projection']], [2026, 2027, 2028])
        history['annual'] = history['annual'][:7]
        self.assertFalse(regional.outlook(history)['available'])

    def test_api_weather_isolated_and_assistant_uses_server_snapshot(self):
        with patch('regional.fetch_json', return_value=provider()):
            response = self.client.post('/api/regional/weather', headers=self.headers, json={'latitude':18.52,'longitude':73.85,'name':'Pune'})
        self.assertEqual(response.status_code, 200)
        result = self.client.post('/api/regional/assistant', headers=self.headers, json=self.context)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.get_json()['weather_retrieved_at'], response.get_json()['retrieved_at'])
        second = self.client.post('/api/demo').get_json()['dataset_id']
        self.assertIsNone(self.client.get('/api/regional/weather', headers={'X-Dataset-ID':second}).get_json()['weather'])
        self.assertEqual(self.client.get('/api/regional/weather').status_code, 404)

    def test_provider_failure_no_fabricated_data_or_stale_fallback(self):
        regional._cache.clear()
        with patch('regional.urlopen', side_effect=URLError('offline')):
            response = self.client.get('/api/regional/locations?q=Pune', headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertIn('no synthetic weather', response.get_json()['error'])
        self.assertIsNone(backend.store.get(self.token).regional_weather)

    def test_cache_preserves_retrieval_timestamp(self):
        raw = provider()
        raw['_orqivra_fetched_at'] = '2026-01-01T00:00:00+00:00'
        self.assertEqual(self.snapshot(raw)['retrieved_at'], raw['_orqivra_fetched_at'])

    def test_unsupported_soil_and_model_shortage_visible(self):
        result = regional.briefing(demo_data().query('Year <= 2015'), self.metadata, None, self.context)
        self.assertFalse(result['outlook']['available'])
        self.assertTrue(any('No regional weather' in gap for gap in result['gaps']))
        self.assertTrue(any('not supplied' in section['text'] for section in result['sections']))


if __name__ == '__main__':
    unittest.main()
