CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, serial INTEGER NOT NULL, snapshot TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cases_owner_id ON cases(owner, id);

CREATE TABLE IF NOT EXISTS fairbill_schema_migrations (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS case_snapshots_v1 (
    case_id TEXT NOT NULL REFERENCES cases(id),
    serial INTEGER NOT NULL,
    reason TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    PRIMARY KEY(case_id, serial)
);

CREATE TABLE IF NOT EXISTS request_replays_v1 (
    owner TEXT NOT NULL,
    key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (owner, key)
);

CREATE INDEX IF NOT EXISTS request_replays_v1_age ON request_replays_v1(created_at);

INSERT OR IGNORE INTO fairbill_schema_migrations(version) VALUES (1);

CREATE TABLE IF NOT EXISTS report_links (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    serial INTEGER NOT NULL CHECK (serial >= 0),
    token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
    creation_key TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE(case_id, creation_key),
    FOREIGN KEY(case_id, serial) REFERENCES case_snapshots_v1(case_id, serial) ON DELETE CASCADE
);

INSERT OR IGNORE INTO fairbill_schema_migrations(version) VALUES (2);
