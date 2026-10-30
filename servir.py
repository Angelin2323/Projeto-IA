"""Servidor local para testar o app no computador:  python servir.py   (abre http://localhost:8080)

O app precisa ser aberto por um endereço http(s); abrir o index.html direto do disco não funciona.
Para testar no celular e instalar o app, publique a pasta em um endereço https (veja o LEIAME.md).
"""
import http.server
import mimetypes
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/wasm", ".wasm")


class Servidor(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    pasta = Path(__file__).resolve().parent
    handler = lambda *a, **k: Servidor(*a, directory=str(pasta), **k)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", porta), handler) as httpd:
        url = f"http://localhost:{porta}"
        print(f"TT Coach em {url}  (Ctrl+C para parar)")
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
