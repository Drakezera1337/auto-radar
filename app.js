// Auto Radar — carros e motos da OLX e da Webmotors (Campos, SJB, São Francisco, São Fidélis).
//
// Os dados vêm do PC: as extensões OLX Auto Radar e Webmotors Radar avaliam os anúncios (FIPE,
// mercado, sinais de problema) e mandam para o server.py. No PC (localhost) o app lê direto do
// server.py (/api/...); fora dele (GitHub Pages, celular) lê olx.json e webmotors.json do Gist.
// Favoritos, ocultos e filtros ficam só neste aparelho.
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

// No app instalado do iPhone (iOS 26) a área da página fica uns 60pt mais curta
// que a tela e sobrava uma faixa vazia embaixo do menu. Instalado, o app ocupa a
// tela inteira, então o body usa a altura da tela quando ela for maior.
function alturaDaTela() {
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const tela = Math.abs(window.orientation) === 90 ? screen.width : screen.height;
  const h = instalado && tela > window.innerHeight ? tela : 0;
  document.body.style.height = h ? h + 'px' : '';
  document.body.style.bottom = h ? 'auto' : '';
}
alturaDaTela();
addEventListener('resize', alturaDaTela);
addEventListener('orientationchange', () => setTimeout(alturaDaTela, 300));
const NO_PC = ['localhost', '127.0.0.1'].includes(location.hostname);
const K = { favoritos: 'autoradar:favoritos', ocultos: 'autoradar:ocultos', push: 'autoradar:push',
  filtros: 'autoradar:filtros', lista: 'autoradar:lista', cache: 'autoradar:cache', vistos: 'autoradar:vistos' };
const ATUALIZAR_MS = 60000; // celular: confere o Gist a cada 1 min com o app aberto (sem mudança, o GitHub responde 304)
const POR_PAGINA = 60;

const FONTES = { olx: 'OLX', webmotors: 'Webmotors' };
const CIDADES = { campos: 'Campos', sjb: 'SJB', sfi: 'São Francisco', sfidelis: 'São Fidélis' };
const NIVEIS = {
  oportunidade: { emoji: '🔥', texto: 'Oportunidade' },
  bom: { emoji: '✅', texto: 'Bom preço' },
  suspeito: { emoji: '🤔', texto: 'Bom demais? Confira' },
  media: { emoji: '➡️', texto: 'Na média' },
  'sem-ref': { emoji: '❔', texto: 'Sem referência' },
  acima: { emoji: '⚠️', texto: 'Acima do mercado' },
  'sem-preco': { emoji: '💬', texto: 'Sem preço' },
  pendente: { emoji: '⏳', texto: 'Analisando' },
};
const FILTROS_PADRAO = { fonte: '', tipo: '', cidades: [], precoMax: '', anoMin: '', kmMax: '',
  semLeilao: false, semProblema: false, soParticular: false, ordem: 'desconto' };

const S = {
  anuncios: [], status: {}, publicadoEm: 0, erro: '', carregando: false, q: '', ultimaMudanca: 0,
  lista: localStorage.getItem(K.lista) || 'oportunidades', limite: POR_PAGINA,
  filtros: { ...FILTROS_PADRAO, ...lerJSON(K.filtros, {}) },
  favoritos: new Set(lerJSON(K.favoritos, [])),
  ocultos: new Set(lerJSON(K.ocultos, [])),
  vistos: new Set(lerJSON(K.vistos, [])), // oportunidades já vistas neste aparelho (para avisar as novas)
};

const ICON = {
  car: '<svg viewBox="0 0 24 24"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11v6a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-6Zm2.2-1h9.6l-1-3H8.2l-1 3ZM7.5 14a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21 10.6 19.7C5.4 15.1 2 12 2 8.4 2 5.4 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1A6.1 6.1 0 0 1 16.6 3C19.6 3 22 5.4 22 8.4c0 3.6-3.4 6.7-8.6 11.3L12 21Z"/></svg>',
};

