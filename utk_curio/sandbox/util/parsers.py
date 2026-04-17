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
import datetime
import numpy as np

from shapely import wkt
from pathlib import Path

#DuckDB imports:
import io
import duckdb
from utk_curio.sandbox.util.db import get_connection, init_db

# Utility Functions
# transforms the whole input into a dict (json) in depth
# def toJsonInput(input):
#     print("here", input)
#     parsedJson = input
#     if(parsedJson['dataType'] == 'outputs'):
#         for key, elem in enumerate(parsedJson['data']):
#             parsedJson['data'][key] = toJsonInput(elem)

#     return parsedJson

# I/O Type Checking
def checkIOType(data, nodeType, input=True):
    if input:
        validate_input(data, nodeType)
    else:
        validate_output(data, nodeType)


# Input Validation
def validate_input(data, nodeType):
    if isinstance(data, list):
        return
    if nodeType in ['DATA_EXPORT', 'DATA_CLEANING']:
        check_dataframe_input(data, nodeType)
    elif nodeType == 'DATA_TRANSFORMATION':
        check_transformation_input(data, nodeType)

# Output Validation
def validate_output(data, nodeType):
    if nodeType in ['DATA_LOADING', 'DATA_CLEANING', 'DATA_TRANSFORMATION']:
        check_valid_output(data, nodeType)
    elif nodeType == 'DATA_EXPORT':
        if data.get('dataType') in ['', None]:
            return
        raise Exception(f'{nodeType} does not support output')


# Input Type Checks
def check_dataframe_input(data, nodeType):
    if isinstance(data, list):
        return
    if data['dataType'] == 'outputs' and len(data['data']) > 5:
        raise Exception(f'{nodeType} only supports five inputs')

    valid_types = {'dataframe', 'geodataframe'}
    if data['dataType'] == 'outputs':
        for elem in data['data']:
            if elem['dataType'] not in valid_types:
                raise Exception(f'{nodeType} only supports DataFrame and GeoDataFrame as input')
    elif data['dataType'] not in valid_types:
        raise Exception(f'{nodeType} only supports DataFrame and GeoDataFrame as input')

def check_transformation_input(data, nodeType):
    valid_types = {'dataframe', 'geodataframe', 'raster'}
    if data['dataType'] == 'outputs' and len(data['data']) > 2:
        raise Exception(f'{nodeType} only supports one or two inputs')

    if data['dataType'] == 'outputs':
        for elem in data['data']:
            if elem['dataType'] not in valid_types:
                raise Exception(f'{nodeType} only supports DataFrame, GeoDataFrame, and Raster as input')
    elif data['dataType'] not in valid_types:
        raise Exception(f'{nodeType} only supports DataFrame, GeoDataFrame, and Raster as input')

def check_valid_output(data, nodeType):
    if isinstance(data, list):
        return
    valid_types = {'dataframe', 'geodataframe', 'raster'}

    if data['dataType'] == 'outputs':
        if len(data['data']) > 1 and nodeType != 'DATA_LOADING':
            raise Exception(f'{nodeType} only supports one output')

        for elem in data['data']:
            if elem['dataType'] not in valid_types:
                raise Exception(f'{nodeType} only supports DataFrame, GeoDataFrame, and Raster as output')

    elif data['dataType'] not in valid_types:
        raise Exception(f'{nodeType} only supports DataFrame, GeoDataFrame, and Raster as output')

def save_memory_mapped_file(data):
    """
    Saves the input data as a memory-mapped JSON file with a unique name.

    Args:
        input_data (dict): The data to be saved.
        shared_disk_path (str): Path to the directory for saving the file.

    Returns:
        str: The path of the saved memory-mapped file.
    """
    launch_dir = Path(os.environ.get("CURIO_LAUNCH_CWD", os.getcwd())).resolve()
    shared_disk_path = os.environ.get("CURIO_SHARED_DATA", "./.curio/data/")
    save_dir = (launch_dir / shared_disk_path).resolve()
    # Ensure the directory exists
    os.makedirs(save_dir, exist_ok=True)

    # Prepare hash before adding filepath
    json_bytes_initial = json.dumps(data, ensure_ascii=False).encode('utf-8')
    input_hash = hashlib.sha256(json_bytes_initial[:1024]).digest()[:4].hex()
    timestamp = str(int(time.time()))
    unique_filename = f"{timestamp}_{input_hash[:25]}.data"

    # Inject the filename into the data
    data['filename'] = unique_filename

    # Now serialize the updated data
    json_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
    compressed_data = zlib.compress(json_bytes)

    full_path = save_dir / unique_filename
    with open(full_path, "wb") as file:
        file.write(compressed_data)
        file.flush()

    relative_path = full_path.relative_to(shared_disk_path)
    return str(relative_path).replace("\\", "/")


