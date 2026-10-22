"""Public demo boundaries and static serving contract."""
import unittest
import app as backend

class DeploymentTest(unittest.TestCase):
    def test_public_demo_rejects_upload_and_identifies_mode(self):
        old = backend.app.config['PUBLIC_DEMO']
        try:
            backend.app.config['PUBLIC_DEMO'] = True
            client = backend.app.test_client()
            self.assertEqual(client.post('/api/upload').status_code, 403)
            self.assertTrue(client.get('/api/health').get_json()['public_demo'])
        finally:
            backend.app.config['PUBLIC_DEMO'] = old

    def test_source_files_are_not_public_and_api_not_cached(self):
        client = backend.app.test_client()
        self.assertNotIn('static', backend.app.view_functions)
        self.assertEqual(client.get('/app.py').status_code, 404)
        self.assertEqual(client.get('/../backend/app.py').status_code, 404)
        self.assertEqual(client.get('/api/not-a-route').status_code, 404)
        self.assertEqual(client.get('/api/health').headers['Cache-Control'], 'no-store')