// ---------------------------------------------------------------- utils
function lerJSON(chave, padrao) {
  try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
}
function gravarJSON(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* armazenamento cheio */ }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const brl = (v) => (v == null || v === '' ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR'));
const km = (v) => (v == null ? '' : Math.round(v).toLocaleString('pt-BR') + ' km');
const chave = (a) => a.fonte + ':' + a.id;
function ago(ms) {
  if (!ms) return '';
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'agora';
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  const dias = Math.floor(d / 86400);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}
function desc(d) {
  if (d == null) return '';
  return `<b class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '−' : '+'}${Math.abs(Math.round(d))}%</b>`;
}
// A OLX manda a descrição com HTML escapado ("&lt;br&gt;" = <br>), às vezes duas
// vezes. Vira texto puro: <br> e </p> viram quebra de linha, códigos (&amp;,
// &#x27;...) viram o caractere, sobra de tag sai e linhas em branco demais somem.
function limparDescricao(texto) {
  if (!texto) return "";
  let s = String(texto);
  for (let i = 0; i < 2; i++) {
    s = s.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
      .replace(/&#x27;|&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/gi, "&");
  }
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function deBase64url(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
async function api(path, opts = {}) {
  const r = await fetch('/api/' + path, {
    headers: { 'Content-Type': 'application/json' }, cache: 'no-store', ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return r.json();
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.14);
      o.start(ctx.currentTime + i * 0.15); o.stop(ctx.currentTime + i * 0.15 + 0.15);
    });
  } catch { /* sem áudio */ }
}
function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('sem conexão'));
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------- dados
// PC: server.py (/api/anuncios). Celular: Gist (olx.json + webmotors.json numa chamada só).
async function carregar({ manual = false } = {}) {
  if (S.carregando) return;
  S.carregando = true;
  try {
    let fontes;
    if (NO_PC) {
      const r = await api('anuncios');
      fontes = r.fontes;
      S.publicadoEm = Date.now();
    } else if (Sync.enabled()) {
      const arq = await Sync.ler({ 'olx.json': null, 'webmotors.json': null });
      fontes = { olx: arq['olx.json'] || {}, webmotors: arq['webmotors.json'] || {} };
      if (!fontes.olx.anuncios && !fontes.webmotors.anuncios) throw new Error('o PC ainda não publicou anúncios (o server.py está rodando?)');
      S.publicadoEm = Math.max(fontes.olx.ts || 0, fontes.webmotors.ts || 0);
    } else {
      S.carregando = false;
      return rotear();
    }
    aplicarFontes(fontes);
    if (!NO_PC) gravarJSON(K.cache, { fontes, ts: S.publicadoEm });
    avisarNovas();
    if (manual) toast('Atualizado');
    S.erro = '';
  } catch (err) {
    S.erro = err.message;
    if (manual) toast(`Não foi possível atualizar: ${err.message}`);
  } finally {
    S.carregando = false;
    atualizarSelo();
    redesenhar();
  }
}

function aplicarFontes(fontes) {
  const lista = [];
  S.status = {};
  for (const f of Object.keys(FONTES)) {
    const d = fontes[f] || {};
    for (const a of d.anuncios || []) lista.push({ ...a, fonte: f });
    S.status[f] = { ...(d.status || {}), recebidoEm: d.recebidoEm || 0, ativo: d.ativo };
  }
  S.anuncios = lista;
}

// Oportunidade que este aparelho ainda não tinha visto (a 1ª carga só registra)
function avisarNovas() {
  const ops = S.anuncios.filter((a) => a.nivel === 'oportunidade' && !a.inicial);
  const primeira = S.vistos.size === 0;
  const novas = ops.filter((a) => !S.vistos.has(chave(a)));
  ops.forEach((a) => S.vistos.add(chave(a)));
  gravarJSON(K.vistos, [...S.vistos].slice(-3000));
  if (primeira || !novas.length || document.visibilityState !== 'visible') return;
  beep(); navigator.vibrate?.([200, 100, 200]);
  toast(`🔥 ${novas.length} oportunidade${novas.length > 1 ? 's' : ''} nova${novas.length > 1 ? 's' : ''}!`);
}

// "ao vivo" = as extensões estão mandando (e, no celular, o Gist é recente)
function fontesAtivas() {
  const fresco = NO_PC || Date.now() - S.publicadoEm < 20 * 60 * 1000;
  return Object.keys(FONTES).filter((f) => fresco && S.status[f]?.ativo && !S.status[f]?.bloqueado);
}
// Por que o celular não conseguiu ler o Gist, em linguagem de gente, com o que fazer
function explicarErro(msg) {
  if (!msg) return '';
  if (/token inválido/.test(msg)) return '🔑 O token guardado neste celular não vale mais (ele foi trocado ou apagado no GitHub). No PC: Auto Radar → Ajustes → <b>Mostrar QR code</b>; aqui: Ajustes → <b>📷 Ler QR do PC</b>.';
  if (/Gist não encontrado/.test(msg)) return '🔗 O Gist que este celular conhece não existe mais. Leia o QR do PC de novo (Ajustes → 📷 Ler QR do PC).';
  if (/403/.test(msg)) return '⏳ O GitHub limitou as leituras por um tempo. Tenta de novo sozinho em alguns minutos.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '📶 Sem conexão com a internet agora — mostrando os últimos dados recebidos.';
  return `⚠️ Não consegui atualizar: ${esc(msg)}`;
}
function avisoErro() {
  if (NO_PC) return '';
  // leu sem token (token recusado): os anúncios chegam, mas avisa pra ler o QR de novo
  if (!S.erro && Sync.enabled() && Sync.tokenRecusado()) return `<div class="aviso">${explicarErro('token inválido')}<br><small>Os anúncios continuam chegando; o QR novo é preciso pras notificações.</small></div>`;
  if (!S.erro) return '';
  return `<div class="aviso">${explicarErro(S.erro)}${S.publicadoEm ? `<br><small>Mostrando os dados do PC de ${ago(S.publicadoEm)}.</small>` : ''}</div>`;
}

function atualizarSelo() {
  const el = $('#live');
  if (S.erro && !NO_PC && Sync.enabled()) {
    el.className = 'live off';
    el.querySelector('b').textContent = 'erro';
    return;
  }
  const ativas = fontesAtivas();
  const comDados = Object.keys(FONTES).filter((f) => S.status[f]?.recebidoEm);
  const tudo = ativas.length && ativas.length === comDados.length;
  el.className = 'live ' + (tudo ? 'on' : ativas.length ? 'meio' : 'off');
  el.querySelector('b').textContent = tudo ? 'ao vivo'
    : ativas.length ? `só ${ativas.map((f) => FONTES[f]).join('/')}`
      : (!NO_PC && !Sync.enabled() ? 'conectar' : 'offline');
}

// ---------------------------------------------------------------- filtros e ordem
function passaFiltros(a) {
  const f = S.filtros;
  if (f.fonte && a.fonte !== f.fonte) return false;
  if (f.tipo && a.tipo !== f.tipo) return false;
  if (f.cidades.length && !f.cidades.includes(a.cidadeKey)) return false;
  if (f.precoMax && a.preco && a.preco > Number(f.precoMax)) return false;
  if (f.anoMin && a.ano && a.ano < Number(f.anoMin)) return false;
  if (f.kmMax && a.km && a.km > Number(f.kmMax)) return false;
  if (f.semLeilao && a.leilao) return false;
  if (f.semProblema && a.problema) return false;
  if (f.soParticular && a.profissional) return false;
  if (S.q) {
    const alvo = semAcento(`${a.titulo} ${a.marca || ''} ${a.modelo || ''}`);
    if (!semAcento(S.q).split(/\s+/).filter(Boolean).every((p) => alvo.includes(p))) return false;
  }
  return true;
}
const recente = (a) => a.dataPublicacao || (a.inicial ? 0 : a.primeiroVisto) || 0;
const eNovo = (a) => !a.inicial && Date.now() - (a.primeiroVisto || 0) < 24 * 3600000;
function naLista(a, lista) {
  if (lista === 'oportunidades') return a.nivel === 'oportunidade' || a.nivel === 'suspeito';
  if (lista === 'baixaram') return Boolean(a.precoOriginal && a.precoOriginal > a.preco);
  if (lista === 'novos') return eNovo(a);
  return true;
}
function ordenar(lista) {
  const d = (a) => (a.desconto != null && a.nivel !== 'sem-preco' ? (a.nivel === 'suspeito' ? a.desconto - 100 : a.desconto) : -999);
  const fns = {
    desconto: (a, b) => d(b) - d(a) || recente(b) - recente(a),
    recente: (a, b) => recente(b) - recente(a) || d(b) - d(a),
    menorPreco: (a, b) => (a.preco || 9e12) - (b.preco || 9e12),
    menorKm: (a, b) => (a.km ?? 9e12) - (b.km ?? 9e12),
    maisNovo: (a, b) => (b.ano || 0) - (a.ano || 0) || (a.km ?? 9e12) - (b.km ?? 9e12),
  };
  return lista.sort(fns[S.filtros.ordem] || fns.desconto);
}
function filtrosAtivos() {
  const f = S.filtros;
  return [f.fonte, f.tipo, f.cidades.length, f.precoMax, f.anoMin, f.kmMax, f.semLeilao, f.semProblema, f.soParticular].filter(Boolean).length;
}
function salvarFiltros() { gravarJSON(K.filtros, S.filtros); }

// ---------------------------------------------------------------- telas
function telaConectar() {
  return `<div class="empty"><b>Conecte ao PC</b>
    No PC: Auto Radar → Ajustes → <b>Mostrar QR code</b>. Aqui: Ajustes → <b>Ler QR do PC</b>.
    <br><a class="btn btn-brand" href="#/ajustes">Ir para Ajustes</a></div>`;
}

function fotoTag(src, alt = '') {
  return src ? `<img loading="lazy" decoding="async" src="${esc(src)}" alt="${esc(alt)}" onerror="this.remove()">` : ICON.car;
}

function card(a) {
  const nv = NIVEIS[a.nivel] || NIVEIS['sem-ref'];
  const selo = a.desconto != null && a.nivel !== 'sem-preco'
    ? `${nv.emoji} ${Math.abs(Math.round(a.desconto))}% ${a.desconto >= 0 ? 'abaixo' : 'acima'}`
    : `${nv.emoji} ${nv.texto}`;
  const ref = a.mercado ? `Mercado ${brl(a.mercado.p50)} ${desc(a.descMercado)}`
    : a.fipe ? `FIPE ${brl(a.fipe)} ${desc(a.descFipe)}`
      : a.refLocal ? `Mercado RJ ${brl(a.refLocal.mediana)} ${desc(a.descLocal)}` : 'Sem referência de preço';
  const specs = [a.anoTexto || a.ano, km(a.km), a.cambio, a.cilindrada && a.tipo === 'moto' ? a.cilindrada + ' cc' : ''].filter(Boolean).join(' · ');
  const tags = (a.chips || []).filter((c) => c[0]).slice(0, 3);
  const fav = S.favoritos.has(chave(a));
  return `<a class="card nv-${esc(a.nivel)}" href="#/anuncio/${a.fonte}/${encodeURIComponent(a.id)}">
    <div class="thumb">${fotoTag(a.thumb || a.fotos?.[0])}<span class="selo">${esc(selo)}</span>${eNovo(a) ? '<span class="badge-new">NOVO</span>' : ''}</div>
    <div class="info">
      <p class="title">${a.tipo === 'moto' ? '🏍 ' : ''}${esc(a.titulo)}</p>
      <div class="price-row"><span class="price">${brl(a.preco)}</span>${a.precoOriginal && a.precoOriginal > a.preco ? `<span class="old">${brl(a.precoOriginal)}</span>` : ''}</div>
      <div class="ref">${ref}</div>
      <div class="specs">${esc(specs)}</div>
      ${tags.length ? `<div class="tags">${tags.map((c) => `<span class="tag ${esc(c[0])}">${esc(c[1])}</span>`).join('')}</div>` : ''}
      <div class="meta"><span class="local">📍 ${esc(a.cidade)}${a.profissional ? '' : ' · particular'}</span><span class="fonte ${a.fonte}">${FONTES[a.fonte]}</span></div>
    </div>
    <button class="fav-btn ${fav ? 'on' : ''}" data-fav="${esc(chave(a))}" aria-label="Favoritar">${ICON.heart}</button>
  </a>`;
}

function renderHome(soFavoritos = false) {
  if (!NO_PC && !Sync.enabled()) { view.innerHTML = telaConectar(); return; }
  const base = S.anuncios.filter((a) => passaFiltros(a) && (soFavoritos || !S.ocultos.has(chave(a))));
  let html = '';
  let lista;
  if (soFavoritos) {
    lista = ordenar(S.anuncios.filter((a) => S.favoritos.has(chave(a))));
    html += `<h2 class="section-title" style="padding:14px 16px 4px;margin:0;font-size:17px">Favoritos</h2>`;
  } else {
    const listas = [['oportunidades', '🔥 Oportunidades'], ['novos', '🆕 Novos'], ['baixaram', '📉 Baixaram'], ['todos', 'Todos']];
    html += `<div class="chips">${listas.map(([k, t]) => `<button class="chip ${S.lista === k ? 'active' : ''}" data-lista="${k}">${t}<span class="n">${base.filter((a) => naLista(a, k)).length}</span></button>`).join('')}</div>`;
    const nf = filtrosAtivos();
    html += `<div class="barra-ordem"><a href="#/filtros" class="${nf ? 'filtro-ativo' : ''}">⚙️ ${nf ? `${nf} filtro${nf > 1 ? 's' : ''} ativo${nf > 1 ? 's' : ''}` : 'Filtros'}</a>
      <select id="ordem">${[['desconto', 'Maior desconto'], ['recente', 'Mais recentes'], ['menorPreco', 'Menor preço'], ['menorKm', 'Menor km'], ['maisNovo', 'Ano mais novo']]
        .map(([v, t]) => `<option value="${v}" ${S.filtros.ordem === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    lista = ordenar(base.filter((a) => naLista(a, S.lista)));
  }
  html += avisoErro();
  const bloqueado = S.status.webmotors?.bloqueado;
  if (bloqueado && !soFavoritos) html += `<div class="aviso">⏸ A Webmotors pediu a verificação “pressione e segure”. Abra a Webmotors no Chrome do PC e confirme.</div>`;
  if (!lista.length) {
    html += `<div class="empty"><b>${soFavoritos ? 'Nenhum favorito ainda' : S.anuncios.length ? 'Nada por aqui' : 'Nenhum anúncio ainda'}</b>${
      soFavoritos ? 'Toque no ♥ de um anúncio para guardar aqui.'
        : S.anuncios.length ? (filtrosAtivos() || S.q ? 'Tente tirar algum filtro ou mudar a busca.' : 'Assim que aparecer algo, chega aqui.')
          : 'Deixe o Chrome do PC aberto com as extensões OLX Auto Radar e Webmotors Radar.'}</div>`;
  } else {
    html += `<div class="list">${lista.slice(0, S.limite).map(card).join('')}</div>`;
    if (lista.length > S.limite) html += `<button class="more" id="mais">Mostrar mais (${lista.length - S.limite})</button>`;
  }
  view.innerHTML = html;
  view.querySelectorAll('[data-lista]').forEach((b) => b.onclick = () => {
    S.lista = b.dataset.lista; S.limite = POR_PAGINA; localStorage.setItem(K.lista, S.lista); renderHome(); view.scrollTop = 0;
  });
  $('#ordem')?.addEventListener('change', (e) => { S.filtros.ordem = e.target.value; salvarFiltros(); renderHome(); });
  $('#mais')?.addEventListener('click', () => { S.limite += POR_PAGINA; renderHome(soFavoritos); });
}

// Coração do card (o card é um link: não deixa navegar)
view.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fav]');
  if (!b) return;
  e.preventDefault();
  const k = b.dataset.fav;
  if (S.favoritos.has(k)) S.favoritos.delete(k); else S.favoritos.add(k);
  gravarJSON(K.favoritos, [...S.favoritos]);
  b.classList.toggle('on', S.favoritos.has(k));
});

