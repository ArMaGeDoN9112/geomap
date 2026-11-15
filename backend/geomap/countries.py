import json
from pathlib import Path

COUNTRIES = {
    country["id"]: country
    for country in json.loads(
        (Path(__file__).parent / "data" / "countries.json").read_text(encoding="utf-8")
    )
}
TRAINING_IDS = (
    "aus", "arg", "bra", "gbr", "deu", "egy", "ind", "can", "chn", "rus", "usa", "zaf",
)


def training_country(object_id: str) -> dict:
    country = COUNTRIES[object_id]
    return {"id": object_id, "name": country["name"], "prompt": f"Покажи на карте «{country['name']}»"}