def load_memory_mapped_file(file_path):
    """
    Loads the JSON data from the specified memory-mapped JSON file.

    Args:
        file_path (str): The path of the memory-mapped JSON file to load.

    Returns:
        dict: The loaded JSON data.
    """
    launch_dir = Path(os.environ.get("CURIO_LAUNCH_CWD", os.getcwd())).resolve()
    shared_disk_path = os.environ.get("CURIO_SHARED_DATA", "./.curio/data/")
    lod_dir = (launch_dir / shared_disk_path).resolve()

    # Ensure file_path is relative, then join and resolve
    requested_path = Path(file_path)
    full_path = (lod_dir / requested_path).resolve()

    # Security check to prevent directory traversal
    if not str(full_path).startswith(str(lod_dir)):
        raise PermissionError(f"Access to path '{full_path}' is not allowed.")

    # Normalize the path
    # file_path = Path(file_path).resolve()

    if not full_path.exists():
        raise FileNotFoundError(f"The file {full_path} does not exist.")

    # Using mmap for efficient memory-mapped loading
    with open(full_path, "rb") as file:
        with mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as mmapped_file:
            # Decompress and decode directly from the memory-mapped file
            decompressed_data = zlib.decompress(mmapped_file[:])
            data = json.loads(decompressed_data.decode('utf-8'))
    return data


def parse_primitive(data_type, data_value):
    try:
        return ast.literal_eval(data_value)
    except (ValueError, SyntaxError):
        return data_value

def parse_list(data_type, data_value):
    values = []
    for elem in data_value:
        if type(elem) == dict and 'dataType' in elem:
            values.append(parseInput(elem))
        else:
            values.append(elem)
    return values

def parse_dataframe(data_value):
    # return pd.DataFrame.from_dict(data_value)
    df = pd.DataFrame.from_dict(data_value)
    return df.astype(object).where(pd.notnull(df), np.nan)

def parse_geodataframe(data_value):
    # df = pd.DataFrame.from_dict(data_value)
    # df['geometry'] = df['geometry'].apply(wkt.loads)
    # gdf = gpd.GeoDataFrame(df, geometry='geometry')
    gdf = gpd.GeoDataFrame.from_features(data_value["features"])
    if 'metadata' in data_value and 'name' in data_value['metadata']:
        gdf.metadata = {'name': data_value['metadata']['name']}
    
    return gdf

def parse_raster(data_value):
    return rasterio.open(data_value)

# Parsing Functions
def parseInput(parsed_json):
    # parsed_json = json.loads(input_str)

    data_type = parsed_json.get('dataType')
    data_value = parsed_json.get('data')

    if data_type in ['int', 'float', 'bool', 'dict', 'str']:
        return parse_primitive(data_type, data_value)
    elif data_type == 'list':
        return parse_list(data_type, data_value)
    elif data_type == 'dataframe':
        return parse_dataframe(data_value)
    elif data_type == 'geodataframe':
        return parse_geodataframe(data_value)
    elif data_type == 'raster':
        return parse_raster(data_value)
    elif data_type == 'outputs':
        return tuple(parseInput(elem) for elem in data_value)

    return None


def make_json_safe(obj):
    if isinstance(obj, (dict, list)):
        return obj
    elif isinstance(obj, (np.integer, np.floating)):
        return obj.item()
    elif isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    elif obj is None:
        return None
    elif isinstance(obj, (float, int)) and pd.isnull(obj):  # Only apply pd.isnull to scalars
        return None
    return obj  # Fallback for str, bool, etc.

def safe_json_loads(val):
    try:
        if isinstance(val, str) and val.strip().startswith('{'):
            return json.loads(val)
    except Exception as e:
        print("Exception in safe_json_loads", e)
    return val

def _make_serializable(val):
    """Recursively convert numpy/pandas types to native Python types."""
    if isinstance(val, np.ndarray):
        return [_make_serializable(v) for v in val.tolist()]
    elif isinstance(val, (np.integer,)):
        return int(val)
    elif isinstance(val, (np.floating,)):
        return float(val)
    elif isinstance(val, (np.bool_,)):
        return bool(val)
    elif isinstance(val, (pd.Timestamp, datetime.datetime, datetime.date)):
        return val.isoformat()
    elif isinstance(val, dict):
        return {k: _make_serializable(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [_make_serializable(v) for v in val]
    return val


def fix_json_strings(gdf):
    gdf = gdf.copy()
    for col in gdf.columns:
        if col != 'geometry':
            gdf[col] = gdf[col].apply(safe_json_loads)
            gdf[col] = gdf[col].apply(_make_serializable)

    return gdf

# Output Functions
def parseOutput(output):
    json_output = {'data': '', 'dataType': ''}
    if isinstance(output, (int, float, bool, str)):
        json_output['data'] = output
        json_output['dataType'] = type(output).__name__
    elif isinstance(output, list):
        json_output['data'] = [parseOutput(elem) for elem in output]
        json_output['dataType'] = type(output).__name__
    elif isinstance(output, dict):
        json_output['data'] = output
        json_output['dataType'] = type(output).__name__
    elif isinstance(output, pd.DataFrame) and not isinstance(output, gpd.GeoDataFrame):
        # json_output['data'] = output.to_dict(orient='list')
        clean_df = output.astype(object).where(pd.notnull(output), None)
        clean_df = make_json_safe(clean_df)
        json_output['data'] = clean_df.to_dict(orient='list')
        json_output['dataType'] = 'dataframe'
    elif isinstance(output, gpd.GeoDataFrame):
        # output['geometry'] = output['geometry'].apply(lambda geom: geom.wkt)
        # json_output['data'] = output.to_dict(orient='list')
        gdf = fix_json_strings(output)
        geojson_dict = json.loads(gdf.to_json())
        json_output['data'] = geojson_dict
        json_output['dataType'] = 'geodataframe'
        if hasattr(output, 'metadata') and 'name' in output.metadata:
            parsed_geojson = json_output['data']
            parsed_geojson['metadata'] = {'name': output.metadata['name']}
            json_output['data'] = parsed_geojson
    elif isinstance(output, rasterio.io.DatasetReader):
        json_output['data'] = output.name
        json_output['dataType'] = 'raster'
    elif isinstance(output, tuple):
        json_output['data'] = [parseOutput(elem) for elem in output]
        json_output['dataType'] = 'outputs'

    return json_output

#DuckDB handlers:
def _make_id():
    """Generate a unique id: {timestamp}_{hash}."""
    timestamp = str(int(time.time() * 1000))  # millisecond precision to avoid collisions
    random_part = hashlib.sha256(os.urandom(16)).digest()[:4].hex()
    return f"{timestamp}_{random_part}"


def save_to_duckdb(value, node_id=None):
    """
    Save a Python value to the artifacts table.

    Args:
        value: the raw Python object (DataFrame, GeoDataFrame, int, str, list, dict, tuple, rasterio dataset, etc.)
               OR a parsed output dict (from parseOutput) for compatibility.
        node_id: the workflow node id that produced this artifact.

    Returns:
        str: the id of the new artifact row.
    """
    import time as _time
    t_start = _time.perf_counter()

    init_db()
    con = get_connection()
    try:
        art_id = _make_id()

        # --- Tuple: split into children + parent pointer row ---
        if isinstance(value, tuple):
            child_ids = [save_to_duckdb(child, node_id=node_id) for child in value]
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, value_json) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'outputs', json.dumps(child_ids)]
            )
            kind_logged = 'outputs'

        # --- bool MUST come before int (bool is a subclass of int) ---
        elif isinstance(value, bool):
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, value_int) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'bool', 1 if value else 0]
            )
            kind_logged = 'bool'

        elif isinstance(value, int):
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, value_int) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'int', value]
            )
            kind_logged = 'int'

        elif isinstance(value, float):
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, value_float) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'float', value]
            )
            kind_logged = 'float'

        elif isinstance(value, str):
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, value_str) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'str', value]
            )
            kind_logged = 'str'

        elif isinstance(value, list):
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, value_json) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'list', json.dumps(value)]
            )
            kind_logged = 'list'

        elif isinstance(value, dict):
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, value_json) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'dict', json.dumps(value)]
            )
            kind_logged = 'dict'

        # --- GeoDataFrame MUST come before DataFrame (gpd.GeoDataFrame subclasses pd.DataFrame) ---
        elif isinstance(value, gpd.GeoDataFrame):
            buf = io.BytesIO()
            value.to_parquet(buf)  # GeoParquet — CRS preserved automatically
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, blob) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'geodataframe', buf.getvalue()]
            )
            kind_logged = f'geodataframe rows={len(value)}'

        elif isinstance(value, pd.DataFrame):
            buf = io.BytesIO()
            value.to_parquet(buf, engine='pyarrow', index=False)
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, blob) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'dataframe', buf.getvalue()]
            )
            kind_logged = f'dataframe rows={len(value)}'

        elif isinstance(value, rasterio.io.DatasetReader):
            con.execute(
                "INSERT INTO artifacts (id, node_id, kind, value_str) VALUES (?, ?, ?, ?)",
                [art_id, node_id, 'raster', value.name]
            )
            kind_logged = 'raster'

        else:
            raise TypeError(f"save_to_duckdb: unsupported type {type(value)}")

        elapsed = _time.perf_counter() - t_start
        print(f"[duckdb] save {kind_logged} id={art_id} node={node_id} took={elapsed:.4f}s")
        return art_id

    finally:
        con.close()


