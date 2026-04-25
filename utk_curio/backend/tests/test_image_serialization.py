import json

import numpy as np
import pandas as pd

from utk_curio.sandbox.util.parsers import parseOutput


def test_parse_output_serializes_array_cells_in_dataframes():
    df = pd.DataFrame(
        {
            "image_id": [np.array([0, 1])],
            "image_content": [np.array(["img-a", "img-b"])],
        }
    )

    parsed = parseOutput(df)

    assert parsed["dataType"] == "dataframe"
    assert parsed["data"]["image_id"] == [[0, 1]]
    assert parsed["data"]["image_content"] == [["img-a", "img-b"]]
    assert json.loads(json.dumps(parsed)) == parsed
