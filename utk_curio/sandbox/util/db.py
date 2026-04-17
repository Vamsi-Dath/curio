import duckdb
import os
from pathlib import Path


def get_db_path():
    """Resolve the path to the shared DuckDB file under .curio/data/."""
    launch_dir = Path(os.environ.get("CURIO_LAUNCH_CWD", os.getcwd())).resolve()
    shared_data = os.environ.get("CURIO_SHARED_DATA", "./.curio/data/")
    db_dir = (launch_dir / shared_data).resolve()
    os.makedirs(db_dir, exist_ok=True)
    return str(db_dir / "curio_data.duckdb")


def get_connection():
    """Open a DuckDB connection. Caller is responsible for closing it."""
    return duckdb.connect(get_db_path())


def init_db():
    """Create the artifacts table if it doesn't exist."""
    con = get_connection()
    try:
        con.execute("""
            CREATE TABLE IF NOT EXISTS artifacts (
                id          VARCHAR PRIMARY KEY,
                node_id     VARCHAR,
                kind        VARCHAR NOT NULL,
                value_int   BIGINT,
                value_float DOUBLE,
                value_str   VARCHAR,
                value_json  JSON,
                blob        BLOB
            )
        """)
    finally:
        con.close()