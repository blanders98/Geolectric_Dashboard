import json
from datetime import datetime, timezone
from pathlib import Path

import requests
from prefect import task, get_run_logger

from pipeline.config import DB_PATH, DOCS_DATA_DIR, GEOJSON_URL, GEOJSON_PATH
from pipeline.tasks.load import get_connection


@task(name="ensure-geojson")
def ensure_geojson() -> None:
    if GEOJSON_PATH.exists():
        return

    logger = get_run_logger()
    logger.info(f"Downloading US states GeoJSON from {GEOJSON_URL}")
    GEOJSON_PATH.parent.mkdir(parents=True, exist_ok=True)

    resp = requests.get(GEOJSON_URL, timeout=30)
    resp.raise_for_status()
    GEOJSON_PATH.write_text(resp.text, encoding="utf-8")
    logger.info(f"Saved GeoJSON to {GEOJSON_PATH}")


@task(name="export-monthly-json")
def export_monthly_json(db_path: Path = DB_PATH, output_dir: Path = DOCS_DATA_DIR) -> list[str]:
    logger = get_run_logger()
    output_dir.mkdir(parents=True, exist_ok=True)
    conn = get_connection(db_path)

    months = [
        row[0]
        for row in conn.execute(
            "SELECT DISTINCT month FROM mart.monthly_state_electricity ORDER BY month"
        ).fetchall()
    ]

    exported: list[str] = []

    for month in months:
        month_str = month.strftime("%Y-%m")

        states_df = conn.execute("""
            SELECT stateid, state_description, avg_price, total_sales
            FROM mart.monthly_state_electricity
            WHERE month = ?
            ORDER BY state_description
        """, [month]).df()

        national_row = conn.execute("""
            SELECT national_avg_price, national_total_sales
            FROM mart.national_monthly_electricity
            WHERE month = ?
        """, [month]).fetchone()

        price_series = states_df["avg_price"].dropna()
        sales_series = states_df["total_sales"].dropna()

        payload = {
            "month": month_str,
            "stats": {
                "national_avg_price": national_row[0] if national_row else None,
                "national_total_sales": national_row[1] if national_row else None,
                "state_min_price": float(price_series.min()) if len(price_series) else None,
                "state_max_price": float(price_series.max()) if len(price_series) else None,
                "state_min_price_name": states_df.loc[states_df["avg_price"].idxmin(), "state_description"] if len(price_series) else None,
                "state_max_price_name": states_df.loc[states_df["avg_price"].idxmax(), "state_description"] if len(price_series) else None,
                "state_min_sales": float(sales_series.min()) if len(sales_series) else None,
                "state_max_sales": float(sales_series.max()) if len(sales_series) else None,
                "state_min_sales_name": states_df.loc[states_df["total_sales"].idxmin(), "state_description"] if len(sales_series) else None,
                "state_max_sales_name": states_df.loc[states_df["total_sales"].idxmax(), "state_description"] if len(sales_series) else None,
            },
            "states": states_df.to_dict(orient="records"),
        }

        out_path = output_dir / f"electricity_{month_str}.json"
        out_path.write_text(json.dumps(payload, default=str), encoding="utf-8")
        exported.append(month_str)

    conn.close()

    manifest = {
        "available_months": exported,
        "latest_month": exported[-1] if exported else None,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "record_count": len(exported),
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    logger.info(f"Exported {len(exported)} monthly JSON files + manifest.json")
    return exported
