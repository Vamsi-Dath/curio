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

    User code may contain top-level ES module `import` statements; these are
    hoisted to the top of the generated .mjs file so that autk-* packages
    installed in the project root's node_modules/ resolve correctly (Node.js
    walks up from the script file's location to find node_modules/).

    The script is written inside launch_dir (the project root) so the upward
    walk from the script finds node_modules/ there.

    Returns {'stdout': [str, ...], 'stderr': str, 'output': {'path': str, 'dataType': str}}
    """
    import json
    import os
    import pathlib
    import re
    import subprocess
    import tempfile
    import time
    import traceback
    import uuid

    from utk_curio.sandbox.util.db import (
        get_db_path,
        release_connection,
        init_db,
        get_connection,
    )

    t0 = time.perf_counter()
    script_path = None
    result_path = None

    cwd = launch_dir or os.getcwd()

    # Absolute path to the DuckDB file and to curio_db.mjs.
    db_path       = get_db_path()
    curio_db_url  = (pathlib.Path(__file__).parent.parent / 'util' / 'curio_db.mjs').as_uri()

    try:
        # Build the artifact-ID value to pass into Node.js.
        # For 'outputs' (multi-input), pre-parse the Python list string → proper JSON array.
        # For single inputs, pass the artifact ID string directly.
        if data_type == 'outputs' and file_path:
            file_path_list = eval(file_path, {'__builtins__': {}})
            artifact_id_for_js = json.dumps(file_path_list)   # embeds as JS array literal
        else:
            artifact_id_for_js = json.dumps(file_path or '')

        # Hoist static `import` lines from user code to the top of the .mjs
        # file so they are valid ES module declarations.
        import_re = re.compile(r'^import\b[^\n]*', re.MULTILINE)
        user_imports = '\n'.join(m.group(0).rstrip(';').rstrip() + ';'
                                 for m in import_re.finditer(code))
        clean_code = import_re.sub('', code).strip()

        # Write the temp script inside cwd so Node's upward module resolution
        # finds node_modules/ at the project root.
        script_name = f'_curio_{uuid.uuid4().hex}.mjs'
        script_path = os.path.join(cwd, script_name)

        # Result file can live in the system temp dir (referenced by absolute path).
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as rf:
            result_path = rf.name

        # Indent clean user code for the async function body.
        indented = '\n'.join('    ' + line for line in clean_code.splitlines())

        wrapper = (
            # curio_db.mjs handles its own worker_threads setup; the web-worker
            # polyfill below is kept so that user code importing autk-db via the
            # browser path still works.
            "import WebWorker from 'web-worker';\n"
            "if (typeof self === 'undefined') globalThis.self = globalThis;\n"
            "if (typeof Worker === 'undefined') globalThis.Worker = WebWorker;\n"
            "const __origFetch = globalThis.fetch;\n"
            "globalThis.fetch = (url, opts = {}) => {\n"
            "  if (typeof url === 'string' && url.includes('overpass-api.de')) {\n"
            "    opts = { ...opts, headers: { ...opts.headers, 'User-Agent': 'autk-db/1.3.1' } };\n"
            "  }\n"
            "  return __origFetch(url, opts);\n"
            "};\n"
            "\n"
            # curio_db.mjs: load/save artifacts from the shared DuckDB file.
            f"import {{ loadFromDuckdb, saveToDuckdb, detectKind }} from {json.dumps(curio_db_url)};\n"
            f"{user_imports}\n"
            "import { writeFileSync } from 'fs';\n"
            "\n"
            # Runtime constants injected by Python.
            f"const __artifactId = {artifact_id_for_js};\n"
            f"const __dataType   = {json.dumps(data_type)};\n"
            f"const __dbPath     = {json.dumps(db_path)};\n"
            f"const __sessionId  = {json.dumps(session_id)};\n"
            f"const __nodeType   = {json.dumps(node_type)};\n"
            f"const __resultFile = {json.dumps(result_path)};\n"
            "const __logs = [];\n"
            "const __origLog = console.log;\n"
            "console.log = (...args) => {\n"
            "  __logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));\n"
            "  __origLog(...args);\n"
            "};\n"
            "console.log('[curio] imports loaded, loading input...');\n"
            "try {\n"
            # Load input from DuckDB (mirrors Python's load_from_duckdb call).
            "  let arg = null;\n"
            "  if (__dataType === 'outputs' && Array.isArray(__artifactId)) {\n"
            "    arg = [];\n"
            "    for (const item of __artifactId)\n"
            "      arg.push(await loadFromDuckdb(item.path, __dbPath, __sessionId));\n"
            "  } else if (__artifactId) {\n"
            "    arg = await loadFromDuckdb(__artifactId, __dbPath, __sessionId);\n"
            "  }\n"
            "  console.log('[curio] input loaded, starting user code...');\n"
            "  const __result = await (async function(arg) {\n"
            f"{indented}\n"
            "  })(arg);\n"
            # Save output to DuckDB (mirrors Python's save_to_duckdb call).
            "  console.log('[curio] user code finished, saving result...');\n"
            "  const __outArtifactId = await saveToDuckdb(__result, __dbPath, __nodeType, __sessionId);\n"
            "  const __outKind = detectKind(__result);\n"
            "  writeFileSync(__resultFile, JSON.stringify({success: true, artifactId: __outArtifactId, dataType: __outKind, logs: __logs}));\n"
            "  console.log('[curio] done.');\n"
            "} catch(e) {\n"
            "  console.log('[curio] error: ' + e.message);\n"
            "  writeFileSync(__resultFile, JSON.stringify({success: false, error: e.message + '\\n' + (e.stack || ''), logs: __logs}));\n"
            "}\n"
        )

        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(wrapper)

        import sys as _sys
        import threading
        print(f"[execJs] starting Node.js  node={node_type}  script={script_path}", file=_sys.stderr, flush=True)

        # Release Python's persistent R/W connection so Node.js can open the file.
        release_connection()

        proc = subprocess.Popen(
            ['node', script_path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=cwd,
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        def _stream(pipe, lines, label):
            for line in pipe:
                line = line.rstrip('\n')
                lines.append(line)
                print(f"[execJs] {label}: {line}", file=_sys.stderr, flush=True)

        t_out = threading.Thread(target=_stream, args=(proc.stdout, stdout_lines, 'stdout'), daemon=True)
        t_err = threading.Thread(target=_stream, args=(proc.stderr, stderr_lines, 'stderr'), daemon=True)
        t_out.start()
        t_err.start()

        try:
            proc.wait(timeout=300)
        except subprocess.TimeoutExpired:
            proc.kill()
            t_out.join()
            t_err.join()
            raise

        t_out.join()
        t_err.join()

        t1 = time.perf_counter()
        print(f"[execJs] Node.js finished  total={t1-t0:.3f}s  exit={proc.returncode}  node={node_type}", file=_sys.stderr, flush=True)

        class _ProcResult:
            returncode = proc.returncode
            stdout = '\n'.join(stdout_lines)
            stderr = '\n'.join(stderr_lines)
        proc = _ProcResult()

        # If Node exited non-zero the script likely crashed before writing the
        # result file (e.g. import error, syntax error). Surface stderr directly.
        raw = ''
        try:
            with open(result_path, 'r', encoding='utf-8') as f:
                raw = f.read().strip()
            run_result = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            stderr_msg = (proc.stderr or '').strip() or (proc.stdout or '').strip() or 'Node.js exited without writing a result.'
            return {
                'stdout': [],
                'stderr': stderr_msg,
                'output': {'path': '', 'dataType': 'str'},
            }

        if not run_result.get('success'):
            return {
                'stdout': run_result.get('logs', []),
                'stderr': run_result.get('error', 'Unknown JavaScript error'),
                'output': {'path': '', 'dataType': 'str'},
            }

        result_artifact = run_result['artifactId']
        out_kind = run_result['dataType']

        return {
            'stdout': run_result.get('logs', []),
            'stderr': proc.stderr or '',
            'output': {'path': result_artifact, 'dataType': out_kind},
        }

    except subprocess.TimeoutExpired:
        return {'stdout': [], 'stderr': 'JavaScript execution timed out (300 s)', 'output': {'path': '', 'dataType': 'str'}}
    except FileNotFoundError:
        return {'stdout': [], 'stderr': 'Node.js not found. Please install Node.js to use JS Computation nodes.', 'output': {'path': '', 'dataType': 'str'}}
    except Exception:
        return {'stdout': [], 'stderr': traceback.format_exc(), 'output': {'path': '', 'dataType': 'str'}}
    finally:
        # Node.js has exited; restore Python's persistent DuckDB connection.
        try:
            init_db()
            get_connection()
        except Exception:
            pass
        for p in (script_path, result_path):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass
