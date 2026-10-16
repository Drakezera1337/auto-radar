# Auto Radar 🚗

As oportunidades de carros e motos da **OLX** e da **Webmotors** em Campos, SJB, São Francisco
e São Fidélis direto no celular, com **notificação na hora** quando aparece algo bem abaixo da
FIPE / do preço de mercado.

**Site:** https://drakezera1337.github.io/auto-radar/ (os anúncios aparecem depois de conectar o celular ao PC)

Mesmo esquema do Rastreazera / FB Radar / Ofertazera:

```
Chrome do PC
  └─ extensão Auto Radar (OLX + Webmotors)   (D:\Loja\BOT\Meu\olx-auto-radar)
       └─ a cada ciclo de cada site manda os anúncios avaliados (FIPE, mercado, sinais) para
          server.py (PC, localhost:8790)
            ├─ envia Web Push das oportunidades para os aparelhos inscritos (na hora)
            └─ publica olx.json e webmotors.json num Gist secreto ──> app no celular (GitHub Pages)
```

Quem decide o que é oportunidade (desconto mínimo, leilão, preço máximo, só particular…) são as
**configurações da extensão**. O app só mostra e notifica.

## Ligar no PC

1. O servidor inicia sozinho com o Windows, **sem janela** (atalho `Auto Radar (servidor)` em `shell:startup`
   rodando `pythonw server.py`; mensagens e erros vão para `server.log`). Para rodar com janela, use `iniciar.bat`;
   para parar, `parar.bat`. Abra http://localhost:8790
2. Recarregue a extensão Auto Radar em `chrome://extensions` (↻). O painel dela mostra "📱 celular conectado".
3. No Auto Radar (http://localhost:8790) → Ajustes → cole um token do GitHub **só com a permissão gist**, criado
   para este projeto: https://github.com/settings/tokens/new?scopes=gist&description=Auto%20Radar (validade
   “No expiration”) → **Conectar**.

## Ligar no celular

1. No PC: Ajustes → **Mostrar QR code**
2. No celular, abra o site → Ajustes → **📷 Ler QR do PC**
3. Instale: Chrome ⋮ → **Instalar app** (iPhone: Compartilhar → Adicionar à Tela de Início, e abra pelo ícone)
4. Ajustes → **🔔 Ativar notificações** → **Enviar teste**

Tocar na notificação abre o detalhe no app (FIPE, mercado, etiquetas, descrição); o botão
**Abrir na OLX/Webmotors** vai direto ao anúncio.

## Avisos automáticos

- 🔥 oportunidade nova ou 📉 que baixou de preço e virou oportunidade (com foto)
- ⏸ a Webmotors pediu a verificação “pressione e segure” (e ✅ quando voltar)
- ⚠️ uma extensão parou de mandar (Chrome fechado, PC dormiu…) e ✅ quando voltar

Se o server.py estiver fora do ar, as extensões guardam os alertas (até 24 h) e mandam quando ele voltar.

## Publicar uma mudança

```bash
python versao.py
git add -A
git commit -m "..."
git push
```

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html`, `styles.css`, `app.js` | App (no PC lê o `server.py`; no celular, o Gist) |
| `sync.js` | Leitura/gravação no Gist (celular) |
| `config.js` | Endereço público e chave **pública** VAPID |
| `sw.js`, `manifest.webmanifest` | App instalável + notificações |
| `server.py` | Servidor local: recebe das extensões, Gist e Web Push |
| `versao.py` | Sobe a versão antes de publicar |

Fora do git (só no PC): `push_vapid.pem` (chave privada), `.vendor/` (`pip install --target .vendor pywebpush`),
`dados.json` (anúncios recebidos) e `ajustes.json` (token do Gist, aparelhos).
