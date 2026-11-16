import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import FastAPI, Path as PathParam, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy.exc import OperationalError
from starlette.concurrency import run_in_threadpool

from . import countries, regions, storage, training


@asynccontextmanager
async def lifespan(_app):
    await run_in_threadpool(storage.initialize)
    yield


app = FastAPI(title="GeoMap", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST", "DELETE"],
)

LIST_ID = "russia"
TaskNumber = Annotated[int, PathParam(ge=1)]
STUDY_DATA = Path(__file__).parent / "data"


class AnswerPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    longitude: Annotated[float, Field(strict=True, ge=-180, le=180)]
    latitude: Annotated[float, Field(strict=True, ge=-90, le=90)]


class StartTraining(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            max_length=100,
            pattern=r"^[^\x00-\x1f\x7f]*$",
        ),
    ] | None = None
    count: Annotated[int, Field(strict=True, ge=1)] | None = None


class StartPhysicalTraining(StartTraining):
    category: regions.PhysicalCategory | None = None


class StartCountryTraining(StartTraining):
    category: regions.WorldCategory | None = None


class Task(BaseModel):
    number: int
    total: int
    prompt: str


class StartedTraining(BaseModel):
    id: UUID
    task: Task


class Feedback(AnswerPoint):
    number: int
    object_id: str
    correct: bool
    distance_km: float | None
    distance_label: str | None


class MissedObject(BaseModel):
    id: str
    name: str


class Result(BaseModel):
    name: str | None
    correct: int
    total: int
    missed: list[MissedObject]


class NextTask(BaseModel):
    task: Task


class FinishedTraining(BaseModel):
    result: Result


class Summit(BaseModel):
    id: str
    name: str
    elevation: int
    coordinates: tuple[float, float]


class GeographicObject(BaseModel):
    id: str
    name: str
    kind: Literal[
        "lake", "river", "mountain", "summit", "sea", "island", "peninsula", "strait",
        "bay", "plain", "upland", "landmark",
    ]
    region: str
    geometry: dict
    centerline: dict | None = None
    summit: Summit | None = None
    related_peak: str | None = None


class MarineObject(BaseModel):
    id: str
    name: str
    kind: Literal["sea", "ocean"]
    geometry: dict


class Attribution(BaseModel):
    text: str
    url: str


class MapConfig(BaseModel):
    bounds: tuple[float, float, float, float]
    attributions: list[Attribution]
    land: str | None = None
    reference_lines: str | None = None


class PhysicalMap(MapConfig):
    relief: str


class CategoryOption(BaseModel):
    id: regions.PhysicalCategory
    label: str
    group: str | None = None


class Catalog(BaseModel):
    title: str
    categories: list[CategoryOption]
    training_count: int
    available_count: int


class ObjectList(Catalog):
    id: Literal["russia"]
    map: PhysicalMap
    objects: list[GeographicObject]
    marine: list[MarineObject]


class CountryProfile(BaseModel):
    region: str
    flag: tuple[int, int] | None = None
    population: int | None = None
    population_year: int | None = None


class Country(BaseModel):
    id: str
    name: str
    capitals: list[str]
    color: int
    geometry: dict
    profile: CountryProfile


class CountryList(Catalog):
    id: Literal["world"]
    map: MapConfig
    objects: list[Country]


@app.exception_handler(training.RunNotFound)
async def missing_training(_request, _error):
    return JSONResponse(status_code=404, content={"detail": "Прохождение недоступно"})


@app.exception_handler(training.TaskConflict)
async def task_conflict(_request, error):
    return JSONResponse(status_code=409, content={"detail": str(error)})


@app.exception_handler(training.InvalidTraining)
async def invalid_training(_request, error):
    return JSONResponse(status_code=422, content={"detail": str(error)})


