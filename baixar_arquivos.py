"""Baixa os arquivos do MediaPipe para dentro do projeto, para o app funcionar sem depender de CDN.

    python baixar_arquivos.py

Cria vendor/ (biblioteca + WebAssembly) e model/ (modelo de pose). Precisa de internet só agora.
Sem rodar este script o app ainda funciona: baixa os mesmos arquivos na primeira vez que for usado.
"""
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
REGISTRO = "https://registry.npmjs.org/@mediapipe/tasks-vision/latest"
MODELO = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/"
          "float16/latest/pose_landmarker_full.task")
ARQUIVOS_BIBLIOTECA = ("package/vision_bundle.mjs",)
PASTA_WASM = "package/wasm/"


def baixar(url: str) -> bytes:
    print(f"  baixando {url}")
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def extrair_pacote(conteudo_tgz: bytes, destino: Path) -> list[str]:
    """Extrai só a biblioteca e a pasta wasm do pacote npm, recusando caminhos suspeitos."""
    escritos = []
    with tarfile.open(fileobj=io.BytesIO(conteudo_tgz), mode="r:gz") as tar:
        for m in tar.getmembers():
            if not m.isfile():
                continue
            if m.name not in ARQUIVOS_BIBLIOTECA and not m.name.startswith(PASTA_WASM):
                continue
            relativo = Path(m.name).relative_to("package")
            if ".." in relativo.parts or relativo.is_absolute():
                raise ValueError(f"caminho suspeito no pacote: {m.name}")
            alvo = destino / relativo
            alvo.parent.mkdir(parents=True, exist_ok=True)
            alvo.write_bytes(tar.extractfile(m).read())
            escritos.append(str(relativo))
    if not any(e.endswith("vision_bundle.mjs") for e in escritos) or not any(e.startswith("wasm") for e in escritos):
        raise ValueError("o pacote baixado não tem os arquivos esperados (vision_bundle.mjs e wasm/).")
    return escritos


def main():
    print("1/2 Biblioteca do MediaPipe (npm)")
    info = json.loads(baixar(REGISTRO))
    print(f"  versão {info['version']}")
    escritos = extrair_pacote(baixar(info["dist"]["tarball"]), RAIZ / "vendor")
    (RAIZ / "vendor" / "VERSAO.txt").write_text(info["version"] + "\n")
    print(f"  {len(escritos)} arquivos em vendor/")

    print("2/2 Modelo de pose")
    modelo = baixar(MODELO)
    if len(modelo) < 1_000_000 or modelo[:2] != b"PK":
        raise ValueError("o modelo baixado parece inválido.")
    (RAIZ / "model").mkdir(exist_ok=True)
    (RAIZ / "model" / "pose_landmarker_full.task").write_bytes(modelo)
    print(f"  {len(modelo) / 1e6:.1f} MB em model/")
    print("\nPronto. Ao publicar o app, publique também as pastas vendor/ e model/.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nFalhou: {e}\nO app ainda funciona sem esta etapa (baixa na primeira vez que for usado).", file=sys.stderr)
        sys.exit(1)
