# Geolectric

Interactive US electricity retail sales dashboard. State-level monthly price (cents/kWh) and sales volume (GWh) from the [EIA Open Data API](https://www.eia.gov/opendata/), stored in DuckDB, exported as static JSON, rendered with Leaflet.js on GitHub Pages.

**Website:** https://blanders98.github.io/Geolectric_Dashboard/

## Stack

| Layer | Tool |
|---|---|
| Orchestration | [Prefect 3](https://docs.prefect.io/) |
| Storage | [DuckDB](https://duckdb.org/) |
| Source | [EIA API v2](https://www.eia.gov/opendata/) |
| Frontend | [Leaflet.js](https://leafletjs.com/) |
| Hosting | GitHub Pages |
| CI/CD | GitHub Actions (weekly) |

## Architecture

```
EIA API  -->  fetch.py  -->  raw.eia_electricity (DuckDB)
                        |
                        | transform.py
                        |
              mart.monthly_state_electricity (DuckDB)
              mart.national_monthly_electricity (DuckDB)
                        |
                        | export.py
                        |
         docs/data/electricity_YYYY-MM.json --> Leaflet map
```

The pipeline runs in GitHub Actions every Tuesday. DuckDB is stateless in CI - all data is fetched fresh from EIA each run. Locally, the pipeline is incremental by default after the first full load.

## Setup

### 1. Prerequisites

```bash
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
```

### 2. API key

Get a free key at <https://www.eia.gov/opendata/> and put it in `./config/eia_api_key.txt`:

The file is gitignored. In CI, set the `EIA_API_KEY` repository secret.

### 3. First run (bulk load from Jan 2000)

```bash
python -m pipeline.flows.electricity
```

This will:
1. Fetch all monthly state-level electricity retail records from EIA (all sectors combined)
2. Store them in `db/electricity.duckdb`
3. Build `mart.monthly_state_electricity` and `mart.national_monthly_electricity` via SQL
4. Export one JSON per month + `manifest.json` to `docs/data/`
5. Download `docs/data/us-states.geojson` if not present

### 4. Subsequent runs (incremental)

```bash
python -m pipeline.flows.electricity --incremental
```

### 5. Local preview

Open `docs/index.html` via a local server (required for `fetch()` to work):

```bash
python -m http.server 8000 --directory docs
# then open http://localhost:8000
```

## DuckDB schema

```sql
-- Raw layer: monthly readings, all sectors combined
raw.eia_electricity   (period, stateid, state_description, sectorid, price, sales, ...)

-- Mart: monthly price and sales per state
mart.monthly_state_electricity  (month, stateid, state_description, avg_price, total_sales)

-- Mart: national monthly totals (weighted avg price, sum of state sales)
mart.national_monthly_electricity  (month, national_avg_price, national_total_sales)
```

## Data notes

- **Price** is the average retail price in cents/kWh across all sectors (residential, commercial, industrial)
- **Sales** is total retail sales in GWh (million kWh) per state per month
- Coverage: all 50 states, January 2000 to present
- Source series: EIA electricity retail sales, `sectorid=ALL`
