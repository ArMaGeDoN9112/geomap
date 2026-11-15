import json
from pathlib import Path

from .regions import included_continents

DATA = Path(__file__).parent / "data"
PROFILES = json.loads((DATA / "country-profiles.json").read_text(encoding="utf-8"))
COUNTRIES = {
    country["id"]: {**country, "profile": PROFILES[country["id"]]}
    for country in json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
}
COUNTRIES_BY_CONTINENT = json.loads((DATA / "country-continents.json").read_text(encoding="utf-8"))
TRAINING_IDS = (
    "aus", "arg", "bra", "gbr", "deu", "egy", "ind", "can", "chn", "rus", "usa", "zaf",
)


def training_country(object_id: str) -> dict:
    country = COUNTRIES[object_id]
    return {"id": object_id, "name": country["name"], "prompt": f"Покажи на карте «{country['name']}»"}


def in_category(category: str):
    if category == "world":
        return list(COUNTRIES.values())
    ids = dict.fromkeys(
        object_id for continent in included_continents(category)
        for object_id in COUNTRIES_BY_CONTINENT[continent]
    )
    return [COUNTRIES[object_id] for object_id in ids]
