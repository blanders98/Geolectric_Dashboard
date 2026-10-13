"""
Main Prefect flow for the Geolectric electricity price pipeline.

Run modes:
    Full reload (default):
        python -m pipeline.flows.electricity

    Incremental (detects latest period in DB):
        python -m pipeline.flows.electricity --incremental
"""

import argparse
from prefect import flow, get_run_logger

from pipeline.config import BULK_START_DATE, DB_PATH, DOCS_DATA_DIR
from pipeline.tasks.fetch import fetch_eia_records
from pipeline.tasks.load import setup_schema, load_records, get_latest_period
from pipeline.tasks.transform import run_transformations
from pipeline.tasks.export import ensure_geojson, export_monthly_json


@flow(name="electricity-pipeline", log_prints=True)
def electricity_pipeline(incremental: bool = False) -> None:
    logger = get_run_logger()

    setup_schema(DB_PATH)

    if incremental:
        start_date = get_latest_period(DB_PATH)
        logger.info(f"Incremental load - fetching from {start_date}")
    else:
        start_date = BULK_START_DATE
        logger.info(f"Full reload - fetching from {start_date}")

    records = fetch_eia_records(start_date)
    load_records(records, DB_PATH)
    run_transformations(DB_PATH)
    ensure_geojson()
    months = export_monthly_json(DB_PATH, DOCS_DATA_DIR)

    logger.info(f"Pipeline complete -- {len(months)} months exported to {DOCS_DATA_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the electricity pipeline")
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Fetch only new data since the last stored period",
    )
    args = parser.parse_args()
    electricity_pipeline(incremental=args.incremental)
