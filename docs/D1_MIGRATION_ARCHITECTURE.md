# Cloudflare D1 Architecture & Edge Database Migration Proposal

## 1. Executive Summary
This document specifies the target architecture for migrating the Overtime Tracker from synchronous Google Apps Script (GAS) / Google Sheets storage to an edge-native **Cloudflare D1 (Serverless SQLite)** architecture with asynchronous dual-sync reconciliation.

### Current Google Sheets Latency Profile vs. Cloudflare D1
| Operation | Current GAS (Cold/Warm) | Cloudflare D1 Target | Improvement Factor |
|---|---|---|---|
| Employee/PIN Auth Verification | 1.8s - 15.0s | 5ms - 15ms | **100x - 1000x faster** |
| Get Dashboard Data | 1.9s - 4.2s | 8ms - 20ms | **100x - 200x faster** |
| Shift Start / Clock-in | 2.5s - 5.5s | 12ms - 30ms | **80x - 180x faster** |
| Shift End / Overtime Calc | 2.8s - 6.0s | 15ms - 35ms | **80x - 170x faster** |
| Attendance Ledger Query | 2.2s - 4.5s | 10ms - 25ms | **100x - 200x faster** |

---

## 2. D1 Relational Schema (SQLite 3)

### 2.1 Table: `employees`
Stores employee profiles, authentication credentials, and job site assignments.

```sql
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY NOT NULL,                -- e.g. 'EMP001'
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Admin', 'Labourer')),
    phone TEXT,
    site_id TEXT,                                -- Foreign key to job_sites.id
    pin_hash TEXT NOT NULL,                      -- PBKDF2-SHA256 hex digest
    pin_salt TEXT NOT NULL,                      -- 16-byte random salt hex
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive', 'Suspended')),
    version INTEGER NOT NULL DEFAULT 1,          -- Optimistic locking
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES job_sites(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_site ON employees(site_id);
```

### 2.2 Table: `job_sites`
Stores geofenced physical work sites.

```sql
CREATE TABLE IF NOT EXISTS job_sites (
    id TEXT PRIMARY KEY NOT NULL,                -- e.g. 'SITE001'
    name TEXT NOT NULL,
    address TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    geofence_radius REAL NOT NULL DEFAULT 100.0, -- In meters
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive', 'Archived')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_job_sites_status ON job_sites(status);
```

### 2.3 Table: `shifts`
Stores immutable shift records, timestamps, GPS telemetry, and R2 selfie proofs.

```sql
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY NOT NULL,                -- e.g. 'SHIFT_1729209600000_123'
    employee_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    start_time TEXT NOT NULL,                    -- ISO-8601 UTC
    end_time TEXT,                               -- ISO-8601 UTC (NULL while Active)
    start_latitude REAL NOT NULL,
    start_longitude REAL NOT NULL,
    start_accuracy REAL NOT NULL,
    end_latitude REAL,
    end_longitude REAL,
    end_accuracy REAL,
    break_minutes INTEGER NOT NULL DEFAULT 60,
    regular_hours REAL DEFAULT 0.0,
    overtime_hours REAL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Completed', 'Cancelled')),
    start_photo_key TEXT,                        -- Cloudflare R2 object key
    start_photo_captured_at TEXT,
    start_photo_status TEXT DEFAULT 'Verified',
    end_photo_key TEXT,                          -- Cloudflare R2 object key
    end_photo_captured_at TEXT,
    end_photo_status TEXT DEFAULT 'Verified',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (site_id) REFERENCES job_sites(id)
);

CREATE INDEX IF NOT EXISTS idx_shifts_active ON shifts(employee_id, status) WHERE status = 'Active';
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(start_time);
CREATE INDEX IF NOT EXISTS idx_shifts_site_date ON shifts(site_id, start_time);
```

### 2.4 Table: `overtime_records`
Stores pending, approved, and rejected overtime authorization records.

