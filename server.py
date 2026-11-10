"""Static file server for local use: python3 server.py [port]. Sends no-cache headers so edits show up on reload."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    print(f"http://localhost:{port}")
    ThreadingHTTPServer(("", port), Handler).serve_forever()
