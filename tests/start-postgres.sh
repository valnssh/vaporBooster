#!/bin/sh
# Disposable test instance, never a user's PostgreSQL database.
set -eu
cd "$(dirname "$0")/.."
umask 077
directory="$PWD/.private/postgres-test"
name=hoursbooster-postgres-test
mkdir -p "$directory"
if docker container inspect "$name" >/dev/null 2>&1; then
    echo "Test container already exists; stop/remove only $name before rerunning." >&2
    exit 1
fi
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
    -keyout "$directory/key.pem" -out "$directory/ca.pem" -subj /CN=localhost \
    -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
    -addext 'basicConstraints=critical,CA:TRUE' >/dev/null 2>&1
# Synthetic key only; private parent directory remains mode 0700.
chmod 644 "$directory/key.pem" "$directory/ca.pem"
password=$(openssl rand -hex 24)
docker run -d --name "$name" --memory=256m \
    -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=hoursbooster_test \
    --mount "type=bind,src=$directory/key.pem,dst=/run/test-key.pem,readonly" \
    --mount "type=bind,src=$directory/ca.pem,dst=/run/test-ca.pem,readonly" \
    --tmpfs /tls:rw,noexec,nosuid,size=1m \
    --entrypoint /bin/sh \
    postgres:17-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5 \
    -c 'cp /run/test-key.pem /tls/key.pem; chown postgres:postgres /tls/key.pem; chmod 600 /tls/key.pem; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/run/test-ca.pem -c ssl_key_file=/tls/key.pem' >/dev/null
attempt=0
until docker exec "$name" pg_isready -U postgres -d hoursbooster_test >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 45 ]; then echo 'Test PostgreSQL did not become ready' >&2; exit 1; fi
    sleep 1
done
printf "export TEST_DATABASE_URL='postgresql://postgres:%s@127.0.0.1:55432/hoursbooster_test'\nexport TEST_DATABASE_CA_FILE='%s/ca.pem'\n" "$password" "$directory" > "$directory/env"
echo 'PostgreSQL test instance ready. Run: . .private/postgres-test/env'
