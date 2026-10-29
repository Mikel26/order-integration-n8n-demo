CREATE TABLE visitors (
 id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, current_session_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE demo_sessions (
 id uuid PRIMARY KEY, visitor_id uuid NOT NULL REFERENCES visitors(id),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSING','EXPIRED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 closed_at timestamptz, purge_after timestamptz
);
CREATE INDEX sessions_expiry ON demo_sessions(status,expires_at);
CREATE INDEX sessions_visitor ON demo_sessions(visitor_id);
CREATE TABLE products (sku text PRIMARY KEY, name text NOT NULL, initial_stock integer NOT NULL CHECK(initial_stock>=0));
INSERT INTO products VALUES ('DEMO-001','Teclado de ejemplo',5),('DEMO-002','Mouse de ejemplo',3),('DEMO-003','Audífonos de ejemplo',2);
CREATE TABLE session_stock (
 session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
 sku text NOT NULL REFERENCES products(sku), available integer NOT NULL CHECK(available>=0),
 PRIMARY KEY(session_id,sku)
);
CREATE TABLE operations (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
 idempotency_key uuid NOT NULL, client_order_id varchar(64) NOT NULL, payload_hash text NOT NULL, request_json jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('ACCEPTED','PROCESSING','RETRY_WAIT','SUCCEEDED','REJECTED','DUPLICATE','FAILED_TECHNICAL')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3), attempt_token uuid,
 execution_id text, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deadline_at timestamptz NOT NULL, result_json jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(session_id,idempotency_key), UNIQUE(session_id,id)
);
CREATE INDEX operations_pending ON operations(next_attempt_at) WHERE status IN ('ACCEPTED','PROCESSING','RETRY_WAIT');
CREATE INDEX operations_session_list ON operations(session_id,created_at DESC,id);
CREATE TABLE operation_events (
 operation_id uuid NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
 sequence integer NOT NULL, status text NOT NULL, code text, at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(operation_id,sequence)
);
CREATE TABLE execution_attempts (
 execution_id text PRIMARY KEY, operation_id uuid NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
 attempt_token uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX execution_operation ON execution_attempts(operation_id);
CREATE TABLE orders (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
 client_order_id varchar(64) NOT NULL, operation_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(session_id,client_order_id), UNIQUE(session_id,id),
 FOREIGN KEY(session_id,operation_id) REFERENCES operations(session_id,id)
);
CREATE INDEX orders_session_list ON orders(session_id,created_at DESC,id);
CREATE TABLE order_items (
 session_id uuid NOT NULL, order_id uuid NOT NULL, sku text NOT NULL REFERENCES products(sku),
 quantity integer NOT NULL CHECK(quantity>0), PRIMARY KEY(order_id,sku),
 FOREIGN KEY(session_id,order_id) REFERENCES orders(session_id,id) ON DELETE CASCADE
);
CREATE INDEX order_items_session ON order_items(session_id);
CREATE TABLE business_receipts (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
 client_order_id varchar(64) NOT NULL, payload_hash text NOT NULL, original_operation_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('SUCCEEDED','REJECTED')), code text NOT NULL,
 order_id uuid, details_json jsonb NOT NULL DEFAULT '[]', UNIQUE(session_id,client_order_id),
 FOREIGN KEY(session_id,original_operation_id) REFERENCES operations(session_id,id),
 FOREIGN KEY(session_id,order_id) REFERENCES orders(session_id,id)
);
CREATE TABLE erp_receipts (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL UNIQUE, outcome text NOT NULL CHECK(outcome IN ('SUCCEEDED','REJECTED','DUPLICATE')),
 code text NOT NULL, order_id uuid, original_operation_id uuid, original_status text,
 details_json jsonb NOT NULL DEFAULT '[]',
 FOREIGN KEY(session_id,operation_id) REFERENCES operations(session_id,id),
 FOREIGN KEY(session_id,order_id) REFERENCES orders(session_id,id),
 FOREIGN KEY(session_id,original_operation_id) REFERENCES operations(session_id,id)
);
CREATE INDEX receipts_session ON erp_receipts(session_id);
CREATE TABLE rate_buckets (key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL);
