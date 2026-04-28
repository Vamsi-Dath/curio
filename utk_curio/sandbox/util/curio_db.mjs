/**
 * curio_db.mjs — JS counterpart of util/db.py + the DuckDB I/O parts of
 * util/parsers.py.  Consumed by the Node.js wrapper scripts that worker.py
 * generates for every JS Computation node execution.
 *
 * Mirrors the Python approach: each execution reads its input artifact from
 * curio_data.duckdb and writes its output artifact back to the same file.
 * Python releases its persistent R/W lock before spawning the Node.js process
 * and re-acquires it afterwards (see worker.py:execute_js_code).
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

// ── DuckDB singleton (one per process) ──────────────────────────────────────

let _db          = null;   // AsyncDuckDB
let _conn        = null;   // AsyncDuckDBConnection
let _openedPath  = null;

async function _bootstrap() {
    // Mirror autk-db's Node.js init: build a worker_threads ↔ Worker-API shim,
    // then instantiate AsyncDuckDB with the EH WASM bundle.
    const { Worker } = await import('node:worker_threads');
    const pkgDir     = path.dirname(_require.resolve('@duckdb/duckdb-wasm'));
    const workerFile = path.join(pkgDir, 'duckdb-node-eh.worker.cjs');
    const wasmFile   = path.join(pkgDir, 'duckdb-eh.wasm');

    const evalCode = `const{parentPort}=require('node:worker_threads');`
        + `globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);`
        + `parentPort.on('message',(d)=>{if(typeof globalThis.onmessage==='function')globalThis.onmessage({data:d});});`
        + `require(${JSON.stringify(workerFile)});`;
    const thread = new Worker(evalCode, { eval: true });

    const _handlers = new Map();
    const adapter = {
        addEventListener(ev, fn) {
            const wrapped = ev === 'error'
                ? (e) => fn({ error: e, message: e?.message ?? String(e), target: adapter })
                : (d) => fn({ data: d, target: adapter });
            _handlers.set(fn, [ev, wrapped]);
            thread.on(ev, wrapped);
        },
        removeEventListener(ev, fn) {
            const entry = _handlers.get(fn);
            if (entry) { thread.off(entry[0], entry[1]); _handlers.delete(fn); }
        },
        postMessage(m, t) { thread.postMessage(m, t); },
        terminate()       { return thread.terminate(); },
    };

    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), adapter);
    await db.instantiate(wasmFile);
    return db;
}

async function _getConn(dbPath) {
    if (_db && _openedPath === dbPath) return _conn;

    if (_db) {
        try { await _conn?.close(); } catch {}
        try { await _db.terminate(); } catch {}
        _db = null; _conn = null;
    }

    _db = await _bootstrap();
    await _db.open({ path: dbPath });
    _conn = await _db.connect();
    _openedPath = dbPath;
    return _conn;
}

// ── Arrow helpers ────────────────────────────────────────────────────────────

/** Convert an Arrow Table to an array of plain JS objects. */
function _tableToRows(table) {
    if (!table || table.numRows === 0) return [];
    const fields = table.schema.fields;
    const rows   = [];
    for (let i = 0; i < table.numRows; i++) {
        const row = {};
        for (const field of fields) {
            const col = table.getChild(field.name);
            if (!col) { row[field.name] = null; continue; }
            let val = col.get(i);
            if (typeof val === 'bigint') val = Number(val);
            row[field.name] = val ?? null;
        }
        rows.push(row);
    }
    return rows;
}

/** Run a parameterised statement (INSERT / UPDATE). Returns nothing. */
async function _exec(conn, sql, ...params) {
    const stmt = await conn.prepare(sql);
    try   { await stmt.run(...params); }
    finally { await stmt.close(); }
}

/** Run a parameterised SELECT, return all rows as plain objects. */
async function _fetchAll(conn, sql, ...params) {
    const stmt = await conn.prepare(sql);
    let result;
    try   { result = await stmt.query(...params); }
    finally { await stmt.close(); }
    return _tableToRows(result);
}

// ── ID generation (same format as Python _make_id) ──────────────────────────

