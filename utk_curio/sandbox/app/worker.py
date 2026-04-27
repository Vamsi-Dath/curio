"""
Execution worker for the Curio sandbox.

_worker_init() is called once at sandbox startup to pre-load all heavy imports
into _globals_cache. execute_code() then runs user code in-process using those
cached imports — no subprocess spawning, no IPC overhead.

Thread safety: _exec_lock serializes calls because contextlib.redirect_stdout
mutates the global sys.stdout, and os.chdir is process-wide. Both are restored
after each call via a finally block. For a single-user tool this is acceptable.

execute_js_code() runs JavaScript via a Node.js subprocess. No lock is needed
because each call is fully isolated in a child process.
"""

import threading

_globals_cache: dict = {}
_exec_lock = threading.Lock()


def _worker_init():
    """Load all heavy imports once. Called at sandbox startup."""
    global _globals_cache

    import warnings
    warnings.filterwarnings('ignore')

    import rasterio
    import geopandas as gpd
    import pandas as pd
    import json
    import mmap
    import zlib
    import os
    import time
    import hashlib
    import ast
    import io

    from utk_curio.sandbox.util.parsers import (
        load_from_duckdb,
        save_to_duckdb,
        detect_kind,
        checkIOType,
    )

    _globals_cache = {
        '__builtins__': __builtins__,
        'warnings': warnings,
        'rasterio': rasterio,
        'gpd': gpd,
        'pd': pd,
        'json': json,
        'mmap': mmap,
        'zlib': zlib,
        'os': os,
        'time': time,
        'hashlib': hashlib,
        'ast': ast,
        'io': io,
        'load_from_duckdb': load_from_duckdb,
        'save_to_duckdb': save_to_duckdb,
        'detect_kind': detect_kind,
        'checkIOType': checkIOType,
    }


def execute_code(code, file_path, node_type, data_type, launch_dir=None, session_id=None):
    """
    Execute user code in-process using pre-loaded library globals.

    session_id: Bearer token of the requesting session. Artifacts are stored and
                loaded scoped to this session so concurrent sessions never share
                execution state — even if they share the same user account.

    Returns {'stdout': [str, ...], 'stderr': str, 'output': {'path': str, 'dataType': str}}
    """
    import io as _io
    import os
    import sys
    import time
    import contextlib
    import traceback

    load_from_duckdb = _globals_cache['load_from_duckdb']
    save_to_duckdb   = _globals_cache['save_to_duckdb']
    detect_kind      = _globals_cache['detect_kind']
    checkIOType      = _globals_cache['checkIOType']

    # _exec_lock serializes sys.stdout mutation and os.chdir.
    with _exec_lock:
        t0 = time.perf_counter()
        original_dir = os.getcwd()
        if launch_dir:
            os.chdir(launch_dir)

        captured_stdout = _io.StringIO()
        captured_stderr = _io.StringIO()
        result = {'path': '', 'dataType': 'str'}
        t_load = t_code = t_save = t0

        try:
            with contextlib.redirect_stdout(captured_stdout), \
                 contextlib.redirect_stderr(captured_stderr):

                # Fresh namespace per call — prevents name leakage between executions.
                ns = dict(_globals_cache)
                exec(f"def userCode(arg):\n{code}", ns)

                # Load input from DuckDB.
                input_data = ''
                if data_type == 'outputs':
                    file_path_list = eval(file_path, {'__builtins__': {}})
                    input_data = [load_from_duckdb(elem['path'], session_id=session_id) for elem in file_path_list]
                elif file_path:
                    input_data = load_from_duckdb(file_path, session_id=session_id)
                t_load = time.perf_counter()

                # Validate and prepare input.
                incomingInput = None
                if input_data is not None and not (isinstance(input_data, str) and input_data == ''):
                    if data_type == 'outputs':
                        synthetic = {
                            'dataType': 'outputs',
                            'data': [{'dataType': detect_kind(v), 'data': None} for v in input_data],
                        }
                        checkIOType(synthetic, node_type)
                        incomingInput = input_data
                    else:
                        synthetic = {'dataType': detect_kind(input_data), 'data': None}
                        checkIOType(synthetic, node_type)
                        incomingInput = input_data

                # Run user code.
                output = ns['userCode'](incomingInput)
                t_code = time.perf_counter()

                # Validate output.
                out_kind = detect_kind(output)
                if out_kind == 'outputs':
                    synthetic_out = {
                        'dataType': 'outputs',
                        'data': [{'dataType': detect_kind(v), 'data': None} for v in output],
                    }
                else:
                    synthetic_out = {'dataType': out_kind, 'data': None}
                checkIOType(synthetic_out, node_type, False)

                # Save output to DuckDB, tagged with the session that produced it.
                result_path = save_to_duckdb(output, node_id=node_type, session_id=session_id)
                result = {'path': result_path, 'dataType': out_kind}
                t_save = time.perf_counter()

        except BaseException:
            captured_stderr.write(traceback.format_exc())

        finally:
            os.chdir(original_dir)
            t1 = time.perf_counter()
            print(
                f"[exec] load={t_load-t0:.3f}s  code={t_code-t_load:.3f}s"
                f"  save={t_save-t_code:.3f}s  total={t1-t0:.3f}s",
                file=sys.__stderr__,
                flush=True,
            )

        stdout_lines = [line for line in captured_stdout.getvalue().split('\n') if line]
        return {
            'stdout': stdout_lines,
            'stderr': captured_stderr.getvalue(),
            'output': result,
        }


def _serialize_for_js(obj) -> str:
    """Serialize a Python object to a JSON string suitable for embedding in a JS literal."""
    import json
    import pandas as pd
    import geopandas as gpd

    if obj is None or obj == '':
        return 'null'
    if isinstance(obj, gpd.GeoDataFrame):
        return obj.to_json()
    if isinstance(obj, pd.DataFrame):
        return json.dumps(obj.to_dict(orient='records'))
    try:
        return json.dumps(obj)
    except (TypeError, ValueError):
        return json.dumps(str(obj))


def execute_js_code(code, file_path, node_type, data_type, launch_dir=None, session_id=None):
    """
    Execute user JavaScript code in an isolated Node.js subprocess.

    User code is the body of `async function(arg) { <code> }`. Input is loaded
    from DuckDB, serialized to JSON, and passed as `arg`. The return value is
    saved back to DuckDB.

    Returns {'stdout': [str, ...], 'stderr': str, 'output': {'path': str, 'dataType': str}}
    """
    import json
    import os
    import subprocess
    import tempfile
    import time
    import traceback

    load_from_duckdb = _globals_cache['load_from_duckdb']
    save_to_duckdb   = _globals_cache['save_to_duckdb']
    detect_kind      = _globals_cache['detect_kind']

    t0 = time.perf_counter()
    script_path = None
    result_path = None

    try:
        # Load input from DuckDB.
        input_data = None
        if data_type == 'outputs' and file_path:
            file_path_list = eval(file_path, {'__builtins__': {}})
            input_data = [load_from_duckdb(elem['path'], session_id=session_id) for elem in file_path_list]
        elif file_path:
            input_data = load_from_duckdb(file_path, session_id=session_id)

        input_json = _serialize_for_js(input_data)

        # Write temp files for the script and its result.
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False, encoding='utf-8') as tf:
            script_path = tf.name
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as rf:
            result_path = rf.name

        # Indent user code for the async function body.
        indented = '\n'.join('    ' + line for line in code.splitlines())

        result_path_escaped = result_path.replace('\\', '\\\\')
        wrapper = (
            f"const arg = {input_json};\n"
            f"const __resultFile = {json.dumps(result_path)};\n"
            "const fs = require('fs');\n"
            "const __logs = [];\n"
            "const __origLog = console.log;\n"
            "console.log = (...args) => {\n"
            "  __logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));\n"
            "  __origLog(...args);\n"
            "};\n"
            "(async () => {\n"
            "  try {\n"
            "    const __result = await (async function(arg) {\n"
            f"{indented}\n"
            "    })(arg);\n"
            "    fs.writeFileSync(__resultFile, JSON.stringify({success: true, result: __result, logs: __logs}));\n"
            "  } catch(e) {\n"
            "    fs.writeFileSync(__resultFile, JSON.stringify({success: false, error: e.message + '\\n' + (e.stack || ''), logs: __logs}));\n"
            "  }\n"
            "})();\n"
        )

        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(wrapper)

        proc = subprocess.run(
            ['node', script_path],
            capture_output=True, text=True, timeout=30,
            cwd=launch_dir or os.getcwd(),
        )

        with open(result_path, 'r', encoding='utf-8') as f:
            run_result = json.load(f)

        t1 = time.perf_counter()
        print(f"[execJs] total={t1-t0:.3f}s  node={node_type}", file=__import__('sys').__stderr__, flush=True)

        if not run_result.get('success'):
            return {
                'stdout': run_result.get('logs', []),
                'stderr': run_result.get('error', 'Unknown JavaScript error'),
                'output': {'path': '', 'dataType': 'str'},
            }

        js_result = run_result['result']
        result_artifact = save_to_duckdb(js_result, node_id=node_type, session_id=session_id)
        out_kind = detect_kind(js_result)

        return {
            'stdout': run_result.get('logs', []),
            'stderr': proc.stderr or '',
            'output': {'path': result_artifact, 'dataType': out_kind},
        }

    except subprocess.TimeoutExpired:
        return {'stdout': [], 'stderr': 'JavaScript execution timed out (30 s)', 'output': {'path': '', 'dataType': 'str'}}
    except FileNotFoundError:
        return {'stdout': [], 'stderr': 'Node.js not found. Please install Node.js to use JS Computation nodes.', 'output': {'path': '', 'dataType': 'str'}}
    except Exception:
        return {'stdout': [], 'stderr': traceback.format_exc(), 'output': {'path': '', 'dataType': 'str'}}
    finally:
        for p in (script_path, result_path):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass
