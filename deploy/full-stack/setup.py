#!/usr/bin/env python3
"""Prepare a private, repeatable HTTPS deployment; Python standard library only."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".private" / "full-stack"
CERTS = ROOT / "certs" / "full-stack"
KEYS = {"HOURS_DOMAIN", "AUTH_DOMAIN", "SERVER_IP", "ACME_EMAIL", "STEAM_ALLOWED_IDS", "EDGE_SUBNET"}
OPENSSL = os.environ.get("OPENSSL_BINARY", "openssl")


def read_settings(path):
    result = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key not in KEYS or key in result:
            raise ValueError("Settings must contain unique supported KEY=value lines")
        result[key] = value.strip()
    return result


def validate(settings, test=False, check_dns=True):
    values = dict(settings)
    if set(values) - KEYS or not KEYS - {"EDGE_SUBNET", "SERVER_IP", "ACME_EMAIL"} <= set(values):
        raise ValueError("Fill in all required settings from settings.example.env")
    for name in ("HOURS_DOMAIN", "AUTH_DOMAIN"):
        domain = values[name].lower()
        if not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
            raise ValueError(name + " must be a DNS name, without scheme, port or path")
        if test:
            if not domain.endswith(".test"):
                raise ValueError("--test is restricted to .test domains")
        elif domain.endswith((".test", ".invalid", ".localhost", ".example", ".example.com", ".example.net", ".example.org")):
            raise ValueError(name + " still contains a reserved example domain")
        values[name] = domain
    if values["HOURS_DOMAIN"] == values["AUTH_DOMAIN"]:
        raise ValueError("HOURS_DOMAIN and AUTH_DOMAIN must differ")
    # Legacy SERVER_IP is optional metadata; supplied certificates need no public-IP check.
    if values.get("SERVER_IP"):
        address = ipaddress.ip_address(values["SERVER_IP"])
        if address.version != 4 or address.is_unspecified or address.is_multicast or (address.is_loopback and not test):
            raise ValueError("SERVER_IP must be a unicast IPv4 address; omit it if unused")
        values["SERVER_IP"] = str(address)
    if values.get("ACME_EMAIL"):
        if not re.fullmatch(r"[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}", values["ACME_EMAIL"]):
            raise ValueError("ACME_EMAIL must be an email address when provided")
    ids = values["STEAM_ALLOWED_IDS"].split(",")
    if not 1 <= len(ids) <= 32 or any(not re.fullmatch(r"[0-9]{17}", item) for item in ids) or len(set(ids)) != len(ids):
        raise ValueError("STEAM_ALLOWED_IDS needs 1-32 unique SteamID64 values, separated by commas")
    network = ipaddress.ip_network(values.get("EDGE_SUBNET", "172.28.0.0/24"), strict=True)
    if network.version != 4 or network.prefixlen != 24 or not network.is_private:
        raise ValueError("EDGE_SUBNET must be a private IPv4 /24 subnet")
    values["EDGE_SUBNET"] = str(network)
    return values


def private_write(path, text, mode=0o600):
    if path.is_symlink():
        raise ValueError("Refusing to overwrite a symlink in private deployment state")
    if path.exists():
        path.chmod(0o600)
    path.write_text(text, encoding="utf-8")
    path.chmod(mode)


def openssl(*arguments):
    # Never echo command arguments, keys or OpenSSL diagnostics into installer logs.
    result = subprocess.run([OPENSSL, *map(str, arguments)], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("OpenSSL failed while preparing private TLS files")
    return result.stdout


def leaf(pki, name, sans, uid, renew=False):
    directory = pki / name
    directory.mkdir(exist_ok=True)
    directory.chmod(0o700)
    cert, key = directory / "fullchain.pem", directory / "privkey.pem"
    if renew or not cert.exists() or not key.exists():
        for existing in (cert, key):
            if existing.exists():
                existing.chmod(0o600)
        request, extensions = directory / "request.csr", directory / "extensions.conf"
        private_write(extensions, "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=" + ",".join("DNS:" + host for host in sans) + "\n")
        openssl("req", "-new", "-newkey", "rsa:3072", "-nodes", "-keyout", key, "-out", request, "-subj", "/CN=" + name)
        openssl("x509", "-req", "-in", request, "-CA", pki / "ca.pem", "-CAkey", pki / "ca.key", "-set_serial", str(secrets.randbits(128)), "-days", "397", "-sha256", "-extfile", extensions, "-out", cert)
        request.unlink()
        extensions.unlink()
    openssl("verify", "-CAfile", pki / "ca.pem", "-verify_hostname", sans[0], cert)
    # A short expiry is surfaced before restarting a working deployment.
    openssl("x509", "-checkend", "2592000", "-noout", "-in", cert)
    private_write(directory / "ca.pem", (pki / "ca.pem").read_text(encoding="utf-8"), 0o444)
    directory.chmod(0o500)
    cert.chmod(0o444)
    key.chmod(0o400)
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        os.chown(directory, uid, uid)
        os.chown(key, uid, uid)


def prepare(settings, private=PRIVATE, test=False, renew=False, certs=None):
    certs = Path(certs) if certs is not None else (private / "certs" if test else CERTS)
    """Called by unit tests with a synthetic private directory; no network or Docker."""
    private.mkdir(parents=True, exist_ok=True, mode=0o700)
    private.chmod(0o700)
    state_file = private / "state.json"
    if state_file.exists():
        state = json.loads(state_file.read_text(encoding="utf-8"))
        if {k: v for k, v in state["settings"].items() if k not in ("SERVER_IP", "ACME_EMAIL")} != {k: v for k, v in settings.items() if k not in ("SERVER_IP", "ACME_EMAIL")} or state["test"] != test:
            raise ValueError("Existing deployment settings differ; migrate through Keycloak before changing domains or secrets")
    else:
        state = {"settings": settings, "test": test}
        for key in ("auth_secret", "client_secret", "db_password", "postgres_password", "admin_password", "initial_password"):
            state[key] = secrets.token_urlsafe(36)
        private_write(state_file, json.dumps(state, indent=2) + "\n")
    if "app_db_password" not in state:
        state["app_db_password"] = secrets.token_urlsafe(36)
        private_write(state_file, json.dumps(state, indent=2) + "\n")
    pki = private / "pki"
    pki.mkdir(exist_ok=True, mode=0o700)
    if not (pki / "ca.pem").exists():
        if (pki / "ca.key").exists():
            raise ValueError("Incomplete CA state; restore the private deployment backup")
        openssl("req", "-x509", "-newkey", "rsa:4096", "-nodes", "-days", "3650", "-sha256", "-keyout", pki / "ca.key", "-out", pki / "ca.pem", "-subj", "/CN=HoursBooster internal CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign")
    openssl("x509", "-checkend", "2592000", "-noout", "-in", pki / "ca.pem")
    (pki / "ca.key").chmod(0o600)
    (pki / "ca.pem").chmod(0o444)
    for service, uid in (("vaporbooster", 1993), ("keycloak", 1000), ("postgres", 999)):
        leaf(pki, service, [service], uid, renew)
    if certs.is_symlink():
        raise ValueError("Certificate directory must not be a symlink")
    certs.mkdir(parents=True, exist_ok=True, mode=0o700)
    certs.chmod(0o700)
    if test:
        leaf(pki, "proxy", [settings["HOURS_DOMAIN"], settings["AUTH_DOMAIN"]], 101, renew)
        public = certs / "nginx"
        public.mkdir(exist_ok=True)
        public.chmod(0o700)
        for name in ("fullchain.pem", "privkey.pem"):
            private_write(public / name, (pki / "proxy" / name).read_text(), 0o400 if name == "privkey.pem" else 0o444)
        public.chmod(0o500)
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            os.chown(public, 101, 101)
            os.chown(public / "privkey.pem", 101, 101)
    nginx = (ROOT / "deploy/full-stack/nginx.conf").read_text()
    for key in ("HOURS_DOMAIN", "AUTH_DOMAIN"):
        nginx = nginx.replace("${" + key + "}", settings[key])
    private_write(private / "nginx.conf", nginx, 0o444)
    network = ipaddress.ip_network(settings["EDGE_SUBNET"])
    env = {
        **settings,
        "PRIVATE_DIR": private.resolve().as_posix(),
        "CERTS_DIR": certs.resolve().as_posix(),
        "PROXY_IP": str(network.network_address + 2),
        # Keep dynamic leases out of the statically assigned proxy address.
        "EDGE_DYNAMIC_RANGE": str(list(network.subnets(new_prefix=25))[1]),
        "HTTPS_BIND_IP": "127.0.0.1" if test else "0.0.0.0",
        "BETTER_AUTH_SECRET": state["auth_secret"],
        "OIDC_CLIENT_SECRET": state["client_secret"],
        "DB_PASSWORD": state["db_password"],
        "APP_DB_PASSWORD": state["app_db_password"],
        "POSTGRES_PASSWORD": state["postgres_password"],
        "ADMIN_PASSWORD": state["admin_password"],
        "INITIAL_PASSWORD": state["initial_password"],
    }
    # Values are constrained above; single quotes preserve path spaces and prevent
    # Compose interpolation. No shell is ever used to execute this file.
    if any("'" in str(value) or "\n" in str(value) or "\r" in str(value) for value in env.values()):
        raise ValueError("Unsupported character in deployment directory or setting")
    private_write(private / "compose.env", "".join(key + "='" + str(value) + "'\n" for key, value in env.items()))
    private_write(private / "credentials.txt", "HoursBooster initial Keycloak login\nUsername: operator\nPassword: " + state["initial_password"] + "\n\nKeycloak bootstrap admin (master realm; create a permanent administrator)\nUsername: bootstrap-admin\nPassword: " + state["admin_password"] + "\n")
    return state


def verify_proxy_tls(settings, certs=CERTS, ca=None):
    public = certs / "nginx"
    cert, key = public / "fullchain.pem", public / "privkey.pem"
    if public.is_symlink() or any(path.is_symlink() or not path.is_file() for path in (cert, key)):
        raise ValueError("Place fullchain.pem and privkey.pem files in certs/full-stack/nginx; copy them rather than symlinking")
    for domain in (settings["HOURS_DOMAIN"], settings["AUTH_DOMAIN"]):
        openssl("verify", *(["-CAfile", ca] if ca else []), "-untrusted", cert, "-verify_hostname", domain, cert)
    openssl("x509", "-checkend", "86400", "-noout", "-in", cert)
    if openssl("x509", "-in", cert, "-pubkey", "-noout") != openssl("pkey", "-in", key, "-pubout"):
        raise ValueError("nginx certificate and private key do not match")
    public.chmod(0o500)
    cert.chmod(0o444)
    key.chmod(0o400)
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        os.chown(public, 101, 101)
        os.chown(key, 101, 101)


def compose_command(private=PRIVATE):
    return ["docker", "compose", "--project-name", "hoursbooster", "--env-file", str(private / "compose.env"), "-f", str(ROOT / "deploy/full-stack/compose.yml")]


def wait_ready(settings, private, test, timeout=300):
    context = ssl.create_default_context(cafile=str(private / "pki/ca.pem") if test else None)
    # Ignore ambient HTTP(S)_PROXY variables: these are local deployment checks.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
    targets = ["https://" + settings["AUTH_DOMAIN"] + "/realms/hours/.well-known/openid-configuration", "https://" + settings["HOURS_DOMAIN"] + "/login"]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready = True
        for url in targets:
            try:
                with opener.open(url, timeout=5) as response:
                    if response.status != 200:
                        ready = False
            except (OSError, urllib.error.URLError):
                ready = False
        if ready:
            return
        time.sleep(3)
    raise RuntimeError("HTTPS readiness timed out; check local DNS, Docker status and nginx TLS configuration")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings", type=Path, default=PRIVATE / "settings.env")
    parser.add_argument("--prepare-only", action="store_true", help="Generate private configuration without starting containers")
    parser.add_argument("--test", action="store_true", help="CI only: .test domains, localhost port binding and private-CA proxy certificate")
    parser.add_argument("--renew-internal-tls", action="store_true", help="Renew backend certificates under the existing CA and recreate containers")
    args = parser.parse_args(argv)
    if sys.platform != "linux":
        raise ValueError("This installer targets Debian/Linux; unit tests can run on other systems")
    if os.geteuid() != 0:
        raise ValueError("Run with sudo so TLS keys can be owned by their container UIDs")
    # Root must not follow an attacker-controlled deployment-directory symlink.
    for path in (ROOT / ".private", PRIVATE, ROOT / "certs", CERTS):
        if path.is_symlink():
            raise ValueError("Private deployment directories must not be symlinks")
    if args.settings.resolve().parent != PRIVATE:
        raise ValueError("Keep populated settings in .private/full-stack/settings.env")
    settings = validate(read_settings(args.settings), args.test)
    if not shutil.which(OPENSSL):
        raise ValueError("Install openssl before running setup")
    prepare(settings, test=args.test, renew=args.renew_internal_tls)
    if args.prepare_only:
        print("Private HTTPS configuration prepared. No containers started.")
        return
    if not shutil.which("docker"):
        raise ValueError("Install Docker Engine and its Compose plugin first")
    verify_proxy_tls(settings, PRIVATE / "certs" if args.test else CERTS, PRIVATE / "pki/ca.pem" if args.test else None)
    subprocess.run(compose_command() + ["config", "--quiet"], check=True)
    subprocess.run(compose_command() + ["up", "-d", "--build", "--wait", "--wait-timeout", "120", "postgres"], check=True)
    # Official init scripts run only on empty volumes. Existing Keycloak installations
    # also need the separate application role/database, without resetting Keycloak.
    subprocess.run(compose_command() + ["exec", "-T", "postgres", "sh", "/docker-entrypoint-initdb.d/20-hoursbooster.sh"], check=True)
    command = compose_command() + ["up", "-d", "--build"]
    if args.renew_internal_tls:
        command.append("--force-recreate")
    subprocess.run(command, check=True)
    wait_ready(settings, PRIVATE, args.test)
    print("HTTPS services are ready. Initial credentials are in .private/full-stack/credentials.txt (private; do not publish).")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        # Deliberately do not dump environment, settings or subprocess output.
        print("Setup stopped: " + (str(error) if isinstance(error, (ValueError, RuntimeError)) else "a required file or command is unavailable"), file=sys.stderr)
        sys.exit(1)
