from pathlib import Path
from prefect import task, get_run_logger
from pipeline.tasks.load import get_connection
from pipeline.config import DB_PATH


_STATE_MONTHLY = """
CREATE OR REPLACE TABLE mart.monthly_state_electricity AS
SELECT
    DATE_TRUNC('month', period)::DATE  AS month,
    stateid,
    ANY_VALUE(state_description)       AS state_description,
    ROUND(AVG(price), 3)::DOUBLE       AS avg_price,
    ROUND(SUM(sales), 1)::DOUBLE       AS total_sales
FROM raw.eia_electricity
WHERE price IS NOT NULL
  AND LENGTH(stateid) = 2
  AND stateid NOT IN ('DC')
GROUP BY 1, 2
ORDER BY 1, 2
"""

_NATIONAL_MONTHLY = """
CREATE OR REPLACE TABLE mart.national_monthly_electricity AS
SELECT
    DATE_TRUNC('month', period)::DATE                         AS month,
    ROUND(SUM(price * sales) / NULLIF(SUM(sales), 0), 3)::DOUBLE AS national_avg_price,
    ROUND(SUM(sales), 1)::DOUBLE                              AS national_total_sales
FROM raw.eia_electricity
WHERE price IS NOT NULL
  AND sales IS NOT NULL
  AND LENGTH(stateid) = 2
  AND stateid NOT IN ('DC')
GROUP BY 1
ORDER BY 1
"""


@task(name="run-transformations")
def run_transformations(db_path: Path = DB_PATH) -> None:
    logger = get_run_logger()
    conn = get_connection(db_path)

    conn.execute(_STATE_MONTHLY)
    state_rows = conn.execute("SELECT COUNT(*) FROM mart.monthly_state_electricity").fetchone()[0]
    logger.info(f"mart.monthly_state_electricity: {state_rows} rows")

    conn.execute(_NATIONAL_MONTHLY)
    nat_rows = conn.execute("SELECT COUNT(*) FROM mart.national_monthly_electricity").fetchone()[0]
    logger.info(f"mart.national_monthly_electricity: {nat_rows} rows")

    conn.close()
