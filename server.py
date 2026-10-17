"""
Auto Radar - servidor local.

Recebe das extensoes do Chrome (OLX Auto Radar e Webmotors Radar) os anuncios de
carros e motos ja avaliados (FIPE, mercado, sinais) e:
  - serve o app no PC (http://localhost:8790);
  - publica os anuncios num Gist secreto (o app do celular, no GitHub Pages, le de la);
  - envia Web Push (VAPID) quando a extensao marca uma oportunidade;
  - avisa no celular quando uma extensao para de enviar ou a Webmotors pede verificacao.
Mesmo esquema do Rastreazera / FB Radar / Ofertazera.

Rode:  python server.py   (pywebpush fica em .vendor/, a chave privada em push_vapid.pem)
"""
import base64
import hashlib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("AUTORADAR_PORT", "8790"))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DADOS_PATH = os.path.join(BASE_DIR, "dados.json")      # anuncios recebidos (fora do git)
AJUSTES_PATH = os.path.join(BASE_DIR, "ajustes.json")  # token do Gist, inscricoes... (fora do git)

FONTES = {
    # sem sinal por mais que isso → avisa no celular que a extensao parou
    "olx": {"nome": "OLX", "parada_min": 15},
    "webmotors": {"nome": "Webmotors", "parada_min": 25},
}

SITE_PUBLICO = "https://drakezera1337.github.io/auto-radar/"
PUSH_PEM = os.path.join(BASE_DIR, "push_vapid.pem")
PUSH_CONTATO = "mailto:276884055+Drakezera1337@users.noreply.github.com"
GIST_API = "https://api.github.com/gists"
GIST_DESCRICAO = "Auto Radar – carros e motos (OLX + Webmotors)"
GIST_LER_S = 30              # confere push.json (inscricoes e pedidos de teste)
GIST_PUBLICAR_MIN_S = 90     # o GitHub bloqueia (403) quem grava arquivos grandes no Gist com muita frequencia
GIST_REPUBLICAR_S = 10 * 60  # sem novidade, republica (o celular ve que o PC esta vivo)
ANUNCIO_MAX_DIAS = 7         # anuncio que nao aparece ha mais que isso sai do celular
CELULAR_MAX_POR_FONTE = 300  # o Gist (e o celular) recebe so o que interessa; o app do PC mostra tudo
CELULAR_DESCRICAO = 300      # caracteres da descricao no Gist
CELULAR_FOTOS = 4


# --------------------------------------------------------------------------- #
# Estado (arquivos JSON, gravados de forma atomica)
# --------------------------------------------------------------------------- #
_lock = threading.Lock()


