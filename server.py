from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DIARY_DATA_DIR", ROOT / "data"))
VAULT_FILE = DATA_DIR / "diary-vault.json"
MAX_BODY_BYTES = 30 * 1024 * 1024


class DiaryHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self._is_diary_api():
            self._send_json(self._read_vault())
            return

        super().do_GET()

    def do_PUT(self):
        if not self._is_diary_api():
            self.send_error(404)
            return

        try:
            body = self._read_json_body()
            vault = self._normalize_vault(body)
            DATA_DIR.mkdir(exist_ok=True)
            VAULT_FILE.write_text(json.dumps(vault, ensure_ascii=False, indent=2), encoding="utf-8")
            self._send_json(vault)
        except ValueError as error:
            self.send_error(400, str(error))

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
        if not VAULT_FILE.exists():
            return {"auth": None, "entries": None, "updatedAt": None}

        try:
            return self._normalize_vault(json.loads(VAULT_FILE.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            return {"auth": None, "entries": None, "updatedAt": None}

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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")


def main():
    parser = argparse.ArgumentParser(description="Private diary server")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", default=int(os.environ.get("PORT", "8000")), type=int)
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), DiaryHandler)
    print(f"Diary server running at http://{args.host}:{args.port}")
    print(f"Diary data file: {VAULT_FILE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
