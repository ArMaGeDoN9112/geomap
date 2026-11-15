import json
from pathlib import Path
from uuid import UUID

from sqlalchemy import (
    CheckConstraint, Column, DateTime, Index, Integer, MetaData, Table, Text, Uuid,
    create_engine, func, or_, select, text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, insert


DATA = Path(__file__).parent / "data"
engine = create_engine(
    "postgresql+psycopg://", connect_args={"connect_timeout": 5}, pool_pre_ping=True,
)
metadata = MetaData()

geographic_object = Table(
    "geographic_object", metadata,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("prompt", Text, nullable=False),
    Column("kind", Text, nullable=False),
    Column("geometry", JSONB, nullable=False),
    CheckConstraint("kind IN ('lake', 'river')"),
    CheckConstraint("geometry ? 'type' AND geometry->>'type' IN ('Polygon', 'MultiPolygon')"),
)

training_run = Table(
    "training_run", metadata,
    Column("id", Uuid, primary_key=True),
    Column("name", Text),
    Column("object_ids", ARRAY(Text), nullable=False),
    Column("task_number", Integer, nullable=False, server_default="1"),
    Column("answers", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column(
        "expires_at", DateTime(timezone=True), nullable=False,
        server_default=text("now() + interval '24 hours'"),
    ),
    Index("training_run_expires_at_idx", "expires_at"),
    CheckConstraint("cardinality(object_ids) BETWEEN 10 AND 15"),
    CheckConstraint("task_number BETWEEN 1 AND cardinality(object_ids) + 1"),
    CheckConstraint(
        "jsonb_array_length(answers) BETWEEN task_number - 1 AND task_number "
        "AND jsonb_array_length(answers) <= cardinality(object_ids)"
    ),
)


def connect():
    return engine.begin()


def initialize():
    objects = json.loads((DATA / "water-objects.json").read_text(encoding="utf-8"))
    seed = insert(geographic_object)
    updated = {field: seed.excluded[field] for field in ("name", "prompt", "kind", "geometry")}
    with connect() as db:
        db.execute(select(func.pg_advisory_xact_lock(71054611)))
        metadata.create_all(db)
        db.execute(
            seed.on_conflict_do_update(
                index_elements=[geographic_object.c.id],
                set_=updated,
                where=or_(
                    *(geographic_object.c[field].is_distinct_from(value)
                      for field, value in updated.items())
                ),
            ),
            objects,
        )
        delete_expired_runs(db)


def check_connection():
    with connect() as db:
        db.execute(select(1))


def list_objects(db, *, include_geometry=False):
    obj = geographic_object.c
    query = select(geographic_object) if include_geometry else select(
        obj.id, obj.name, obj.prompt, obj.kind
    )
    return db.execute(query.order_by(obj.id)).mappings().all()


def object_geometry(db, object_id: str):
    return db.execute(
        select(geographic_object.c.geometry).where(geographic_object.c.id == object_id)
    ).scalar_one()


def delete_expired_runs(db):
    db.execute(training_run.delete().where(training_run.c.expires_at <= func.now()))


def insert_run(db, run_id: UUID, name: str | None, object_ids: list[str]):
    db.execute(training_run.insert().values(id=run_id, name=name, object_ids=object_ids))


def lock_run(db, run_id: UUID):
    run = training_run.c
    query = (
        select(run.name, run.object_ids, run.task_number, run.answers)
        .where(run.id == run_id, run.expires_at > func.now())
        .with_for_update()
    )
    return db.execute(query).mappings().one_or_none()


def save_answer(db, run_id: UUID, answer: dict):
    db.execute(
        training_run.update()
        .where(training_run.c.id == run_id)
        .values(answers=training_run.c.answers.concat([answer]))
    )


def set_task_number(db, run_id: UUID, number: int):
    db.execute(training_run.update().where(training_run.c.id == run_id).values(task_number=number))


def delete_run(db, run_id: UUID):
    db.execute(training_run.delete().where(training_run.c.id == run_id))