def ler_json(caminho, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


def gravar_json(caminho, valor):
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(valor, f, ensure_ascii=False)
    os.replace(tmp, caminho)


DADOS = ler_json(DADOS_PATH, {})          # {fonte: {anuncios: [...], status: {...}, recebidoEm: ms}}
AJUSTES_BAK = AJUSTES_PATH.replace(".json", ".bak.json")
AJUSTES = ler_json(AJUSTES_PATH, {})      # {gistToken, gistId, inscricoes, testes, notificados, avisos}
# ajustes.json sumiu ou perdeu a conexao com o Gist (apagado sem querer): volta da copia
if not AJUSTES.get("gistToken"):
    _bak = ler_json(AJUSTES_BAK, {})
    if _bak.get("gistToken"):
        AJUSTES = {**_bak, **AJUSTES, "gistToken": _bak["gistToken"], "gistId": _bak.get("gistId"),
                   "inscricoes": AJUSTES.get("inscricoes") or _bak.get("inscricoes") or []}
        STATE_INICIO = "[ajustes] conexao com o Gist restaurada da copia de seguranca (ajustes.bak.json)"
_publicar = threading.Event()
_mudou = threading.Condition()
STATE = {"ultima_mudanca": 0}


def salvar_ajustes():
    with _lock:
        gravar_json(AJUSTES_PATH, AJUSTES)
        if AJUSTES.get("gistToken"):
            gravar_json(AJUSTES_BAK, AJUSTES)   # copia de seguranca da conexao com o celular


def agora_ms():
    return int(time.time() * 1000)


def avisar_mudanca():
    with _mudou:
        STATE["ultima_mudanca"] = agora_ms()
        _mudou.notify_all()
    _publicar.set()


# --------------------------------------------------------------------------- #
# Recebimento das extensoes
# --------------------------------------------------------------------------- #
def receber(corpo):
    fonte = str(corpo.get("fonte") or "")
    if fonte not in FONTES:
        return {"erro": "fonte desconhecida"}, 400
    anuncios = [a for a in (corpo.get("anuncios") or []) if isinstance(a, dict) and a.get("id")]
    status = corpo.get("status") or {}
    anterior = DADOS.get(fonte) or {}
    with _lock:
        DADOS[fonte] = {"anuncios": anuncios, "status": status, "recebidoEm": agora_ms()}
        gravar_json(DADOS_PATH, DADOS)

    # Webmotors pediu "pressione e segure" / voltou: avisa uma vez em cada mudanca
    bloqueou = bool(status.get("bloqueado"))
    if bloqueou != bool((anterior.get("status") or {}).get("bloqueado")):
        if bloqueou:
            enviar_push({"title": "⏸ Webmotors pediu verificação",
                         "body": "Abra a Webmotors no Chrome do PC e confirme o “pressione e segure”. O radar volta sozinho.",
                         "tag": "autoradar-bloqueio-" + fonte})
        elif anterior:
            enviar_push({"title": "✅ Webmotors voltou", "body": "Verificação confirmada, o radar está lendo de novo.",
                         "tag": "autoradar-bloqueio-" + fonte})

    # Extensao tinha parado e voltou
    avisos = AJUSTES.setdefault("avisos", {})
    if avisos.get(fonte):
        avisos[fonte] = False
        salvar_ajustes()
        enviar_push({"title": f"✅ {FONTES[fonte]['nome']}: voltou a monitorar", "body": "Tudo certo de novo.",
                     "tag": "autoradar-parou-" + fonte})

    # Oportunidades que a extensao mandou avisar (ela reenvia ate receber "ok": dedup aqui)
    por_id = {a["id"]: a for a in anuncios}
    notificados = AJUSTES.setdefault("notificados", {})
    enviados = 0
    for alerta in corpo.get("alertas") or []:
        ad = por_id.get(str(alerta.get("id")))
        if not ad:
            continue
        chave = f"{fonte}:{ad['id']}:{alerta.get('motivo', 'novo')}:{ad.get('preco')}"
        if chave in notificados:
            continue
        notificados[chave] = agora_ms()
        n = enviar_push(payload_anuncio(fonte, ad, alerta.get("motivo")))
        enviados += 1
        print(f"[push] {FONTES[fonte]['nome']} {ad.get('titulo', '')[:50]} -> {n} aparelho(s)")
    if enviados:
        limite = agora_ms() - 30 * 86400000
        AJUSTES["notificados"] = {k: v for k, v in notificados.items() if v > limite}
        salvar_ajustes()

    avisar_mudanca()
    return {"ok": True, "alertasRecebidos": len(corpo.get("alertas") or []),
            "aparelhos": len(AJUSTES.get("inscricoes") or []), "gist": bool(gist_cfg())}, 200


def anuncios_publicos():
    """Anuncios ativos das duas fontes (o que o celular mostra)."""
    limite = agora_ms() - ANUNCIO_MAX_DIAS * 86400000
    st = status_fontes()
    saida = {}
    for fonte in FONTES:
        d = DADOS.get(fonte) or {}
        lista = [a for a in d.get("anuncios") or [] if (a.get("vistoEm") or a.get("primeiroVisto") or 0) > limite]
        saida[fonte] = {"anuncios": lista, "status": d.get("status") or {}, "recebidoEm": d.get("recebidoEm") or 0,
                        "ativo": st[fonte]["ativo"]}
    return saida


def status_fontes():
    agora = agora_ms()
    saida = {}
    for fonte, info in FONTES.items():
        d = DADOS.get(fonte) or {}
        rec = d.get("recebidoEm") or 0
        saida[fonte] = {
            "nome": info["nome"], "recebidoEm": rec,
            "ativo": bool(rec) and agora - rec < info["parada_min"] * 60000,
            "total": len(d.get("anuncios") or []), "status": d.get("status") or {},
        }
    return saida


# --------------------------------------------------------------------------- #
# Web Push
# --------------------------------------------------------------------------- #
_webpush = None


def carregar_webpush():
    global _webpush
    if _webpush is None:
        vendor = os.path.join(BASE_DIR, ".vendor")
        if vendor not in sys.path:
            sys.path.insert(0, vendor)
        try:
            from pywebpush import WebPushException, webpush
            _webpush = (webpush, WebPushException)
        except ImportError as exc:
            print(f"[push] desligado: pywebpush nao encontrado em .vendor ({exc})")
            _webpush = False
    return _webpush or None


def enviar_push(payload, inscricoes=None):
    """Envia para os aparelhos inscritos; tira do push.json os que nao existem mais."""
    lib = carregar_webpush()
    if inscricoes is None:
        inscricoes = list(AJUSTES.get("inscricoes") or [])
    if not lib or not inscricoes or not os.path.exists(PUSH_PEM):
        return 0
    webpush, WebPushException = lib
    mortos, ok = [], 0
    for insc in inscricoes:
        try:
            webpush(subscription_info={"endpoint": insc["endpoint"], "keys": insc["keys"]},
                    data=json.dumps(payload, ensure_ascii=False), vapid_private_key=PUSH_PEM,
                    vapid_claims={"sub": PUSH_CONTATO}, ttl=6 * 3600, timeout=15,
                    headers={"Urgency": "high"})
            ok += 1
        except WebPushException as exc:
            if getattr(exc.response, "status_code", None) in (404, 410):
                mortos.append(insc["endpoint"])
            print(f"[push] {insc.get('aparelho', '?')}: {exc}")
        except (KeyError, TypeError) as exc:
            print(f"[push] inscricao invalida: {exc}")
    if mortos:
        AJUSTES["inscricoes"] = [i for i in AJUSTES.get("inscricoes") or [] if i["endpoint"] not in mortos]
        salvar_ajustes()
        if gist_cfg():
            try:
                gist_request("PATCH", {"files": {"push.json": {"content": json.dumps(AJUSTES["inscricoes"], indent=1)}}})
            except Exception as exc:  # noqa: BLE001
                print(f"[push] nao consegui limpar push.json: {exc}")
    return ok


def fmt_brl(v):
    return "R$ " + f"{round(v):,}".replace(",", ".") if v else "—"


NIVEIS = {"oportunidade": "🔥 Oportunidade", "suspeito": "🤔 Bom demais? (confira)", "bom": "✅ Bom preço"}


def payload_anuncio(fonte, ad, motivo):
    nivel = NIVEIS.get(ad.get("nivel"), "🔥 Oportunidade")
    cab = ("📉 Baixou · " if motivo == "baixou" else "") + nivel
    linhas = []
    preco = fmt_brl(ad.get("preco"))
    if motivo == "baixou" and ad.get("precoAnterior"):
        preco += f" (era {fmt_brl(ad['precoAnterior'])})"
    linhas.append("💰 " + preco)
    refs = []
    if ad.get("fipe"):
        refs.append(f"FIPE {fmt_brl(ad['fipe'])}")
    if ad.get("mercado"):
        refs.append(f"mercado {fmt_brl(ad['mercado'].get('p50'))}")
    elif ad.get("refLocal"):
        refs.append(f"mercado RJ {fmt_brl(ad['refLocal'].get('mediana'))}")
    if ad.get("desconto") is not None:
        refs.append(f"{abs(round(ad['desconto']))}% {'abaixo' if ad['desconto'] >= 0 else 'acima'}")
    if refs:
        linhas.append("📋 " + " · ".join(refs))
    specs = [str(x) for x in (ad.get("anoTexto") or ad.get("ano"), (f"{ad['km']:,} km".replace(",", ".") if ad.get("km") is not None else None), ad.get("cambio")) if x]
    if specs:
        linhas.append("📅 " + " · ".join(specs))
    linhas.append("📍 " + (ad.get("cidade") or "") + (" · Particular" if not ad.get("profissional") else " · Loja"))
    alertas = [c[1] for c in ad.get("chips") or [] if c and c[0] in ("ruim", "aviso")]
    if alertas:
        linhas.append("⚠️ " + " · ".join(alertas[:3]))
    resumo = {k: ad.get(k) for k in ("id", "titulo", "preco", "url", "nivel", "desconto")}
    resumo["fonte"] = fonte
    return {
        "title": f"{cab} · {FONTES[fonte]['nome']}",
        "body": (ad.get("titulo") or "")[:90] + "\n" + "\n".join(linhas),
        "tag": f"autoradar-{fonte}-{ad['id']}",
        "image": ad.get("fotoGrande") or (ad.get("fotos") or [None])[0],
        "anuncio": resumo,
    }


# --------------------------------------------------------------------------- #
# Gist secreto (o celular le daqui)
#   olx.json / webmotors.json  publicados por aqui
#   push.json                  aparelhos inscritos (o celular grava; daqui sai o push)
# --------------------------------------------------------------------------- #
def gist_cfg():
    token, gid = AJUSTES.get("gistToken"), AJUSTES.get("gistId")
    return {"token": token, "gistId": gid} if token and gid else None


def github(url, token, method="GET", corpo=None):
    req = urllib.request.Request(
        url, method=method, data=json.dumps(corpo).encode() if corpo is not None else None,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json", "User-Agent": "AutoRadar"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())


# ETag da ultima versao do Gist que este servidor conhece (leu ou acabou de gravar).
# GET condicional que volta 304 nao conta no limite de 5000/h da conta (dividido
# com Ofertazera, Rastreazera, OLX no celular...) e nao baixa os ~900 KB de novo.
_gist_etag = {"valor": None}
# Contadores do limite da conta que o GitHub devolve em cada resposta (o mesmo pote
# de 5000/h dos outros apps com token "classic"): aparecem em /api/status e no log
LIMITE = {}


def anotar_limite(headers):
    # so o pote "core" (5000/h, o que estoura); outros recursos tem limites proprios
    if headers and headers.get("X-RateLimit-Limit") and (headers.get("X-RateLimit-Resource") or "core") == "core":
        LIMITE.update({"limite": int(headers.get("X-RateLimit-Limit") or 0),
                       "usados": int(headers.get("X-RateLimit-Used") or 0),
                       "restantes": int(headers.get("X-RateLimit-Remaining") or 0),
                       "zeraEm": int(headers.get("X-RateLimit-Reset") or 0) * 1000,
                       "visto": agora_ms()})


def gist_request(method="GET", corpo=None, condicional=False):
    """condicional=True: devolve None quando o Gist nao mudou desde a ultima vez (304)."""
    cfg = gist_cfg()
    headers = {"Authorization": f"Bearer {cfg['token']}", "Accept": "application/vnd.github+json",
               "Content-Type": "application/json", "User-Agent": "AutoRadar"}
    if condicional and _gist_etag["valor"]:
        headers["If-None-Match"] = _gist_etag["valor"]
    req = urllib.request.Request(f"{GIST_API}/{cfg['gistId']}", method=method, headers=headers,
                                 data=json.dumps(corpo).encode() if corpo is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            anotar_limite(res.headers)
            _gist_etag["valor"] = res.headers.get("ETag") or _gist_etag["valor"]
            return json.loads(res.read())
    except urllib.error.HTTPError as exc:
        anotar_limite(exc.headers)
        if exc.code == 304:
            return None
        raise


def conectar_gist(token):
    """Usa o Gist do Auto Radar que ja existe na conta; senao cria um (secreto)."""
    lista = github(f"{GIST_API}?per_page=100", token)
    existente = next((g for g in lista if g.get("description") == GIST_DESCRICAO), None)
    if existente:
        gid, criado = existente["id"], False
    else:
        gid = github(GIST_API, token, "POST", {
            "description": GIST_DESCRICAO, "public": False,
            "files": {"olx.json": {"content": "{}"}, "webmotors.json": {"content": "{}"}, "push.json": {"content": "[]"}}})["id"]
        criado = True
    AJUSTES["gistToken"], AJUSTES["gistId"] = token, gid
    salvar_ajustes()
    _publicar.set()
    return gid, criado


def json_do_arquivo(arquivos, nome, padrao):
    arq = arquivos.get(nome)
    if not arq:
        return padrao
    conteudo = arq.get("content") or ""
    if arq.get("truncated") and arq.get("raw_url"):
        with urllib.request.urlopen(arq["raw_url"], timeout=30) as r:
            conteudo = r.read().decode("utf-8")
    try:
        return json.loads(conteudo) if conteudo else padrao
    except ValueError:
        return padrao


def para_o_celular(anuncios):
    """Corta o que vai pro Gist: todas as oportunidades/bons precos/que baixaram/novos
    (48 h) e completa com os mais recentes ate CELULAR_MAX_POR_FONTE, com descricao e
    fotos reduzidas. Sem isso o olx.json passava de 1 MB e o GitHub bloqueava (403)."""
    agora = agora_ms()
    def importante(a):
        return (a.get("nivel") in ("oportunidade", "suspeito", "bom")
                or (a.get("precoOriginal") or 0) > (a.get("preco") or 0)
                or (not a.get("inicial") and agora - (a.get("primeiroVisto") or 0) < 48 * 3600000))
    imp = [a for a in anuncios if importante(a)]
    ids = {a["id"] for a in imp}
    resto = sorted((a for a in anuncios if a["id"] not in ids),
                   key=lambda a: -(a.get("dataPublicacao") or a.get("primeiroVisto") or 0))
    saida = []
    for a in imp + resto[:max(0, CELULAR_MAX_POR_FONTE - len(imp))]:
        b = {k: v for k, v in a.items() if k not in ("fotoGrande", "vistoEm")}
        if b.get("descricao"):
            b["descricao"] = b["descricao"][:CELULAR_DESCRICAO]
        if b.get("fotos"):
            b["fotos"] = b["fotos"][:CELULAR_FOTOS]
        saida.append(b)
    return saida


def conteudo_publicacao():
    """{arquivo: texto} e uma assinatura que so muda quando os anuncios mudam."""
    pub = anuncios_publicos()
    arquivos, assinatura = {}, hashlib.sha1()
    for fonte, d in pub.items():
        lista = para_o_celular(d["anuncios"])
        assinatura.update(json.dumps(lista, sort_keys=True, ensure_ascii=False).encode())
        assinatura.update(json.dumps([d["status"].get("bloqueado"), d["ativo"]]).encode())
        arquivos[f"{fonte}.json"] = json.dumps({**d, "anuncios": lista, "total": len(d["anuncios"]), "ts": agora_ms()},
                                                ensure_ascii=False, separators=(",", ":"))
    return arquivos, assinatura.hexdigest()


def processar_push_json():
    """Le push.json (inscricoes + pedidos de teste vindos do celular). So baixa o
    Gist se ele mudou desde a ultima leitura/gravacao deste servidor (ETag)."""
    gist = gist_request(condicional=True)
    if gist is None:
        return  # nada mudou (o celular nao mexeu no push.json)
    arquivos = gist.get("files") or {}
    inscricoes = [i for i in json_do_arquivo(arquivos, "push.json", [])
                  if isinstance(i, dict) and i.get("endpoint") and i.get("keys")]
    AJUSTES["inscricoes"] = inscricoes  # copia local: o push sai mesmo com o GitHub fora do ar
    testes = AJUSTES.setdefault("testes", {})
    for insc in inscricoes:
        if insc.get("testeEm", 0) > testes.get(insc["endpoint"], 0):
            testes[insc["endpoint"]] = insc["testeEm"]
            enviar_push({"title": "Auto Radar", "body": "🔔 Teste: as notificações estão funcionando neste aparelho!",
                         "tag": "autoradar-teste"}, [insc])
            print(f"[push] teste enviado ({insc.get('aparelho', '?')})")
    salvar_ajustes()


def laco_gist():
    ultima_leitura = ultima_publicacao = 0
    assinatura_publicada = None
    pausa_ate, espera = 0, 60  # bloqueio do GitHub (403/429): espera o pedido ou 1 min, dobrando
    while True:
        _publicar.wait(timeout=5)
        _publicar.clear()
        if not gist_cfg():
            continue
        agora = time.time()
        if agora < pausa_ate:
            continue
        try:
            if agora - ultima_leitura > GIST_LER_S:
                ultima_leitura = agora
                processar_push_json()
            arquivos, assinatura = conteudo_publicacao()
            mudou = assinatura != assinatura_publicada
            if (mudou and agora - ultima_publicacao >= GIST_PUBLICAR_MIN_S) or agora - ultima_publicacao > GIST_REPUBLICAR_S:
                gist_request("PATCH", {"files": {k: {"content": v} for k, v in arquivos.items()}})
                ultima_publicacao, assinatura_publicada = time.time(), assinatura
            # mudou mas ainda nao passou o intervalo minimo: o wait(5 s) do laco tenta de novo
            espera = 60
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429):
                try:  # o GitHub diz o motivo (limite secundario, token sem permissao...)
                    motivo = json.loads(exc.read() or b"{}").get("message", "")
                except Exception:  # noqa: BLE001
                    motivo = ""
                print(f"[gist] resposta do GitHub: {exc.code} {motivo[:120]} | limite da conta: {LIMITE}")
                pedido = int(exc.headers.get("Retry-After") or 0)
                segundos = max(pedido, espera)
                pausa_ate, espera = time.time() + segundos, min(espera * 2, 900)
                print(f"[gist] GitHub bloqueou ({exc.code}); tento de novo em {int(segundos)} s")
            else:
                print(f"[gist] {exc}")
                time.sleep(10)
        except Exception as exc:  # noqa: BLE001 - sem internet, token trocado...: tenta de novo
            print(f"[gist] {exc}")
            time.sleep(10)


def watchdog():
    """Extensao sem enviar ha muito tempo (Chrome fechado, PC dormiu...): avisa no celular uma vez."""
    while True:
        time.sleep(60)
        avisos = AJUSTES.setdefault("avisos", {})
        for fonte, st in status_fontes().items():
            if st["recebidoEm"] and not st["ativo"] and not avisos.get(fonte):
                avisos[fonte] = True
                salvar_ajustes()
                _publicar.set()
                enviar_push({"title": f"⚠️ {st['nome']}: parou de monitorar",
                             "body": "A extensão não manda nada há um tempo. Confira se o Chrome do PC está aberto.",
                             "tag": "autoradar-parou-" + fonte})
                print(f"[monitor] {st['nome']} parou")


# --------------------------------------------------------------------------- #
# HTTP (so no proprio PC: as extensoes e o app em localhost)
# --------------------------------------------------------------------------- #
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE_DIR, **kw)

    def log_message(self, fmt, *args):  # silencioso
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    # Arquivos do servidor que nunca podem ser servidos
    PRIVADOS = (".json", ".pem", ".tmp", ".py", ".bat", ".md", ".txt", ".log", ".1")
    PUBLICOS = ("manifest.webmanifest",)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        path = u.path
        if path == "/api/anuncios":
            return self._json({"fontes": anuncios_publicos(), "status": status_fontes(), "ts": agora_ms()})
        if path == "/api/status":
            return self._json(self.status_json())
        if path == "/api/celular":
            # link de configuracao do celular (vai no QR code); so existe com o Gist conectado
            cfg = gist_cfg()
            if not cfg:
                return self._json({"erro": "Conecte o Gist primeiro"}, 400)
            dados = json.dumps(cfg, separators=(",", ":")).encode()
            b64 = urllib.parse.quote(base64.urlsafe_b64encode(dados).decode().rstrip("="))
            return self._json({"url": f"{SITE_PUBLICO}#config={b64}"})
        if path == "/api/wait":
            # long-poll do app no PC: segura ate chegar algo novo (max 25 s)
            since = int(qs.get("since") or 0)
            deadline = time.time() + 25
            with _mudou:
                while STATE["ultima_mudanca"] <= since and time.time() < deadline:
                    _mudou.wait(timeout=max(0.1, deadline - time.time()))
            return self._json({"ultima": STATE["ultima_mudanca"]})
        nome = path.rsplit("/", 1)[-1].lower()
        if (nome.endswith(self.PRIVADOS) and nome not in self.PUBLICOS) or "/." in path:
            return self._json({"erro": "não encontrado"}, 404)
        return super().do_GET()

    def status_json(self):
        cfg = gist_cfg()
        return {
            "fontes": status_fontes(),
            "gist": {"id": cfg["gistId"], "tokenFim": cfg["token"][-4:]} if cfg else None,
            "aparelhos": [i.get("aparelho", "?") for i in AJUSTES.get("inscricoes") or []],
            "pushPronto": os.path.exists(PUSH_PEM) and bool(carregar_webpush()),
            "limiteGitHub": LIMITE,
            "agora": agora_ms(),
        }

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self._body()
        if path == "/api/radar":
            resposta, codigo = receber(body)
            return self._json(resposta, codigo)
        if path == "/api/gist":
            token = str(body.get("token") or "").strip()
            if not token:
                return self._json({"erro": "Cole o token do GitHub"}, 400)
            try:
                gid, criado = conectar_gist(token)
            except urllib.error.HTTPError as e:
                msg = {401: "token inválido", 403: "o token não tem a permissão gist"}.get(e.code, f"erro {e.code}")
                return self._json({"erro": msg}, 400)
            except Exception as e:  # noqa: BLE001
                return self._json({"erro": str(e)}, 400)
            return self._json({"ok": True, "gistId": gid, "criado": criado})
        if path == "/api/push-teste":
            n = enviar_push({"title": "Auto Radar", "body": "🔔 Teste: as notificações estão funcionando!",
                             "tag": "autoradar-teste"})
            return self._json({"ok": n > 0, "aparelhos": n})
        return self._json({"erro": "rota inválida"}, 404)


class Servidor(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # Conexao fechada pelo navegador/extensao no meio da resposta: normal, nao polui o log
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)

    # No Windows, SO_REUSEADDR deixaria um segundo server.py escutar a mesma porta junto com o primeiro
    allow_reuse_address = sys.platform != "win32"
    daemon_threads = True


def log_sem_janela():
    """Com pythonw.exe (inicio automatico, sem janela) nao ha console: as mensagens vao para server.log."""
    if sys.stdout is not None:
        return
    caminho = os.path.join(BASE_DIR, "server.log")
    if os.path.exists(caminho) and os.path.getsize(caminho) > 2_000_000:
        os.replace(caminho, caminho + ".1")  # guarda so o anterior
    arquivo = open(caminho, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = arquivo
    print(f"\n--- iniciado em {time.strftime('%d/%m/%Y %H:%M:%S')} ---")


def main():
    log_sem_janela()
    if globals().get("STATE_INICIO"):
        print(STATE_INICIO)
    try:
        server = Servidor(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"O Auto Radar já está rodando (porta {PORT} ocupada).")
        return
    threading.Thread(target=watchdog, daemon=True).start()
    threading.Thread(target=laco_gist, daemon=True).start()
    cfg = gist_cfg()
    print("=" * 60)
    print(" AUTO RADAR rodando!")
    print(f"   No PC:      http://localhost:{PORT}/")
    print(f"   Celular:    {SITE_PUBLICO}  ({'Gist conectado' if cfg else 'conecte o Gist em Ajustes'})")
    print(f"   Push:       {'pronto' if os.path.exists(PUSH_PEM) and carregar_webpush() else 'FALTA push_vapid.pem ou .vendor'}")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