def load_from_duckdb(art_id):
    """
    Load an artifact by id.

    Returns the reconstructed Python value (DataFrame, GeoDataFrame, tuple, int, etc.).
    """
    import time as _time
    t_start = _time.perf_counter()

    con = get_connection()
    try:
        row = con.execute(
            "SELECT kind, value_int, value_float, value_str, value_json, blob "
            "FROM artifacts WHERE id = ?",
            [art_id]
        ).fetchone()

        if row is None:
            raise KeyError(f"No artifact with id {art_id}")

        kind, v_int, v_float, v_str, v_json, blob = row

        if kind == 'bool':
            result = bool(v_int)
        elif kind == 'int':
            result = v_int
        elif kind == 'float':
            result = v_float
        elif kind == 'str':
            result = v_str
        elif kind == 'list':
            result = json.loads(v_json)
        elif kind == 'dict':
            result = json.loads(v_json)
        elif kind == 'dataframe':
            result = pd.read_parquet(io.BytesIO(blob))
        elif kind == 'geodataframe':
            result = gpd.read_parquet(io.BytesIO(blob))
        elif kind == 'raster':
            result = rasterio.open(v_str)
        elif kind == 'outputs':
            child_ids = json.loads(v_json)
            # Close this connection before recursing (one connection per call)
            con.close()
            result = tuple(load_from_duckdb(cid) for cid in child_ids)
            elapsed = _time.perf_counter() - t_start
            print(f"[duckdb] load outputs id={art_id} children={len(child_ids)} took={elapsed:.4f}s")
            return result
        else:
            raise ValueError(f"Unknown kind: {kind}")

        elapsed = _time.perf_counter() - t_start
        print(f"[duckdb] load {kind} id={art_id} took={elapsed:.4f}s")
        return result

    finally:
        try:
            con.close()
        except Exception:
            pass

def detect_kind(obj):
    """Return the Curio 'kind' string for a Python object (no conversion)."""
    # bool MUST come before int
    if isinstance(obj, bool): return 'bool'
    if isinstance(obj, int): return 'int'
    if isinstance(obj, float): return 'float'
    if isinstance(obj, str): return 'str'
    if isinstance(obj, list): return 'list'
    if isinstance(obj, dict): return 'dict'
    # GeoDataFrame MUST come before DataFrame
    if isinstance(obj, gpd.GeoDataFrame): return 'geodataframe'
    if isinstance(obj, pd.DataFrame): return 'dataframe'
    if isinstance(obj, rasterio.io.DatasetReader): return 'raster'
    if isinstance(obj, tuple): return 'outputs'
    return 'unknown'