function _makeId() {
    const ts   = Date.now().toString();
    const rand = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 8);
    return `${ts}_${rand}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the Curio artifact kind for a JS value.
 * Mirrors Python's detect_kind().
 */
export function detectKind(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean')            return 'bool';
    if (Number.isInteger(value))               return 'int';
    if (typeof value === 'number')             return 'float';
    if (typeof value === 'string')             return 'str';
    if (Array.isArray(value))                  return 'list';
    if (typeof value === 'object')             return 'dict';
    return 'unknown';
}

/**
 * Persist a JS value to the artifacts table.
 * Mirrors Python's save_to_duckdb().
 * Returns the new artifact ID.
 */
export async function saveToDuckdb(value, dbPath, nodeId, sessionId) {
    const conn  = await _getConn(dbPath);
    const artId = _makeId();

    if (value === null || value === undefined) {
        await _exec(conn,
            'INSERT INTO artifacts (id, node_id, kind) VALUES ($1, $2, $3)',
            artId, nodeId ?? null, 'null');

    } else if (typeof value === 'boolean') {
        await _exec(conn,
            'INSERT INTO artifacts (id, node_id, kind, value_int) VALUES ($1, $2, $3, $4)',
            artId, nodeId ?? null, 'bool', value ? 1 : 0);

    } else if (Number.isInteger(value)) {
        await _exec(conn,
            'INSERT INTO artifacts (id, node_id, kind, value_int) VALUES ($1, $2, $3, $4)',
            artId, nodeId ?? null, 'int', value);

    } else if (typeof value === 'number') {
        await _exec(conn,
            'INSERT INTO artifacts (id, node_id, kind, value_float) VALUES ($1, $2, $3, $4)',
            artId, nodeId ?? null, 'float', value);

    } else if (typeof value === 'string') {
        await _exec(conn,
            'INSERT INTO artifacts (id, node_id, kind, value_str) VALUES ($1, $2, $3, $4)',
            artId, nodeId ?? null, 'str', value);

    } else if (Array.isArray(value)) {
        let payload = null;
        try { payload = JSON.stringify(value); } catch {}
        if (payload !== null) {
            await _exec(conn,
                'INSERT INTO artifacts (id, node_id, kind, value_json) VALUES ($1, $2, $3, $4)',
                artId, nodeId ?? null, 'list', payload);
        } else {
            // Circular / non-serialisable: save each element as its own artifact.
            const childIds = [];
            for (const item of value) {
                childIds.push(await saveToDuckdb(item, dbPath, nodeId, sessionId));
            }
            await _exec(conn,
                'INSERT INTO artifacts (id, node_id, kind, value_json) VALUES ($1, $2, $3, $4)',
                artId, nodeId ?? null, 'list_of_ids', JSON.stringify(childIds));
        }

    } else if (typeof value === 'object') {
        let payload = null;
        try { payload = JSON.stringify(value); } catch {}
        if (payload !== null) {
            await _exec(conn,
                'INSERT INTO artifacts (id, node_id, kind, value_json) VALUES ($1, $2, $3, $4)',
                artId, nodeId ?? null, 'dict', payload);
        } else {
            const childIdMap = {};
            for (const [k, v] of Object.entries(value)) {
                childIdMap[k] = await saveToDuckdb(v, dbPath, nodeId, sessionId);
            }
            await _exec(conn,
                'INSERT INTO artifacts (id, node_id, kind, value_json) VALUES ($1, $2, $3, $4)',
                artId, nodeId ?? null, 'dict_of_ids', JSON.stringify(childIdMap));
        }
    } else {
        throw new TypeError(`saveToDuckdb: unsupported type ${typeof value}`);
    }

    if (sessionId) {
        await _exec(conn,
            'UPDATE artifacts SET session_id = $1 WHERE id = $2',
            sessionId, artId);
    }

    return artId;
}

/**
 * Load an artifact by ID from the DuckDB file.
 * Mirrors Python's load_from_duckdb().
 *
 * Kind mapping to JS types:
 *   null         → null
 *   bool         → boolean
 *   int / float  → number
 *   str / raster → string
 *   list / dict  → Array / Object (JSON)
 *   list_of_ids  → Array (recursive loads)
 *   dict_of_ids  → Object (recursive loads)
 *   outputs      → Array (recursive loads)
 *   dataframe    → Array of row objects  [{ col: val, ... }, ...]
 *   geodataframe → GeoJSON FeatureCollection (requires DuckDB spatial extension)
 */
export async function loadFromDuckdb(artifactId, dbPath, sessionId) {
    if (!artifactId) return null;

    const conn = await _getConn(dbPath);

    // Session isolation (mirrors Python logic: NULL session_id = pre-isolation, allow all)
    if (sessionId) {
        const sidRows = await _fetchAll(conn,
            'SELECT session_id FROM artifacts WHERE id = $1', artifactId);
        if (sidRows.length === 0) throw new Error(`No artifact with id ${artifactId}`);
        const stored = sidRows[0].session_id;
        if (stored !== null && stored !== sessionId)
            throw new Error(`No artifact with id ${artifactId}`);
    }

    const rows = await _fetchAll(conn,
        'SELECT kind, value_int, value_float, value_str, value_json FROM artifacts WHERE id = $1',
        artifactId);
    if (rows.length === 0) throw new Error(`No artifact with id ${artifactId}`);

    const { kind, value_int: vInt, value_float: vFloat, value_str: vStr, value_json: vJson } = rows[0];

    switch (kind) {
        case 'null':   return null;
        case 'bool':   return vInt !== null ? Boolean(vInt) : null;
        case 'int':    return vInt;
        case 'float':  return vFloat;
        case 'str':
        case 'raster': return vStr;
        case 'list':
        case 'dict':   return JSON.parse(vJson);

        case 'list_of_ids': {
            const ids = JSON.parse(vJson);
            const result = [];
            for (const id of ids) result.push(await loadFromDuckdb(id, dbPath, sessionId));
            return result;
        }
        case 'dict_of_ids': {
            const idMap = JSON.parse(vJson);
            const result = {};
            for (const [k, id] of Object.entries(idMap))
                result[k] = await loadFromDuckdb(id, dbPath, sessionId);
            return result;
        }
        case 'outputs': {
            const childIds = JSON.parse(vJson);
            const result = [];
            for (const id of childIds) result.push(await loadFromDuckdb(id, dbPath, sessionId));
            return result;
        }
        case 'dataframe':    return _loadParquet(artifactId, false);
        case 'geodataframe': return _loadParquet(artifactId, true);
        default: throw new Error(`loadFromDuckdb: unknown artifact kind "${kind}"`);
    }
}

// ── Parquet / GeoParquet loading ─────────────────────────────────────────────

async function _readBlobRow(artifactId) {
    const conn = _conn;
    const rows = await _fetchAll(conn,
        'SELECT blob, value_json FROM artifacts WHERE id = $1', artifactId);
    if (rows.length === 0) throw new Error(`No artifact blob for id ${artifactId}`);
    return { blob: rows[0].blob, metaJson: rows[0].value_json };
}

async function _loadParquet(artifactId, isGeo) {
    const { blob, metaJson } = await _readBlobRow(artifactId);
    if (!blob) throw new Error(`Artifact ${artifactId} has no blob data`);

    // blob may be a Uint8Array (Arrow Binary) or a Buffer-like from Arrow
    const blobBytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);

    const tmpName = `_curio_${isGeo ? 'geo' : ''}parquet_${artifactId}.parquet`;
    await _db.registerFileBuffer(tmpName, blobBytes);

    try {
        const conn = _conn;
        let result;

        if (isGeo) {
            // Try to use the spatial extension for geometry → GeoJSON conversion.
            let hasSpatial = false;
            try {
                await conn.query("LOAD spatial;");
                hasSpatial = true;
            } catch {
                try {
                    await conn.query("INSTALL spatial; LOAD spatial;");
                    hasSpatial = true;
                } catch {}
            }

            if (hasSpatial) {
                // GeoParquet stores geometry as WKB. With spatial loaded, DuckDB
                // auto-detects the column; cast to GEOMETRY then emit GeoJSON.
                try {
                    result = await conn.query(
                        `SELECT * EXCLUDE (geometry),`
                        + ` ST_AsGeoJSON(geometry::GEOMETRY) AS __geom_json`
                        + ` FROM parquet_scan('${tmpName}')`
                    );
                } catch {
                    // Geometry column name might differ; fall back to raw scan.
                    result = await conn.query(`SELECT * FROM parquet_scan('${tmpName}')`);
                    hasSpatial = false;
                }

                const rowData = _tableToRows(result);
                _restoreObjectColumns(rowData, metaJson);

                const features = rowData.map(({ __geom_json, ...props }) => ({
                    type: 'Feature',
                    geometry: __geom_json ? JSON.parse(__geom_json) : null,
                    properties: props,
                }));
                return { type: 'FeatureCollection', features };
            }
        }

        // Plain DataFrame (or GeoDataFrame fallback without spatial)
        result = await conn.query(`SELECT * FROM parquet_scan('${tmpName}')`);
        const rowData = _tableToRows(result);
        _restoreObjectColumns(rowData, metaJson);
        return rowData;

    } finally {
        try { await _db.dropFile(tmpName); } catch {}
    }
}

/** JSON-parse any columns that Python encoded as JSON strings in the Parquet. */
function _restoreObjectColumns(rows, metaJson) {
    if (!metaJson || !rows.length) return;
    let encodedCols;
    try {
        const meta = JSON.parse(metaJson);
        encodedCols = meta.encoded_object_columns ?? [];
    } catch {
        return;
    }
    for (const col of encodedCols) {
        for (const row of rows) {
            if (row[col] != null && typeof row[col] === 'string') {
                try { row[col] = JSON.parse(row[col]); } catch {}
            }
        }
    }
}
