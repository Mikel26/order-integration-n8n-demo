FROM postgres:17.6-alpine
COPY init.sh /docker-entrypoint-initdb.d/01-demo.sh
RUN chmod 0644 /docker-entrypoint-initdb.d/01-demo.sh