@app.exception_handler(OperationalError)
async def database_unavailable(_request, _error):
    return JSONResponse(status_code=503, content={"detail": "База данных временно недоступна"})


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, error):
    errors = [
        {key: item[key] for key in ("loc", "msg", "type")}
        for item in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


@app.get("/api/health")
def health():
    storage.check_connection()
    return {"status": "ok"}


@app.get("/api/maps/russia/reference-lines.geojson", response_class=FileResponse)
def reference_lines():
    return FileResponse(
        STUDY_DATA / "reference-lines.geojson",
        media_type="application/geo+json",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/lists/russia", response_model=ObjectList)
def object_list(category: regions.PhysicalCategory = "russia"):
    with storage.connect() as db:
        russian_objects = storage.list_objects(db, include_geometry=True)
    objects = regions.physical_objects(russian_objects, category)
    nomenclature = regions.NOMENCLATURE_CATEGORIES.get(category)
    russia = category == "russia" or nomenclature is not None
    label, bounds = regions.REGIONS["russia" if russia else category]
    return {
        "id": LIST_ID,
        "title": nomenclature[0] if nomenclature else {
            "russia": "Природа России", "world": "Природа мира",
        }.get(category, label),
        "categories": regions.categories(political=False),
        "training_count": min(12, len(objects)),
        "available_count": len(objects),
        "map": {
            "bounds": bounds,
            "relief": "/physical-relief.webp",
            "reference_lines": (
                "/api/maps/russia/reference-lines.geojson" if russia else "/world-boundaries.geojson"
            ),
            "attributions": [
                {
                    "text": "© OpenStreetMap contributors (ODbL)",
                    "url": "https://www.openstreetmap.org/copyright",
                },
                {"text": "Made with Natural Earth", "url": "https://www.naturalearthdata.com/"},
                *([{
                    "text": "SCAR Antarctic Digital Database (CC BY 4.0)",
                    "url": "https://doi.org/10.5285/6a27ab9e-1258-49b1-bd2c-fcbed310ab45",
                }] if category in ("world", "antarctica") else []),
            ],
        },
        "objects": [{**obj, "region": regions.REGIONS[regions.physical_continent(obj)][0]} for obj in objects],
        "marine": [] if nomenclature else regions.marine_objects(category),
    }


@app.post("/api/lists/russia/training", response_model=StartedTraining, status_code=201)
def start_training(body: StartPhysicalTraining | None = None):
    body = body or StartPhysicalTraining()
    return training.start(body.name or None, category=body.category, count=body.count)


@app.get("/api/lists/world", response_model=CountryList)
def country_list(category: regions.WorldCategory = "world"):
    objects = countries.in_category(category)
    return {
        "id": "world",
        "title": "Страны мира" if category == "world" else "Страны и территории",
        "categories": regions.categories(political=True),
        "training_count": min(12, len(objects)),
        "available_count": len(objects),
        "map": {
            "bounds": regions.REGIONS[category][1],
            "land": "/world-land.geojson" if category != "world" else None,
            "reference_lines": "/world-boundaries.geojson" if category != "world" else None,
            "attributions": [
                {"text": "Made with Natural Earth", "url": "https://www.naturalearthdata.com/"},
                {"text": "Флаги: Flagpedia", "url": "https://flagpedia.net/"},
            ],
        },
        "objects": objects,
    }


@app.post("/api/lists/world/training", response_model=StartedTraining, status_code=201)
def start_country_training(body: StartCountryTraining | None = None):
    body = body or StartCountryTraining()
    return training.start(
        body.name or None, political=True, category=body.category, count=body.count,
    )


@app.post("/api/training/{run_id}/tasks/{number}/answer", response_model=Feedback)
def submit_answer(run_id: UUID, number: TaskNumber, point: AnswerPoint):
    return training.answer(run_id, number, point.longitude, point.latitude)


@app.post("/api/training/{run_id}/tasks/{number}/next", response_model=NextTask | FinishedTraining)
def advance(run_id: UUID, number: TaskNumber):
    return training.advance(run_id, number)


@app.delete("/api/training/{run_id}", status_code=204)
def discard_training(run_id: UUID):
    with storage.connect() as db:
        storage.delete_run(db, run_id)
    return Response(status_code=204)
