#!/usr/bin/env python3
"""
Serves the "Problems in Agent Calling" page and keeps developer remarks and
uploaded proof recordings in store.json, so everyone who opens the page sees
the same remarks.

    python3 serve.py            # http://localhost:8080
    python3 serve.py 9000       # different port

Opening index.html directly (without this server) still works, but remarks
then stay in that browser's local storage and the "Attach recording" button
is hidden.
"""
import json
import os
import re
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(ROOT, "store.json")
AUDIO_DIR = os.path.join(ROOT, "audio")
LOCK = threading.Lock()
MAX_UPLOAD = 300 * 1024 * 1024  # bytes
CHUNK = 256 * 1024


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_store():
    try:
        with open(STORE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("remarks", {})
    data.setdefault("proofs", {})
    data.setdefault("done", {})
    return data


def save_store(data):
    tmp = STORE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, STORE)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".opus": "audio/ogg",
        ".webm": "audio/webm",
        ".flac": "audio/flac",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # ---------- helpers ----------
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n > 0 else b""
        try:
            return json.loads(raw or b"{}")
        except ValueError:
            return None

    def end_headers(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html", "/data.js", "/app.js", "/style.css"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- GET: static files, store, ranged audio ----------
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/store":
            with LOCK:
                return self.send_json(load_store())
        if path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        if path.startswith("/audio/") and "Range" in self.headers:
            return self.send_range(path)
        return super().do_GET()

    def send_range(self, path):
        """Byte-range responses so the browser can seek inside a recording."""
        fpath = self.translate_path(path)
        if not os.path.isfile(fpath):
            return self.send_error(404)
        size = os.path.getsize(fpath)
        m = re.match(r"bytes=(\d*)-(\d*)$", self.headers["Range"].strip())
        if not m:
            return self.send_error(416)
        start_s, end_s = m.groups()
        if start_s:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        else:  # suffix range: last N bytes
            n = int(end_s or 0)
            start, end = max(size - n, 0), size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.end_headers()
            return
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(fpath))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(fpath, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                buf = f.read(min(CHUNK, left))
                if not buf:
                    break
                self.wfile.write(buf)
                left -= len(buf)

    def send_head(self):
        # Advertise range support on normal audio responses too.
        if urlparse(self.path).path.startswith("/audio/"):
            self._adv_ranges = True
        return super().send_head()

    def send_response(self, code, message=None):
        super().send_response(code, message)
        if getattr(self, "_adv_ranges", False) and code == 200:
            self.send_header("Accept-Ranges", "bytes")
            self._adv_ranges = False

    # ---------- PUT /api/remark  |  PUT /api/done ----------
    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/done":
            return self.put_done()
        if path != "/api/remark":
            return self.send_json({"error": "not found"}, 404)
        payload = self.read_json()
        if payload is None:
            return self.send_json({"error": "bad json"}, 400)
        pid = str(payload.get("id", "")).strip()
        text = str(payload.get("text", ""))
        if not pid:
            return self.send_json({"error": "id required"}, 400)
        with LOCK:
            data = load_store()
            entry = {"text": text, "updated": now()}
            if text.strip():
                data["remarks"][pid] = entry
            else:
                data["remarks"].pop(pid, None)
            save_store(data)
        self.send_json(entry)

    def put_done(self):
        """Mark a problem complete / not complete: {"id": "agent-3", "done": true}."""
        payload = self.read_json()
        if payload is None:
            return self.send_json({"error": "bad json"}, 400)
        pid = str(payload.get("id", "")).strip()
        done = bool(payload.get("done"))
        if not pid:
            return self.send_json({"error": "id required"}, 400)
        with LOCK:
            data = load_store()
            entry = {"done": done, "updated": now()}
            if done:
                data["done"][pid] = entry
            else:
                data["done"].pop(pid, None)
            save_store(data)
        self.send_json(entry)

    # ---------- POST /api/upload?id=N  (raw body, name in X-Filename) ----------
    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/api/upload":
            return self.send_json({"error": "not found"}, 404)
        pid = parse_qs(u.query).get("id", [""])[0].strip()
        if not pid:
            return self.send_json({"error": "id required"}, 400)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self.send_json({"error": "empty upload"}, 400)
        if length > MAX_UPLOAD:
            return self.send_json({"error": "file too large"}, 413)

        original = os.path.basename(unquote(self.headers.get("X-Filename") or "")) or "recording"
        base, ext = os.path.splitext(original)
        base = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-.") or "recording"
        ext = re.sub(r"[^A-Za-z0-9.]", "", ext.lower())[:8]
        os.makedirs(AUDIO_DIR, exist_ok=True)
        fname = "%s-%s%s" % (pid, base, ext)
        i = 2
        while os.path.exists(os.path.join(AUDIO_DIR, fname)):
            fname = "%s-%s-%d%s" % (pid, base, i, ext)
            i += 1

        tmp = os.path.join(AUDIO_DIR, fname + ".part")
        left = length
        with open(tmp, "wb") as f:
            while left > 0:
                buf = self.rfile.read(min(CHUNK, left))
                if not buf:
                    break
                f.write(buf)
                left -= len(buf)
        if left != 0:
            os.remove(tmp)
            return self.send_json({"error": "upload incomplete"}, 400)
        os.replace(tmp, os.path.join(AUDIO_DIR, fname))

        entry = {"file": "audio/" + fname, "name": original, "added": now()}
        with LOCK:
            data = load_store()
            data["proofs"].setdefault(pid, []).append(entry)
            save_store(data)
        self.send_json(entry, 201)

    # ---------- DELETE /api/proof?id=N&file=audio/x ----------
    def do_DELETE(self):
        u = urlparse(self.path)
        if u.path != "/api/proof":
            return self.send_json({"error": "not found"}, 404)
        q = parse_qs(u.query)
        pid = q.get("id", [""])[0].strip()
        rel = q.get("file", [""])[0]
        if not pid or not rel.startswith("audio/") or "/" in rel[6:] or ".." in rel:
            return self.send_json({"error": "bad request"}, 400)
        with LOCK:
            data = load_store()
            items = data["proofs"].get(pid, [])
            keep = [x for x in items if x.get("file") != rel]
            if len(keep) == len(items):
                return self.send_json({"error": "not found"}, 404)
            if keep:
                data["proofs"][pid] = keep
            else:
                data["proofs"].pop(pid, None)
            save_store(data)
        fpath = os.path.join(AUDIO_DIR, rel[6:])
        if os.path.isfile(fpath):
            os.remove(fpath)
        self.send_json({"ok": True})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("Problems in Agent Calling  ->  http://localhost:%d" % port)
    print("Remarks and uploads are kept in %s" % STORE)
    print("Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
