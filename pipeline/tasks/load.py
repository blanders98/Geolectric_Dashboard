from pathlib import Path
import pandas as pd
import duckdb
from prefect import task, get_run_logger
from pipeline.config import DB_PATH, DUCKDB_MEMORY_LIMIT, DUCKDB_THREADS


def get_connection(db_path: Path = DB_PATH) -> duckdb.DuckDBPyConnection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(str(db_path))
    conn.execute(f"SET memory_limit='{DUCKDB_MEMORY_LIMIT}'")
    conn.execute(f"SET threads={DUCKDB_THREADS}")
    return conn


@task(name="setup-schema")
def setup_schema(db_path: Path = DB_PATH) -> None:
    conn = get_connection(db_path)
    conn.execute("CREATE SCHEMA IF NOT EXISTS raw")
    conn.execute("CREATE SCHEMA IF NOT EXISTS mart")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS raw.eia_electricity (
            period            DATE      NOT NULL,
            stateid           VARCHAR   NOT NULL,
            state_description VARCHAR,
            sectorid          VARCHAR,
            sector_name       VARCHAR,
            price             DOUBLE,
            sales             DOUBLE,
            customers         DOUBLE,
            revenue           DOUBLE,
            ingested_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.close()


@task(name="load-records")
def load_records(records: list[dict], db_path: Path = DB_PATH) -> int:
    logger = get_run_logger()
    if not records:
        logger.warning("No records to load - skipping")
        return 0

    df = pd.DataFrame(records)
    df["period"] = pd.to_datetime(df["period"]).dt.date

    conn = get_connection(db_path)

    min_period = df["period"].min()
    max_period = df["period"].max()

    stale = conn.execute(
        "SELECT COUNT(*) FROM raw.eia_electricity WHERE period BETWEEN ? AND ?",
        [min_period, max_period],
    ).fetchone()[0]
    conn.execute(
        "DELETE FROM raw.eia_electricity WHERE period BETWEEN ? AND ?",
        [min_period, max_period],
    )

    conn.execute("""
        INSERT INTO raw.eia_electricity
            (period, stateid, state_description, sectorid, sector_name,
             price, sales, customers, revenue)
        SELECT
            period::DATE, stateid, state_description, sectorid, sector_name,
            price, sales, customers, revenue
        FROM df
    """)

    total = conn.execute("SELECT COUNT(*) FROM raw.eia_electricity").fetchone()[0]
    conn.close()

    logger.info(f"Removed {stale} stale rows; inserted {len(records)}; table total: {total}")
    return total


@task(name="get-latest-period")
def get_latest_period(db_path: Path = DB_PATH) -> str:
    from datetime import timedelta
    from pipeline.config import BULK_START_DATE

    conn = get_connection(db_path)
    result = conn.execute("SELECT MAX(period) FROM raw.eia_electricity").fetchone()
    conn.close()

    if result[0] is None:
        return BULK_START_DATE

    latest = result[0]
    # Overlap by 60 days to catch late-arriving EIA revisions
    return (latest - timedelta(days=60)).strftime("%Y-%m")