function linhaRef(rotulo, valor, d, obs) {
  return valor ? `<span>${rotulo}</span><b>${brl(valor)}</b><span>${desc(d)}</span>${obs ? `<small>${esc(obs)}</small>` : ''}` : '';
}

function renderDetail(fonte, id) {
  const a = S.anuncios.find((x) => x.fonte === fonte && String(x.id) === String(id));
  detalheDesenhado = location.hash + JSON.stringify(a || null);   // ver redesenhar()
  if (!a) {
    view.innerHTML = `<div class="empty"><b>Anúncio não encontrado</b>Ele pode ter saído do ar ou ainda não chegou neste aparelho.<br><a class="btn btn-brand" href="#/">Voltar</a></div>`;
    return;
  }
  const nv = NIVEIS[a.nivel] || NIVEIS['sem-ref'];
  const fotos = a.fotos?.length ? a.fotos : (a.thumb ? [a.thumb] : []);
  const k = chave(a);
  const refs = [
    linhaRef('FIPE', a.fipe, a.descFipe),
    a.mercado ? linhaRef('Mercado OLX', a.mercado.p50, a.descMercado, `mediana de ${a.mercado.n} anúncios iguais na OLX`) : '',
    !a.mercado && a.refLocal ? linhaRef('Mercado RJ', a.refLocal.mediana, a.descLocal, `mediana de ${a.refLocal.n} parecidos${a.refLocal.aprox ? ' (ano ±1)' : ''}`) : '',
  ].join('');
  const dados = [
    ['Ano', a.anoTexto || a.ano], ['Km', km(a.km)], ['Câmbio', a.cambio], ['Combustível', a.combustivel],
    ['Cilindrada', a.cilindrada && a.tipo === 'moto' ? a.cilindrada + ' cc' : ''], ['Carroceria', a.carroceria], ['Cor', a.cor],
    ['Local', a.cidade + (a.bairro ? ' · ' + a.bairro : '')], ['Vendedor', a.profissional ? `Loja${a.vendedor ? ' · ' + a.vendedor : ''}` : 'Particular'],
    ['No radar desde', a.inicial ? 'já estava no ar na 1ª leitura' : ago(a.primeiroVisto)],
    ['Publicado', a.dataPublicacao ? ago(a.dataPublicacao) : ''],
  ].filter(([, v]) => v);
  const site = FONTES[a.fonte];
  view.innerHTML = `<div class="detail">
    <div class="fotos">${fotos.length
      ? fotos.map((f, i) => `<img src="${esc(f)}" data-foto="${i}" decoding="async" ${i > 1 ? 'loading="lazy"' : ''} alt="">`).join('')
      : `<div class="sem-foto">${ICON.car}</div>`}</div>
    ${fotos.length > 1 ? `<p class="fotos-dica">${fotos.length} fotos · toque para ver em tela cheia</p>` : ''}
    <div class="body">
      <h1>${a.tipo === 'moto' ? '🏍 ' : '🚗 '}${esc(a.titulo)}</h1>
      <div class="price-row"><span class="price">${brl(a.preco)}</span>${a.precoOriginal && a.precoOriginal > a.preco ? `<span class="old">${brl(a.precoOriginal)}</span>` : ''}<span class="fonte ${a.fonte}">${site}</span></div>
      <div class="nivel-box nv-${esc(a.nivel)}">
        <strong>${nv.emoji} ${nv.texto}${a.desconto != null && a.nivel !== 'sem-preco' ? ` · ${Math.abs(Math.round(a.desconto))}% ${a.desconto >= 0 ? 'abaixo' : 'acima'}` : ''}</strong>
        ${refs ? `<div class="refs-tab">${refs}</div>` : '<span style="font-size:13px;color:var(--muted)">Sem FIPE ou preço de mercado para comparar.</span>'}
      </div>
      ${a.chips?.length ? `<div class="tags">${a.chips.map((c) => `<span class="tag ${esc(c[0])}">${esc(c[1])}</span>`).join('')}</div>` : ''}
      <div class="kv">${dados.map(([r, v]) => `<span>${esc(r)}</span><b>${esc(v)}</b>`).join('')}</div>
      ${a.descricao ? `<div class="msg">${esc(limparDescricao(a.descricao))}</div>` : ''}
    </div>
  </div>
  <div class="cta-bar">
    <a class="btn btn-${a.fonte}" href="${esc(a.url)}" target="_blank" rel="noopener">Abrir na ${site}</a>
    <button class="btn btn-ghost quadrado" id="favDet" aria-label="Favoritar">${S.favoritos.has(k) ? '♥' : '♡'}</button>
    <button class="btn btn-ghost quadrado" id="ocultar" aria-label="Ocultar" title="${S.ocultos.has(k) ? 'Mostrar de novo' : 'Ocultar'}">${S.ocultos.has(k) ? '👁' : '🙈'}</button>
  </div>`;
  view.querySelectorAll('.fotos img[data-foto]').forEach((img) => img.onclick = () => abrirGaleria(fotos.map(fotoTelaCheia), +img.dataset.foto));
  $('#favDet').onclick = () => {
    if (S.favoritos.has(k)) S.favoritos.delete(k); else S.favoritos.add(k);
    gravarJSON(K.favoritos, [...S.favoritos]);
    $('#favDet').textContent = S.favoritos.has(k) ? '♥' : '♡';
  };
  $('#ocultar').onclick = () => {
    const ocultando = !S.ocultos.has(k);
    if (ocultando) S.ocultos.add(k); else S.ocultos.delete(k);
    gravarJSON(K.ocultos, [...S.ocultos]);
    toast(ocultando ? 'Oculto — não aparece mais nas listas' : 'Voltou a aparecer nas listas');
    history.back();
  };
}

