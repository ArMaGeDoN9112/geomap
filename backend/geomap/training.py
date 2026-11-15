import random
from uuid import UUID, uuid4

from . import countries, regions, storage
from .grading import grade


class RunNotFound(Exception):
    pass


class TaskConflict(Exception):
    pass


class InvalidTraining(Exception):
    pass


def task(objects: list[dict], number: int) -> dict:
    obj = objects[number - 1]
    return {"number": number, "total": len(objects), "prompt": obj["prompt"]}


def start(
    name: str | None, *, political: bool = False, category: regions.PhysicalCategory | None = None,
    count: int | None = None,
) -> dict:
    run_id = uuid4()
    with storage.connect() as db:
        if political:
            if category is None and count is None:
                ids = [f"country:{code}" for code in countries.TRAINING_IDS]
            else:
                ids = [country["id"] for country in countries.in_category(category or "world")]
            objects = [countries.training_country(object_id) for object_id in ids]
        else:
            objects = regions.physical_objects(storage.list_objects(db), category or "russia")
        if count is None:
            count = len(objects) if not political and category in (None, "russia") else min(12, len(objects))
        if not 1 <= count <= len(objects):
            raise InvalidTraining(f"Выбери количество заданий от 1 до {len(objects)}")
        random.shuffle(objects)
        objects = objects[:count]
        storage.delete_expired_runs(db)
        storage.insert_run(db, run_id, name, [obj["id"] for obj in objects])
    return {"id": run_id, "task": task(objects, 1)}


def answer(run_id: UUID, number: int, longitude: float, latitude: float) -> dict:
    with storage.connect() as db:
        run = storage.lock_run(db, run_id)
        if run is None:
            raise RunNotFound
        if number <= len(run["answers"]):
            return run["answers"][number - 1]
        if number != run["task_number"] or number > len(run["object_ids"]):
            raise TaskConflict("Сейчас нельзя ответить на это задание")

        object_id = run["object_ids"][number - 1]
        obj = countries.COUNTRIES.get(object_id) or regions.WORLD_WATERS.get(object_id)
        geometry = obj["geometry"] if obj else storage.object_geometry(db, object_id)
        feedback = {
            "number": number,
            "object_id": object_id,
            "longitude": longitude,
            "latitude": latitude,
            **grade(geometry, longitude, latitude),
        }
        storage.save_answer(db, run_id, feedback)
        return feedback


def advance(run_id: UUID, number: int) -> dict:
    with storage.connect() as db:
        run = storage.lock_run(db, run_id)
        if run is None:
            raise RunNotFound
        current = run["task_number"]
        if number > current or number > len(run["answers"]):
            raise TaskConflict("Сначала ответь на текущее задание")

        if number == current:
            current += 1
            storage.set_task_number(db, run_id, current)

        object_ids = run["object_ids"]
        if object_ids[0].startswith("country:"):
            objects = [countries.training_country(object_id) for object_id in object_ids]
        else:
            catalog = {obj["id"]: obj for obj in storage.list_objects(db)} | regions.WORLD_WATERS
            objects = [catalog[object_id] for object_id in object_ids]
        if current <= len(objects):
            return {"task": task(objects, current)}

        missed = [
            {"id": obj["id"], "name": obj["name"]}
            for obj, feedback in zip(objects, run["answers"], strict=True)
            if not feedback["correct"]
        ]
        return {
            "result": {
                "name": run["name"],
                "correct": len(objects) - len(missed),
                "total": len(objects),
                "missed": missed,
            }
        }