```sql
CREATE TABLE IF NOT EXISTS overtime_records (
    id TEXT PRIMARY KEY NOT NULL,                -- e.g. 'OT_1729209600000_456'
    shift_id TEXT NOT NULL UNIQUE,
    employee_id TEXT NOT NULL,
    date TEXT NOT NULL,                          -- YYYY-MM-DD
    regular_hours REAL NOT NULL DEFAULT 8.0,
    overtime_hours REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Rejected')),
    reviewed_by TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (shift_id) REFERENCES shifts(id),
    FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_overtime_status ON overtime_records(status);
CREATE INDEX IF NOT EXISTS idx_overtime_employee ON overtime_records(employee_id);
```

### 2.5 Table: `audit_logs`
Cryptographic-grade tamper-evident activity ledger.

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY NOT NULL,
    employee_id TEXT,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS', 'FAILURE', 'DENIED')),
    performed_by TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, timestamp DESC);
```

### 2.6 Table: `d1_sync_outbox` (Reliable Dual-Sync Outbox)
Guarantees zero-data-loss asynchronous push to Google Sheets.

```sql
CREATE TABLE IF NOT EXISTS d1_sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,                   -- 'SHIFT', 'EMPLOYEE', 'SITE', 'OVERTIME'
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('INSERT', 'UPDATE', 'DELETE')),
    payload JSON NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON d1_sync_outbox(status, created_at) WHERE status IN ('PENDING', 'FAILED');
```

---

## 3. Transaction Boundaries & Invariants

1. **Shift Clock-In Atomic Transaction:**
   ```sql
   BEGIN TRANSACTION;
   -- 1. Ensure no existing active shift exists for employee
   SELECT id FROM shifts WHERE employee_id = ? AND status = 'Active';
   -- 2. Insert new active shift with verified GPS and R2 photo key
   INSERT INTO shifts (...) VALUES (...);
   -- 3. Queue dual-sync outbox entry
   INSERT INTO d1_sync_outbox (entity_type, entity_id, operation, payload) VALUES ('SHIFT', ?, 'INSERT', ?);
   -- 4. Audit log event
   INSERT INTO audit_logs (...) VALUES (...);
   COMMIT;
   ```

2. **Shift Clock-Out & Overtime Transaction:**
   ```sql
   BEGIN TRANSACTION;
   -- 1. Update active shift to Completed with end GPS and photo
   UPDATE shifts SET status = 'Completed', end_time = ?, overtime_hours = ? WHERE id = ? AND status = 'Active';
   -- 2. If overtime_hours > 0, insert overtime_records
   INSERT INTO overtime_records (...) VALUES (...);
   -- 3. Queue dual-sync outbox entries
   INSERT INTO d1_sync_outbox (...) VALUES (...);
   COMMIT;
   ```

---

## 4. Dual-Sync Strategy & Reconciliation

```
[Client (Web/PWA)]
       |
       v (sub-20ms)
[Cloudflare Edge Worker]
       |
       +---> [Cloudflare D1 SQLite Database] (Immediate commit)
       |
       +---> [Cloudflare Queues / Cron Trigger] (Async Outbox Processor)
                   |
                   v (Batch non-blocking)
             [Google Apps Script] ---> [Google Sheets Primary Ledger]
```

### 4.1 Sync Guarantees
- **At-least-once delivery:** The outbox processor uses exponential backoff (`retry_count`) with a maximum of 5 attempts.
- **Idempotency:** Google Apps Script checks `ID` primary keys before appending/updating, ensuring re-deliveries do not create duplicate rows.
- **Failover / Fallback:** If D1 experiences a localized outage, the worker automatically routes writes through the existing synchronous GAS endpoint.

---

## 5. Migration Execution Plan
1. **Phase A (Zero-Downtime Data Ingestion):**
   - Execute one-time batch ETL script from Google Sheets into Cloudflare D1.
   - Run verification suite confirming 100% row and checksum match.
2. **Phase B (Shadow Dual-Writing):**
   - Cloudflare Worker writes to D1 and simultaneously writes to Google Sheets via outbox.
   - Read traffic remains on Sheets cache for 48 hours to verify absolute consistency.
3. **Phase C (Cutover):**
   - Switch primary reads to Cloudflare D1.
   - Retain Google Sheets as read-only business intelligence and real-time backup.