function renderFiltros() {
  const f = S.filtros;
  const opc = (campo, valores) => `<div class="opcoes">${valores.map(([v, t]) =>
    `<button class="chip ${f[campo] === v ? 'active' : ''}" data-campo="${campo}" data-v="${v}">${t}</button>`).join('')}</div>`;
  const sw = (campo, texto) => `<label class="toggle-row"><span>${texto}</span><span class="switch"><input type="checkbox" data-sw="${campo}" ${f[campo] ? 'checked' : ''}><span></span></span></label>`;
  view.innerHTML = `<div class="panel">
    <h2>Site</h2>${opc('fonte', [['', 'Todos'], ['olx', 'OLX'], ['webmotors', 'Webmotors']])}
    <h2>Tipo</h2>${opc('tipo', [['', 'Todos'], ['carro', '🚗 Carros'], ['moto', '🏍 Motos']])}
    <h2>Cidades</h2><div class="opcoes">${Object.entries(CIDADES).map(([v, t]) =>
      `<button class="chip ${f.cidades.includes(v) ? 'active' : ''}" data-cidade="${v}">${t}</button>`).join('')}</div>
    <div class="grade2">
      <div class="field"><label>Preço até (R$)</label><input type="number" inputmode="numeric" data-num="precoMax" value="${esc(f.precoMax)}" placeholder="sem limite"></div>
      <div class="field"><label>Ano a partir de</label><input type="number" inputmode="numeric" data-num="anoMin" value="${esc(f.anoMin)}" placeholder="qualquer"></div>
      <div class="field"><label>Km até</label><input type="number" inputmode="numeric" data-num="kmMax" value="${esc(f.kmMax)}" placeholder="qualquer"></div>
    </div>
    ${sw('semLeilao', 'Esconder leilão')}
    ${sw('semProblema', 'Esconder defeito, documentação ou “entrada”')}
    ${sw('soParticular', 'Só particular (sem lojas)')}
  </div>
  <div class="panel"><div class="row">
    <button class="btn btn-ghost" id="limpar">Limpar filtros</button>
    <a class="btn btn-brand" href="#/">Ver ${S.anuncios.filter((a) => passaFiltros(a) && !S.ocultos.has(chave(a))).length} anúncios</a>
  </div>
  <p style="margin-top:12px">${S.ocultos.size ? `${S.ocultos.size} anúncio(s) oculto(s) neste aparelho. <a href="#" id="reexibir" style="color:var(--brand);text-decoration:underline">Mostrar todos de novo</a>` : 'Nenhum anúncio oculto.'}</p></div>`;
  const aplicar = () => { salvarFiltros(); renderFiltros(); };
  view.querySelectorAll('[data-campo]').forEach((b) => b.onclick = () => { f[b.dataset.campo] = b.dataset.v; aplicar(); });
  view.querySelectorAll('[data-cidade]').forEach((b) => b.onclick = () => {
    const c = b.dataset.cidade;
    f.cidades = f.cidades.includes(c) ? f.cidades.filter((x) => x !== c) : [...f.cidades, c];
    aplicar();
  });
  view.querySelectorAll('[data-sw]').forEach((i) => i.onchange = () => { f[i.dataset.sw] = i.checked; aplicar(); });
  view.querySelectorAll('[data-num]').forEach((i) => i.onchange = () => { f[i.dataset.num] = i.value; aplicar(); });
  $('#limpar').onclick = () => { S.filtros = { ...FILTROS_PADRAO, ordem: f.ordem }; aplicar(); };
  $('#reexibir')?.addEventListener('click', (e) => { e.preventDefault(); S.ocultos.clear(); gravarJSON(K.ocultos, []); renderFiltros(); });
}

