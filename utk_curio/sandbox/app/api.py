from flask import request, abort, jsonify
import json
import re
import sys
import geopandas as gpd
import pandas as pd
import utk
from utk_curio.sandbox.app import app, cache
from utk_curio.sandbox.app.utils.cache import make_key
import os
import mmap
from pathlib import Path

from shapely import wkt

from utk_curio.sandbox.app.worker import _worker_init, execute_code, execute_js_code
from utk_curio.sandbox.util.parsers import load_from_duckdb, parseOutput

_VALID_PACKAGE_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._\-]*(\[[\w,\s]+\])?(===?|~=|!=|>=?|<=?[a-zA-Z0-9._\-*]+)?$')

# Pre-load heavy libraries once at sandbox startup so every /exec call is fast.
_worker_init()

DATA_DIR = "./data"

@app.after_request
def add_cors_headers(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE')
    return response

@app.route('/')
def root():
    abort(403)

@app.route('/live', methods=['GET'])
def live():
    return 'Sandbox is live.'

@app.route('/get', methods=['GET'])
def get_artifact():
    import pandas as _pd
    art_id = request.args.get('fileName')
    if not art_id:
        abort(400, "fileName is required")
    session_id = request.args.get('sessionId') or None
    max_rows_param = request.args.get('maxRows')
    raw = load_from_duckdb(art_id, session_id=session_id)
    total_rows = None
    if max_rows_param is not None:
        max_rows = int(max_rows_param)
        if isinstance(raw, _pd.DataFrame):
            total_rows = len(raw)
            raw = raw.head(max_rows)
    data = parseOutput(raw)
    data['filename'] = art_id
    if total_rows is not None:
        data['preview'] = True
        data['previewRows'] = min(max_rows, total_rows)
        data['totalRows'] = total_rows
    return jsonify(data)

@app.route('/cwd')
def cwd():
    return os.getcwd()

@app.route('/launchCwd')
def launchCwd():
    return os.environ["CURIO_LAUNCH_CWD"]

@app.route('/sharedDataPath')
def sharedDataPath():
    return os.environ["CURIO_SHARED_DATA"]

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return 'No file part'

    file = request.files['file']
    if file.filename == '':
        return 'No selected file'

    launch_dir = os.environ.get("CURIO_LAUNCH_CWD", os.getcwd())
    data_dir = Path(os.path.join(launch_dir, "data"))
    data_dir.mkdir(parents=True, exist_ok=True)

    filename = os.path.basename(request.form.get('fileName', file.filename))
    save_path = data_dir / filename
    file.save(save_path)

    return str(save_path)

@app.route('/datasets', methods=['GET'])
def list_datasets():
    allowed_extensions = {'.json', '.geojson', '.csv'}

    files = []

    # Source 1: /data relative to the root of the installed pip package
    project_root_data = Path(__file__).parent.parent.parent / 'data'
    print("Loading datasets from pip package location:", project_root_data)

    if project_root_data.exists() and project_root_data.is_dir():
        files.extend([
            f.as_posix() for f in project_root_data.iterdir()
            if f.is_file() and f.suffix.lower() in allowed_extensions
        ])

    # Source 2: /data relative to current working directory
    # cwd_data = os.getcwd() / 'data'
    launch_dir = os.environ.get("CURIO_LAUNCH_CWD", os.getcwd())
    data_dir = os.path.join(launch_dir, "data")
    data_dir = Path(data_dir)
    print("Loading datasets from working directory:", data_dir)

    if data_dir.exists() and data_dir.is_dir():
        files.extend([
            f.as_posix() for f in data_dir.iterdir()
            if f.is_file() and f.suffix.lower() in allowed_extensions
        ])

    return jsonify(files)

@app.route('/install', methods=['POST'])
def install_packages():
    import subprocess
    packages = request.json.get('packages', [])
    if not packages:
        abort(400, "No packages specified")

    results = []
    for package in packages:
        package = package.strip()
        if not package:
            continue
        if not _VALID_PACKAGE_RE.match(package):
            results.append({"package": package, "success": False, "stdout": "", "stderr": f"Invalid package name: {package}"})
            continue
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', package],
            capture_output=True, text=True
        )
        results.append({
            "package": package,
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
        })

    return jsonify({"results": results})

