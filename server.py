from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
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
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
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

            vault["accessKeyHash"] = self._new_access_key_hash() or stored.get("accessKeyHash") or self._access_key_hash()
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

    def do_POST(self):
        parts = self._attachment_parts()
        if not parts:
            self.send_error(404)
            return

        try:
            stored = self._read_vault()
            self._authorize_write(stored)
            entry_id, attachment_id, action = parts
            object_path = self._attachment_object_path(entry_id, attachment_id)

            if action == "url":
                self._send_json({"url": self._create_attachment_url(object_path)})
                return

            if action:
                self.send_error(404)
                return

            self._upload_attachment(object_path)
            self._send_json({"path": object_path})
        except ValueError as error:
            self.send_error(400, str(error))
        except VaultAccessError as error:
            self.send_error(403, str(error))
        except RuntimeError as error:
            self.send_error(502, str(error))

    def do_DELETE(self):
        parts = self._attachment_parts()
        if not parts or parts[2]:
            self.send_error(404)
            return

        try:
            stored = self._read_vault()
            self._authorize_write(stored)
            object_path = self._attachment_object_path(parts[0], parts[1])
            self._delete_attachment(object_path)
            self._send_json({"deleted": True})
        except VaultAccessError as error:
            self.send_error(403, str(error))
        except RuntimeError as error:
            self.send_error(502, str(error))

    def do_OPTIONS(self):
        if self._is_diary_api() or self._attachment_parts():
            self.send_response(204)
            self._send_common_headers("application/json")
            self.end_headers()
            return

        self.send_error(404)

    def _is_diary_api(self):
        return urlparse(self.path).path == "/api/diary"

    def _attachment_parts(self):
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) not in (4, 5) or parts[:2] != ["api", "attachments"]:
            return None

        entry_id, attachment_id = parts[2], parts[3]
        allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        if not entry_id or not attachment_id or not set(entry_id + attachment_id) <= allowed:
            return None

        return entry_id, attachment_id, parts[4] if len(parts) == 5 else ""

    def _attachment_object_path(self, entry_id, attachment_id):
        return f"attachments/{entry_id}/{attachment_id}"

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
            if error.code in (400, 404):
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

    def _upload_attachment(self, object_path):
        self._require_supabase()
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length") from error

        if length <= 0:
            raise ValueError("Attachment is empty")
        if length > MAX_ATTACHMENT_BYTES:
            raise ValueError("Attachment is larger than 50 MB")

        parsed = urlparse(SUPABASE_URL)
        connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=90)
        storage_path = (
            f"/storage/v1/object/{quote(SUPABASE_BUCKET, safe='')}/"
            f"{quote(object_path, safe='/')}"
        )

        try:
            connection.putrequest("POST", storage_path)
            connection.putheader("apikey", SUPABASE_SERVICE_KEY)
            connection.putheader("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
            connection.putheader("Content-Type", self.headers.get("Content-Type", "application/octet-stream"))
            connection.putheader("Content-Length", str(length))
            connection.putheader("x-upsert", "false")
            connection.endheaders()

            remaining = length
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise RuntimeError("Attachment upload was interrupted")
                connection.send(chunk)
                remaining -= len(chunk)

            response = connection.getresponse()
            response.read()
            if not 200 <= response.status < 300:
                raise RuntimeError(f"Supabase attachment upload failed ({response.status})")
        except OSError as error:
            raise RuntimeError("Supabase attachment upload failed") from error
        finally:
            connection.close()

    def _create_attachment_url(self, object_path):
        self._require_supabase()
        data = json.dumps({"expiresIn": 600}).encode("utf-8")
        request = self._supabase_request(
            f"/storage/v1/object/sign/{quote(SUPABASE_BUCKET, safe='')}/{quote(object_path, safe='/')}",
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=20) as response:
                value = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise RuntimeError(f"Supabase attachment access failed ({error.code})") from error
        except (URLError, json.JSONDecodeError) as error:
            raise RuntimeError("Supabase attachment access failed") from error

        signed_url = value.get("signedURL") or value.get("signedUrl")
        if not signed_url:
            raise RuntimeError("Supabase did not return an attachment URL")
        if signed_url.startswith("http"):
            return signed_url
        if signed_url.startswith("/storage/v1"):
            return f"{SUPABASE_URL}{signed_url}"
        return f"{SUPABASE_URL}/storage/v1{signed_url}"

    def _delete_attachment(self, object_path):
        self._require_supabase()
        data = json.dumps({"prefixes": [object_path]}).encode("utf-8")
        request = self._supabase_request(
            f"/storage/v1/object/{quote(SUPABASE_BUCKET, safe='')}",
            data=data,
            method="DELETE",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=20):
                return
        except HTTPError as error:
            raise RuntimeError(f"Supabase attachment delete failed ({error.code})") from error
        except URLError as error:
            raise RuntimeError("Supabase attachment delete failed") from error

    def _require_supabase(self):
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError("Supabase attachment storage is not configured")

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

    def _new_access_key_hash(self):
        access_key = self.headers.get("X-Diary-New-Key", "")
        if not access_key:
            return ""
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
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept, X-Diary-Key, X-Diary-New-Key, X-Diary-Version")


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
