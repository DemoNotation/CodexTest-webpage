from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(
    os.environ.get(
        "DIARY_DATA_DIR",
        os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", ROOT / "data"),
    )
)
VAULT_FILE = DATA_DIR / "diary-vault.json"
MAX_BODY_BYTES = 30 * 1024 * 1024
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "private-diary")
SUPABASE_OBJECT = "diary-vault.json"


class VaultConflictError(Exception):
    pass


class VaultAccessError(Exception):
    pass


class DiaryHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self._is_diary_api():
            try:
                self._send_json(self._public_vault(self._read_vault()))
            except RuntimeError as error:
                self.send_error(502, str(error))
            return

        super().do_GET()

    def do_PUT(self):
        if not self._is_diary_api():
            self.send_error(404)
            return

        try:
            body = self._read_json_body()
            vault = self._normalize_vault(body)
            stored = self._read_vault()
            self._authorize_write(stored)

            expected_version = self.headers.get("X-Diary-Version", "")
            stored_version = stored.get("updatedAt") or ""
            if expected_version != stored_version:
                raise VaultConflictError("Diary was updated on another device")

            vault["accessKeyHash"] = stored.get("accessKeyHash") or self._access_key_hash()
            self._write_vault(vault)
            self._send_json(self._public_vault(vault))
        except ValueError as error:
            self.send_error(400, str(error))
        except VaultAccessError as error:
            self.send_error(403, str(error))
        except VaultConflictError as error:
            self.send_error(409, str(error))
        except RuntimeError as error:
            self.send_error(502, str(error))

    def do_OPTIONS(self):
        if self._is_diary_api():
            self.send_response(204)
            self._send_common_headers("application/json")
            self.end_headers()
            return

        self.send_error(404)

    def _is_diary_api(self):
        return urlparse(self.path).path == "/api/diary"

    def _read_vault(self):
        if SUPABASE_URL and SUPABASE_SERVICE_KEY:
            return self._read_supabase_vault()

        if not VAULT_FILE.exists():
            return self._empty_vault()

        try:
            value = json.loads(VAULT_FILE.read_text(encoding="utf-8"))
            vault = self._normalize_vault(value)
            vault["accessKeyHash"] = value.get("accessKeyHash")
            return vault
        except json.JSONDecodeError:
            return self._empty_vault()

    def _write_vault(self, vault):
        if SUPABASE_URL and SUPABASE_SERVICE_KEY:
            self._write_supabase_vault(vault)
            return

        DATA_DIR.mkdir(exist_ok=True)
        VAULT_FILE.write_text(json.dumps(vault, ensure_ascii=False, indent=2), encoding="utf-8")

    def _read_supabase_vault(self):
        request = self._supabase_request(
            f"/storage/v1/object/{SUPABASE_BUCKET}/{SUPABASE_OBJECT}",
            method="GET",
        )
        try:
            with urlopen(request, timeout=20) as response:
                value = json.loads(response.read().decode("utf-8"))
                vault = self._normalize_vault(value)
                vault["accessKeyHash"] = value.get("accessKeyHash")
                return vault
        except HTTPError as error:
            if error.code == 404:
                return self._empty_vault()
            raise RuntimeError(f"Supabase read failed ({error.code})") from error
        except (URLError, json.JSONDecodeError) as error:
            raise RuntimeError("Supabase read failed") from error

    def _write_supabase_vault(self, vault):
        data = json.dumps(vault, ensure_ascii=False).encode("utf-8")
        request = self._supabase_request(
            f"/storage/v1/object/{SUPABASE_BUCKET}/{SUPABASE_OBJECT}",
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "x-upsert": "true"},
        )
        try:
            with urlopen(request, timeout=30):
                return
        except HTTPError as error:
            if error.code == 404:
                raise RuntimeError("Supabase bucket private-diary does not exist") from error
            raise RuntimeError(f"Supabase write failed ({error.code})") from error
        except URLError as error:
            raise RuntimeError("Supabase write failed") from error

    def _supabase_request(self, path, data=None, method="GET", headers=None):
        request_headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        }
        request_headers.update(headers or {})
        return Request(f"{SUPABASE_URL}{path}", data=data, method=method, headers=request_headers)

    def _authorize_write(self, stored):
        access_key = self.headers.get("X-Diary-Key", "")
        if not access_key:
            raise VaultAccessError("Diary password is required")

        stored_hash = stored.get("accessKeyHash")
        if stored_hash and not hmac.compare_digest(stored_hash, self._access_key_hash()):
            raise VaultAccessError("Diary password is incorrect")

    def _access_key_hash(self):
        access_key = self.headers.get("X-Diary-Key", "")
        return hashlib.sha256(access_key.encode("utf-8")).hexdigest()

    def _empty_vault(self):
        return {"auth": None, "entries": None, "updatedAt": None, "accessKeyHash": None}

    def _public_vault(self, vault):
        return {key: vault.get(key) for key in ("auth", "entries", "updatedAt")}

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length") from error

        if length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")

        raw = self.rfile.read(length)

        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("Invalid JSON") from error

    def _normalize_vault(self, value):
        if not isinstance(value, dict):
            raise ValueError("Vault must be an object")

        return {
            "auth": value.get("auth"),
            "entries": value.get("entries"),
            "updatedAt": value.get("updatedAt"),
        }

    def _send_json(self, value):
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self._send_common_headers("application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_common_headers(self, content_type):
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept, X-Diary-Key, X-Diary-Version")


def main():
    parser = argparse.ArgumentParser(description="Private diary server")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", default=int(os.environ.get("PORT", "8000")), type=int)
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), DiaryHandler)
    print(f"Diary server running at http://{args.host}:{args.port}")
    storage_name = f"Supabase bucket {SUPABASE_BUCKET}" if SUPABASE_URL else str(VAULT_FILE)
    print(f"Diary storage: {storage_name}")
    server.serve_forever()


if __name__ == "__main__":
    main()
