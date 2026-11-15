import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import shape
from sqlalchemy import create_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from geomap import countries, storage, training
from geomap.api import app


@pytest.fixture(scope="module")
def client():
    if os.getenv("GEOMAP_TEST_DB") != "1":
        pytest.skip("Укажите параметры тестового PostgreSQL и GEOMAP_TEST_DB=1")

    schema = f"test_{uuid4().hex}"
    test_engine = create_engine(
        storage.engine.url, connect_args={"options": f"-c search_path={schema}"}
    )
    with storage.connect() as db:
        db.execute(CreateSchema(schema))
    try:
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(storage, "engine", test_engine)
            with TestClient(app) as client:
                yield client
    finally:
        test_engine.dispose()
        with storage.connect() as db:
            db.execute(DropSchema(schema, cascade=True))


@pytest.fixture(scope="module")
def catalog(client):
    response = client.get("/api/lists/russia")
    assert response.status_code == 200
    return response.json()


def point(longitude, latitude):
    return {"longitude": longitude, "latitude": latitude}


def test_catalog_provides_water_areas_and_reference_layers(client, catalog):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert catalog["id"] == "russia"
    assert len(catalog["objects"]) == 11
    assert {obj["kind"] for obj in catalog["objects"]} == {"lake", "river"}
    assert {obj["region"] for obj in catalog["objects"]} == {"Европа", "Азия"}
    assert all(shape(obj["geometry"]).is_valid for obj in catalog["objects"])

    response = client.get(catalog["map"]["reference_lines"])
    assert response.headers["content-type"] == "application/geo+json"
    assert response.json()["type"] == "FeatureCollection"
    assert {f["properties"]["kind"] for f in response.json()["features"]} == {
        "coastline",
        "boundary",
    }


def test_world_catalog_serves_country_borders_and_capitals_without_database():
    response = TestClient(app).get("/api/lists/world")
    assert response.status_code == 200
    catalog = response.json()
    assert catalog["id"] == "world"
    assert catalog["training_count"] == 12
    objects = {obj["id"]: obj for obj in catalog["objects"]}
    assert len(objects) > 190
    assert objects["country:rus"]["capitals"] == ["Москва"]
    brazil = objects["country:bra"]["profile"]
    assert brazil["region"] == "Южная Америка"
    assert brazil["population"] > 200_000_000 and brazil["population_year"] == 2019
    assert len(brazil["flag"]) == 2
    assert objects["country:ata"]["profile"]["flag"] is None
    assert all(obj["profile"]["region"] for obj in objects.values())
    assert all(shape(obj["geometry"]).is_valid for obj in objects.values())


def test_world_training_grades_country_areas_and_returns_only_countries(client, monkeypatch):
    monkeypatch.setattr(
        training.random, "shuffle",
        lambda objects: objects.sort(key=lambda obj: obj["id"] != "country:rus"),
    )
    started = client.post("/api/lists/world/training", json={"name": "Анна"})
    assert started.status_code == 201
    run = started.json()
    assert run["task"] == {"number": 1, "total": 12, "prompt": "Покажи на карте «Россия»"}
    path = f"/api/training/{run['id']}"

    answered = []
    for number in range(1, 13):
        answer_url = f"{path}/tasks/{number}/answer"
        coordinates = point(-171.7, 65.8) if number == 1 else point(-26, 0)
        response = client.post(answer_url, json=coordinates)
        assert response.status_code == 200
        feedback = response.json()
        answered.append(feedback["object_id"])
        assert feedback["correct"] is (number == 1)
        if number == 1:
            assert client.post(answer_url, json=point(-26, 0)).json() == feedback
            assert feedback["distance_km"] is None
        else:
            assert feedback["distance_km"] > 100
        following = client.post(f"{path}/tasks/{number}/next")
        assert following.status_code == 200

    assert set(answered) == {f"country:{code}" for code in countries.TRAINING_IDS}
    assert following.json()["result"] == {
        "name": "Анна", "correct": 1, "total": 12,
        "missed": [
            {"id": object_id, "name": countries.COUNTRIES[object_id]["name"]}
            for object_id in answered[1:]
        ],
    }


