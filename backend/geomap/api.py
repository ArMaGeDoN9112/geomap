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

from . import countries, storage, training


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


class GeographicObject(BaseModel):
    id: str
    name: str
    kind: Literal["lake", "river"]
    geometry: dict


class Attribution(BaseModel):
    text: str
    url: str


class MapConfig(BaseModel):
    bounds: tuple[float, float, float, float]
    attributions: list[Attribution]


class PhysicalMap(MapConfig):
    hillshade_tiles: str
    hillshade_max_zoom: int
    reference_lines: str


class ObjectList(BaseModel):
    id: Literal["russia"]
    title: str
    map: PhysicalMap
    objects: list[GeographicObject]


class Country(BaseModel):
    id: str
    name: str
    capitals: list[str]
    color: int
    geometry: dict


class CountryList(BaseModel):
    id: Literal["world"]
    title: str
    map: MapConfig
    objects: list[Country]
    training_count: int


@app.exception_handler(training.RunNotFound)
async def missing_training(_request, _error):
    return JSONResponse(status_code=404, content={"detail": "Прохождение недоступно"})


@app.exception_handler(training.TaskConflict)
async def task_conflict(_request, error):
    return JSONResponse(status_code=409, content={"detail": str(error)})


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
def object_list():
    with storage.connect() as db:
        objects = storage.list_objects(db, include_geometry=True)
    return {
        "id": LIST_ID,
        "title": "Водоёмы России",
        "map": {
            "bounds": [19, 41, 191, 82],
            "hillshade_tiles": (
                "https://services.arcgisonline.com/arcgis/rest/services/Elevation/"
                "World_Hillshade/MapServer/tile/{z}/{y}/{x}"
            ),
            "hillshade_max_zoom": 13,
            "reference_lines": "/api/maps/russia/reference-lines.geojson",
            "attributions": [
                {
                    "text": "© OpenStreetMap contributors (ODbL)",
                    "url": "https://www.openstreetmap.org/copyright",
                },
                {"text": "Made with Natural Earth", "url": "https://www.naturalearthdata.com/"},
                {
                    "text": (
                        "Esri, Vantor, Airbus DS, USGS, NGA, NASA, CGIAR, N Robinson, NCEAS, "
                        "NLS, OS, NMA, Geodatastyrelsen, Rijkswaterstaat, GSA, Geoland, "
                        "FEMA, Intermap, and the GIS user community"
                    ),
                    "url": "https://goto.arcgisonline.com/maps/Elevation/World_Hillshade",
                },
            ],
        },
        "objects": objects,
    }


@app.post("/api/lists/russia/training", response_model=StartedTraining, status_code=201)
def start_training(body: StartTraining | None = None):
    return training.start((body.name or None) if body else None)


@app.get("/api/lists/world", response_model=CountryList)
def country_list():
    return {
        "id": "world",
        "title": "Страны мира",
        "map": {
            "bounds": [-180, -58, 180, 83.65],
            "attributions": [
                {"text": "Made with Natural Earth", "url": "https://www.naturalearthdata.com/"},
            ],
        },
        "objects": list(countries.COUNTRIES.values()),
        "training_count": len(countries.TRAINING_IDS),
    }


@app.post("/api/lists/world/training", response_model=StartedTraining, status_code=201)
def start_country_training(body: StartTraining | None = None):
    return training.start((body.name or None) if body else None, political=True)


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