// ---------------------------------------------------------------- fotos em tela cheia e gestos
// Mesmo comportamento do app "OLX no celular": tocar numa foto abre em tela cheia;
// desliza pro lado entre as fotos; dois toques amplia (e dá pra arrastar);
// arrastar pra baixo, ✕, tocar fora da foto ou "voltar" do celular fecha.

// Na tela cheia vale a foto maior: OLX original (/images/), Webmotors 1280 px
function fotoTelaCheia(url) {
  const olx = /^(https:\/\/img\.olx\.com\.br\/)thumbs\d+x\d+\/(\d+\/\d+\.\w+)/.exec(url || '');
  if (olx) return `${olx[1]}images/${olx[2]}`;
  if (/image\.webmotors\.com\.br/.test(url || '')) return url.replace(/([?&])w=\d+&h=\d+/, '$1w=1280&h=960');
  return url;
}

function abrirGaleria(fotos, inicio = 0) {
  if (!fotos?.length) return;
  fecharGaleria();
  const g = document.createElement('div');
  g.id = 'galeria';
  g.innerHTML = `
    <div class="gal-topo"><span id="galCont">${inicio + 1} / ${fotos.length}</span><button type="button" class="gal-x" aria-label="Fechar">✕</button></div>
    <div class="gal-trilho">${fotos.map((f) => `<div class="gal-slide"><img src="${esc(f)}" loading="lazy" decoding="async" alt=""></div>`).join('')}</div>`;
  document.body.appendChild(g);
  const trilho = $('.gal-trilho', g);
  requestAnimationFrame(() => { trilho.scrollLeft = inicio * trilho.clientWidth; });
  trilho.addEventListener('scroll', () => {
    $('#galCont').textContent = `${Math.round(trilho.scrollLeft / trilho.clientWidth) + 1} / ${fotos.length}`;
  }, { passive: true });
  $('.gal-x', g).addEventListener('click', () => history.back());
  for (const slide of g.querySelectorAll('.gal-slide')) {
    let ultimoToque = 0;
    slide.addEventListener('click', (e) => {
      const agora = Date.now();
      if (agora - ultimoToque < 300) { // dois toques: amplia / volta ao normal
        const img = $('img', slide);
        const zoom = !slide.classList.contains('zoom');
        slide.classList.toggle('zoom', zoom);
        img.style.width = '';
        delete slide.dataset.escala;
        if (zoom) {
          const r = img.getBoundingClientRect();
          requestAnimationFrame(() => {
            slide.scrollLeft = (e.clientX - r.left) * 1.5;
            slide.scrollTop = (e.clientY - r.top) * 1.5;
          });
        }
        ultimoToque = 0;
        return;
      }
      ultimoToque = agora;
      if (e.target === slide && !slide.classList.contains('zoom')) setTimeout(() => { if (ultimoToque === agora) history.back(); }, 320);
    });
  }
  arrastarParaFechar(g, trilho);
  pincaNaFoto(g);
  history.pushState({ galeria: true }, '');
}

