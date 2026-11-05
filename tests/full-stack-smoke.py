"""Exercise the real HTTPS proxy and Keycloak against synthetic CI-only data."""

import html
import http.cookiejar
import json
import pathlib
import socket
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.private' / 'full-stack'
HOURS = 'https://hours.test'
AUTH = 'https://auth.test'
COMPOSE = ['docker', 'compose', '--project-name', 'hoursbooster', '--env-file',
           str(PRIVATE / 'compose.env'), '-f', str(ROOT / 'deploy/full-stack/compose.yml')]


class LoginForm(HTMLParser):
    action = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'form' and attrs.get('id') == 'kc-form-login':
            self.action = html.unescape(attrs['action'])


def main():
    state = json.loads((PRIVATE / 'state.json').read_text())
    assert state['test'] is True, 'Run this smoke test only against a synthetic test deployment'
    ctx = ssl.create_default_context(cafile=str(PRIVATE / 'pki/ca.pem'))
    cookies = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookies),
        urllib.request.HTTPSHandler(context=ctx))

    def request(url, data=None, content_type='application/json'):
        parts = urllib.parse.urlsplit(url)
        headers = {'Origin': parts.scheme + '://' + parts.netloc, 'Content-Type': content_type}
        try:
            return opener.open(urllib.request.Request(url, data=data, headers=headers), timeout=15)
        except urllib.error.HTTPError as error:
            try:
                code = json.loads(error.read(2048)).get('code', 'none')
            except (ValueError, AttributeError):
                code = 'none'
            raise AssertionError(f'{parts.path}: HTTP {error.code}, error code {code}') from None

    for attempt in range(90):
        try:
            with request(AUTH + '/realms/hours/.well-known/openid-configuration') as response:
                discovery = json.load(response)
            with request(HOURS + '/login') as response:
                assert response.status == 200
                assert 'max-age=' in response.headers['Strict-Transport-Security']
            break
        except (OSError, urllib.error.URLError, AssertionError):
            if attempt == 89:
                raise RuntimeError('HTTPS services did not become ready') from None
            time.sleep(4)
    assert discovery['issuer'] == AUTH + '/realms/hours'
    assert all(value.startswith('https://') for key, value in discovery.items()
               if key.endswith('_endpoint') and isinstance(value, str))

    # An ordinary untrusted TLS client must reject the CI-only private CA.
    try:
        urllib.request.urlopen(HOURS + '/login', timeout=10)
        raise AssertionError('Untrusted certificate was accepted')
    except urllib.error.URLError as error:
        assert isinstance(error.reason, ssl.SSLCertVerificationError)

    # No plaintext or directly exposed application/identity/database ports.
    for port in (8000, 8080, 8443, 5432):
        with socket.socket() as sock:
            sock.settimeout(1)
            assert sock.connect_ex(('127.0.0.1', port)) != 0, f'Unexpected public port {port}'

    with request(HOURS + '/api/auth/sign-in/social', json.dumps({
        'provider': 'keycloak', 'callbackURL': HOURS + '/'
    }).encode()) as response:
        destination = json.load(response)['url']
    assert destination.startswith(AUTH + '/realms/hours/protocol/openid-connect/auth?')
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(destination).query)
    assert query['code_challenge_method'] == ['S256']
    assert query['redirect_uri'] == [HOURS + '/api/auth/callback/keycloak']
    with request(destination) as response:
        form = LoginForm()
        form.feed(response.read().decode())
    assert form.action and form.action.startswith(AUTH + '/')
    credentials = urllib.parse.urlencode({
        'username': 'operator', 'password': state['initial_password'], 'credentialId': ''
    }).encode()
    with request(form.action, credentials, 'application/x-www-form-urlencoded') as response:
        assert response.url.rstrip('/') == HOURS
        assert response.status == 200
    with request(HOURS + '/api/auth/get-session') as response:
        session = json.load(response)
    assert session['user']['id'] and session['session']['userId'] == session['user']['id']
    auth_cookies = [cookie for cookie in cookies if 'session_token' in cookie.name]
    assert auth_cookies and all(cookie.secure and cookie.has_nonstandard_attr('HttpOnly')
                                for cookie in auth_cookies)
    database = subprocess.run(COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'postgres',
        '-d', 'postgres', '-Atc', "SELECT bool_and(s.ssl) FROM pg_stat_ssl s JOIN pg_stat_activity a "
        "USING(pid) WHERE a.usename='keycloak' AND a.backend_type='client backend';"],
        check=True, capture_output=True, text=True)
    assert database.stdout.strip() == 't', 'Keycloak database connection must use TLS'
    role = subprocess.run(COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'postgres',
        '-d', 'postgres', '-Atc', "SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles "
        "WHERE rolname='keycloak';"], check=True, capture_output=True, text=True)
    assert role.stdout.strip() == 'f', 'Keycloak must use a restricted database role'
    app_database = subprocess.run(COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'postgres',
        '-d', 'postgres', '-Atc', "SELECT bool_and(s.ssl) FROM pg_stat_ssl s JOIN pg_stat_activity a "
        "USING(pid) WHERE a.usename='hoursbooster' AND a.backend_type='client backend';"],
        check=True, capture_output=True, text=True)
    assert app_database.stdout.strip() == 't', 'HoursBooster must connect to PostgreSQL over TLS'
    isolation = subprocess.run(COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'postgres',
        '-d', 'postgres', '-Atc', "SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) "
        "AND NOT has_database_privilege('hoursbooster','keycloak','CONNECT') "
        "FROM pg_roles WHERE rolname='hoursbooster';"], check=True, capture_output=True, text=True)
    assert isolation.stdout.strip() == 't', 'Application and identity databases must be isolated'
    # A unique-token violation must be observable without exposing the token in DB logs.
    canary = 'fixture-only-session-token-' + uuid.uuid4().hex
    admin_app = COMPOSE + ['exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
        '-U', 'postgres', '-d', 'hoursbooster', '-Atc']
    query = "INSERT INTO session(id,expires_at,token,updated_at,user_id) SELECT '%s',now()+interval '1 day','%s',now(),id FROM public.\"user\" LIMIT 1"
    subprocess.run(admin_app + [query % ('canary-first', canary)], check=True, capture_output=True)
    try:
        duplicate = subprocess.run(admin_app + [query % ('canary-second', canary)], capture_output=True)
        assert duplicate.returncode != 0
        logged = subprocess.run(COMPOSE + ['logs', '--no-color', 'postgres'], check=True, capture_output=True, text=True)
        logs = logged.stdout + logged.stderr
        assert 'duplicate key value violates unique constraint' in logs
        assert canary not in logs, 'PostgreSQL logged a session token'
    finally:
        subprocess.run(admin_app + ["DELETE FROM session WHERE id IN ('canary-first','canary-second')"], check=True, capture_output=True)
    # Verify backup restoration, not merely successful creation of a dump file.
    for database, table in (('hoursbooster', 'public."user"'), ('keycloak', 'public.realm')):
        restore = 'hb_restore_' + uuid.uuid4().hex
        admin = COMPOSE + ['exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atc']
        original = subprocess.run(COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', database,
            '-Atc', 'SELECT count(*) FROM ' + table], check=True, capture_output=True)
        dump = subprocess.run(COMPOSE + ['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-Fc', database], check=True, capture_output=True)
        subprocess.run(admin + ['CREATE DATABASE ' + restore], check=True, capture_output=True)
        try:
            subprocess.run(COMPOSE + ['exec', '-T', 'postgres', 'pg_restore', '-U', 'postgres', '-d', restore],
                input=dump.stdout, check=True, capture_output=True)
            restored = subprocess.run(COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', restore,
                '-Atc', 'SELECT count(*) FROM ' + table], check=True, capture_output=True)
            assert original.stdout == restored.stdout, 'Restored database row count differs'
        finally:
            subprocess.run(admin + ['DROP DATABASE ' + restore], check=True, capture_output=True)
    plaintext = subprocess.run(COMPOSE + ['exec', '-T', '-e', 'PGSSLMODE=disable',
        '-e', 'PGCONNECT_TIMEOUT=3', 'postgres', 'psql', '-h', '127.0.0.1', '-U', 'keycloak',
        '-d', 'keycloak', '-Atc', 'SELECT 1'], capture_output=True, text=True)
    assert plaintext.returncode != 0 and 'no encryption' in plaintext.stderr
    # Starting Steam login requires the correct origin and issues only a Steam URL.
    with request(HOURS + '/api/auth/link/steam', b'{}') as response:
        steam_url = json.load(response)['url']
    assert steam_url.startswith('https://steamcommunity.com/openid/login?')
    try:
        opener.open(urllib.request.Request(HOURS + '/api/auth/link/steam', data=b'{}',
                    headers={'Origin': 'https://attacker.invalid', 'Content-Type': 'application/json'}))
        raise AssertionError('Cross-origin linking accepted')
    except urllib.error.HTTPError as error:
        assert error.code in (400, 403)
    print('Verified HTTPS proxy, real Keycloak OIDC+PKCE, PostgreSQL TLS/role isolation, backup restoration of both databases, Secure session and Steam start.')


if __name__ == '__main__':
    main()
