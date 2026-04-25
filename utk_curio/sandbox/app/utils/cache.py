from flask import request, current_app
from flask import request

def make_key():
    """A function which is called to derive the key for a computed value.
       The key in this case is the concat value of all the json request
       parameters. Other strategy could to use any hashing function.
    :returns: unique string for which the value should be cached.
    """
    user_data = request.get_json()
    current_app.logger.info(f'make_key(): {user_data}')

    # response = cache._load_osm_from_cache(query)

    # if not response:
    #     time.sleep(1) # avoiding Overpass 429 Too Many Requests
    #     response = api.get(query, build=False)
    #     cache._save_osm_to_cache(query,response)

    return ",".join([f"{key}={value}" for key, value in user_data.items()])
