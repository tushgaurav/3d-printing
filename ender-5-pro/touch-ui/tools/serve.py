"""Local dev server with a custom 404 page."""
import http.server
import os
import sys

STATIC = os.path.join(os.path.dirname(__file__),
                      '..', 'octoprint_layer1', 'static')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.abspath(STATIC), **kw)

    def end_headers(self):
        # Revalidate every file on load (a cheap 304 when unchanged). Without this the
        # browser may reuse a cached JS module or stylesheet after an edit, and a plain
        # reload shows a mix of old and new code.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            page = os.path.join(self.directory, '404.html')
            try:
                with open(page, 'rb') as f:
                    body = f.read()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except FileNotFoundError:
                pass
        super().send_error(code, message, explain)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    with http.server.HTTPServer(('', port), Handler) as s:
        print(f'Layer1 dev server → http://localhost:{port}')
        s.serve_forever()
