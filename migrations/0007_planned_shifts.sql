-- Dated primaries for one shift on one date. They replace the weekly recurring plan on that date only.
-- people_json is a snapshot: [{"id":"...","name":"..."}]. An empty list means no one is planned.
CREATE TABLE planned_shifts (
 service_date TEXT NOT NULL CHECK(service_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 shift TEXT NOT NULL CHECK(shift IN ('am','pm')),
 people_json TEXT NOT NULL CHECK(json_valid(people_json)),
 updated_at TEXT NOT NULL,
 updated_by TEXT,
 PRIMARY KEY(service_date, shift)
);
