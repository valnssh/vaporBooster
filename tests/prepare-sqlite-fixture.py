"""Create a new synthetic SQLite snapshot for the Docker importer smoke test."""
import json
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
private = root / '.private' / 'full-stack'
assert json.loads((private / 'state.json').read_text())['test'] is True
directory = private / 'sqlite-backup'
directory.mkdir(mode=0o700, exist_ok=True)
source = directory / 'sqlite.db'
if source.exists() or source.is_symlink():
    raise RuntimeError('Refusing to replace an existing SQLite snapshot')
database = sqlite3.connect(source)
try:
    for name in ('0000_known_supernaut.sql', '0001_scope_steam_account_names.sql', '0002_steam_panel_identity.sql'):
        database.executescript((root / 'drizzle/sqlite' / name).read_text())
    database.executescript("""
        INSERT INTO user(id,name,email) VALUES ('migration-fixture-user','Fixture','migration-fixture@example.invalid');
        INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at)
        VALUES ('migration-fixture-identity','fixture-id','fixture','migration-fixture-user',1700000000123,1700000000456);
        INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id)
        VALUES ('migration-fixture-session',2000000000123,'fixture-only-sqlite-session-token',1,2,'migration-fixture-user');
        INSERT INTO steam_account(id,account_name,user_id,games,created_at,updated_at)
        VALUES ('migration-fixture-account','fixture-do-not-start','migration-fixture-user','[570,730]',1,2);
        INSERT INTO steam_chat_message(id,account_id,steam_id_other,content,timestamp)
        VALUES (7,'migration-fixture-account','76561198000000001','Проверка переноса 👋',1700000000);
    """)
    database.commit()
finally:
    database.close()
source.chmod(0o600)
print('Synthetic SQLite snapshot prepared; no existing files were replaced.')