@pytest.mark.parametrize(
    ("map_id", "category", "count"),
    [
        ("russia", "antarctica", 3), ("world", "antarctica", 1),
        ("world", "world", 20), ("world", "eurasia", 3),
    ],
)
def test_category_and_count_limit_training_to_distinct_catalog_objects(client, map_id, category, count):
    route = f"/api/lists/{map_id}"
    catalog = client.get(route, params={"category": category}).json()
    assert {option["id"] for option in catalog["categories"]} >= {
        "world", "eurasia", "europe", "asia", "africa", "north-america", "south-america",
        "oceania", "antarctica",
    }
    objects = {obj["id"]: obj for obj in catalog["objects"]}
    assert catalog["available_count"] == len(objects)
    if category == "eurasia":
        europe = set(countries.COUNTRIES_BY_CONTINENT["europe"])
        asia = set(countries.COUNTRIES_BY_CONTINENT["asia"])
        assert objects.keys() == europe | asia
    assert client.post(
        f"{route}/training", json={"category": category, "count": len(objects) + 1},
    ).status_code == 422

    started = client.post(f"{route}/training", json={"category": category, "count": count})
    assert started.status_code == 201
    run = started.json()
    assert run["task"]["total"] == count
    path = f"/api/training/{run['id']}"
    ids = set()
    task = run["task"]
    for number in range(1, count + 1):
        obj = next(obj for obj in objects.values() if f'«{obj["name"]}»' in task["prompt"])
        inside = shape(obj["geometry"]).representative_point()
        feedback = client.post(f"{path}/tasks/{number}/answer", json=point(inside.x, inside.y)).json()
        assert feedback["correct"] is True
        assert feedback["object_id"] == obj["id"] and obj["id"] not in ids
        ids.add(obj["id"])
        following = client.post(f"{path}/tasks/{number}/next").json()
        task = following.get("task")
    assert following["result"]["total"] == following["result"]["correct"] == count


def test_full_training_scores_only_first_answers_and_waits_for_next(client, catalog):
    started = client.post("/api/lists/russia/training", json={"name": " Анна "})
    assert started.status_code == 201
    run = started.json()
    path = f"/api/training/{run['id']}"
    assert client.post(f"{path}/tasks/1/next").status_code == 409
    assert client.post(f"{path}/tasks/2/answer", json=point(0, 0)).status_code == 409

    tasks = []
    task = run["task"]
    areas = {obj["id"]: shape(obj["geometry"]) for obj in catalog["objects"]}
    assert task["total"] == len(areas)
    # Determine the object from the prompt sent to the pupil.
    with storage.connect() as db:
        prompt_ids = {row["prompt"]: row["id"] for row in storage.list_objects(db)}

    for number in range(1, task["total"] + 1):
        assert task["number"] == number
        object_id = prompt_ids[task["prompt"]]
        tasks.append(object_id)
        inside = point(*areas[object_id].representative_point().coords[0])
        answer_url = f"{path}/tasks/{number}/answer"
        submitted = client.post(answer_url, json=point(0, 0) if number == 1 else inside)
        assert submitted.status_code == 200
        feedback = submitted.json()
        assert feedback["object_id"] == object_id
        assert feedback["correct"] is (number != 1)
        if number == 1:
            assert client.post(answer_url, json=inside).json() == feedback

        next_url = f"{path}/tasks/{number}/next"
        following = client.post(next_url)
        assert following.status_code == 200
        assert client.post(next_url).json() == following.json()
        task = following.json().get("task")

    assert set(tasks) == set(areas) and len(set(tasks)) == len(tasks)
    missed_name = next(obj["name"] for obj in catalog["objects"] if obj["id"] == tasks[0])
    assert following.json() == {
        "result": {
            "name": "Анна",
            "correct": len(areas) - 1,
            "total": len(areas),
            "missed": [{"id": tasks[0], "name": missed_name}],
        }
    }
    repeat = client.post("/api/lists/russia/training")
    assert repeat.status_code == 201
    assert repeat.json()["id"] != run["id"]
    repeat_path = f"/api/training/{repeat.json()['id']}"
    assert client.delete(repeat_path).status_code == 204
    assert client.post(f"{repeat_path}/tasks/1/answer", json=point(0, 0)).status_code == 404


