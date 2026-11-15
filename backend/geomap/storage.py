import json
from pathlib import Path
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


DATA = Path(__file__).parent / "data"


def connect():
    return psycopg.connect(row_factory=dict_row, connect_timeout=5)


def initialize():
    objects = json.loads((DATA / "water-objects.json").read_text(encoding="utf-8"))
    with connect() as db, db.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(71054611)")
        cursor.execute(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
        cursor.executemany(
            """
            INSERT INTO geographic_object (id, name, prompt, kind, geometry)
            VALUES (%(id)s, %(name)s, %(prompt)s, %(kind)s, %(geometry)s)
            ON CONFLICT (id) DO UPDATE
            SET (name, prompt, kind, geometry) =
                (excluded.name, excluded.prompt, excluded.kind, excluded.geometry)
            WHERE (geographic_object.name, geographic_object.prompt,
                   geographic_object.kind, geographic_object.geometry)
                  IS DISTINCT FROM (excluded.name, excluded.prompt, excluded.kind, excluded.geometry)
            """,
            [dict(obj, geometry=Jsonb(obj["geometry"])) for obj in objects],
        )
        delete_expired_runs(db)


def list_objects(db, *, include_geometry=False):
    query = (
        "SELECT id, name, prompt, kind, geometry FROM geographic_object ORDER BY id"
        if include_geometry
        else "SELECT id, name, prompt, kind FROM geographic_object ORDER BY id"
    )
    return db.execute(query).fetchall()


def object_geometry(db, object_id: str):
    return db.execute(
        "SELECT geometry FROM geographic_object WHERE id = %s", (object_id,)
    ).fetchone()["geometry"]


def delete_expired_runs(db):
    db.execute("DELETE FROM training_run WHERE expires_at <= now()")


def insert_run(db, run_id: UUID, name: str | None, object_ids: list[str]):
    db.execute(
        "INSERT INTO training_run (id, name, object_ids) VALUES (%s, %s, %s)",
        (run_id, name, object_ids),
    )


def lock_run(db, run_id: UUID):
    return db.execute(
        """
        SELECT name, object_ids, task_number, answers
        FROM training_run
        WHERE id = %s AND expires_at > now()
        FOR UPDATE
        """,
        (run_id,),
    ).fetchone()


def save_answer(db, run_id: UUID, answer: dict):
    db.execute(
        "UPDATE training_run SET answers = answers || %s WHERE id = %s",
        (Jsonb([answer]), run_id),
    )


def set_task_number(db, run_id: UUID, number: int):
    db.execute("UPDATE training_run SET task_number = %s WHERE id = %s", (number, run_id))


def delete_run(db, run_id: UUID):
    db.execute("DELETE FROM training_run WHERE id = %s", (run_id,))