@app.route('/exec', methods=['POST'])
# @cache.cached(make_cache_key=make_key)
def exec():
    import time
    import sys
    t0 = time.perf_counter()

    if request.json.get('code') is None:
        abort(400, "Code was not included in the post request")

    code       = request.json['code']
    file_path  = request.json['file_path']
    node_type  = request.json['nodeType']
    data_type  = request.json['dataType']
    session_id = request.json.get('session_id') or None
    launch_dir = os.environ.get('CURIO_LAUNCH_CWD', os.getcwd())

    result = execute_code(code, str(file_path), str(node_type), str(data_type), launch_dir, session_id=session_id)

    print(f"[sandbox /exec] total={time.perf_counter()-t0:.3f}s  node={node_type}", file=sys.stderr, flush=True)
    return jsonify(result)

@app.route('/execJs', methods=['POST'])
def exec_js():
    import time
    import sys
    t0 = time.perf_counter()

    if request.json.get('code') is None:
        abort(400, "Code was not included in the post request")

    code       = request.json['code']
    file_path  = request.json['file_path']
    node_type  = request.json['nodeType']
    data_type  = request.json['dataType']
    session_id = request.json.get('session_id') or None
    launch_dir = os.environ.get('CURIO_LAUNCH_CWD', os.getcwd())

    result = execute_js_code(code, str(file_path), str(node_type), str(data_type), launch_dir, session_id=session_id)

    print(f"[sandbox /execJs] total={time.perf_counter()-t0:.3f}s  node={node_type}", file=sys.stderr, flush=True)
    return jsonify(result)


