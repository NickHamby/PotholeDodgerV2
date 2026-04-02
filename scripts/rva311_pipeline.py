import requests
import sys
import os
import json
from datetime import datetime, timedelta

# --- Config ---
API_URL = "https://webapi.citizenservices.org/rvaone/api/v1/requests"
SERVICE_IDS = [
    "new_cs221019222643",  # Potholes on Road
    "new_cs180228161314",  # Raise and Lower Sewer or Manhole
    "new_cs180221194130",  # Repair Bridge
    "new_cs221019163752",  # Repair Road
]
ACTIVE_STATUSES = ["1", "2", "3", "4"]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "..", "web", "data", "hazards.json")

# --- Step 1: Fetch ---
def fetch():
    now = datetime.utcnow()
    two_years_ago = now - timedelta(days=730)

    base_payload = {
        "start": int(two_years_ago.timestamp() * 1000),
        "end": int(now.timestamp() * 1000),
        "services": SERVICE_IDS,
        "status": ACTIVE_STATUSES,
        "dynamicalStringFilters": [
            {"filterName": "Neighborhoods", "filterValues": []},
            {"filterName": "Council Districts", "filterValues": []},
        ],
        "orderBy": "requestDate",
        "orderDirection": "desc",
    }

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    all_records = []
    page = 1

    while True:
        payload = {**base_payload, "pageNumber": page}
        print(f"Fetching page {page}...")
        response = requests.post(API_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json().get("data", [])

        if not data:
            print(f"Page {page} returned empty — pagination complete.")
            break

        all_records.extend(data)
        print(f"Page {page}: {len(data)} records (running total: {len(all_records)})")
        page += 1

    return all_records

# --- Step 2: Parse ---
def parse(records):
    parsed = []
    for r in records:
        lat = r.get("latitude") or r.get("lat")
        lng = r.get("longitude") or r.get("lng") or r.get("lon")
        if lat is None or lng is None:
            continue
        parsed.append({
            "id":          r.get("id"),
            "serviceName": r.get("serviceName"),
            "latitude":    float(lat),
            "longitude":   float(lng),
            "location":    r.get("location"),
            "status":      r.get("status"),
            "requestDate": r.get("requestDate"),
            "description": r.get("description"),
        })

    print(f"Parsed {len(parsed)} records with valid coordinates.")
    return parsed

# --- Step 3: Deduplicate ---
def deduplicate(records):
    seen = set()
    deduped = []
    for r in records:
        key = (round(r["latitude"], 5), round(r["longitude"], 5))
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    print(f"Deduplicated to {len(deduped)} records.")
    return deduped

# --- Main ---
def main():
    records = fetch()
    parsed = parse(records)

    if not parsed:
        print("ERROR: No valid records returned from RVA311 API. Failing loudly.")
        sys.exit(1)

    deduped = deduplicate(parsed)

    if not deduped:
        print("ERROR: No records remaining after deduplication. Failing loudly.")
        sys.exit(1)

    output_path = os.path.normpath(OUTPUT_PATH)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(deduped, f, indent=2)

    print(f"Wrote {len(deduped)} records to {output_path}")

if __name__ == "__main__":
    main()