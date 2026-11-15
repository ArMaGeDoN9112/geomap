CREATE TABLE IF NOT EXISTS geographic_object (
    id text PRIMARY KEY,
    name text NOT NULL,
    prompt text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('lake', 'river')),
    geometry jsonb NOT NULL CHECK (
        geometry ? 'type' AND geometry->>'type' IN ('Polygon', 'MultiPolygon')
    )
);

CREATE TABLE IF NOT EXISTS training_run (
    id uuid PRIMARY KEY,
    name text,
    object_ids text[] NOT NULL CHECK (cardinality(object_ids) BETWEEN 10 AND 15),
    task_number integer NOT NULL DEFAULT 1,
    answers jsonb NOT NULL DEFAULT '[]'::jsonb,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    CHECK (task_number BETWEEN 1 AND cardinality(object_ids) + 1),
    CHECK (
        jsonb_array_length(answers) BETWEEN task_number - 1 AND task_number
        AND jsonb_array_length(answers) <= cardinality(object_ids)
    )
);

CREATE INDEX IF NOT EXISTS training_run_expires_at_idx ON training_run (expires_at);