@app.route('/toLayers', methods=['POST'])
def toLayers():

    if(request.json['geojsons'] == None):
        abort(400, "geojsons were not included in the post request")

    geojsons = request.json['geojsons']

    layers = []
    joinedJsons = []

    for index, geojson in enumerate(geojsons):

        parsedGeoJson = geojson # json.loads(geojson)

        layerName = "layer"+str(index)

        if 'metadata' in parsedGeoJson and 'name' in parsedGeoJson['metadata']:
            layerName = parsedGeoJson['metadata']['name']

        # gdfs.append(gpd.GeoDataFrame.from_features(geoJson))
        gdf = gpd.GeoDataFrame.from_features(parsedGeoJson)
        # df = pd.DataFrame.from_dict(geojson)
        # df = pd.DataFrame({'geometry': geojson['geometry'], 'values': geojson['value']})
        # df = df[df['geometry'].apply(lambda x: isinstance(x, str))]
        # df['geometry'] = df['geometry'].apply(wkt.loads)
        # gdf = gpd.GeoDataFrame(df, geometry='geometry')

        if 'building_id' in gdf.columns:

            gdf = gdf.set_crs('4326')
            mesh = utk.OSM.mesh_from_buildings_gdf(gdf, 5)['data']

            non_geometry_columns = [col for col in gdf.columns if col != gdf.geometry.name and col != "id" and col != "interacted" and col != "linked" and col != 'building_id' and col != 'tags' and col != 'height' and col != 'min_height']

            joinedJson = {
                "id": layerName,
                "incomingId": [],
                "inValues": []
            }

            renderStyle = []

            if(len(non_geometry_columns) > 0):
                renderStyle = ["SMOOTH_COLOR_MAP_TEX", "PICKING"]
            else:
                renderStyle = ["SMOOTH_COLOR_MAP_TEX"]

            layer = {
                "id": layerName,
                "type": "BUILDINGS_LAYER",
                "renderStyle": renderStyle,
                "styleKey": "surface",
                "data": mesh
            }

            layers.append(layer)

            for column in non_geometry_columns:

                inValues = []

                currentBuildingId = -1

                uniqueObjectIndex = 0

                print("column", column)

                for index, row in gdf.iterrows():

                    if(row['building_id'] != currentBuildingId): # only replicate values for the first reference to that building
                        currentBuildingId = row['building_id']

                        objectUnit = layer['data'][uniqueObjectIndex]['geometry'] # object (each row of the gdf was transformed in a set of coordinates)

                        for i in range(int(len(objectUnit['coordinates'])/3)):
                            if(isinstance(row[column],list)): # different values for each coordinate # TODO: consider multiple timesteps
                                inValues.append(row[column][i])
                            else: # for each coordinate replicate the value of the row
                                inValues.append(row[column])

                        uniqueObjectIndex += 1

                joinedJson["incomingId"].append(column)
                joinedJson["inValues"].append([inValues]) # TODO: support for multiple timesteps

            joinedJsons.append(joinedJson)

        elif 'surface_id' in gdf.columns:

            gdf = gdf.set_crs('3395')
            gdf = gdf.to_crs('4326')

            polygon_geometry = gdf.geometry.iloc[0]

            coordinates = list(polygon_geometry.exterior.coords)

            minLat = None
            maxLat = None
            minLon = None
            maxLon = None

            for coord in coordinates:
                if(minLat == None or minLat > coord[1]):
                    minLat = coord[1]

                if(maxLat == None or maxLat < coord[1]):
                    maxLat = coord[1]

                if(minLon == None or minLon > coord[0]):
                    minLon = coord[0]

                if(maxLon == None or maxLon < coord[0]):
                    maxLon = coord[0]

            mesh = utk.OSM.create_surface_mesh([minLat, minLon, maxLat, maxLon], True, -1, 5)

            non_geometry_columns = [col for col in gdf.columns if col != gdf.geometry.name and col != "id" and col != "interacted" and col != "linked" and col != 'surface_id']

            joinedJson = {
                "id": layerName,
                "incomingId": [],
                "inValues": []
            }

            renderStyle = []

            if(len(non_geometry_columns) > 0):
                renderStyle = ["SMOOTH_COLOR_MAP", "PICKING"]
            else:
                renderStyle = ["SMOOTH_COLOR"]

            layer = {
                "id": layerName,
                "type": "TRIANGLES_3D_LAYER",
                "renderStyle": renderStyle,
                "styleKey": "surface",
                "data": mesh['data']
            }

            layers.append(layer)

            for column in non_geometry_columns:

                inValues = []

                for index, row in gdf.iterrows():

                    objectUnit = layer['data'][index]['geometry'] # object (each row of the gdf was transformed in a set of coordinates)

                    for i in range(int(len(objectUnit['coordinates'])/3)):
                        if(isinstance(row[column],list)): # different values for each coordinate # TODO: consider multiple timesteps
                            inValues.append(row[column][i])
                        else: # for each coordinate replicate the value of the row
                            inValues.append(row[column])

                joinedJson["incomingId"].append(column)
                joinedJson["inValues"].append([inValues]) # TODO: support for multiple timesteps

            joinedJsons.append(joinedJson)

        else:

            gdf = gdf.set_crs('3395')
            mesh = utk.mesh_from_gdf(gdf)

            # layer = {
            #     "id": layerName,
            #     "type": "TRIANGLES_3D_LAYER",
            #     "renderStyle": ["SMOOTH_COLOR_MAP"],
            #     "styleKey": "surface",
            #     "data": mesh
            # }

            non_geometry_columns = [col for col in gdf.columns if col != gdf.geometry.name and col != "id" and col != "interacted" and col != "linked"]

            joinedJson = {
                "id": layerName,
                "incomingId": [],
                "inValues": []
            }

            renderStyle = []

            if(len(non_geometry_columns) > 0):
                renderStyle = ["SMOOTH_COLOR_MAP", "PICKING"]
            else:
                renderStyle = ["SMOOTH_COLOR"]

            layer = {
                "id": layerName,
                "type": "TRIANGLES_3D_LAYER",
                "renderStyle": renderStyle,
                "styleKey": "surface",
                "data": mesh
            }

            layers.append(layer)

            for column in non_geometry_columns:

                inValues = []

                for index, row in gdf.iterrows():
                    # print(layer['data'])
                    # print(layer['data'], flush=True)

                    objectUnit = layer['data'][index]['geometry'] # object (each row of the gdf was transformed in a set of coordinates)
                    
                    for i in range(int(len(objectUnit['coordinates'])/3)):
                        if(isinstance(row[column],list)): # different values for each coordinate # TODO: consider multiple timesteps
                            inValues.append(row[column][i])
                        else: # for each coordinate replicate the value of the row
                            inValues.append(row[column])

                joinedJson["incomingId"].append(column)
                joinedJson["inValues"].append([inValues]) # TODO: support for multiple timesteps

            joinedJsons.append(joinedJson)

    jsonOutput = {
        "layers": layers,
        "joinedJsons": joinedJsons
    }

    return jsonify(jsonOutput)

