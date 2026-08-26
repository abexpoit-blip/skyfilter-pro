import http.server
import socketserver
import webbrowser
import os
import sys

DEFAULT_PORT = 3000
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def run_server():
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print("=" * 65)
        print("   >>> SKYFILTER PRO - HIGH PERFORMANCE SERVER ACTIVE <<<")
        print("=" * 65)
        print(f"Local Server URL: {url}")
        print("Open the link above in your browser.")
        print(f"Server Port: {PORT}")
        print("Press Ctrl + C to stop the server.")
        print("=" * 65)
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            httpd.shutdown()

if __name__ == '__main__':
    run_server()