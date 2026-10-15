-- =============================================================================
-- Mizan point-in-time (PIT) instrument snapshot - PROPOSED D1/SQLite DDL
-- STATE: DESIGN (not IMPLEMENTED). NOT in drizzle/, NOT applied to any database.
-- The test suite loads this file into an in-memory node:sqlite database only to check that it parses and that the
-- constraints/triggers behave as documented.
--
-- Principles
--  * The ticker is never a key of a security. instrument_id is an internal, immutable integer that is never reused
--    (AUTOINCREMENT). A symbol is only a *listing interval* attached to an instrument.
--  * Append-only: rows are inserted, not updated or deleted. Documented exceptions are the one-time NULL -> value
--    transitions of instrument_listing.valid_to/closed_run_id and identity_conflict resolution columns.
--  * Every run carries provenance and a content hash chained to the previous run (tamper evidence, not tamper proof:
--    SQLite has no SHA-256, so the hashes are computed and checked by code - see identity.cjs - and an external anchor of
--    the chain head is required to detect truncation or a fully recomputed chain).
--  * Dates are 'YYYY-MM-DD' TEXT (exchange-local session date for bars, UTC snapshot date for snapshots);
--    timestamps are ISO-8601 UTC TEXT ending in 'Z'.
--  * Names avoid collisions with existing tables (aziz_*, market_observations, research_*, screener_*, forecast_*).
--  * D1 specifics (statement/batch size, row limits, storage cap) are UNKNOWN here and not assumed.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- snapshot_run: one row per collector batch (universe fetch or a chunk of bars). Provenance + hash chain.
-- Inserted FIRST in the same db.batch() as its child rows (child rows reference it); the code computes
-- content_hash from the rows BEFORE inserting. Rows are only accepted into the latest run (triggers below).
-- -----------------------------------------------------------------------------
CREATE TABLE snapshot_run (
  run_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_seq         INTEGER NOT NULL UNIQUE CHECK (chain_seq >= 1),          -- 1,2,3... gap-free (trigger enforces +1)
  kind              TEXT    NOT NULL CHECK (kind IN ('universe','bars')),
  snapshot_date     TEXT    NOT NULL CHECK (snapshot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  market            TEXT    NOT NULL CHECK (market IN ('sa','us')),
  status            TEXT    NOT NULL CHECK (status IN ('complete','partial')), -- partial = fewer rows than expected_count
  expected_count    INTEGER CHECK (expected_count IS NULL OR expected_count >= 0),
  row_count         INTEGER NOT NULL CHECK (row_count >= 0),
  -- provenance
  source            TEXT    NOT NULL CHECK (length(source) > 0),            -- e.g. 'yahoo-chart', 'nasdaqtrader-directory', 'saudiexchange-directory'
  source_endpoint   TEXT    NOT NULL CHECK (length(source_endpoint) > 0),   -- endpoint TEMPLATE without secrets/query tokens
  retrieved_at      TEXT    NOT NULL CHECK (retrieved_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  http_status_summary TEXT  NOT NULL CHECK (json_valid(http_status_summary)), -- e.g. {"200":412,"404":3,"timeout":2}
  fetch_failures_json TEXT  NOT NULL DEFAULT '[]' CHECK (json_valid(fetch_failures_json)), -- bounded list of [instrument_id|symbol, status]
  collector_version TEXT    NOT NULL CHECK (length(collector_version) > 0),
  -- integrity
  content_hash      TEXT    NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  prev_hash         TEXT    NOT NULL CHECK (length(prev_hash)    = 64 AND prev_hash    NOT GLOB '*[^0-9a-f]*'),
  chain_hash        TEXT    NOT NULL CHECK (length(chain_hash)   = 64 AND chain_hash   NOT GLOB '*[^0-9a-f]*'),
  created_at        TEXT    NOT NULL
);
-- At most one COMPLETE universe run per (date, market): the universe of a date is a single fact.
CREATE UNIQUE INDEX snapshot_run_one_complete_universe
  ON snapshot_run (snapshot_date, market) WHERE kind = 'universe' AND status = 'complete';
CREATE INDEX snapshot_run_date ON snapshot_run (snapshot_date, kind, market);

-- Chain linkage enforced by the database: seq = previous + 1, prev_hash = previous chain_hash (genesis = 64 zeros).
-- (The database cannot recompute chain_hash; verifyChain() in identity.cjs does.)
CREATE TRIGGER snapshot_run_chain_guard BEFORE INSERT ON snapshot_run
WHEN NEW.chain_seq <> COALESCE((SELECT MAX(chain_seq) FROM snapshot_run), 0) + 1
  OR NEW.prev_hash <> COALESCE((SELECT chain_hash FROM snapshot_run WHERE chain_seq = (SELECT MAX(chain_seq) FROM snapshot_run)),
                               '0000000000000000000000000000000000000000000000000000000000000000')
BEGIN SELECT RAISE(ABORT, 'snapshot_run: chain_seq/prev_hash must extend the current head'); END;
CREATE TRIGGER snapshot_run_no_update BEFORE UPDATE ON snapshot_run BEGIN SELECT RAISE(ABORT, 'snapshot_run is append-only'); END;
CREATE TRIGGER snapshot_run_no_delete BEFORE DELETE ON snapshot_run BEGIN SELECT RAISE(ABORT, 'snapshot_run is append-only'); END;

-- -----------------------------------------------------------------------------
-- instrument: the identity itself. Immutable. Name/exchange/currency as OBSERVED each day live in snapshot_universe;
-- symbols live in instrument_listing; strong identifiers in instrument_identifier; status in instrument_status_event.
-- -----------------------------------------------------------------------------
CREATE TABLE instrument (
  instrument_id           INTEGER PRIMARY KEY AUTOINCREMENT,                  -- never reused, never reassigned
  market                  TEXT    NOT NULL CHECK (market IN ('sa','us')),
  first_seen              TEXT    NOT NULL CHECK (first_seen GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), -- first snapshot_date WE observed it (PIT), not its IPO date
  provider_first_row_date TEXT    CHECK (provider_first_row_date IS NULL OR provider_first_row_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_reason          TEXT    NOT NULL CHECK (created_reason IN ('new','identity_conflict_split','symbol_reuse_after_close','other_exchange_listing','possible_symbol_change')),
  created_run_id          INTEGER NOT NULL REFERENCES snapshot_run (run_id)
);
CREATE INDEX instrument_market ON instrument (market);
CREATE TRIGGER instrument_no_update BEFORE UPDATE ON instrument BEGIN SELECT RAISE(ABORT, 'instrument is immutable'); END;
CREATE TRIGGER instrument_no_delete BEFORE DELETE ON instrument BEGIN SELECT RAISE(ABORT, 'instrument is never deleted'); END;

-- -----------------------------------------------------------------------------
-- instrument_listing: ticker-assignment intervals. Key of a listing is (symbol, exchange) over [valid_from, valid_to].
-- valid_to NULL = still open; it is the LAST date the instrument held the symbol (inclusive).
-- -----------------------------------------------------------------------------
CREATE TABLE instrument_listing (
  listing_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id  INTEGER NOT NULL REFERENCES instrument (instrument_id),
  symbol         TEXT    NOT NULL CHECK (length(symbol) > 0),
  exchange       TEXT    NOT NULL CHECK (length(exchange) > 0),               -- canonical (see identity.cjs exchangeAliases, PROVISIONAL)
  valid_from     TEXT    NOT NULL CHECK (valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to       TEXT    CHECK (valid_to IS NULL OR (valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND valid_to >= valid_from)),
  opened_run_id  INTEGER NOT NULL REFERENCES snapshot_run (run_id),
  closed_run_id  INTEGER REFERENCES snapshot_run (run_id),
  CHECK ((valid_to IS NULL) = (closed_run_id IS NULL)),
  UNIQUE (instrument_id, symbol, exchange, valid_from)
);
-- A (symbol, exchange) pair can be OPEN for only one instrument at a time. This is the structural defence against ticker reuse.
CREATE UNIQUE INDEX instrument_listing_one_open ON instrument_listing (symbol, exchange) WHERE valid_to IS NULL;
CREATE INDEX instrument_listing_instrument ON instrument_listing (instrument_id);
CREATE INDEX instrument_listing_symbol_dates ON instrument_listing (symbol, exchange, valid_from, valid_to);
-- Only exception to immutability: close an open listing once.
CREATE TRIGGER instrument_listing_update_guard BEFORE UPDATE ON instrument_listing
WHEN NOT (OLD.valid_to IS NULL AND NEW.valid_to IS NOT NULL AND NEW.closed_run_id IS NOT NULL
          AND NEW.listing_id = OLD.listing_id AND NEW.instrument_id = OLD.instrument_id AND NEW.symbol = OLD.symbol
          AND NEW.exchange = OLD.exchange AND NEW.valid_from = OLD.valid_from AND NEW.opened_run_id = OLD.opened_run_id)
BEGIN SELECT RAISE(ABORT, 'instrument_listing: only a one-time close (valid_to, closed_run_id) is allowed'); END;
CREATE TRIGGER instrument_listing_no_delete BEFORE DELETE ON instrument_listing BEGIN SELECT RAISE(ABORT, 'instrument_listing is append-only'); END;

-- -----------------------------------------------------------------------------
-- instrument_identifier: strong identifiers when available (Saudi directory in the repo carries ISIN for 438/439 rows;
-- the in-repo US directory carries none - US identifiers would need another source: UNKNOWN).
-- Not UNIQUE across instruments: a CIK covers several share classes, and identifiers can legitimately change.
-- -----------------------------------------------------------------------------
CREATE TABLE instrument_identifier (
  instrument_id  INTEGER NOT NULL REFERENCES instrument (instrument_id),
  id_type        TEXT    NOT NULL CHECK (id_type IN ('isin','cusip','figi','sec_cik')),
  id_value       TEXT    NOT NULL CHECK (length(id_value) > 0 AND id_value = upper(trim(id_value))),
  source         TEXT    NOT NULL CHECK (length(source) > 0),
  observed_run_id INTEGER NOT NULL REFERENCES snapshot_run (run_id),         -- run in which it was first observed on this instrument
  PRIMARY KEY (instrument_id, id_type, id_value)
) WITHOUT ROWID;
CREATE INDEX instrument_identifier_lookup ON instrument_identifier (id_type, id_value);
CREATE TRIGGER instrument_identifier_no_update BEFORE UPDATE ON instrument_identifier BEGIN SELECT RAISE(ABORT, 'instrument_identifier is append-only'); END;
CREATE TRIGGER instrument_identifier_no_delete BEFORE DELETE ON instrument_identifier BEGIN SELECT RAISE(ABORT, 'instrument_identifier is append-only'); END;

-- -----------------------------------------------------------------------------
-- instrument_status_event: status history (append-only). Current status = latest event (view below).
-- 'candidate_delisted' is set automatically by absence; leaving it requires kind='confirmation' with actor + evidence.
-- 'delisted' and 'ended_identity_conflict' are terminal for that instrument_id.
-- -----------------------------------------------------------------------------
CREATE TABLE instrument_status_event (
  event_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id  INTEGER NOT NULL REFERENCES instrument (instrument_id),
  status         TEXT    NOT NULL CHECK (status IN ('active','candidate_delisted','delisted','ended_identity_conflict')),
  effective_date TEXT    NOT NULL CHECK (effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind           TEXT    NOT NULL CHECK (kind IN ('auto','confirmation')),
  run_id         INTEGER REFERENCES snapshot_run (run_id),                    -- NULL for manual confirmations
  actor          TEXT,                                                        -- required for confirmations
  evidence       TEXT,                                                        -- required for confirmations
  recorded_at    TEXT    NOT NULL,
  CHECK (kind = 'auto' OR (actor IS NOT NULL AND length(actor) > 0 AND evidence IS NOT NULL AND length(evidence) > 0)),
  CHECK (kind = 'confirmation' OR status IN ('active','candidate_delisted','ended_identity_conflict'))  -- 'delisted' only via confirmation
);
CREATE INDEX instrument_status_event_latest ON instrument_status_event (instrument_id, event_id);
CREATE TRIGGER instrument_status_event_transition_guard BEFORE INSERT ON instrument_status_event
WHEN (SELECT status FROM instrument_status_event WHERE instrument_id = NEW.instrument_id ORDER BY event_id DESC LIMIT 1) IN ('delisted','ended_identity_conflict')
  OR (NEW.status = 'active' AND NEW.kind = 'auto'
      AND EXISTS (SELECT 1 FROM instrument_status_event WHERE instrument_id = NEW.instrument_id))
BEGIN SELECT RAISE(ABORT, 'instrument_status_event: terminal status, or return to active without a confirmation record'); END;
CREATE TRIGGER instrument_status_event_no_update BEFORE UPDATE ON instrument_status_event BEGIN SELECT RAISE(ABORT, 'instrument_status_event is append-only'); END;
CREATE TRIGGER instrument_status_event_no_delete BEFORE DELETE ON instrument_status_event BEGIN SELECT RAISE(ABORT, 'instrument_status_event is append-only'); END;

CREATE VIEW instrument_current_status AS
  SELECT e.instrument_id, e.status, e.effective_date, e.kind
  FROM instrument_status_event e
  WHERE e.event_id = (SELECT MAX(event_id) FROM instrument_status_event x WHERE x.instrument_id = e.instrument_id);

-- -----------------------------------------------------------------------------
-- snapshot_universe: membership by date. One row per instrument present in the source directory on that date,
-- with the name/exchange/currency/symbol AS OBSERVED that day (the evidence the identity detector compares).
-- This is the table that makes a survivorship-free universe possible FROM DAY 0 ONWARD (not before).
-- -----------------------------------------------------------------------------
CREATE TABLE snapshot_universe (
  run_id          INTEGER NOT NULL REFERENCES snapshot_run (run_id),
  instrument_id   INTEGER NOT NULL REFERENCES instrument (instrument_id),
  snapshot_date   TEXT    NOT NULL CHECK (snapshot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- = run.snapshot_date (denormalized for indexing)
  symbol          TEXT    NOT NULL CHECK (length(symbol) > 0),
  exchange        TEXT    NOT NULL CHECK (length(exchange) > 0),
  name            TEXT    NOT NULL CHECK (length(name) > 0),
  currency        TEXT    NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  instrument_type TEXT    NOT NULL CHECK (instrument_type IN ('EQUITY','ETF','OTHER')),
  directory_flags TEXT    CHECK (directory_flags IS NULL OR json_valid(directory_flags)),   -- raw directory attributes (e.g. test-issue marks), if any
  PRIMARY KEY (run_id, instrument_id)
) WITHOUT ROWID;
CREATE INDEX snapshot_universe_date ON snapshot_universe (snapshot_date, instrument_id);
CREATE INDEX snapshot_universe_instrument ON snapshot_universe (instrument_id, snapshot_date);
CREATE TRIGGER snapshot_universe_latest_run_only BEFORE INSERT ON snapshot_universe
WHEN NEW.run_id <> (SELECT MAX(run_id) FROM snapshot_run)
  OR NEW.snapshot_date <> (SELECT snapshot_date FROM snapshot_run WHERE run_id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'snapshot_universe: rows only into the latest run, with that run''s snapshot_date'); END;
CREATE TRIGGER snapshot_universe_no_update BEFORE UPDATE ON snapshot_universe BEGIN SELECT RAISE(ABORT, 'snapshot_universe is append-only'); END;
CREATE TRIGGER snapshot_universe_no_delete BEFORE DELETE ON snapshot_universe BEGIN SELECT RAISE(ABORT, 'snapshot_universe is append-only'); END;

-- -----------------------------------------------------------------------------
-- snapshot_bar: daily bars per instrument_id as delivered. A restated bar (same instrument + session_date, different values)
-- is stored as a NEW row in a LATER run; the earlier row stays ("what we knew when"). known_at = run.retrieved_at.
-- Prices are stored AS DELIVERED; whether provider `close` is split/dividend adjusted is UNVERIFIED in this repo, so it is
-- flagged rather than assumed. adj_close, when present, is the provider's adjusted series.
-- -----------------------------------------------------------------------------
CREATE TABLE snapshot_bar (
  run_id          INTEGER NOT NULL REFERENCES snapshot_run (run_id),
  instrument_id   INTEGER NOT NULL REFERENCES instrument (instrument_id),
  session_date    TEXT    NOT NULL CHECK (session_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  open            REAL    CHECK (open  IS NULL OR open  > 0),
  high            REAL    CHECK (high  IS NULL OR high  > 0),
  low             REAL    CHECK (low   IS NULL OR low   > 0),
  close           REAL    NOT NULL CHECK (close > 0),
  close_basis     TEXT    NOT NULL DEFAULT 'provider_unverified'
                  CHECK (close_basis IN ('provider_unverified','raw_unadjusted','split_adjusted','split_dividend_adjusted')),
  adj_close       REAL    CHECK (adj_close IS NULL OR adj_close > 0),
  adj_basis       TEXT    NOT NULL DEFAULT 'none' CHECK (adj_basis IN ('none','provider_split_dividend_adjusted')),
  volume          REAL    CHECK (volume IS NULL OR volume >= 0),
  dividend_amount REAL    CHECK (dividend_amount IS NULL OR dividend_amount >= 0),          -- corporate-action fields: NULL = not reported
  split_numerator   REAL  CHECK (split_numerator   IS NULL OR split_numerator   > 0),
  split_denominator REAL  CHECK (split_denominator IS NULL OR split_denominator > 0),
  is_backfill     INTEGER NOT NULL CHECK (is_backfill IN (0,1)),   -- 1 = session_date predates first_seen: history received at first sight, NOT point-in-time
  quality_flags   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(quality_flags)),  -- e.g. ["ohlc_inconsistent","volume_missing"]; stored as delivered, flagged not dropped
  PRIMARY KEY (run_id, instrument_id, session_date),
  CHECK ((split_numerator IS NULL) = (split_denominator IS NULL))
) WITHOUT ROWID;
CREATE INDEX snapshot_bar_instrument_session ON snapshot_bar (instrument_id, session_date, run_id);
CREATE TRIGGER snapshot_bar_latest_run_only BEFORE INSERT ON snapshot_bar
WHEN NEW.run_id <> (SELECT MAX(run_id) FROM snapshot_run)
  OR (SELECT kind FROM snapshot_run WHERE run_id = NEW.run_id) <> 'bars'
BEGIN SELECT RAISE(ABORT, 'snapshot_bar: rows only into the latest run, and only a bars run'); END;
CREATE TRIGGER snapshot_bar_no_update BEFORE UPDATE ON snapshot_bar BEGIN SELECT RAISE(ABORT, 'snapshot_bar is append-only'); END;
CREATE TRIGGER snapshot_bar_no_delete BEFORE DELETE ON snapshot_bar BEGIN SELECT RAISE(ABORT, 'snapshot_bar is append-only'); END;

-- -----------------------------------------------------------------------------
-- identity_conflict: quarantine. Every conflict, review flag, symbol reuse, or unconfirmed possible link is recorded here.
-- NOTHING is merged automatically. Resolution (columns below) may be written ONCE, by a human, with actor and note.
-- A 'confirmed_succession' resolution is the only source of predecessor/successor links used by the research loader.
-- -----------------------------------------------------------------------------
CREATE TABLE identity_conflict (
  conflict_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_run_id    INTEGER NOT NULL REFERENCES snapshot_run (run_id),
  snapshot_date      TEXT    NOT NULL CHECK (snapshot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  symbol             TEXT    NOT NULL,
  exchange           TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('hard_split','review_flag','symbol_reuse_after_close','possible_symbol_change','other_exchange_listing')),
  old_instrument_id  INTEGER NOT NULL REFERENCES instrument (instrument_id),
  new_instrument_id  INTEGER REFERENCES instrument (instrument_id),    -- NULL for review_flag (same instrument kept)
  reasons_json       TEXT    NOT NULL CHECK (json_valid(reasons_json) AND json_array_length(reasons_json) > 0),
  evidence_json      TEXT    NOT NULL CHECK (json_valid(evidence_json)),
  status             TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution         TEXT    CHECK (resolution IS NULL OR resolution IN ('confirmed_distinct','confirmed_succession','dismissed_false_alarm')),
  resolved_by        TEXT,
  resolved_at        TEXT,
  resolution_note    TEXT,
  CHECK (new_instrument_id IS NULL OR new_instrument_id <> old_instrument_id),   -- never "merged": old and new ids always differ
  CHECK ((kind = 'review_flag') = (new_instrument_id IS NULL)),
  CHECK ((status = 'open') = (resolution IS NULL)),
  CHECK (resolution IS NULL OR (resolved_by IS NOT NULL AND length(resolved_by) > 0 AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL AND length(resolution_note) > 0)),
  CHECK (resolution <> 'confirmed_succession' OR new_instrument_id IS NOT NULL)
);
CREATE INDEX identity_conflict_open ON identity_conflict (status, snapshot_date);
CREATE INDEX identity_conflict_old ON identity_conflict (old_instrument_id);
CREATE INDEX identity_conflict_new ON identity_conflict (new_instrument_id);
-- Only exception: a single open -> resolved transition; the evidence is frozen.
CREATE TRIGGER identity_conflict_update_guard BEFORE UPDATE ON identity_conflict
WHEN NOT (OLD.status = 'open' AND NEW.status = 'resolved'
          AND NEW.conflict_id = OLD.conflict_id AND NEW.detected_run_id = OLD.detected_run_id AND NEW.snapshot_date = OLD.snapshot_date
          AND NEW.symbol = OLD.symbol AND NEW.exchange = OLD.exchange AND NEW.kind = OLD.kind
          AND NEW.old_instrument_id = OLD.old_instrument_id AND NEW.new_instrument_id IS OLD.new_instrument_id
          AND NEW.reasons_json = OLD.reasons_json AND NEW.evidence_json = OLD.evidence_json)
BEGIN SELECT RAISE(ABORT, 'identity_conflict: only a one-time open -> resolved transition is allowed'); END;
CREATE TRIGGER identity_conflict_no_delete BEFORE DELETE ON identity_conflict BEGIN SELECT RAISE(ABORT, 'identity_conflict is never deleted'); END;

-- Confirmed predecessor/successor links (the only ones a research loader may follow).
CREATE VIEW instrument_confirmed_link AS
  SELECT old_instrument_id AS predecessor_id, new_instrument_id AS successor_id, conflict_id, resolved_at, resolved_by
  FROM identity_conflict WHERE resolution = 'confirmed_succession';
