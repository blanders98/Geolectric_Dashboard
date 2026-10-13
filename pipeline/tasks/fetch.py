import time
import requests
from prefect import task, get_run_logger
from pipeline.config import (
    EIA_BASE_URL, EIA_ENDPOINT, EIA_SECTOR,
    BULK_START_DATE, PAGE_SIZE, get_api_key,
)


@task(name="fetch-eia-electricity", retries=3, retry_delay_seconds=30)
def fetch_eia_records(start_date: str = BULK_START_DATE) -> list[dict]:
    """Paginate through the EIA v2 electricity retail-sales endpoint and return records."""
    logger = get_run_logger()
    api_key = get_api_key()
    url = EIA_BASE_URL + EIA_ENDPOINT

    records: list[dict] = []
    offset = 0

    while True:
        params = {
            "api_key": api_key,
            "frequency": "monthly",
            "data[0]": "price",
            "data[1]": "sales",
            "data[2]": "customers",
            "data[3]": "revenue",
            "facets[sectorid][]": EIA_SECTOR,
            "start": start_date,
            "sort[0][column]": "period",
            "sort[0][direction]": "asc",
            "length": PAGE_SIZE,
            "offset": offset,
        }

        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()

        payload = resp.json().get("response", {})
        batch: list[dict] = payload.get("data", [])
        total: int = int(payload.get("total", 0))

        logger.info(f"Page offset={offset}: got {len(batch)} of {total} total records")

        for row in batch:
            records.append(_normalize(row))

        offset += len(batch)
        if offset >= total or not batch:
            break

        time.sleep(0.15)

    logger.info(f"Fetch complete -- {len(records)} records retrieved")
    return records


def _normalize(row: dict) -> dict:
    period_str = row["period"]
    # EIA electricity period is YYYY-MM; convert to YYYY-MM-01 for DATE storage
    if len(period_str) == 7:
        period_str = period_str + "-01"
    return {
        "period": period_str,
        "stateid": row.get("stateid", ""),
        "state_description": row.get("stateDescription") or row.get("state-description", ""),
        "sectorid": row.get("sectorid", ""),
        "sector_name": row.get("sectorName") or row.get("sector-name", ""),
        "price": float(row["price"]) if row.get("price") is not None else None,
        "sales": float(row["sales"]) if row.get("sales") is not None else None,
        "customers": float(row["customers"]) if row.get("customers") is not None else None,
        "revenue": float(row["revenue"]) if row.get("revenue") is not None else None,
    }