def test_http_grading_handles_shores_misses_and_distance_format(client, catalog, monkeypatch):
    monkeypatch.setattr(
        training.random, "shuffle",
        lambda objects: objects.sort(key=lambda obj: obj["id"] != "ladoga"),
    )
    ladoga = next(obj for obj in catalog["objects"] if obj["id"] == "ladoga")
    shoreline = max(shape(ladoga["geometry"]).exterior.coords, key=lambda coordinates: coordinates[1])
    longitude, latitude = shoreline

    cases = [
        (point(31.5, 60.8), True, None, None),
        (point(*shoreline), True, None, None),
        (point(longitude, latitude + 0.0005), False, 0.1, "Менее 0,1 км"),
        (point(longitude, latitude + 0.0123), False, 1.4, "1,4 км"),
        (point(35.65, 61.55), False, None, None),  # Lake Onega
    ]
    for answer, correct, km, label in cases:
        started = client.post("/api/lists/russia/training").json()
        response = client.post(f"/api/training/{started['id']}/tasks/1/answer", json=answer)
        assert response.status_code == 200
        feedback = response.json()
        assert feedback["correct"] is correct
        if km is not None or correct:
            assert feedback["distance_km"] == km
            assert feedback["distance_label"] == label
        else:
            assert feedback["distance_km"] > 100


@pytest.mark.parametrize(
    ("object_id", "coordinates"),
    [
        ("khanka", [(132.20, 45.27), (132.45, 44.93)]),
        ("peipus", [(27.25, 58.65), (27.69, 58.67)]),
        ("pskov", [(27.615, 57.98), (28.05, 57.98)]),
        ("neva", [(31.028, 59.950), (30.962, 59.857), (30.280, 59.933)]),
    ],
)
def test_http_grading_covers_both_sides_of_border_lakes_and_the_neva(
    client, monkeypatch, object_id, coordinates
):
    monkeypatch.setattr(
        training.random, "shuffle",
        lambda objects: objects.sort(key=lambda obj: obj["id"] != object_id),
    )
    for longitude, latitude in coordinates:
        run = client.post("/api/lists/russia/training").json()
        response = client.post(
            f"/api/training/{run['id']}/tasks/1/answer", json=point(longitude, latitude)
        )
        assert response.status_code == 200
        assert response.json()["correct"] is True


def test_simultaneous_answers_return_the_same_first_feedback(client):
    started = client.post("/api/lists/russia/training").json()
    url = f"/api/training/{started['id']}/tasks/1/answer"
    with ThreadPoolExecutor(max_workers=2) as threads:
        responses = list(
            threads.map(lambda pos: client.post(url, json=pos), [point(0, 0), point(31.5, 60.8)])
        )
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()


def test_invalid_request_is_rejected_before_accessing_database():
    client = TestClient(app)
    url = f"/api/training/{uuid4()}/tasks/1/answer"
    assert client.post(url, json=point(181, 0)).status_code == 422
    assert client.post(url, json=point("30", 60)).status_code == 422
    response = client.post(
        url, content='{"longitude": NaN, "latitude": 0}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert client.post("/api/lists/russia/training", json={"name": "\0"}).status_code == 422
    assert client.post("/api/lists/russia/training", json={"count": 0}).status_code == 422
    assert client.post("/api/lists/world/training", json={"count": 1.5}).status_code == 422
    assert client.post("/api/lists/world/training", json={"category": "russia"}).status_code == 422
