#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres --set=demo_password="$DEMO_DB_PASSWORD" --set=n8n_password="$N8N_DB_PASSWORD" <<'SQL'
CREATE ROLE demo LOGIN PASSWORD :'demo_password';
CREATE DATABASE orders_demo OWNER demo;
CREATE DATABASE orders_test OWNER demo;
CREATE ROLE n8n LOGIN PASSWORD :'n8n_password';
CREATE DATABASE n8n OWNER n8n;
SQL
