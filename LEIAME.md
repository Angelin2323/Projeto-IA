# TT Coach (app PWA)

App para analisar golpes de tênis de mesa. Roda inteiro no aparelho de quem usa: o vídeo é
processado ali mesmo e **não é enviado a nenhum servidor**. Só as medidas do corpo extraídas dos
golpes ficam guardadas, no próprio aparelho. Instala na tela inicial do celular e funciona sem internet.

## O que foi testado e o que não foi

- Testado: a análise (conversão do Python para JavaScript, mesmos números), o app no Chromium
  (treinar, analisar, backup, apagar, importar, cancelar, erros, offline, instalação) e o layout em
  390 px de largura.
- **Não testado: a detecção de pose do MediaPipe com vídeo real.** O ambiente em que escrevi o código
  não consegue baixar o MediaPipe, então nos testes usei um detector simulado. O primeiro teste real
  com um vídeo seu é o que falta. Se algo falhar nessa etapa, abra o console do navegador e me
  mande a mensagem.

## Testar no computador

```
python servir.py
```
Abre http://localhost:8080. (Não abra o `index.html` direto do disco: não funciona.)

Opcional, mas recomendado (precisa de internet só uma vez): `python baixar_arquivos.py`. Ele baixa o
MediaPipe e o modelo de pose para as pastas `vendor/` e `model/`, e o app deixa de depender de CDN.
Sem isso o app funciona do mesmo jeito: baixa esses arquivos na primeira vez que for usado e guarda
no aparelho para as próximas.

## Colocar na internet (link fixo, sem servidor)

O app é só um conjunto de arquivos estáticos: qualquer hospedagem de site estático serve. Exemplos
que costumam ter plano gratuito (confira as condições atuais): GitHub Pages, Netlify, Cloudflare Pages.

1. (Opcional) rode `python baixar_arquivos.py` antes, para publicar junto as pastas `vendor/` e `model/`.
2. Publique **toda esta pasta**. Para instalar no celular o endereço precisa ser **https**
   (as hospedagens acima já dão https).
3. Ao publicar uma versão nova, mude `VERSAO` no começo do `sw.js` (por exemplo para `ttcoach-v2`);
   senão os aparelhos podem continuar com a versão antiga guardada.

## Instalar no celular

- **Android (Chrome):** abra o link e toque em “Instalar app” (ou no menu do navegador).
- **iPhone (Safari):** toque em Compartilhar, depois em “Adicionar à Tela de Início”.

## Como usar

1. Aba **Treinar a IA:** envie vídeos de golpes corretos (pelo menos 3 golpes) e, se quiser, de
   golpes errados com o nome do erro.
2. Aba **Analisar:** envie um vídeo novo e veja o veredito, o quadro de cada golpe e o que corrigir.
3. Aba **Memória:** veja o que foi aprendido, remova vídeos, exporte e importe backups.

Dicas de filmagem: câmera parada, mesmo ângulo, corpo inteiro, só o jogador no quadro, boa luz.

## Limites e cuidados

- Vídeos de até **60 s**. A análise lê 30 quadros por segundo; em celular mais fraco pode demorar
  (há barra de progresso e botão Cancelar).
- O navegador precisa conseguir abrir o vídeo. `.mp4` (H.264) funciona em geral; arquivos `.mov` do
  iPhone (HEVC) podem não abrir no Chrome do computador.
- **A memória fica só no aparelho.** Apagar os dados do navegador a apaga, e o Safari do iPhone pode
  apagar dados de apps que ficam muito tempo sem abrir. **Exporte um backup de vez em quando**
  (aba Memória); o mesmo arquivo serve para levar a memória para outro aparelho.
- A memória **não é compartilhada** entre pessoas: cada aparelho tem a sua. Compartilhar exigiria
  um serviço para guardar as medidas, que não está incluído.
- A IA mede postura e movimento do corpo, não a bola nem a raquete. “Correto” significa “parecido
  com os exemplos que você marcou como corretos”: valide seus exemplos com um treinador.
- Se o MediaPipe mudar de versão e o download pela internet falhar, ajuste `VERSAO_CDN` em
  `pose.js` (ou rode `baixar_arquivos.py`, que pega a versão mais recente).
