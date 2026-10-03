PRAGMA foreign_keys = ON;

-- =====================================================
-- Source Snapshots
-- =====================================================

CREATE TABLE source_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    snapshot_time TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    schema_version TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_source_snapshots_time
ON source_snapshots(snapshot_time);

-- =====================================================
-- Source Files
-- =====================================================

CREATE TABLE source_files (
    file_id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    market TEXT NOT NULL,
    dataset_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY(snapshot_id)
    REFERENCES source_snapshots(snapshot_id)
);

CREATE INDEX idx_source_files_symbol
ON source_files(symbol);

CREATE INDEX idx_source_files_snapshot
ON source_files(snapshot_id);

-- =====================================================
-- Forecast History
-- =====================================================

CREATE TABLE forecasts_history (
    forecast_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    model_version TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    prediction_payload TEXT NOT NULL,
    source_snapshot_id TEXT,

    FOREIGN KEY(source_snapshot_id)
    REFERENCES source_snapshots(snapshot_id)
);

CREATE INDEX idx_forecast_symbol
ON forecasts_history(symbol);

CREATE INDEX idx_forecast_issued
ON forecasts_history(issued_at);

-- =====================================================
-- Forecast Evaluations
-- =====================================================

CREATE TABLE forecast_evaluations (
    evaluation_id TEXT PRIMARY KEY,
    forecast_id TEXT NOT NULL,

    reference_price REAL,
    realized_price REAL,

    error_percent REAL,

    direction_correct INTEGER,
    horizon_days INTEGER,

    evaluated_at TEXT,

    FOREIGN KEY(forecast_id)
    REFERENCES forecasts_history(forecast_id)
);

CREATE INDEX idx_eval_forecast
ON forecast_evaluations(forecast_id);

-- =====================================================
-- Backtest Runs
-- =====================================================

CREATE TABLE backtest_runs (
    run_id TEXT PRIMARY KEY,

    model_version TEXT NOT NULL,
    dataset_version TEXT NOT NULL,

    parameters_json TEXT NOT NULL,

    executed_at TEXT NOT NULL
);

CREATE INDEX idx_backtest_model
ON backtest_runs(model_version);

-- =====================================================
-- Backtest Results
-- =====================================================

CREATE TABLE backtest_results (
    result_id TEXT PRIMARY KEY,

    run_id TEXT NOT NULL,

    accuracy REAL,
    precision_score REAL,
    recall_score REAL,
    f1_score REAL,

    sharpe_ratio REAL,
    win_rate REAL,
    max_drawdown REAL,

    FOREIGN KEY(run_id)
    REFERENCES backtest_runs(run_id)
);

CREATE INDEX idx_backtest_result_run
ON backtest_results(run_id);

-- =====================================================
-- Research Datasets
-- =====================================================

CREATE TABLE research_datasets (
    dataset_id TEXT PRIMARY KEY,

    dataset_name TEXT NOT NULL,

    dataset_version TEXT NOT NULL,

    content_hash TEXT NOT NULL,

    created_at TEXT NOT NULL
);

-- =====================================================
-- Future Model Evaluations
-- =====================================================

CREATE TABLE model_evaluations (
    evaluation_id TEXT PRIMARY KEY,

    model_version TEXT NOT NULL,

    dataset_id TEXT NOT NULL,

    score REAL,

    notes_json TEXT,

    created_at TEXT NOT NULL,

    FOREIGN KEY(dataset_id)
    REFERENCES research_datasets(dataset_id)
);

-- =====================================================
-- Transfer Batches
-- =====================================================

CREATE TABLE transfer_batches (
    batch_id TEXT PRIMARY KEY,

    source_table TEXT NOT NULL,

    exported_rows INTEGER NOT NULL,

    imported_rows INTEGER NOT NULL,

    source_hash TEXT NOT NULL,

    destination_hash TEXT NOT NULL,

    transfer_status TEXT NOT NULL,

    created_at TEXT NOT NULL,

    verified_at TEXT
);

CREATE INDEX idx_transfer_status
ON transfer_batches(transfer_status);

-- =====================================================
-- Transfer Receipts
-- =====================================================

CREATE TABLE transfer_receipts (
    receipt_id TEXT PRIMARY KEY,

    batch_id TEXT NOT NULL,

    object_type TEXT NOT NULL,

    object_id TEXT NOT NULL,

    verified INTEGER NOT NULL,

    created_at TEXT NOT NULL,

    FOREIGN KEY(batch_id)
    REFERENCES transfer_batches(batch_id)
);
