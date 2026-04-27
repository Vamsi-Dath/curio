import shutil
import unittest
import tempfile
import os
import sys
import json
from utk_curio.sandbox.app import app
from flask import Flask, jsonify

# Modify sys.path to include the sandbox folder
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sandbox')))

_SKIP_NO_NODE = unittest.skipIf(
    shutil.which('node') is None,
    "Node.js is not installed — skipping JS execution tests",
)


class TestSandbox(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_live(self):
        response = self.client.get('/live')
        self.assertEqual(response.data.decode('utf-8'), 'Sandbox is live.')
        self.assertEqual(response.status_code, 200)

    @_SKIP_NO_NODE
    def test_exec_js_returns_scalar(self):
        """POST /execJs with a scalar return value."""
        response = self.client.post('/execJs', json={
            'code': 'return 42;',
            'file_path': '',
            'nodeType': 'JS_COMPUTATION',
            'dataType': '',
            'session_id': None,
        })
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn('output', data)
        self.assertIn('stdout', data)
        self.assertIn('stderr', data)
        self.assertEqual(data['stderr'], '')
        self.assertNotEqual(data['output']['path'], '')

    @_SKIP_NO_NODE
    def test_exec_js_console_log_captured(self):
        """console.log output appears in stdout."""
        response = self.client.post('/execJs', json={
            'code': 'console.log("hello"); return 1;',
            'file_path': '',
            'nodeType': 'JS_COMPUTATION',
            'dataType': '',
            'session_id': None,
        })
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn('hello', data['stdout'])

    @_SKIP_NO_NODE
    def test_exec_js_syntax_error_returned_in_stderr(self):
        """A JS syntax/runtime error is returned in stderr, not as a 500."""
        response = self.client.post('/execJs', json={
            'code': 'throw new Error("oops");',
            'file_path': '',
            'nodeType': 'JS_COMPUTATION',
            'dataType': '',
            'session_id': None,
        })
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn('oops', data['stderr'])
        self.assertEqual(data['output']['path'], '')

    @_SKIP_NO_NODE
    def test_execute_js_code_direct(self):
        """Unit-test execute_js_code() directly."""
        from utk_curio.sandbox.app.worker import execute_js_code, _worker_init
        _worker_init()
        result = execute_js_code('return arg * 2;', '', 'JS_COMPUTATION', '', session_id=None)
        self.assertIn('output', result)
        self.assertEqual(result['stderr'], '')


if __name__ == "__main__":
    unittest.main()