import json
from pathlib import Path
from typing import Literal


WorldCategory = Literal[
    "world", "eurasia", "europe", "asia", "africa", "north-america", "south-america", "oceania",
    "antarctica",
]
PhysicalCategory = Literal[WorldCategory, "russia"]

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

WORLD_WATERS = {
    obj["id"]: obj
    for obj in json.loads(
        (Path(__file__).parent / "data" / "world-water-objects.json").read_text(encoding="utf-8")
    )
}
ASIAN_RUSSIAN_WATERS = {"baikal", "khanka", "taymyr"}


def included_continents(category: str):
    return ("europe", "asia") if category == "eurasia" else (category,)


def physical_objects(russian_objects, category: PhysicalCategory):
    if category == "russia":
        return list(russian_objects)

    continents = included_continents(category)
    return [
        obj for obj in russian_objects
        if category == "world" or (
            "asia" if obj["id"] in ASIAN_RUSSIAN_WATERS else "europe"
        ) in continents
    ] + [
        obj for obj in WORLD_WATERS.values()
        if category == "world" or obj["continent"] in continents
    ]


def categories(*, political: bool):
    return [
        {"id": key, "label": label}
        for key, (label, _) in REGIONS.items()
        if not political or key != "russia"
    ]
