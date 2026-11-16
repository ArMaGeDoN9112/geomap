import json
from pathlib import Path
from typing import Literal

from shapely.geometry import box, shape


WorldCategory = Literal[
    "world", "eurasia", "europe", "asia", "africa", "north-america", "south-america", "oceania",
    "antarctica",
]
PhysicalCategory = Literal[
    WorldCategory, "russia", "russia-records", "russia-physical",
    "russia-islands", "russia-peninsulas", "russia-straits", "russia-bays", "russia-seas",
    "russia-lakes", "russia-rivers", "russia-plains", "russia-uplands", "russia-mountains",
]
DATA = Path(__file__).parent / "data"

REGIONS = {
    "world": ("Весь мир", [-180, -83, 180, 83.65]),
    "eurasia": ("Евразия", [-27, -12, 180, 82]),
    "europe": ("Европа", [-27, 32, 66, 82]),
    "asia": ("Азия", [25, -12, 180, 82]),
    "africa": ("Африка", [-27, -38, 59, 39]),
    "north-america": ("Северная Америка", [-180, 5, -11, 84]),
    "south-america": ("Южная Америка", [-85, -57, -25, 14]),
    "oceania": ("Австралия и Океания", [110, -54, 180, 12]),
    "antarctica": ("Антарктида", [-180, -85, 180, -60]),
    "russia": ("Россия", [19, 41, 191, 82]),
}

EXTRA_PHYSICAL = {
    obj["id"]: obj
    for filename in ("world-water-objects.json", "atlas-objects.json")
    for obj in json.loads((DATA / filename).read_text(encoding="utf-8"))
}
MARINE = [
    (obj, shape(obj["geometry"]))
    for obj in json.loads((DATA / "marine-objects.json").read_text(encoding="utf-8"))
]
NOMENCLATURE = json.loads((DATA / "russia-nomenclature.json").read_text(encoding="utf-8"))
NOMENCLATURE_GROUP = "Физическая карта России"
NOMENCLATURE_CATEGORIES = {
    "russia-records": ("Самое-самое в России", NOMENCLATURE["records"]),
    "russia-physical": (
        NOMENCLATURE_GROUP,
        [object_id for section in NOMENCLATURE["sections"] for object_id in section["object_ids"]],
    ),
    **{
        section["id"]: (section["label"], section["object_ids"])
        for section in NOMENCLATURE["sections"]
    },
}
NOMENCLATURE_OBJECTS = {
    obj["id"]: {"prompt": f'Покажи «{obj["name"]}»', **obj}
    for obj in NOMENCLATURE["objects"]
}
ASIAN_SEAS = {"Q33629", "Q7988", "Q163434", "Q159252", "Q44725", "Q41602", "Q27092"}
for obj, _ in MARINE:
    if obj["kind"] == "sea" and obj.get("russia"):
        NOMENCLATURE_OBJECTS[obj["id"]] = {
            **obj, "prompt": f'Покажи «{obj["name"]}»',
            "continent": "asia" if obj["id"].split(":")[1] in ASIAN_SEAS else "europe",
        }

for mountain in list(EXTRA_PHYSICAL.values()):
    if mountain["kind"] == "mountain":
        summit = mountain["summit"]
        EXTRA_PHYSICAL[summit["id"]] = {
            **mountain, "id": summit["id"], "name": summit["name"], "kind": "summit",
            "prompt": f'Покажи горный массив, где находится вершина «{summit["name"]}»',
        }
ASIAN_RUSSIAN_WATERS = {"baikal", "khanka", "taymyr"}
TRAINING_PHYSICAL = EXTRA_PHYSICAL | NOMENCLATURE_OBJECTS


def included_continents(category: str):
    return ("europe", "asia") if category == "eurasia" else (category,)


def physical_continent(obj):
    return obj.get("continent") or ("asia" if obj["id"] in ASIAN_RUSSIAN_WATERS else "europe")


def physical_objects(russian_objects, category: PhysicalCategory):
    if category in NOMENCLATURE_CATEGORIES:
        catalog = {obj["id"]: obj for obj in russian_objects} | TRAINING_PHYSICAL
        return [catalog[object_id] for object_id in NOMENCLATURE_CATEGORIES[category][1]]

    if category == "russia":
        return [*russian_objects, *(obj for obj in EXTRA_PHYSICAL.values() if obj.get("russia"))]

    continents = included_continents(category)
    return [
        obj for obj in [*russian_objects, *EXTRA_PHYSICAL.values()]
        if category == "world" or physical_continent(obj) in continents
    ]


def marine_objects(category: PhysicalCategory):
    if category == "russia":
        return [obj for obj, _ in MARINE if obj.get("russia")]
    viewport = box(*REGIONS[category][1])
    return [obj for obj, area in MARINE if area.intersects(viewport)]


def categories(*, political: bool):
    options = [
        {"id": key, "label": label}
        for key, (label, _) in REGIONS.items()
        if not political or key != "russia"
    ]
    if not political:
        options.extend(
            {"id": key, "label": label, "group": NOMENCLATURE_GROUP}
            if key != "russia-records" else {"id": key, "label": label}
            for key, (label, _) in NOMENCLATURE_CATEGORIES.items()
        )
    return options
