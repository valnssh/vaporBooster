"""Synthetic configuration/TLS checks; no Docker, DNS or Steam credentials."""
import importlib.util
import json
import os
from pathlib import Path
import ssl
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("full_stack_setup", Path(__file__).with_name("setup.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def settings(self):
        return {"HOURS_DOMAIN": "hours.test", "AUTH_DOMAIN": "auth.test", "SERVER_IP": "127.0.0.1", "ACME_EMAIL": "operator@example.invalid", "STEAM_ALLOWED_IDS": "76561198000000001"}

    def test_canonical_issuer_port_is_reachable_inside_docker(self):
        directory = Path(__file__).parent
        nginx = (directory / "nginx.conf").read_text()
        compose = (directory / "compose.yml").read_text()
        self.assertIn("listen 443 ssl;", nginx)
        self.assertIn("return 308 https://$host$request_uri;", nginx)
        self.assertIn("proxy_ssl_verify on;", nginx)
        self.assertIn("}:80:80'", compose)
        self.assertIn("}:443:443'", compose)
        self.assertIn("net.ipv4.ip_unprivileged_port_start: '0'", compose)

    def test_untrusted_settings_are_rejected(self):
        for key, value in (("HOURS_DOMAIN", "https://hours.test"), ("AUTH_DOMAIN", "hours.test"), ("SERVER_IP", "0.0.0.0"), ("STEAM_ALLOWED_IDS", "YOUR_STEAMID64"), ("STEAM_ALLOWED_IDS", "76561198000000001,76561198000000001"), ("ACME_EMAIL", "x@example.invalid\nadmin off"), ("EDGE_SUBNET", "8.8.8.0/24")):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                setup.validate({**self.settings(), key: value}, test=True)
        with self.assertRaises(ValueError):
            setup.validate(self.settings(), test=False, check_dns=False)
        with self.assertRaises(ValueError):
            setup.validate({**self.settings(), "AUTH_DOMAIN": "real.example.com"}, test=True)

    def test_home_vm_does_not_require_public_address(self):
        values = {**self.settings(), "HOURS_DOMAIN": "hours.deployment.dev", "AUTH_DOMAIN": "auth.deployment.dev", "SERVER_IP": "192.168.1.50", "ACME_EMAIL": "operator@deployment.dev"}
        self.assertEqual(setup.validate(values)["SERVER_IP"], "192.168.1.50")
        del values["SERVER_IP"]
        del values["ACME_EMAIL"]
        self.assertNotIn("SERVER_IP", setup.validate(values))

    def test_synthetic_install_is_private_idempotent_and_verifiable(self):
        values = setup.validate(self.settings(), test=True)
        with tempfile.TemporaryDirectory() as temporary:
            private = Path(temporary)
            first = setup.prepare(values, private, test=True)
            setup.verify_proxy_tls(values, private / "certs", private / "pki/ca.pem")
            with self.assertRaises(RuntimeError):
                setup.verify_proxy_tls({**values, "AUTH_DOMAIN": "wrong.test"}, private / "certs", private / "pki/ca.pem")
            key_path = private / "certs/nginx/privkey.pem"
            saved_key = key_path.read_text()
            setup.private_write(key_path, (private / "pki/keycloak/privkey.pem").read_text())
            with self.assertRaises(ValueError):
                setup.verify_proxy_tls(values, private / "certs", private / "pki/ca.pem")
            setup.private_write(key_path, saved_key, 0o400)
            cert = (private / "pki/vaporbooster/fullchain.pem").read_bytes()
            ca = (private / "pki/ca.pem").read_bytes()
            second = setup.prepare(values, private, test=True)
            self.assertEqual(first, second)
            self.assertEqual(cert, (private / "pki/vaporbooster/fullchain.pem").read_bytes())
            self.assertEqual(ca, (private / "pki/ca.pem").read_bytes())
            for service, hostname in (("vaporbooster", "vaporbooster"), ("keycloak", "keycloak"), ("postgres", "postgres"), ("proxy", "hours.test")):
                setup.openssl("verify", "-CAfile", private / "pki/ca.pem", "-verify_hostname", hostname, private / "pki" / service / "fullchain.pem")
            with self.assertRaises(RuntimeError):
                setup.openssl("verify", "-CAfile", private / "pki/ca.pem", "-verify_hostname", "wrong.test", private / "pki/proxy/fullchain.pem")
            ssl.create_default_context(cafile=str(private / "pki/ca.pem"))
            env = (private / "compose.env").read_text()
            self.assertIn("HTTPS_BIND_IP='127.0.0.1'", env)
            self.assertIn("PROXY_IP='172.28.0.2'", env)
            self.assertIn("EDGE_DYNAMIC_RANGE='172.28.0.128/25'", env)
            self.assertNotEqual(first["initial_password"], first["admin_password"])
            self.assertNotEqual(first["db_password"], first["postgres_password"])
            for key in ("auth_secret", "client_secret", "db_password", "postgres_password", "initial_password", "admin_password"):
                self.assertGreaterEqual(len(first[key]), 48)
            setup.prepare(values, private, test=True, renew=True)
            self.assertNotEqual(cert, (private / "pki/vaporbooster/fullchain.pem").read_bytes())
            self.assertEqual(ca, (private / "pki/ca.pem").read_bytes())
            self.assertEqual(first, json.loads((private / "state.json").read_text()))
            with self.assertRaises(ValueError):
                setup.prepare({**values, "AUTH_DOMAIN": "different.test"}, private, test=True)
            if os.name != "nt":
                self.assertEqual((private / "state.json").stat().st_mode & 0o777, 0o600)
                self.assertEqual((private / "pki/ca.key").stat().st_mode & 0o777, 0o600)
            (private / "certs/nginx").chmod(0o700)
            # Restore directory permissions so non-root unit tests can clean up.
            for directory in (private / "pki").iterdir():
                if directory.is_dir():
                    directory.chmod(0o700)


if __name__ == "__main__":
    unittest.main()