// Arrastar a foto pra baixo fecha a tela cheia (como no app de Fotos): a foto
// acompanha o dedo e o fundo vai clareando; soltou depois de ~120 px (ou num
// puxão rápido) fecha, senão volta pro lugar. Só vale com a foto sem zoom e
// quando o gesto começa na vertical — o deslize pro lado continua trocando foto.
function arrastarParaFechar(g, trilho) {
  let x0 = 0, y0 = 0, t0 = 0, modo = null, dy = 0;
  trilho.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('.gal-slide.zoom')) { modo = 'nada'; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); modo = null; dy = 0;
  }, { passive: true });
  trilho.addEventListener('touchmove', (e) => {
    if (modo === 'nada' || e.touches.length !== 1) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!modo) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) {
        // ainda indefinido, mas já descendo: segura o gesto pro app desde o
        // 1º movimento (no iPhone, depois que a rolagem começa não dá mais)
        if (my > 0 && my >= Math.abs(mx)) e.preventDefault();
        return;
      }
      modo = my > 0 && Math.abs(my) > Math.abs(mx) ? 'fechar' : 'nada';
      if (modo !== 'fechar') return;
      trilho.style.transition = g.style.transition = 'none';
    }
    e.preventDefault(); // não rola nada por baixo enquanto arrasta
    dy = Math.max(0, my);
    trilho.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy / 2000, 0.15)})`;
    g.style.backgroundColor = `rgba(0,0,0,${Math.max(0.2, 1 - dy / 400)})`;
  }, { passive: false });
  const soltar = () => {
    if (modo !== 'fechar') { modo = null; return; }
    modo = null;
    const rapido = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;
    trilho.style.transition = 'transform .2s ease, opacity .2s ease';
    g.style.transition = 'background-color .2s ease';
    if (dy > 120 || rapido) {
      trilho.style.transform = `translateY(${window.innerHeight}px)`;
      trilho.style.opacity = '0';
      g.style.backgroundColor = 'rgba(0,0,0,0)';
      setTimeout(() => { if (document.getElementById('galeria') === g) history.back(); }, 180);
    } else {
      trilho.style.transform = '';
      g.style.backgroundColor = '';
    }
  };
  trilho.addEventListener('touchend', soltar);
  trilho.addEventListener('touchcancel', soltar);
}

// Pinça com dois dedos amplia a foto em tela cheia (1× a 5×), mantendo o ponto
// entre os dedos no lugar. É feita pelo app porque o zoom da página está
// desligado (ver bloqueio logo abaixo). Abaixo de ~1,05× volta ao normal.
function pincaNaFoto(g) {
  for (const slide of g.querySelectorAll('.gal-slide')) {
    const img = $('img', slide);
    let d0 = 0, s0 = 1, fx = 0, fy = 0;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const meio = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    slide.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      const r = img.getBoundingClientRect();
      const m = meio(e.touches);
      d0 = dist(e.touches);
      s0 = Number(slide.dataset.escala || (slide.classList.contains('zoom') ? 2.5 : 1));
      fx = (m.x - r.left) / r.width;   // ponto da foto entre os dedos (0..1)
      fy = (m.y - r.top) / r.height;
    }, { passive: true });
    slide.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      const escala = Math.min(5, Math.max(1, s0 * dist(e.touches) / d0));
      slide.dataset.escala = String(escala);
      slide.classList.toggle('zoom', escala > 1.05);
      img.style.width = escala > 1.05 ? `${escala * 100}%` : '';
      if (escala > 1.05) {
        const m = meio(e.touches), rs = slide.getBoundingClientRect();
        slide.scrollLeft = fx * img.offsetWidth - (m.x - rs.left);
        slide.scrollTop = fy * img.offsetHeight - (m.y - rs.top);
      }
    }, { passive: false });
    const fim = (e) => {
      if (e.touches.length >= 2 || !d0) return;
      d0 = 0;
      if (Number(slide.dataset.escala || 1) <= 1.05) {
        slide.classList.remove('zoom');
        img.style.width = '';
        delete slide.dataset.escala;
      }
    };
    slide.addEventListener('touchend', fim);
    slide.addEventListener('touchcancel', fim);
  }
}

// Zoom da página bloqueado (só as fotos em tela cheia ampliam):
// - iPhone/Safari ignora o user-scalable=no e manda eventos "gesture*" na pinça;
// - fallback: dois dedos se mexendo fora da tela cheia não fazem nada.
for (const tipo of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(tipo, (e) => { if (!e.target.closest?.('#galeria')) e.preventDefault(); }, { passive: false });
}
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !e.target.closest?.('#galeria')) e.preventDefault();
}, { passive: false });

function fecharGaleria() { document.getElementById('galeria')?.remove(); }
window.addEventListener('popstate', fecharGaleria);
window.addEventListener('hashchange', fecharGaleria);

function voltarUmPasso() {
  if (history.length > 1) history.back(); else location.hash = '#/';
}

// Dentro de um anúncio, deslizar da esquerda pra direita volta um passo (como o
// gesto de voltar do iPhone, que o app instalado não tem). A tela acompanha o
// dedo; soltou depois de ~90 px (ou num puxão rápido) volta, senão fica. Não
// vale começando no carrossel de fotos (lá o deslize troca de foto) nem com a
// foto em tela cheia aberta. Move o detalhe e a barra de botões juntos (a barra
// é fixa: mover o #view inteiro a tiraria do lugar).
(function deslizarParaVoltar() {
  let x0 = 0, y0 = 0, t0 = 0, modo = null, dx = 0, alvos = [];
  const aplicar = (transform, opacity, transition) => alvos.forEach((el) => {
    el.style.transition = transition; el.style.transform = transform; el.style.opacity = opacity;
  });
  view.addEventListener('touchstart', (e) => {
    modo = 'nada';
    if (!view.classList.contains('tela-anuncio') || e.touches.length !== 1) return;
    if (document.getElementById('galeria') || e.target.closest('.fotos')) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); modo = null; dx = 0;
    alvos = [$('.detail', view), $('.cta-bar', view)].filter(Boolean);
  }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    if (modo === 'nada' || e.touches.length !== 1) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!modo) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      modo = mx > 0 && mx > Math.abs(my) * 1.5 ? 'voltar' : 'nada';
      if (modo !== 'voltar') return;
    }
    e.preventDefault();
    dx = Math.max(0, mx);
    aplicar(`translateX(${dx}px)`, String(Math.max(0.4, 1 - dx / 600)), 'none');
  }, { passive: false });
  const soltar = () => {
    if (modo !== 'voltar') { modo = null; return; }
    modo = null;
    const rapido = dx > 40 && dx / Math.max(1, Date.now() - t0) > 0.6;
    if (dx > 90 || rapido) {
      aplicar(`translateX(${window.innerWidth}px)`, '0', 'transform .18s ease, opacity .18s ease');
      setTimeout(voltarUmPasso, 160);
    } else {
      aplicar('', '', 'transform .18s ease, opacity .18s ease');
    }
  };
  view.addEventListener('touchend', soltar);
  view.addEventListener('touchcancel', soltar);
})();

// ---------------------------------------------------------------- notificações (Web Push)
function pushSuportado() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function chaveParaBytes(b64url) {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function descreverAparelho() {
  const ua = navigator.userAgent;
  const tipo = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Computador';
  return `${tipo} · Auto Radar (ativado em ${new Date().toLocaleDateString('pt-BR')})`;
}
async function ativarPush() {
  if (!Sync.enabled()) return toast('Conecte ao PC primeiro (Ler QR do PC)');
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') { renderSettings(); return toast('Sem permissão para notificar'); }
  try {
    const reg = await navigator.serviceWorker.getRegistration('./') || await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(AR_CONFIG.pushChavePublica) });
    const { endpoint, keys } = sub.toJSON();
    const registro = { endpoint, keys, aparelho: descreverAparelho(), criadoEm: Date.now() };
    await Sync.atualizarInscricao(endpoint, registro);
    gravarJSON(K.push, registro);
    toast('Notificações ativadas neste aparelho');
  } catch (err) {
    toast(`Não foi possível ativar: ${err.message}`);
  }
  renderSettings();
}
async function testarPush() {
  const registro = lerJSON(K.push, null);
  if (!registro) return renderSettings();
  try {
    await Sync.atualizarInscricao(registro.endpoint, { ...registro, testeEm: Date.now() });
    toast('Teste pedido ao PC — chega em até 1 min (com o PC ligado)');
  } catch (err) {
    toast(`Não foi possível pedir o teste: ${err.message}`);
  }
}
async function desativarPush() {
  const registro = lerJSON(K.push, null);
  try {
    const reg = await navigator.serviceWorker.getRegistration('./');
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
    if (registro) await Sync.atualizarInscricao(registro.endpoint, null);
  } catch { /* segue desligando localmente */ }
  gravarJSON(K.push, null);
  toast('Notificações desativadas neste aparelho');
  renderSettings();
}

// ---------------------------------------------------------------- celular: QR / link de configuração
// O QR abre o Auto Radar publicado com #config=…; o fragmento (#) não vai a nenhum servidor e é apagado ao ler.
function aplicarLinkConfig(texto) {
  const match = String(texto || '').match(/#config=([\w%-]+)/);
  if (!match) return false;
  try {
    const { token, gistId } = JSON.parse(deBase64url(decodeURIComponent(match[1])));
    if (!token || !gistId) throw new Error();
    Sync.setConfig({ token, gistId });
    toast('Conectado ao PC — carregando anúncios…');
    return true;
  } catch {
    toast('Link de configuração inválido');
    return false;
  }
}
let leitorStream = null;
let jsQrScript;
function pararLeitorQr() {
  leitorStream?.getTracks().forEach((t) => t.stop());
  leitorStream = null;
  const box = $('#leitorQr'); if (box) box.hidden = true;
}
async function lerQr() {
  const video = $('#videoQr');
  try {
    leitorStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    return toast('Sem acesso à câmera — permita nas configurações ou cole o link abaixo');
  }
  video.srcObject = leitorStream;
  $('#leitorQr').hidden = false;
  await video.play().catch(() => {});
  let ler;
  if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')) {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    ler = async () => (await detector.detect(video))[0]?.rawValue;
  } else {
    try {
      jsQrScript ??= carregarScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js').catch((e) => { jsQrScript = null; throw e; });
      await jsQrScript;
    } catch {
      pararLeitorQr();
      return toast('Não foi possível carregar o leitor de QR — cole o link abaixo');
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ler = async () => {
      if (!video.videoWidth) return null;
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      return jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
    };
  }
  while (leitorStream) {
    const texto = await ler().catch(() => null);
    if (texto?.includes('#config=')) {
      pararLeitorQr();
      if (aplicarLinkConfig(texto)) { location.hash = '#/'; carregar(); }
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
let qrScript;
async function mostrarQr() {
  const caixa = $('#qrCodigo');
  if (!caixa.hidden) { caixa.hidden = true; caixa.innerHTML = ''; return; }
  const r = await api('celular');
  if (!r.url) return toast(r.erro || 'Conecte o Gist primeiro');
  try {
    qrScript ??= carregarScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').catch((e) => { qrScript = null; throw e; });
    await qrScript;
  } catch {
    return toast('Não foi possível carregar o gerador de QR code');
  }
  caixa.innerHTML = '';
  new QRCode(caixa, { text: r.url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.L });
  caixa.hidden = false;
}

// ---------------------------------------------------------------- ajustes
function blocoMonitor() {
  const linhas = Object.entries(FONTES).map(([f, nome]) => {
    const st = S.status[f] || {};
    const n = S.anuncios.filter((a) => a.fonte === f).length;
    const ops = S.anuncios.filter((a) => a.fonte === f && a.nivel === 'oportunidade').length;
    let estado;
    if (!st.recebidoEm) estado = `🔴 <b>${nome}</b>: ainda não mandou nada. Carregue a extensão no Chrome do PC.`;
    else if (st.bloqueado) estado = `⏸ <b>${nome}</b>: pediu a verificação “pressione e segure” — abra a Webmotors no PC e confirme.`;
    else if (!fontesAtivas().includes(f)) estado = `🔴 <b>${nome}</b>: parado. Último envio ${ago(st.recebidoEm)}.`;
    else estado = `🟢 <b>${nome}</b>: monitorando. Última leitura ${ago(st.ultimoCiclo || st.recebidoEm)}.`;
    const erros = (st.erros || []).length && !st.bloqueado ? `<br>⚠️ ${esc(st.erros.join(' · '))}` : '';
    return `<div class="fonte-status"><div>${estado}<br>${n} anúncios · ${ops} oportunidade${ops === 1 ? '' : 's'}${erros}</div></div>`;
  }).join('');
  return `<div class="panel"><h2>Status do monitor</h2>${linhas}
    ${!NO_PC && S.publicadoEm ? `<p style="margin:8px 0 0">Dados do PC ${ago(S.publicadoEm)}.</p>` : ''}</div>`;
}

async function renderSettings() {
  pararLeitorQr();
  const versao = `Versão ${typeof AR_VERSAO === 'number' ? AR_VERSAO : '?'}${NO_PC ? ' · no PC' : ''}`;
  if (NO_PC) {
    let st;
    try { st = await api('status'); } catch { view.innerHTML = '<div class="empty"><b>server.py fora do ar</b></div>'; return; }
    view.innerHTML = `${blocoMonitor()}
    <div class="panel">
      <h2>📱 Celular</h2>
      <p>O celular usa o app publicado (<a class="code" href="${esc(AR_CONFIG.sitePublico)}" target="_blank">${esc(AR_CONFIG.sitePublico.replace('https://', ''))}</a>), que lê os anúncios de um <b>Gist secreto</b> do GitHub e recebe as notificações deste PC.</p>
      <p>${st.gist ? `✅ Conectado ao Gist ${esc(st.gist.id.slice(0, 8))}… · token …${esc(st.gist.tokenFim)}` : 'Nenhum Gist conectado: o celular não recebe anúncios nem avisos.'}</p>
      <div class="field"><label>Token do GitHub (só a permissão <b>gist</b>, exclusivo do Auto Radar)</label>
        <div class="row"><input id="token" type="password" placeholder="ghp_… ou github_pat_…" autocomplete="off" style="flex:3">
        <button class="btn btn-brand btn-sm" id="conectar">${st.gist ? 'Trocar' : 'Conectar'}</button></div>
      </div>
      <p><a href="https://github.com/settings/tokens/new?scopes=gist&description=Auto%20Radar" target="_blank" rel="noopener" style="color:var(--brand);text-decoration:underline">Criar um token com a permissão gist ↗</a> (escolha validade “No expiration”)</p>
      <div class="row" style="margin-top:8px">
        <button class="btn btn-orange" id="qr" ${st.gist ? '' : 'disabled'}>Mostrar QR code</button>
        <button class="btn btn-ghost" id="teste" ${st.aparelhos.length ? '' : 'disabled'}>Testar notificação</button>
      </div>
      <div id="qrCodigo" class="qr" hidden></div>
      <p style="margin-top:12px"><b>Aparelhos com notificação (${st.aparelhos.length})</b><br>${st.aparelhos.length ? st.aparelhos.map(esc).join('<br>') : 'Nenhum ainda. No celular: leia o QR → Ajustes → 🔔 Ativar notificações.'}</p>
      ${st.pushPronto ? '' : '<p>⚠️ Push desligado no server.py: falta <span class="code">push_vapid.pem</span> ou a pasta <span class="code">.vendor</span>.</p>'}
    </div>
    <p class="versao">${versao}</p>`;
    $('#conectar').onclick = async () => {
      const token = $('#token').value.trim();
      if (!token) return toast('Cole o token do GitHub');
      const r = await api('gist', { method: 'POST', body: { token } });
      toast(r.ok ? (r.criado ? 'Gist do Auto Radar criado e conectado' : 'Gist do Auto Radar conectado') : `Não foi possível conectar: ${r.erro}`);
      renderSettings();
    };
    $('#qr').onclick = mostrarQr;
    $('#teste').onclick = async () => {
      const r = await api('push-teste', { method: 'POST' });
      toast(r.ok ? `Enviada para ${r.aparelhos} aparelho(s)` : 'Nenhum aparelho recebeu');
    };
    return;
  }

  const inscricao = lerJSON(K.push, null);
  const ativo = Boolean(inscricao) && pushSuportado() && Notification.permission === 'granted';
  const conectado = Sync.enabled();
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.innerHTML = `${conectado ? blocoMonitor() : ''}
  <div class="panel">
    <h2>🔔 Notificações</h2>
    <p>${!pushSuportado() ? '⚠️ Este navegador não suporta notificações. No iPhone, abra o Auto Radar pelo ícone da tela de início (iOS 16.4 ou mais novo).'
      : ativo ? '✅ Notificações ativas neste aparelho. As oportunidades chegam na hora, mesmo com o app fechado. O que vira alerta (desconto mínimo, leilão, preço máximo…) é ajustado nas extensões do PC.'
        : Notification.permission === 'denied' ? '🚫 Notificações bloqueadas: libere nas configurações do celular/navegador.'
          : 'Notificações desligadas neste aparelho.'}</p>
    <div class="row">
      ${!ativo && pushSuportado() && Notification.permission !== 'denied' ? '<button class="btn btn-orange" id="ativar">🔔 Ativar notificações</button>' : ''}
      ${ativo ? '<button class="btn btn-brand" id="testar">Enviar teste</button><button class="btn btn-ghost" id="desativar">Desativar</button>' : ''}
    </div>
  </div>
  <div class="panel">
    <h2>🔗 Conexão com o PC</h2>
    <p>${conectado ? (S.erro ? explicarErro(S.erro) : Sync.tokenRecusado() ? explicarErro('token inválido') : `✅ Conectado ao Gist ${esc(Sync.config().gistId.slice(0, 8))}…`) : 'No PC: Auto Radar → Ajustes → <b>Mostrar QR code</b>. Aqui: leia o QR.'}</p>
    <div class="row"><button class="btn ${conectado ? 'btn-ghost' : 'btn-brand'}" id="lerQr">📷 Ler QR do PC</button></div>
    <div id="leitorQr" class="leitor" hidden><video id="videoQr" playsinline muted></video><button class="btn btn-ghost btn-sm" id="pararQr">Cancelar</button></div>
    <div class="field" style="margin-top:12px"><label>Ou cole o link de configuração</label><input id="linkConfig" placeholder="https://…#config=…"></div>
  </div>
  ${instalado ? '' : `<div class="panel"><h2>📲 Instalar na tela inicial</h2>
    <p>Android (Chrome): menu ⋮ → <b>Instalar app</b>. iPhone (Safari): Compartilhar → <b>Adicionar à Tela de Início</b>, e abra pelo ícone.</p></div>`}
  <p class="versao">${versao}</p>`;
  $('#ativar')?.addEventListener('click', ativarPush);
  $('#testar')?.addEventListener('click', testarPush);
  $('#desativar')?.addEventListener('click', desativarPush);
  $('#lerQr').onclick = lerQr;
  $('#pararQr').onclick = pararLeitorQr;
  $('#linkConfig').onchange = (e) => { if (aplicarLinkConfig(e.target.value)) { location.hash = '#/'; carregar(); } e.target.value = ''; };
}

// ---------------------------------------------------------------- roteador
function rotaAtual() {
  const h = location.hash || '#/';
  const tab = h.startsWith('#/filtros') ? 'filtros' : h.startsWith('#/favoritos') ? 'favoritos' : h.startsWith('#/ajustes') ? 'ajustes' : 'home';
  return { h, tab };
}
function rotear() {
  const { h, tab } = rotaAtual();
  document.querySelectorAll('.bottomnav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  view.classList.toggle('tela-anuncio', h.startsWith('#/anuncio/'));   // liga o deslizar pra voltar
  if (h.startsWith('#/anuncio/')) {
    const [fonte, id] = h.slice(10).split('/');
    renderDetail(fonte, decodeURIComponent(id || ''));
    view.scrollTop = 0;
    return;
  }
  if (tab === 'filtros') return renderFiltros();
  if (tab === 'ajustes') return renderSettings();
  if (tab === 'favoritos') return renderHome(true);
  renderHome();
}
// Redesenha sem atrapalhar: não mexe em Filtros/Ajustes enquanto o usuário mexe neles
// No anúncio aberto, só redesenha se o anúncio mudou de verdade (senão a tela
// voltaria pro topo e o carrossel pra 1ª foto no meio da leitura) e nunca com
// a foto em tela cheia aberta.
let detalheDesenhado = '';
function redesenhar() {
  const { h, tab } = rotaAtual();
  if (h.startsWith('#/anuncio/')) {
    if (document.getElementById('galeria')) return;
    const [fonte, id] = h.slice(10).split('/');
    const a = S.anuncios.find((x) => x.fonte === fonte && String(x.id) === decodeURIComponent(id || ''));
    const assinatura = h + JSON.stringify(a || null);
    if (assinatura === detalheDesenhado) return;
    detalheDesenhado = assinatura;
    const y = view.scrollTop;
    rotear();
    view.scrollTop = y;
    return;
  }
  detalheDesenhado = '';
  if (tab === 'home' || tab === 'favoritos') {
    const y = view.scrollTop;
    rotear();
    view.scrollTop = y;
  }
}

let qTimer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    S.q = e.target.value.trim();
    S.limite = POR_PAGINA;
    if (rotaAtual().tab !== 'home' || location.hash.startsWith('#/anuncio/')) location.hash = '#/';
    else renderHome();
  }, 200);
});
window.addEventListener('hashchange', rotear);
$('#live').addEventListener('click', () => { if (!NO_PC) location.hash = '#/ajustes'; });

// ---------------------------------------------------------------- atualização ao vivo
async function laçoPc() {
  // long-poll: o server.py responde assim que uma extensão manda algo novo
  for (;;) {
    try {
      const r = await api('wait?since=' + S.ultimaMudanca);
      if (r.ultima > S.ultimaMudanca) { S.ultimaMudanca = r.ultima; await carregar(); }
    } catch {
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
}
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.tipo === 'push') setTimeout(() => carregar(), 40000); // dá tempo do PC publicar no Gist
  if (e.data?.tipo === 'abrir' && e.data.url) location.href = e.data.url;
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !NO_PC) carregar(); });
setInterval(() => { if (!document.hidden && !NO_PC) carregar(); }, ATUALIZAR_MS);
setInterval(() => { if (!document.hidden) { atualizarSelo(); redesenhar(); } }, 60000); // "há X min"

// ---------------------------------------------------------------- início
if (location.hash.startsWith('#config=')) {
  const hash = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  aplicarLinkConfig(hash);
}
if (!NO_PC) {
  // abre na hora com o que já tinha (depois atualiza)
  const cache = lerJSON(K.cache, null);
  if (cache?.fontes) { aplicarFontes(cache.fontes); S.publicadoEm = cache.ts; }
}
if ('serviceWorker' in navigator && !NO_PC) navigator.serviceWorker.register('sw.js').catch(() => {});
atualizarSelo();
rotear();
carregar().then(() => { if (NO_PC) laçoPc(); });
