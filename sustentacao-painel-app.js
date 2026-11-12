/**
 * Sustentação Mondial — Painel Executivo
 * Lógica de dados, indicadores e interface (padrão do painel GMUD v2026.11.12-1208).
 *
 * Camadas:
 *   sustentacao-painel-config.js  → regras de negócio (SUST_CONFIG)
 *   data/base-sustentacao.json    → base oficial lida do servidor ao abrir (todos veem a mesma base)
 *   sustentacao-painel-dados.js   → cópia embutida (SUST_BASE), usada sem servidor ou se o JSON falhar
 *   sustentacao-painel-app.js     → este arquivo
 *
 * Princípios: nenhum número fixo no código; nenhum dado fictício; ausência de dado ≠ zero;
 * status e tempos de SLA vêm da ferramenta (D-03); nenhum ticket fica de fora dos indicadores.
 */
(function () {
  'use strict';

  const VERSAO = '2026.11.12-1208';
  const CFG = window.SUST_CONFIG;
  const COR = {
    azul: '#005AA9', azulEscuro: '#003C70', azulMedio: '#0284C7',
    verde: '#10B981', amarelo: '#F59E0B', roxo: '#8B5CF6', vermelho: '#ED1C24',
    vermelhoEscuro: '#B91C1C', laranja: '#F97316', vermelhoAlerta: '#EF4444', cinza: '#94A3B8'
  };
  const COR_OUTROS = '#94A3B8';
  const ESTADO_COR = {
    'Fechado': '#005AA9', 'Resolvido': '#10B981', 'Pendente Fornecedor': '#8B5CF6',
    'Pendente': '#F59E0B', 'Aberto': '#0284C7', 'Pendente Aprovação': '#F97316', 'ReOpen': '#ED1C24'
  };
  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const FONTE = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const COLS_OP = [6, 22, 12, 6.5, 9.5, 10, 10.5, 7.8, 8, 7.7]; // % das colunas da fila operacional

  // Colunas tratadas (mesma lista do tools/gerar_dados_sustentacao.py — decisão D-05)
  const COLUNAS = ['ID do ticket', 'Assunto', 'Estado', 'Tipo', 'Prioridade', 'Agente', 'Grupo',
    'Categoria', 'Subcategoria', 'Item', 'Serviço / Sistema', 'Aplicação',
    'Fornecedor', 'Chamado com Fornecedor', 'Departamento', 'Localização do solicitante',
    'Origem', 'Tipo de associação',
    'Hora de criação', 'Hora de vencimento', 'Tempo de resposta inicial',
    'Tempo da primeira resposta (em horas)', 'Estado da primeira resposta',
    'Hora de resolução', 'Tempo de resolução (em horas)', 'Estado de resolução',
    'Hora de fecho', 'Hora da última atualização',
    'Interações do agente', 'Interações com o Cliente'];
  const COLUNAS_OPCIONAIS = ['Urgência', 'Impacto', 'Modulo', 'OFENSOR', 'Resultado do inquérito'];

  const TABS = ['visao-executiva', 'backlog-aging', 'sla-tempos', 'sistemas', 'demanda-areas', 'desvios', 'operacao', 'todos-chamados'];

  const state = {
    meta: {}, fonte: '', registros: [], ref: null, D: [],
    baseOficial: null,
    filtros: { ano: '', mes: '', estado: '', tipo: '', prioridade: '', categoria: '', sistema: '', fornecedor: '', agente: '', prazo: '', inconf: '' },
    activeTab: 'visao-executiva',
    tv: false, tvTick: 0, tvTimer: null,
    charts: {},
    op: { filtro: 'todos', busca: '', vel: 'lento', pausado: false, hover: false },
    kb: { filtro: 'todos', grupo: 'estado', vel: 'lento', pausado: false },
    porId: new Map()
  };

  /* ======================================================================
     UTILITÁRIOS
     ====================================================================== */
  const $ = id => document.getElementById(id);
  const txt = v => (v === undefined || v === null) ? '' : String(v).trim();
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setT = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const fmtInt = n => (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR');
  const fmtNum1 = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtPct = p => (p === null || p === undefined || isNaN(p)) ? '—' : `${fmtNum1(p)}%`;
  const fmtH = h => (h === null || h === undefined || isNaN(h)) ? '—' : `${fmtNum1(h)}h`;
  const fmtD = d => (d === null || d === undefined || isNaN(d)) ? '—' : `${fmtNum1(d)}d`;
  const fmtData = d => d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '—';
  const fmtDataCurta = d => d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}` : '—';
  const fmtDataHora = d => d ? `${fmtData(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
  const chaveMes = d => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}` : null;
  const rotuloMes = k => { const [y, m] = k.split('-'); return `${MESES[+m - 1]}/${y.slice(2)}`; };
  const val = v => v === '' ? CFG.rotuloNaoInformado : v;
  const pctDe = (a, b) => b ? (a / b) * 100 : null;

  function parseData(s) {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
    const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  function parseHoras(s) {
    const t = txt(s);
    if (!t) return null;
    const m = t.match(/^(\d+):(\d{2}):(\d{2})$/);
    return m ? +m[1] + (+m[2]) / 60 + (+m[3]) / 3600 : null;
  }
  function contar(arr, fn) {
    const m = new Map();
    arr.forEach(r => { const k = fn(r); m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }
  const ordenarDesc = map => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR'));
  function percentil(valores, p) {
    const v = valores.filter(x => x !== null && x !== undefined && !isNaN(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const pos = (v.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  }
  function media(valores) {
    const v = valores.filter(x => x !== null && x !== undefined && !isNaN(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  function sla(arr, campo) {
    const dentro = arr.filter(r => r[campo] === CFG.slaDentro).length;
    const violado = arr.filter(r => r[campo] === CFG.slaViolado).length;
    const n = dentro + violado;
    return { dentro, violado, n, pct: pctDe(dentro, n) };
  }
  function toast(msg, erro) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (erro ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, 5200);
  }

  /* ======================================================================
     NORMALIZAÇÃO E REGRAS
     ====================================================================== */
  function normalizar(r) {
    const agenteBruto = txt(r['Agente']);
    const categoria = txt(r['Categoria']);
    const semAgente = agenteBruto === CFG.inconformidade.agenteSemResponsavel || agenteBruto === '';
    const semCategoria = !!CFG.inconformidade.categoriaVazia && categoria === '';
    const estado = txt(r['Estado']);
    const rec = {
      id: txt(r['ID do ticket']),
      assunto: txt(r['Assunto']),
      estado,
      tipo: txt(r['Tipo']),
      prioridade: txt(r['Prioridade']),
      urgencia: txt(r['Urgência']),
      impacto: txt(r['Impacto']),
      agenteBruto,
      agente: semAgente ? CFG.rotuloSemAgente : agenteBruto,
      grupo: txt(r['Grupo']),
      categoria,
      subcategoria: txt(r['Subcategoria']),
      item: txt(r['Item']),
      sistema: txt(r['Serviço / Sistema']),
      aplicacao: txt(r['Aplicação']),
      modulo: txt(r['Modulo']),
      fornecedor: txt(r['Fornecedor']),
      chamadoForn: txt(r['Chamado com Fornecedor']),
      departamento: txt(r['Departamento']),
      localizacao: txt(r['Localização do solicitante']),
      origem: txt(r['Origem']),
      associacao: txt(r['Tipo de associação']),
      ofensor: txt(r['OFENSOR']),
      pesquisa: txt(r['Resultado do inquérito']),
      criado: parseData(r['Hora de criação']),
      venc: parseData(r['Hora de vencimento']),
      fr: parseData(r['Tempo de resposta inicial']),
      frH: parseHoras(r['Tempo da primeira resposta (em horas)']),
      slaFr: txt(r['Estado da primeira resposta']),
      res: parseData(r['Hora de resolução']),
      resH: parseHoras(r['Tempo de resolução (em horas)']),
      slaRes: txt(r['Estado de resolução']),
      fec: parseData(r['Hora de fecho']),
      upd: parseData(r['Hora da última atualização']),
      intAgente: txt(r['Interações do agente']),
      intCliente: txt(r['Interações com o Cliente'])
    };
    rec.backlog = CFG.estadosBacklog.includes(estado);
    rec.encerrado = CFG.estadosEncerrados.includes(estado);
    rec.semAgente = semAgente;
    rec.semCategoria = semCategoria;
    rec.inconf = semAgente || semCategoria;
    // 1ª resposta só é válida quando há hora da 1ª resposta (00:00:00 sem resposta = ausência)
    if (!rec.fr) rec.frH = null;
    // Regra GMUD: fechado fora do prazo = resolução depois do vencimento (status gravado pela ferramenta)
    rec.foraPrazo = rec.encerrado && rec.slaRes === CFG.slaViolado;
    rec.noPrazo = rec.encerrado && rec.slaRes === CFG.slaDentro;
    rec.foraPrazoCalc = !!(rec.res && rec.venc && rec.res > rec.venc);
    rec.leadDias = (rec.encerrado && rec.res && rec.criado) ? (rec.res - rec.criado) / 864e5 : null;
    rec.atrasoH = (rec.foraPrazo && rec.res && rec.venc) ? (rec.res - rec.venc) / 36e5 : null;
    return rec;
  }

  function carregarBase(base, fonte) {
    const cols = base.colunas || [];
    const linhas = (base.linhas || []).map(l => {
      const o = {};
      cols.forEach((c, i) => { o[c] = l[i]; });
      return o;
    });
    state.meta = base.meta || {};
    state.fonte = fonte;
    state.registros = linhas.map(normalizar);
    state.ref = parseData(state.meta.dataReferencia) ||
      state.registros.reduce((mx, r) => (r.upd && (!mx || r.upd > mx)) ? r.upd : mx, null);
    state.porId = new Map();
    state.registros.forEach(r => {
      r.agingDias = (r.backlog && r.criado && state.ref) ? (state.ref - r.criado) / 864e5 : null;
      // Regra GMUD: atrasado = em aberto com vencimento anterior à data de referência
      r.atrasado = !!(r.backlog && r.venc && state.ref && r.venc < state.ref);
      state.porId.set(r.id, r);
    });
    const criacoes = state.registros.filter(r => r.criado).map(r => r.criado.getTime());
    state.criacaoMin = criacoes.length ? new Date(Math.min(...criacoes)) : null;
    state.criacaoMax = criacoes.length ? new Date(Math.max(...criacoes)) : null;
    state.lacunaDias = (state.ref && state.criacaoMax) ? Math.floor((state.ref - state.criacaoMax) / 864e5) : 0;
    state.baseParcial = state.lacunaDias > CFG.alertaCoberturaDias;
  }

  /* ======================================================================
     FILTROS
     ====================================================================== */
  function filtrados() {
    const f = state.filtros;
    return state.registros.filter(r => {
      if (f.ano && !(r.criado && String(r.criado.getFullYear()) === f.ano)) return false;
      if (f.mes && !(r.criado && pad(r.criado.getMonth() + 1) === f.mes)) return false;
      if (f.estado && r.estado !== f.estado) return false;
      if (f.tipo && r.tipo !== f.tipo) return false;
      if (f.prioridade && r.prioridade !== f.prioridade) return false;
      if (f.categoria && val(r.categoria) !== f.categoria) return false;
      if (f.sistema && val(r.sistema) !== f.sistema) return false;
      if (f.fornecedor && val(r.fornecedor) !== f.fornecedor) return false;
      if (f.agente && r.agente !== f.agente) return false;
      if (f.prazo === 'atrasado' && !r.atrasado) return false;
      if (f.prazo === 'fora' && !r.foraPrazo) return false;
      if (f.prazo === 'noprazo' && !r.noPrazo) return false;
      if (f.inconf === 'somente' && !r.inconf) return false;
      if (f.inconf === 'excluir' && r.inconf) return false;
      return true;
    });
  }

  function popularFiltros() {
    const R = state.registros;
    const ord = (a, b) => a.localeCompare(b, 'pt-BR');
    const opcoes = {
      'f-ano': [...new Set(R.filter(r => r.criado).map(r => String(r.criado.getFullYear())))].sort(),
      'f-mes': [...new Set(R.filter(r => r.criado).map(r => pad(r.criado.getMonth() + 1)))].sort(),
      'f-estado': [...new Set(R.map(r => r.estado))].filter(Boolean).sort(ord),
      'f-tipo': [...new Set(R.map(r => r.tipo))].filter(Boolean).sort(ord),
      'f-prioridade': [...new Set(R.map(r => r.prioridade))].filter(Boolean).sort(ord),
      'f-categoria': [...new Set(R.map(r => val(r.categoria)))].sort(ord),
      'f-sistema': [...new Set(R.map(r => val(r.sistema)))].sort(ord),
      'f-fornecedor': [...new Set(R.map(r => val(r.fornecedor)))].sort(ord),
      'f-agente': [...new Set(R.map(r => r.agente))].sort(ord)
    };
    Object.entries(opcoes).forEach(([id, lista]) => {
      const el = $(id);
      const atual = el.value;
      el.innerHTML = el.options[0].outerHTML + lista.map(v => `<option value="${esc(v)}">${esc(id === 'f-mes' ? MESES[+v - 1] : v)}</option>`).join('');
      if (lista.includes(atual)) el.value = atual; else { el.value = ''; state.filtros[el.dataset.f] = ''; }
    });
  }

  function atualizarBadgeFiltros() {
    const n = Object.values(state.filtros).filter(Boolean).length;
    const b = $('filter-count-badge');
    b.textContent = n;
    b.style.display = n ? 'inline-block' : 'none';
  }

  /* ======================================================================
     GRÁFICOS (Chart.js) — padrão visual GMUD
     ====================================================================== */
  const valueLabelsPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || opts.display === false) return;
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const isH = chart.config.options.indexAxis === 'y';
      const isDonut = chart.config.type === 'doughnut';
      const isTv = document.body.classList.contains('tv-mode');
      const sc = chart.config.options.scales || {};
      const stacked = !!((sc.x && sc.x.stacked) || (sc.y && sc.y.stacked));
      ctx.save();
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (!meta || meta.hidden) return;
        if (opts.somenteDatasets && !opts.somenteDatasets.includes(di)) return;
        const isLine = (ds.type || chart.config.type) === 'line';
        const total = ds.data.reduce((a, b) => a + (Number(b) || 0), 0);
        meta.data.forEach((el, i) => {
          const raw = ds.data[i];
          if (raw === null || raw === undefined || isNaN(raw) || (Number(raw) === 0 && !opts.mostrarZero)) return;
          const label = typeof opts.formatter === 'function' ? opts.formatter(raw, { ds, i, di, chart }) : fmtInt(raw);
          if (label === null || label === undefined) return;
          ctx.font = `800 ${isTv ? 12.5 : 11}px ${FONTE}`;
          if (isDonut) {
            const ang = el.endAngle - el.startAngle;
            if (ang < 0.25) return;
            const mid = (el.startAngle + el.endAngle) / 2, rad = (el.innerRadius + el.outerRadius) / 2;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
            ctx.fillStyle = '#FFFFFF';
            const pct = total ? Math.round(raw / total * 100) : 0;
            ctx.fillText(ang > 0.8 ? `${fmtInt(raw)} (${pct}%)` : fmtInt(raw), el.x + Math.cos(mid) * rad, el.y + Math.sin(mid) * rad);
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
          } else if (isLine) {
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            if (opts.fundoLinha) {
              const tw = ctx.measureText(label).width;
              ctx.fillStyle = 'rgba(255,255,255,0.92)';
              ctx.strokeStyle = opts.corLinha || '#0F172A'; ctx.lineWidth = 1;
              const bx = el.x - tw / 2 - 4, by = el.y - 22, bw = tw + 8, bh = 15;
              ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 4) : ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
            }
            ctx.fillStyle = opts.corLinha || '#0F172A';
            ctx.fillText(label, el.x, el.y - 9);
          } else if (isH) {
            if (stacked) {
              const w = Math.abs(el.x - el.base);
              if (w < ctx.measureText(label).width + 8) return;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#FFFFFF';
              ctx.fillText(label, (el.x + el.base) / 2, el.y);
              return;
            }
            const tw = ctx.measureText(label).width;
            let x = el.x + 6;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            if (x + tw + 4 > chartArea.right) { x = Math.max(chartArea.left + 4, el.x - tw - 6); ctx.fillStyle = '#FFFFFF'; }
            else ctx.fillStyle = '#0F172A';
            ctx.fillText(label, x, el.y);
          } else {
            if (stacked) {
              const h = Math.abs(el.base - el.y);
              if (h < 14) return;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#FFFFFF';
              ctx.fillText(label, el.x, (el.y + el.base) / 2);
              return;
            }
            ctx.textAlign = 'center';
            let y = el.y - 4; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#0F172A';
            if (y < chartArea.top + 12) { y = el.y + 12; ctx.textBaseline = 'middle'; ctx.fillStyle = '#FFFFFF'; }
            ctx.fillText(label, el.x, y);
          }
        });
      });
      ctx.restore();
    }
  };
  const donutCenterPlugin = {
    id: 'doughnutCenter',
    afterDraw(chart) {
      if (chart.config.type !== 'doughnut') return;
      const o = chart.config.options.plugins.doughnutCenter;
      if (!o) return;
      const { ctx, chartArea } = chart;
      const cx = (chartArea.left + chartArea.right) / 2, cy = (chartArea.top + chartArea.bottom) / 2;
      const isTv = document.body.classList.contains('tv-mode');
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${isTv ? 24 : 20}px ${FONTE}`; ctx.fillStyle = '#003C70';
      ctx.fillText(o.mainText, cx, cy - 7);
      ctx.font = `700 ${isTv ? 11 : 9.5}px ${FONTE}`; ctx.fillStyle = '#64748B';
      ctx.fillText(o.subText, cx, cy + 12);
      ctx.restore();
    }
  };
  const temChart = () => typeof Chart !== 'undefined';
  if (temChart()) {
    Chart.register(valueLabelsPlugin, donutCenterPlugin);
    Chart.defaults.font.family = FONTE;
    Chart.defaults.color = '#475569';
    Chart.defaults.borderColor = '#E2E8F0';
    Chart.defaults.plugins.tooltip.backgroundColor = '#003C70';
    Chart.defaults.plugins.tooltip.titleFont = { weight: '800', size: 11.5 };
    Chart.defaults.plugins.tooltip.bodyFont = { weight: '600', size: 11 };
    Chart.defaults.plugins.tooltip.padding = 8;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
  }

  function estadoVazio(id, vazio, msg) {
    const canvas = $(id);
    if (!canvas) return;
    const body = canvas.closest('.chart-body');
    let ov = body.querySelector('.chart-empty');
    if (vazio) {
      if (!ov) { ov = document.createElement('div'); ov.className = 'chart-empty'; body.appendChild(ov); }
      ov.textContent = msg || 'Sem dados para os filtros selecionados.';
    } else if (ov) ov.remove();
  }

  function grafico(id, type, data, options, vazio) {
    const el = $(id);
    if (!el) return;
    if (!temChart()) { estadoVazio(id, true, 'Gráfico indisponível: a biblioteca Chart.js não carregou (sem acesso à internet). Os números dos cards continuam válidos.'); return; }
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
    estadoVazio(id, vazio);
    if (vazio) return;
    state.charts[id] = new Chart(el, {
      type, data,
      // Mesmo efeito de criação do painel GMUD (createChart): 3,2 s com easeOutQuart; rosca com respiro de 24 px
      options: Object.assign({ responsive: true, maintainAspectRatio: false },
        (type === 'doughnut' || type === 'pie') && !(options && options.layout) ? { layout: { padding: 24 } } : {},
        options,
        { animation: options && options.animation !== undefined ? options.animation : { duration: CFG.graficosAnimacaoMs || 3200, easing: 'easeOutQuart' } })
    });
  }

  function barrasH(id, entradas, opts = {}) {
    const labels = entradas.map(e => e[0]);
    const dados = entradas.map(e => e[1]);
    grafico(id, 'bar', {
      labels,
      datasets: [{ label: opts.rotulo || 'Tickets', data: dados, backgroundColor: opts.cores || dados.map(() => opts.cor || COR.azul), borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.85 }]
    }, {
      indexAxis: 'y',
      layout: { padding: { right: 8 } },
      scales: {
        x: { beginAtZero: true, grace: '16%', max: opts.max, grid: { color: '#F1F5F9' }, ticks: { font: { size: 10 }, callback: opts.tickFmt } },
        y: { grid: { display: false }, ticks: { font: { size: 10.5, weight: 600 }, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 32 ? l.slice(0, 31) + '…' : l; } } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: opts.tooltip || {} }, valueLabels: { display: true, formatter: opts.formatter, mostrarZero: opts.mostrarZero } }
    }, !entradas.length || dados.every(d => !d && !opts.mostrarZero));
  }

  function barrasV(id, labels, dados, opts = {}) {
    grafico(id, 'bar', {
      labels,
      datasets: [{ label: opts.rotulo || 'Tickets', data: dados, backgroundColor: opts.cores || opts.cor || COR.azul, borderRadius: 4 }]
    }, {
      scales: { y: { beginAtZero: true, grace: '16%', grid: { color: '#F1F5F9' }, ticks: { font: { size: 10 } } }, x: { grid: { display: false }, ticks: { font: { size: 10.5, weight: 600 } } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: opts.tooltip || {} }, valueLabels: { display: true, formatter: opts.formatter } }
    }, !labels.length || dados.every(d => !d));
  }

  const legendaTopo = { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: 600 } } };
  const ordemPrio = ['Alta', 'Média', 'Baixa'];
  const ordenarPrio = arr => arr.sort((a, b) => (ordemPrio.indexOf(a) + 1 || 99) - (ordemPrio.indexOf(b) + 1 || 99));

  /* ---------------- KPI: pulsação e semáforo ---------------- */
  function pulsar(cardId, ativo) {
    const c = $(cardId);
    if (c) c.classList.toggle('kpi-card-atrasadas', !!ativo);
  }
  function semaforo(cardId, pct) {
    const c = $(cardId);
    if (!c) return;
    c.classList.remove('sem-verde', 'sem-amarelo', 'sem-vermelho');
    const m = CFG.metaSla;
    if (!m || pct === null || pct === undefined) return;
    c.classList.add(pct >= m.verde ? 'sem-verde' : pct >= m.amarelo ? 'sem-amarelo' : 'sem-vermelho');
  }

  /* ======================================================================
     ABA 1 — VISÃO EXECUTIVA
     ====================================================================== */
  function renderVisao(D) {
    const B = D.filter(r => r.backlog);
    const E = D.filter(r => r.encerrado);
    const sRes = sla(E, 'slaRes'), sFr = sla(D, 'slaFr');
    const atrasados = B.filter(r => r.atrasado).length;
    const fora = E.filter(r => r.foraPrazo).length;
    const inconf = D.filter(r => r.inconf).length;
    const lead = media(E.map(r => r.leadDias));

    setT('k-total', fmtInt(D.length));
    const datas = D.filter(r => r.criado).map(r => r.criado.getTime());
    setT('k-total-sub', datas.length ? `criados de ${fmtDataCurta(new Date(Math.min(...datas)))} a ${fmtDataCurta(new Date(Math.max(...datas)))}` : 'sem registros');
    setT('k-backlog', fmtInt(B.length));
    setT('k-encerrados', fmtInt(E.length));
    setT('k-sla-res', fmtPct(sRes.pct));
    setT('k-sla-res-sub', `${fmtInt(sRes.dentro)} no prazo de ${fmtInt(sRes.n)}`);
    semaforo('k-card-sla', sRes.pct);
    setT('k-lead', fmtD(lead));
    setT('k-lead-sub', `mediana ${fmtD(percentil(E.map(r => r.leadDias), 0.5))} • criação → resolução`);
    setT('k-atrasados', fmtInt(atrasados));
    setT('k-atrasados-sub', B.length ? `${Math.round(atrasados / B.length * 100)}% dos abertos • vencimento expirado` : 'sem tickets em aberto');
    pulsar('k-card-atrasados', atrasados > 0);
    setT('k-fora', fmtInt(fora));
    setT('k-fora-sub', sRes.n ? `${fmtPct(pctDe(fora, sRes.n))} dos encerrados • resolução após o vencimento` : 'Resolução após o vencimento');
    pulsar('k-card-fora', fora > 0);
    setT('k-sla-fr', fmtPct(sFr.pct));
    setT('k-sla-fr-sub', `${fmtInt(sFr.violado)} violados de ${fmtInt(sFr.n)}`);
    semaforo('k-card-fr', sFr.pct);
    setT('k-inconf', fmtInt(inconf));
    setT('k-inconf-sub', D.length ? `${fmtPct(pctDe(inconf, D.length))} • sem agente / sem categoria` : '—');

    // Evolução mensal (entrada = criação; encerrado = mês da resolução — D-04)
    const meses = new Map();
    const reg = k => { if (!meses.has(k)) meses.set(k, { e: 0, s: 0 }); return meses.get(k); };
    D.forEach(r => {
      if (r.criado) reg(chaveMes(r.criado)).e++;
      if (r.encerrado && r.res) reg(chaveMes(r.res)).s++;
    });
    const ks = [...meses.keys()].sort();
    grafico('c-evolucao', 'bar', {
      labels: ks.map(rotuloMes),
      datasets: [
        { label: 'Entradas', data: ks.map(k => meses.get(k).e), backgroundColor: COR.azul, borderRadius: 4 },
        { label: 'Encerrados', data: ks.map(k => meses.get(k).s), backgroundColor: COR.verde, borderRadius: 4 }
      ]
    }, {
      scales: { y: { beginAtZero: true, grace: '16%', grid: { color: '#F1F5F9' } }, x: { grid: { display: false } } },
      plugins: { legend: legendaTopo, valueLabels: { display: true } }
    }, !ks.length);

    const est = ordenarDesc(contar(D, r => r.estado || CFG.rotuloNaoInformado));
    grafico('c-estado', 'doughnut', {
      labels: est.map(e => e[0]),
      datasets: [{ data: est.map(e => e[1]), backgroundColor: est.map(e => ESTADO_COR[e[0]] || COR_OUTROS), borderColor: '#FFFFFF', borderWidth: 2 }]
    }, {
      cutout: '58%',
      plugins: { legend: { display: false }, doughnutCenter: { mainText: fmtInt(D.length), subText: 'Tickets' }, valueLabels: { display: true } }
    }, !D.length);
    $('legend-estado').innerHTML = est.map(([k, v]) => `<div class="donut-legend-row"><span class="tag"><span class="dot" style="background:${ESTADO_COR[k] || COR_OUTROS}"></span>${esc(k)}</span><strong>${fmtInt(v)} (${fmtPct(pctDe(v, D.length))})</strong></div>`).join('');

    barrasH('c-item', ordenarDesc(contar(D, r => val(r.item))).slice(0, 5), { cor: COR.azulMedio });
    const prio = contar(D, r => val(r.prioridade));
    const pl = ordenarPrio([...prio.keys()]);
    barrasV('c-prioridade', pl, pl.map(k => prio.get(k)), { cores: pl.map(k => k === 'Alta' ? COR.vermelho : k === 'Média' ? COR.amarelo : COR.azul) });
    const tipos = ordenarDesc(contar(D, r => val(r.tipo)));
    barrasV('c-tipo', tipos.map(e => e[0]), tipos.map(e => e[1]), { cor: COR.roxo });
  }

  /* ======================================================================
     ABA 2 — BACKLOG & AGING
     ====================================================================== */
  function renderBacklog(D) {
    const B = D.filter(r => r.backlog);
    const E = D.filter(r => r.encerrado);
    const critico = B.filter(r => r.agingDias !== null && r.agingDias > CFG.agingCriticoDias).length;
    const sRes = sla(E, 'slaRes');
    setT('b-backlog', fmtInt(B.length));
    setT('b-backlog-sub', `${fmtInt(B.filter(r => r.atrasado).length)} atrasados • ${fmtInt(B.filter(r => r.estado === 'Pendente Fornecedor').length)} pendentes de fornecedor`);
    setT('b-aging', fmtD(media(B.map(r => r.agingDias))));
    setT('b-aging-sub', `mediana ${fmtD(percentil(B.map(r => r.agingDias), 0.5))} • dias corridos`);
    setT('b-critico-label', `Backlog Crítico (>${CFG.agingCriticoDias}d)`);
    setT('b-critico', fmtInt(critico));
    setT('b-critico-sub', `Abertos há mais de ${CFG.agingCriticoDias} dias`);
    $('b-critico-badge').style.display = critico ? 'inline-flex' : 'none';
    pulsar('b-card-critico', critico > 0);
    setT('b-noprazo', fmtInt(sRes.dentro));
    setT('b-noprazo-sub', sRes.n ? `${fmtPct(sRes.pct)} dos encerrados • até o vencimento` : 'Entregues até o vencimento');

    const faixas = CFG.faixasAging.map(f => ({ ...f, n: 0 }));
    B.forEach(r => { if (r.agingDias === null) return; const f = faixas.find(x => r.agingDias <= x.max); if (f) f.n++; });
    const coresFaixa = [COR.verde, COR.azulMedio, COR.amarelo, COR.vermelhoAlerta, COR.vermelhoEscuro];
    barrasV('c-aging', faixas.map(f => f.rotulo), faixas.map(f => f.n), { cores: faixas.map((f, i) => coresFaixa[Math.min(i, coresFaixa.length - 1)]) });

    const est = ordenarDesc(contar(B, r => r.estado));
    barrasH('c-backlog-estado', est, { cores: est.map(e => ESTADO_COR[e[0]] || COR_OUTROS) });
    const ag = ordenarDesc(contar(B, r => r.agente));
    barrasH('c-backlog-agente', ag, { cores: ag.map(e => e[0] === CFG.rotuloSemAgente ? COR.roxo : COR.azul) });

    const lista = [...B].sort((a, b) => (a.criado || 0) - (b.criado || 0));
    // Tabela com rolagem contínua (marquee), mesmo comportamento da fila de Operação:
    // cabeçalho fixo, linhas sobem continuamente, pausa com o mouse em cima, sempre rodando no Modo TV
    const cont = $('t-backlog');
    if (!lista.length) { cont.innerHTML = '<div class="chart-empty">Sem tickets em aberto para os filtros selecionados.</div>'; return; }
    const cols = '<colgroup><col style="width:64px"><col><col style="width:128px"><col style="width:130px"><col style="width:54px"><col style="width:104px"></colgroup>';
    const linhas = lista.map(r => `<tr class="clickable${r.atrasado ? ' row-em-atraso' : ''}" data-id="${esc(r.id)}"><td>${esc(r.id)}</td><td title="${esc(r.assunto)}">${esc(r.assunto)}</td>
        <td><span class="pill ${r.estado === 'Pendente Fornecedor' ? 'pill-inconf' : 'pill-info'}">${esc(r.estado)}</span></td>
        <td>${esc(r.agente)}</td><td class="num">${r.agingDias === null ? '—' : Math.floor(r.agingDias) + 'd'}</td>
        <td>${r.atrasado ? '<span class="pill pill-bad">⚠ ' + fmtData(r.venc) + '</span>' : fmtData(r.venc)}</td></tr>`).join('');
    cont.classList.add('marquee-tabela');
    cont.innerHTML = `<table class="data-table">${cols}<thead><tr><th>ID</th><th>Assunto</th><th>Estado</th><th>Agente</th><th class="num">Aging</th><th>Vencimento</th></tr></thead></table>
      <div class="op-body-viewport"><div class="op-marquee-track"><table class="data-table">${cols}<tbody>${linhas}</tbody></table></div></div>`;
    marqueeTabela(cont, linhas, lista.length);
  }

  // Marquee genérico para tabelas em cards (mesma animação da fila de Operação do GMUD)
  function marqueeTabela(cont, linhasHtml, n) {
    const vp = cont.querySelector('.op-body-viewport');
    const track = cont.querySelector('.op-marquee-track');
    const tbody = track.querySelector('tbody');
    requestAnimationFrame(() => {
      if (track.scrollHeight <= vp.clientHeight + 4) { track.style.animation = 'none'; return; }
      tbody.innerHTML = linhasHtml + linhasHtml;
      const dur = Math.max(12, n * CFG.velocidades[state.op.vel] * 1.6);
      track.style.animation = `marqueeTableVerticalUp ${dur}s linear infinite`;
      vp.onmouseenter = () => { if (!state.tv) track.style.animationPlayState = 'paused'; };
      vp.onmouseleave = () => { track.style.animationPlayState = 'running'; };
    });
  }

  /* ======================================================================
     ABA 3 — SLA & TEMPOS
     ====================================================================== */
  function renderSla(D) {
    const E = D.filter(r => r.encerrado);
    const sRes = sla(E, 'slaRes'), sFr = sla(D, 'slaFr');
    setT('s-res', fmtPct(sRes.pct)); setT('s-res-sub', `${fmtInt(sRes.dentro)} no prazo de ${fmtInt(sRes.n)}`);
    semaforo('s-card-res', sRes.pct);
    setT('s-fora', fmtInt(sRes.violado));
    setT('s-fr', fmtPct(sFr.pct)); setT('s-fr-sub', `${fmtInt(sFr.dentro)} dentro de ${fmtInt(sFr.n)}`);
    setT('s-fr-v', fmtInt(sFr.violado));
    setT('s-sem-fr', fmtInt(D.filter(r => !r.slaFr).length));
    setT('s-lead', fmtD(media(E.map(r => r.leadDias))));
    setT('s-lead-sub', `mediana ${fmtD(percentil(E.map(r => r.leadDias), 0.5))} • dias corridos`);
    const resHs = E.filter(r => r.res).map(r => r.resH);
    setT('s-p50', fmtH(percentil(resHs, 0.5)));
    setT('s-p90', `P90 ${fmtH(percentil(resHs, 0.9))} • horas úteis (ferramenta)`);
    setT('s-fr-p50', fmtH(percentil(D.map(r => r.frH), 0.5)));

    // SLA mensal (%)
    const mRes = new Map(), mFr = new Map();
    D.forEach(r => {
      if (r.encerrado && r.res && (r.noPrazo || r.foraPrazo)) { const k = chaveMes(r.res); if (!mRes.has(k)) mRes.set(k, []); mRes.get(k).push(r); }
      if (r.criado && (r.slaFr === CFG.slaDentro || r.slaFr === CFG.slaViolado)) { const k = chaveMes(r.criado); if (!mFr.has(k)) mFr.set(k, []); mFr.get(k).push(r); }
    });
    const ks = [...new Set([...mRes.keys(), ...mFr.keys()])].sort();
    const pRes = ks.map(k => mRes.has(k) ? +sla(mRes.get(k), 'slaRes').pct.toFixed(1) : null);
    const pFr = ks.map(k => mFr.has(k) ? +sla(mFr.get(k), 'slaFr').pct.toFixed(1) : null);
    monitor('c-sla-mes', ks.map(rotuloMes), [
      { nome: 'Taxa no prazo (resolução)', valores: pRes, cor: '#10B981', corScan: '#34D399', fmt: v => Math.round(v) + '%', n: ks.map(k => mRes.has(k) ? mRes.get(k).length : 0) },
      { nome: 'SLA 1ª resposta', valores: pFr, cor: COR.azul, fmt: v => Math.round(v) + '%', rotulos: 'abaixo', n: ks.map(k => mFr.has(k) ? mFr.get(k).length : 0) }
    ], { max: 100, eixo: v => v + '%', meta: CFG.metaSla ? CFG.metaSla.verde : null });

    // Taxa no prazo por Tipo × Prioridade
    const grupos = new Map();
    E.forEach(r => {
      if (!r.noPrazo && !r.foraPrazo) return;
      const k = `${val(r.tipo)} · ${val(r.prioridade)}`;
      if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r);
    });
    const tp = [...grupos.entries()].map(([k, arr]) => { const s = sla(arr, 'slaRes'); return [k, +s.pct.toFixed(1), s.n]; }).sort((a, b) => b[2] - a[2]);
    barrasH('c-sla-tp', tp.map(e => [e[0], e[1]]), {
      cor: COR.verde, max: 100, tickFmt: v => v + '%',
      formatter: (v, o) => `${Math.round(v)}% (n=${tp[o.i][2]})`,
      tooltip: { label: c => `No prazo: ${fmtPct(c.parsed.x)} • n=${tp[c.dataIndex][2]}` }
    });

    // Lead time médio por mês da resolução (dias corridos)
    const mL = new Map();
    E.forEach(r => { if (r.leadDias !== null) { const k = chaveMes(r.res); if (!mL.has(k)) mL.set(k, []); mL.get(k).push(r.leadDias); } });
    const kl = [...mL.keys()].sort();
    // Mesmas cores do GMUD (Eficiência & SLA): lead time em azul Mondial com varredura ciano
    monitor('c-lead-mes', kl.map(rotuloMes), [
      { nome: 'Lead time médio', valores: kl.map(k => +media(mL.get(k)).toFixed(1)), cor: '#005AA9', corScan: '#0284C7', fmt: v => fmtNum1(v) + 'd', n: kl.map(k => mL.get(k).length) },
      { nome: 'Mediana', valores: kl.map(k => +percentil(mL.get(k), 0.5).toFixed(1)), cor: COR.amarelo, fmt: v => fmtNum1(v) + 'd', rotulos: false, n: kl.map(k => mL.get(k).length) }
    ], { eixo: v => v + 'd' });

    // Tempo de resolução por mês (P50 / P90) — horas úteis da ferramenta
    const mT = new Map();
    E.forEach(r => { if (r.res && r.resH !== null) { const k = chaveMes(r.res); if (!mT.has(k)) mT.set(k, []); mT.get(k).push(r.resH); } });
    const kt = [...mT.keys()].sort();
    monitor('c-tempo-mes', kt.map(rotuloMes), [
      { nome: 'P90', valores: kt.map(k => +percentil(mT.get(k), 0.9).toFixed(1)), cor: COR.vermelho, corScan: '#F87171', fmt: v => Math.round(v) + 'h', n: kt.map(k => mT.get(k).length) },
      { nome: 'P50 (mediana)', valores: kt.map(k => +percentil(mT.get(k), 0.5).toFixed(1)), cor: COR.azul, fmt: v => Math.round(v) + 'h', rotulos: 'abaixo', n: kt.map(k => mT.get(k).length) }
    ], { eixo: v => v + 'h' });
  }

  /* ---------------- "Monitor ao Vivo" — mesmo motor da aba Eficiência & SLA do GMUD ----------------
     (renderOpcao4MonitorChart): curva suavizada em SVG revelada por uma varredura com brilho,
     4,5 s de crescimento com desaceleração cúbica, pulso de energia (halo) em cada marco,
     repetida a cada 10 s. A 1ª série recebe área, brilho, halos e rótulos; as demais, linha e rótulos opcionais.
     Diferença em relação ao GMUD: sem série de exemplo quando há poucos meses — mostra aviso (sem dado fictício). */
  function pararMonitores() {
    if (state.monitorFrame) cancelAnimationFrame(state.monitorFrame);
    state.monitorFrame = null;
    state.monitorRunners = [];
  }
  function iniciarMonitores() {
    if (state.monitorFrame) cancelAnimationFrame(state.monitorFrame);
    let t0 = null;
    const ciclo = (CFG.graficosCicloSegundos || 10) * 1000;
    const loop = ts => {
      if (!t0 || ts - t0 > ciclo) t0 = ts;
      (state.monitorRunners || []).forEach(fn => { try { fn(ts, t0); } catch (e) { /* segue */ } });
      state.monitorFrame = requestAnimationFrame(loop);
    };
    state.monitorFrame = requestAnimationFrame(loop);
  }
  function monitor(id, rotulos, series, opts = {}) {
    const svg = $(id);
    if (!svg) return;
    const body = svg.closest('.chart-body');
    let ov = body.querySelector('.chart-empty');
    const temDado = rotulos.length && series[0].valores.some(v => v !== null && v !== undefined);
    if (!temDado) {
      svg.innerHTML = '';
      if (!ov) { ov = document.createElement('div'); ov.className = 'chart-empty'; body.appendChild(ov); }
      ov.textContent = 'Sem dados para os filtros selecionados.';
      return;
    }
    if (ov) ov.remove();
    const NS = 'http://www.w3.org/2000/svg';
    const el = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
    svg.innerHTML = '';
    const W = Math.max(320, body.clientWidth || 520);
    const H = Math.max(180, body.clientHeight || 220);
    const L = 44, R = W - 22, T = 34, B = H - 26;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W); svg.setAttribute('height', H);

    const todos = series.flatMap(s => s.valores).filter(v => v !== null && !isNaN(v));
    const max = opts.max || Math.max(4, Math.ceil(Math.max(...todos) * 1.18 / 4) * 4); // múltiplo de 4: grade com números inteiros
    const principal = series[0];
    const cor = principal.cor, corScan = principal.corScan || principal.cor;

    // Defs: brilho, gradiente da área, recorte da varredura
    const defs = el('defs', {}, svg);
    const fid = 'gl-' + id;
    const f = el('filter', { id: fid, x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: 3, result: 'b' }, f);
    const mg = el('feMerge', {}, f); el('feMergeNode', { in: 'b' }, mg); el('feMergeNode', { in: 'SourceGraphic' }, mg);
    const gid = 'ar-' + id;
    const g = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': cor, 'stop-opacity': 0.2 }, g);
    el('stop', { offset: 1, 'stop-color': cor, 'stop-opacity': 0.01 }, g);
    const cid = 'cp-' + id;
    const scanRect = el('rect', { x: 0, y: 0, width: 0, height: H }, el('clipPath', { id: cid }, defs));

    // Grade e eixo Y
    for (let i = 0; i <= 4; i++) {
      const y = B - ((B - T) * i) / 4;
      el('line', { x1: L, x2: R, y1: y, y2: y, stroke: '#E2E8F0', 'stroke-width': 1, 'stroke-dasharray': '3 4' }, svg);
      el('text', { x: L - 8, y: y + 4, fill: '#64748B', 'font-size': '10.5px', 'font-weight': '600', 'text-anchor': 'end' }, svg).textContent = opts.eixo ? opts.eixo(Math.round(max * i / 4)) : Math.round(max * i / 4);
    }
    const n = rotulos.length;
    const xDe = i => n === 1 ? (L + R) / 2 : L + ((R - L) * i) / (n - 1);
    const yDe = v => B - ((B - T) * Math.min(max, Math.max(0, v))) / max;
    rotulos.forEach((r, i) => { el('text', { x: xDe(i), y: H - 8, fill: '#64748B', 'font-size': '11px', 'font-weight': '600', 'text-anchor': 'middle' }, svg).textContent = r; });

    // Legenda (topo)
    let lx = L;
    series.forEach(s => {
      el('line', { x1: lx, x2: lx + 16, y1: 12, y2: 12, stroke: s.cor, 'stroke-width': 3, 'stroke-dasharray': s === principal ? '' : '5 4' }, svg);
      const t = el('text', { x: lx + 21, y: 16, fill: '#475569', 'font-size': '11px', 'font-weight': '600' }, svg);
      t.textContent = s.nome;
      lx += 32 + s.nome.length * 6.2;
    });
    if (opts.meta !== null && opts.meta !== undefined) {
      const ym = yDe(opts.meta);
      el('line', { x1: L, x2: R, y1: ym, y2: ym, stroke: COR.cinza, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }, svg);
      el('text', { x: R, y: ym - 4, fill: '#64748B', 'font-size': '10px', 'font-weight': '700', 'text-anchor': 'end' }, svg).textContent = `Meta ${opts.meta}%`;
    }

    // Curva suavizada (Bezier cúbica), quebrando onde não há valor
    const segmentos = s => {
      const segs = []; let atual = [];
      s.valores.forEach((v, i) => { if (v === null || v === undefined || isNaN(v)) { if (atual.length) segs.push(atual); atual = []; } else atual.push([xDe(i), yDe(v), i]); });
      if (atual.length) segs.push(atual);
      return segs;
    };
    const suave = pts => pts.reduce((acc, p, i) => {
      if (!i) return `M${p[0]},${p[1]}`;
      const q = pts[i - 1], cx = (q[0] + p[0]) / 2;
      return acc + ` C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`;
    }, '');

    // 1. Traço de fundo translúcido (todas as séries)
    series.forEach(s => segmentos(s).forEach(seg => el('path', { d: suave(seg), fill: 'none', stroke: s.cor, 'stroke-width': 1.5, opacity: 0.22, 'stroke-dasharray': s === principal ? '' : '5 4' }, svg)));
    // 2. Grupo revelado pela varredura
    const ativo = el('g', { 'clip-path': `url(#${cid})` }, svg);
    segmentos(principal).forEach(seg => {
      const d = suave(seg);
      el('path', { d: d + ` L${seg[seg.length - 1][0]},${B} L${seg[0][0]},${B} Z`, fill: `url(#${gid})` }, ativo);
    });
    series.slice().reverse().forEach(s => segmentos(s).forEach(seg => el('path', {
      d: suave(seg), fill: 'none', stroke: s.cor, 'stroke-width': s === principal ? 3.2 : 2.2,
      'stroke-dasharray': s === principal ? '' : '6 4', filter: s === principal ? `url(#${fid})` : ''
    }, ativo)));
    // 3. Marcos: halo (pulso de energia) + ponto + rótulo (rótulo omitido se encostar em outro; o valor fica na dica do ponto)
    const ocupados = new Map();
    series.forEach(s => {
      s.valores.forEach((v, i) => {
        if (v === null || v === undefined || isNaN(v)) return;
        const x = xDe(i), y = yDe(v);
        const mg2 = el('g', {}, ativo);
        if (s === principal) el('circle', { cx: x, cy: y, r: 6, fill: 'none', stroke: s.cor, 'stroke-width': 2, class: 'halo' }, mg2);
        const ponto = el('circle', { cx: x, cy: y, r: s === principal ? 4.5 : 3.5, fill: s.cor, stroke: '#FFFFFF', 'stroke-width': 2 }, mg2);
        el('title', {}, ponto).textContent = `${rotulos[i]} • ${s.nome}: ${s.fmt(v)}${s.n ? ` (n=${s.n[i]})` : ''}`;
        const pos = s.rotulos === undefined ? 'acima' : s.rotulos;
        if (pos) {
          const ty = pos === 'abaixo' ? Math.min(B - 3, y + 17) : y - 10;
          const ja = ocupados.get(i) || [];
          if (ja.some(oy => Math.abs(oy - ty) < 13)) return;
          ja.push(ty); ocupados.set(i, ja);
          el('text', { x, y: ty, fill: s.cor, 'font-size': '11px', 'font-weight': '800', 'text-anchor': 'middle', stroke: '#FFFFFF', 'stroke-width': 3, 'paint-order': 'stroke' }, mg2).textContent = s.fmt(v);
        }
      });
    });
    // 4. Linha do scanner
    const scanLine = el('line', { y1: T - 6, y2: B + 2, stroke: corScan, 'stroke-width': 2.2, opacity: 0.9, filter: `url(#${fid})` }, svg);
    const scanDot = el('circle', { r: 4, fill: corScan, filter: `url(#${fid})` }, svg);
    const span = R - L + 24;
    const duracao = CFG.monitorVarreduraMs || 4500;
    state.monitorRunners = state.monitorRunners || [];
    state.monitorRunners.push((ts, t0) => {
      const p = Math.min(1, (ts - t0) / duracao);
      const ease = 1 - Math.pow(1 - p, 3);
      const x = p >= 1 ? W + 30 : L + span * ease;
      scanRect.setAttribute('width', x);
      scanLine.setAttribute('x1', x); scanLine.setAttribute('x2', x);
      scanDot.setAttribute('cx', x); scanDot.setAttribute('cy', B);
      const op = p >= 0.98 ? '0' : '0.85';
      scanLine.style.opacity = op; scanDot.style.opacity = op;
    });
    if (!state.monitorFrame) iniciarMonitores();
  }

  /* ======================================================================
     ABA 4 — SISTEMAS & FORNECEDORES
     ====================================================================== */
  function renderSistemas(D) {
    const sist = ordenarDesc(contar(D, r => val(r.sistema)));
    barrasH('c-sistema', sist, { cores: sist.map(e => e[0] === CFG.rotuloNaoInformado ? COR_OUTROS : COR.azul) });

    const grupos = new Map();
    D.forEach(r => {
      if (!r.noPrazo && !r.foraPrazo) return;
      const k = val(r.sistema); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r);
    });
    // Sistemas com poucos encerrados são somados num grupo único, para não exibir % sem base (ex.: 1 de 1 = 100%)
    const minN = CFG.amostraMinimaPercentual || 1;
    const pequenos = [...grupos.entries()].filter(([, arr]) => arr.length < minN);
    if (pequenos.length > 1) {
      pequenos.forEach(([k]) => grupos.delete(k));
      grupos.set(`Demais sistemas (${pequenos.length}, n<${minN} cada)`, pequenos.flatMap(([, arr]) => arr));
    }
    const vs = [...grupos.entries()].map(([k, arr]) => { const s = sla(arr, 'slaRes'); return [k, +(s.violado / s.n * 100).toFixed(1), s.n, s.violado]; })
      .sort((a, b) => (a[0].startsWith('Demais') ? 1 : 0) - (b[0].startsWith('Demais') ? 1 : 0) || b[2] - a[2]);
    barrasH('c-sistema-fora', vs.map(e => [e[0], e[1]]), {
      cores: vs.map(e => e[0] === CFG.rotuloNaoInformado ? COR_OUTROS : COR.vermelhoEscuro), max: 100, mostrarZero: true, tickFmt: v => v + '%',
      formatter: (v, o) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% (${vs[o.i][3]}/${vs[o.i][2]})`,
      tooltip: { label: c => `Fora do prazo: ${vs[c.dataIndex][3]} de ${vs[c.dataIndex][2]} (${fmtPct(c.parsed.x)})` }
    });

    barrasH('c-fornecedor', ordenarDesc(contar(D.filter(r => r.fornecedor), r => r.fornecedor)), { cor: COR.roxo });

    const bf = D.filter(r => r.backlog && r.fornecedor);
    const estados = [...new Set(bf.map(r => r.estado))].sort((a, b) => CFG.ordemEstados.indexOf(a) - CFG.ordemEstados.indexOf(b));
    const porForn = new Map();
    bf.forEach(r => { if (!porForn.has(r.fornecedor)) porForn.set(r.fornecedor, {}); const o = porForn.get(r.fornecedor); o[r.estado] = (o[r.estado] || 0) + 1; });
    const linhas = [...porForn.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
    $('t-fornecedor').innerHTML = linhas.length ? `<table class="data-table"><thead><tr><th>Fornecedor</th>${estados.map(e => `<th class="num">${esc(e)}</th>`).join('')}<th class="num">Atrasados</th><th class="num">Total</th></tr></thead><tbody>
      ${linhas.map(([f, o]) => `<tr><td>${esc(f)}</td>${estados.map(e => `<td class="num">${o[e] ? fmtInt(o[e]) : '—'}</td>`).join('')}<td class="num">${fmtInt(bf.filter(r => r.fornecedor === f && r.atrasado).length)}</td><td class="num"><strong>${fmtInt(Object.values(o).reduce((a, b) => a + b, 0))}</strong></td></tr>`).join('')}
      </tbody><tfoot><tr><td>Total</td>${estados.map(e => `<td class="num">${fmtInt(bf.filter(r => r.estado === e).length)}</td>`).join('')}<td class="num">${fmtInt(bf.filter(r => r.atrasado).length)}</td><td class="num">${fmtInt(bf.length)}</td></tr></tfoot></table>
      <div class="chart-note" style="padding:6px 2px; white-space:normal;">Backlog com o campo Fornecedor preenchido. Classificação operacional por fornecedor — não é avaliação de pessoas.</div>`
      : '<div class="chart-empty">Sem backlog com fornecedor para os filtros selecionados.</div>';
  }

  /* ======================================================================
     ABA 5 — DEMANDA & ÁREAS
     ====================================================================== */
  function renderDemanda(D) {
    barrasH('c-depto', ordenarDesc(contar(D, r => val(r.departamento))).slice(0, 15), { cor: COR.azulEscuro });

    const porAg = new Map();
    D.forEach(r => { if (!porAg.has(r.agente)) porAg.set(r.agente, { e: 0, b: 0, o: 0 }); const o = porAg.get(r.agente); if (r.encerrado) o.e++; else if (r.backlog) o.b++; else o.o++; });
    const nomes = [...porAg.keys()].sort((a, b) => a === CFG.rotuloSemAgente ? 1 : b === CFG.rotuloSemAgente ? -1 : a.localeCompare(b, 'pt-BR'));
    grafico('c-agente', 'bar', {
      labels: nomes,
      datasets: [
        { label: 'Encerrados', data: nomes.map(n => porAg.get(n).e), backgroundColor: nomes.map(n => n === CFG.rotuloSemAgente ? COR.roxo : COR.azul) },
        { label: 'Em aberto', data: nomes.map(n => porAg.get(n).b), backgroundColor: COR.amarelo, borderRadius: { topRight: 4, bottomRight: 4 } }
      ]
    }, {
      indexAxis: 'y',
      scales: { x: { stacked: true, beginAtZero: true, grid: { color: '#F1F5F9' } }, y: { stacked: true, grid: { display: false }, ticks: { font: { size: 10.5, weight: 600 }, autoSkip: false } } },
      plugins: { legend: legendaTopo, valueLabels: { display: true } }
    }, !nomes.length);

    const loc = ordenarDesc(contar(D, r => val(r.localizacao)));
    barrasH('c-local', loc, { cores: loc.map(e => e[0] === CFG.rotuloNaoInformado ? COR_OUTROS : COR.azulMedio) });
    barrasH('c-origem', ordenarDesc(contar(D, r => val(r.origem))), { cor: COR.roxo });

    // Heatmap dia × hora (criação) — escala sequencial em azul Mondial
    const grade = Array.from({ length: 7 }, () => new Array(24).fill(0));
    D.forEach(r => { if (r.criado) grade[r.criado.getDay()][r.criado.getHours()]++; });
    const max = Math.max(0, ...grade.flat());
    const ordemDias = [1, 2, 3, 4, 5, 6, 0];
    const cor = v => v ? `rgba(0, 90, 169, ${(0.12 + (v / max) * 0.88).toFixed(2)})` : '#F8FAFC';
    $('h-heatmap').innerHTML = max ? `<table class="heatmap" aria-label="Entradas por dia da semana e hora"><thead><tr><th class="row-h"></th>${[...Array(24).keys()].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${ordemDias.map(d => `<tr><th class="row-h">${DIAS[d]}</th>${grade[d].map((v, h) => `<td style="background:${cor(v)}; color:${v / max > 0.55 ? '#FFFFFF' : '#0F172A'}" title="${DIAS[d]} ${h}h: ${v} tickets">${v || ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table><div class="heatmap-legend">Menos <span class="scale">${[0.12, 0.34, 0.56, 0.78, 1].map(a => `<span style="background:rgba(0,90,169,${a})"></span>`).join('')}</span> Mais • hora de criação</div>`
      : '<div class="chart-empty">Sem dados para os filtros selecionados.</div>';
  }

  /* ======================================================================
     ABA 6 — DESVIOS & QUALIDADE
     ====================================================================== */
  function divergenciasPrazo(arr) {
    return arr.filter(r => r.encerrado && (r.noPrazo || r.foraPrazo) && r.foraPrazo !== r.foraPrazoCalc);
  }
  function renderDesvios(D) {
    const E = D.filter(r => r.encerrado);
    const sRes = sla(E, 'slaRes');
    const F = E.filter(r => r.foraPrazo);
    const atrasados = D.filter(r => r.atrasado).length;
    const inconf = D.filter(r => r.inconf).length;
    const div = divergenciasPrazo(D).length;
    setT('d-fora', fmtInt(F.length));
    setT('d-fora-sub', sRes.n ? `${fmtPct(pctDe(F.length, sRes.n))} dos ${fmtInt(sRes.n)} encerrados com prazo` : '—');
    const atrasoMed = percentil(F.map(r => r.atrasoH), 0.5);
    setT('d-atraso', atrasoMed === null ? '—' : atrasoMed >= 48 ? fmtD(atrasoMed / 24) : fmtH(atrasoMed));
    setT('d-atrasados', fmtInt(atrasados));
    pulsar('d-card-atrasados', atrasados > 0);
    setT('d-inconf', fmtInt(inconf));
    setT('d-inconf-sub', D.length ? `${fmtPct(pctDe(inconf, D.length))} do volume` : '—');
    setT('d-semag', fmtInt(D.filter(r => r.semAgente).length));
    setT('d-semcat', fmtInt(D.filter(r => r.semCategoria).length));
    setT('d-indevido', fmtInt(D.filter(r => /^0\s*-/.test(r.categoria)).length));
    setT('d-div', fmtInt(div));
    setT('d-div-sub', div ? 'status da ferramenta ≠ resolução × vencimento' : 'status da ferramenta = resolução × vencimento');
    const cd = $('d-card-div');
    cd.style.borderLeftColor = div ? 'var(--vermelho)' : 'var(--verde)';
    $('d-div').style.color = div ? 'var(--vermelho)' : 'var(--verde)';

    // Fora do prazo por mês (contagem + %)
    const m = new Map();
    E.forEach(r => { if (!r.res || (!r.noPrazo && !r.foraPrazo)) return; const k = chaveMes(r.res); if (!m.has(k)) m.set(k, { n: 0, f: 0 }); const o = m.get(k); o.n++; if (r.foraPrazo) o.f++; });
    const ks = [...m.keys()].sort();
    grafico('c-fora-mes', 'bar', {
      labels: ks.map(rotuloMes),
      datasets: [
        { type: 'line', label: '% fora do prazo', data: ks.map(k => +(m.get(k).f / m.get(k).n * 100).toFixed(1)), borderColor: COR.amarelo, backgroundColor: COR.amarelo, borderWidth: 2, tension: 0.3, pointRadius: 4, yAxisID: 'y1' },
        { type: 'bar', label: 'Fechados fora do prazo', data: ks.map(k => m.get(k).f), backgroundColor: COR.vermelhoEscuro, borderRadius: 4, yAxisID: 'y' }
      ]
    }, {
      scales: {
        y: { beginAtZero: true, grace: '18%', grid: { color: '#F1F5F9' }, title: { display: true, text: 'tickets', font: { size: 10 } } },
        y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: v => v + '%' } },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: legendaTopo,
        tooltip: { callbacks: { afterBody: items => { const k = ks[items[0].dataIndex]; return `Encerrados com prazo no mês: ${m.get(k).n}`; } } },
        valueLabels: { display: true, formatter: (v, o) => o.di === 0 ? Math.round(v) + '%' : fmtInt(v), corLinha: '#B45309', fundoLinha: true }
      }
    }, !ks.length);

    const faixas = CFG.faixasAtraso.map(f => ({ ...f, n: 0 }));
    F.forEach(r => { if (r.atrasoH === null) return; const f = faixas.find(x => r.atrasoH <= x.max); if (f) f.n++; });
    const coresA = [COR.amarelo, COR.laranja, COR.vermelhoAlerta, COR.vermelhoEscuro];
    barrasV('c-atraso-faixas', faixas.map(f => f.rotulo), faixas.map(f => f.n), {
      cores: faixas.map((f, i) => coresA[Math.min(i, coresA.length - 1)]),
      formatter: v => `${fmtInt(v)} (${Math.round(v / (F.length || 1) * 100)}%)`
    });

    // Inconformidade por mês de criação
    const mi = new Map();
    D.forEach(r => { if (!r.inconf || !r.criado) return; const k = chaveMes(r.criado); if (!mi.has(k)) mi.set(k, { a: 0, ag: 0, c: 0 }); const o = mi.get(k); if (r.semAgente && r.semCategoria) o.a++; else if (r.semAgente) o.ag++; else o.c++; });
    const ki = [...mi.keys()].sort();
    grafico('c-inconf-mes', 'bar', {
      labels: ki.map(rotuloMes),
      datasets: [
        { label: 'Sem agente e sem categoria', data: ki.map(k => mi.get(k).a), backgroundColor: '#5B21B6' },
        { label: 'Só sem agente', data: ki.map(k => mi.get(k).ag), backgroundColor: COR.roxo },
        { label: 'Só sem categoria', data: ki.map(k => mi.get(k).c), backgroundColor: '#C4B5FD' }
      ]
    }, {
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: '#F1F5F9' } } },
      plugins: { legend: legendaTopo, valueLabels: { display: true } }
    }, !ki.length);

    barrasH('c-fora-item', ordenarDesc(contar(F, r => val(r.item))).slice(0, 8), { cor: COR.vermelhoEscuro, rotulo: 'Fora do prazo' });
  }

  /* ======================================================================
     ABA 7 — OPERAÇÃO (fila com rolagem contínua, padrão GMUD)
     ====================================================================== */
  function classeOp(r, f) {
    switch (f) {
      case 'aberto': return r.backlog;
      case 'atrasado': return r.atrasado;
      case 'fornecedor': return r.estado === 'Pendente Fornecedor';
      case 'fora': return r.foraPrazo;
      case 'inconf': return r.inconf;
      default: return true;
    }
  }
  function ordenarOperacional(a, b) {
    // Atrasados primeiro, depois em aberto (mais antigos), depois encerrados mais recentes
    const pa = a.atrasado ? 0 : a.backlog ? 1 : 2, pb = b.atrasado ? 0 : b.backlog ? 1 : 2;
    if (pa !== pb) return pa - pb;
    if (pa < 2) return (a.criado || 0) - (b.criado || 0);
    return (b.res || b.criado || 0) - (a.res || a.criado || 0);
  }
  function listaOperacao() {
    const q = state.op.busca.toLowerCase();
    let L = state.D.filter(r => classeOp(r, state.op.filtro));
    if (q) L = L.filter(r => [r.id, r.assunto, r.agente, r.sistema, r.departamento, r.fornecedor, r.estado, r.item].some(v => v && v.toLowerCase().includes(q)));
    return L.sort(ordenarOperacional);
  }
  function pillEstado(r) {
    const c = ESTADO_COR[r.estado] || COR_OUTROS;
    return `<span class="op-status-badge" style="background:${c}1A; color:${c}; border:1px solid ${c}55;">${esc(r.estado)}</span>`;
  }
  function pillPrio(p) {
    const c = p === 'Alta' ? COR.vermelho : p === 'Média' ? COR.amarelo : COR.azul;
    return `<span class="op-prio-badge" style="background:${c}1A; color:${c};">${esc(val(p))}</span>`;
  }
  function linhaOp(r, i) {
    return `<tr class="${r.atrasado ? 'row-em-atraso' : (i % 2 ? 'row-par' : '')}" data-id="${esc(r.id)}">
      <td><strong>${esc(r.id)}</strong></td>
      <td title="${esc(r.assunto)}">${r.atrasado ? '<span class="badge-atraso-pulsante" style="margin:0 6px 0 0;">ATRASADO</span>' : ''}${r.inconf ? '<span class="pill pill-inconf" style="margin-right:6px;">INCONF.</span>' : ''}${esc(r.assunto)}</td>
      <td title="${esc(val(r.item))}">${esc(val(r.item))}</td>
      <td>${pillPrio(r.prioridade)}</td>
      <td>${pillEstado(r)}</td>
      <td title="${esc(val(r.departamento))}">${esc(val(r.departamento))}</td>
      <td title="${esc(r.agente)}">${esc(r.agente)}</td>
      <td style="text-align:center;">${fmtDataCurta(r.criado)}</td>
      <td style="text-align:center;${r.atrasado ? ' font-weight:800;' : ''}">${fmtDataCurta(r.venc)}</td>
      <td style="text-align:center;${r.foraPrazo ? ' color:#B91C1C; font-weight:800;' : ''}" title="${r.foraPrazo ? 'Fechado fora do prazo' : ''}">${r.res ? fmtDataCurta(r.res) : '—'}</td>
    </tr>`;
  }
  function renderOperacao() {
    const D = state.D;
    ['todos', 'aberto', 'atrasado', 'fornecedor', 'fora', 'inconf'].forEach(f => setT(`op-c-${f}`, fmtInt(D.filter(r => classeOp(r, f)).length)));
    document.querySelectorAll('#op-menu-nav .op-menu-btn').forEach(b => b.classList.toggle('active', b.dataset.op === state.op.filtro));
    document.querySelectorAll('[data-op-vel]').forEach(b => b.classList.toggle('active', b.dataset.opVel === state.op.vel));
    const cols = COLS_OP.map(w => `<col style="width:${w}%">`).join('');
    $('op-cols-head').innerHTML = cols; $('op-cols-body').innerHTML = cols;

    const L = listaOperacao();
    const tbody = document.querySelector('#op-body-table tbody');
    const vp = $('op-body-viewport'), track = $('op-marquee-track');
    const html = L.map(linhaOp).join('');
    tbody.innerHTML = html || '<tr><td colspan="10" class="op-empty">Nenhum ticket encontrado para o filtro selecionado.</td></tr>';
    track.style.animation = 'none';
    vp.style.overflowY = 'hidden';
    vp.scrollTop = 0;
    const parado = !state.tv && (state.op.pausado || !!state.op.busca);
    requestAnimationFrame(() => {
      const precisa = L.length && track.scrollHeight > vp.clientHeight + 4;
      if (precisa && !parado) {
        tbody.innerHTML = html + html;
        const dur = Math.max(20, L.length * CFG.velocidades[state.op.vel]);
        track.style.animation = `marqueeTableVerticalUp ${dur}s linear infinite`;
        track.style.animationPlayState = (state.op.hover && !state.tv) ? 'paused' : 'running';
      } else if (precisa) {
        vp.style.overflowY = 'auto';
      }
      atualizarPillOp(precisa && !parado);
    });
    const at = L.filter(r => r.atrasado).length;
    setT('op-footer-info', L.length ? `${fmtInt(L.length)} tickets na fila • ${fmtInt(at)} atrasados • ordem: atrasados, em aberto (mais antigos), encerrados (mais recentes)` : 'Nenhum ticket.');
  }
  function atualizarPillOp(rolando) {
    const pill = $('op-status-pill');
    const pausado = !rolando || state.op.hover;
    pill.classList.toggle('is-paused', pausado);
    setT('op-status-txt', !rolando ? (state.op.busca ? 'Busca ativa — rolagem manual' : state.op.pausado ? 'Pausado — rolagem manual' : 'Lista completa visível') : state.op.hover ? 'Pausado (mouse)' : 'Rolagem ativa');
    $('op-pausa').textContent = state.op.pausado ? '▶️ Retomar' : '⏸️ Pausar';
  }
  function exportarCsv() {
    const L = listaOperacao();
    const cab = ['ID', 'Assunto', 'Estado', 'Tipo', 'Prioridade', 'Agente', 'Categoria', 'Subcategoria', 'Item', 'Serviço / Sistema', 'Fornecedor', 'Departamento', 'Localização', 'Origem', 'Criação', 'Vencimento', 'Resolução', 'Fecho', 'Status SLA resolução', 'Status SLA 1ª resposta', 'Tempo resolução (h úteis)', 'Lead time (dias)', 'Aging (dias)', 'Atrasado', 'Fora do prazo', 'Inconformidade'];
    const c = v => { const s = v === null || v === undefined ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const n1 = v => v === null || v === undefined ? '' : fmtNum1(v);
    const linhas = L.map(r => [r.id, r.assunto, r.estado, r.tipo, r.prioridade, r.agente, r.categoria, r.subcategoria, r.item, r.sistema, r.fornecedor, r.departamento, r.localizacao, r.origem,
      fmtDataHora(r.criado), fmtDataHora(r.venc), r.res ? fmtDataHora(r.res) : '', r.fec ? fmtDataHora(r.fec) : '', r.slaRes, r.slaFr, n1(r.resH), n1(r.leadDias), n1(r.agingDias),
      r.atrasado ? 'Sim' : 'Não', r.foraPrazo ? 'Sim' : 'Não', r.inconf ? 'Sim' : 'Não'].map(c).join(';'));
    const blob = new Blob(['﻿' + [cab.join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const hoje = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `sustentacao-chamados-${state.op.filtro}-${hoje.getFullYear()}${pad(hoje.getMonth() + 1)}${pad(hoje.getDate())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${fmtInt(L.length)} tickets exportados.`);
  }

  /* ======================================================================
     ABA 8 — TODOS OS CHAMADOS (esteira Kanban, padrão GMUD)
     ====================================================================== */
  function classeKb(r, f) {
    switch (f) {
      case 'aberto': return r.backlog;
      case 'atrasado': return r.atrasado;
      case 'fornecedor': return r.estado === 'Pendente Fornecedor';
      case 'encerrado': return r.encerrado;
      default: return true;
    }
  }
  function chaveKb(r) {
    switch (state.kb.grupo) {
      case 'sistema': return val(r.sistema);
      case 'categoria': return val(r.categoria);
      case 'departamento': return val(r.departamento);
      default: return r.estado || CFG.rotuloNaoInformado;
    }
  }
  function renderKanban() {
    document.querySelectorAll('[data-kb-filtro]').forEach(b => b.classList.toggle('active', b.dataset.kbFiltro === state.kb.filtro));
    document.querySelectorAll('[data-kb-grupo]').forEach(b => b.classList.toggle('active', b.dataset.kbGrupo === state.kb.grupo));
    document.querySelectorAll('[data-kb-vel]').forEach(b => b.classList.toggle('active', b.dataset.kbVel === state.kb.vel));
    $('kb-pausa').textContent = state.kb.pausado ? '▶️ Retomar' : '⏸️ Pausar';
    const board = $('kb-board');
    board.classList.toggle('board-paused', state.kb.pausado);

    const L = state.D.filter(r => classeKb(r, state.kb.filtro));
    const grupos = new Map();
    L.forEach(r => { const k = chaveKb(r); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
    let chaves;
    if (state.kb.grupo === 'estado') {
      chaves = [...grupos.keys()].sort((a, b) => (CFG.ordemEstados.indexOf(a) + 1 || 99) - (CFG.ordemEstados.indexOf(b) + 1 || 99));
    } else {
      chaves = [...grupos.keys()].sort((a, b) => grupos.get(b).length - grupos.get(a).length || a.localeCompare(b, 'pt-BR'));
    }
    const maxC = CFG.maxColunasKanban;
    if (chaves.length > maxC) {
      const ficam = chaves.slice(0, maxC - 1);
      const outros = chaves.slice(maxC - 1).flatMap(k => grupos.get(k));
      const rot = `Outros (${chaves.length - maxC + 1} grupos)`;
      grupos.set(rot, outros);
      chaves = [...ficam, rot];
    }
    if (!chaves.length) {
      board.style.gridTemplateColumns = '1fr';
      board.innerHTML = '<div class="chart-empty" style="position:relative;">Nenhum chamado para a seleção.</div>';
      return;
    }
    board.style.gridTemplateColumns = `repeat(${chaves.length}, minmax(0, 1fr))`;
    board.innerHTML = chaves.map(k => {
      const arr = grupos.get(k).slice().sort(ordenarOperacional);
      const exib = arr.slice(0, CFG.maxCartoesPorColuna);
      const corLane = state.kb.grupo === 'estado' ? (ESTADO_COR[k] || COR.azul) : COR.azul;
      const at = arr.filter(r => r.atrasado).length;
      return `<div class="change-col-lane" style="border-top:3px solid ${corLane};">
        <div class="lane-fixed-header"><span class="lane-fixed-title" title="${esc(k)}">${esc(k)}</span>
          <span class="lane-header-badges">${at ? `<span class="badge-atraso-card">🚨 ${fmtInt(at)}</span>` : ''}<span class="lane-count-pill">${fmtInt(arr.length)}</span></span></div>
        <div class="lane-marquee-viewport"><div class="lane-marquee-track" data-n="${exib.length}">${exib.map(cartaoKb).join('')}</div></div>
        <div class="lane-fixed-footer">${arr.length > exib.length ? `<span class="lane-more">exibindo ${fmtInt(exib.length)} de ${fmtInt(arr.length)} • lista completa na aba Operação</span>` : '<span class="lane-arrow-down">▼</span>'}</div>
      </div>`;
    }).join('');

    requestAnimationFrame(() => {
      board.querySelectorAll('.lane-marquee-track').forEach(track => {
        const vp = track.parentElement;
        const n = +track.dataset.n;
        if (n && track.scrollHeight > vp.clientHeight + 4) {
          track.innerHTML += track.innerHTML;
          track.style.setProperty('--col-duration', `${Math.max(16, n * CFG.velocidades[state.kb.vel] * 1.6)}s`);
        } else {
          track.style.animation = 'none';
        }
      });
    });
  }
  function cartaoKb(r) {
    const c = ESTADO_COR[r.estado] || COR_OUTROS;
    return `<div class="lane-card-item${r.atrasado ? ' card-em-atraso' : ''}" data-id="${esc(r.id)}" style="border-left-color:${c};">
      <div class="lane-card-head"><span class="lane-card-id">#${esc(r.id)}</span>${r.atrasado ? '<span class="badge-atraso-card">ATRASADO</span>' : r.foraPrazo ? '<span class="pill pill-bad" style="font-size:8.5px;">Fora do prazo</span>' : ''}</div>
      <div class="lane-card-desc" title="${esc(r.assunto)}">${esc(r.assunto)}</div>
      <div class="lane-card-footer"><span class="lane-card-dept" title="${esc(val(r.departamento))}">${esc(val(r.departamento))}</span>
        <span class="lane-card-status-pill" style="background:${c}1A; color:${c}; border-color:${c}55;">${esc(state.kb.grupo === 'estado' ? r.agente : r.estado)}</span></div>
    </div>`;
  }

  /* ======================================================================
     MODAIS
     ====================================================================== */
  function abrirModal(id) { $(id).classList.add('open'); }
  function fecharModal(id) { $(id).classList.remove('open'); }

  function abrirDetalhe(id) {
    const r = state.porId.get(id);
    if (!r) return;
    setT('modal-title', `Ticket #${r.id}`);
    const prazo = r.atrasado ? '<span class="pill pill-bad">Atrasado — vencimento expirado</span>'
      : r.backlog ? '<span class="pill pill-info">Em aberto, dentro do vencimento</span>'
      : r.foraPrazo ? '<span class="pill pill-bad">Fechado fora do prazo</span>'
      : r.noPrazo ? '<span class="pill pill-ok">Fechado no prazo</span>' : '<span class="pill pill-neutral">Sem status de prazo</span>';
    const linha = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
    const t = v => esc(val(v));
    $('modal-content').innerHTML = `<dl class="detail-grid">
      ${linha('Assunto', esc(r.assunto))}
      ${linha('Situação de prazo', prazo)}
      ${linha('Estado', pillEstado(r))}
      ${linha('Tipo / Prioridade', `${t(r.tipo)} • ${pillPrio(r.prioridade)}${r.urgencia ? ` • urgência ${esc(r.urgencia)} • impacto ${esc(val(r.impacto))}` : ''}`)}
      ${linha('Agente', r.semAgente ? `<span class="pill pill-inconf">${esc(r.agente)}</span>` : esc(r.agente))}
      ${linha('Grupo', t(r.grupo))}
      <div class="detail-sec">Classificação</div>
      ${linha('Categoria', r.semCategoria ? '<span class="pill pill-inconf">Não informada</span>' : esc(r.categoria))}
      ${linha('Subcategoria / Item', `${t(r.subcategoria)} • ${t(r.item)}`)}
      ${linha('Serviço / Sistema', `${t(r.sistema)}${r.aplicacao ? ` • aplicação ${esc(r.aplicacao)}` : ''}${r.modulo ? ` • módulo ${esc(r.modulo)}` : ''}`)}
      ${linha('Fornecedor', `${t(r.fornecedor)}${r.chamadoForn ? ` • chamado ${esc(r.chamadoForn)}` : ''}`)}
      ${linha('Departamento / Local', `${t(r.departamento)} • ${t(r.localizacao)}`)}
      ${linha('Origem', t(r.origem))}
      ${r.ofensor ? linha('OFENSOR', esc(r.ofensor)) : ''}
      ${r.associacao ? linha('Associação', esc(r.associacao)) : ''}
      <div class="detail-sec">Prazos e tempos</div>
      ${linha('Criação', fmtDataHora(r.criado))}
      ${linha('Vencimento', fmtDataHora(r.venc))}
      ${linha('1ª resposta', r.fr ? `${fmtDataHora(r.fr)} • ${fmtH(r.frH)} úteis • ${t(r.slaFr)}` : `sem 1ª resposta registrada${r.slaFr ? ' • ' + esc(r.slaFr) : ''}`)}
      ${linha('Resolução', r.res ? `${fmtDataHora(r.res)} • ${fmtH(r.resH)} úteis • ${t(r.slaRes)}` : '—')}
      ${r.atrasoH !== null ? linha('Atraso', `${r.atrasoH >= 48 ? fmtD(r.atrasoH / 24) : fmtH(r.atrasoH)} após o vencimento (corridas)`) : ''}
      ${linha('Fechamento', fmtDataHora(r.fec))}
      ${r.leadDias !== null ? linha('Lead time', `${fmtD(r.leadDias)} corridos`) : ''}
      ${r.agingDias !== null ? linha('Aging', `${fmtD(r.agingDias)} corridos até ${fmtDataHora(state.ref)}`) : ''}
      ${linha('Interações', `agente ${t(r.intAgente)} • cliente ${t(r.intCliente)}`)}
      ${r.pesquisa ? linha('Pesquisa de satisfação', esc(r.pesquisa)) : ''}
      ${r.inconf ? linha('INCONFORMIDADE', `<span class="pill pill-inconf">${[r.semAgente ? 'sem agente' : '', r.semCategoria ? 'sem categoria' : ''].filter(Boolean).join(' e ')}</span>`) : ''}
    </dl>`;
    abrirModal('modal-details');
  }

  function renderGlossario() {
    const R = state.registros;
    const m = state.meta;
    setT('gloss-sub', `Base: ${m.arquivoOrigem || '—'} • referência ${fmtDataHora(state.ref)} • ${fmtInt(R.length)} tickets • qualidade calculada sobre a base completa (sem filtros)`);
    const card = (cor, titulo, tag, texto, formula) => `<div class="gloss-card" style="border-left-color:${cor};"><div><div style="display:flex; justify-content:space-between; gap:6px; margin-bottom:5px;"><strong class="t">${titulo}</strong><span class="pill pill-neutral">${tag}</span></div><p>${texto}</p></div><div class="formula">${formula}</div></div>`;
    const ids = new Set(R.map(r => r.id));
    const naoMap = R.filter(r => !r.backlog && !r.encerrado);
    const div = divergenciasPrazo(R);
    const q = [
      { l: 'Tickets carregados', v: R.length, d: `${fmtInt(ids.size)} IDs únicos • ${fmtInt(R.length - ids.size)} duplicados`, c: R.length === ids.size ? 'q-ok' : 'q-bad' },
      { l: 'Cobertura da exportação', v: state.lacunaDias, d: state.baseParcial ? `dias sem dados: criados até ${fmtData(state.criacaoMax)}, exportado em ${fmtData(state.ref)}. Verifique o filtro de período no Freshservice.` : `criados de ${fmtData(state.criacaoMin)} a ${fmtData(state.criacaoMax)}`, c: state.baseParcial ? 'q-bad' : 'q-ok' },
      { l: 'Regra de prazo × ferramenta', v: div.length, d: div.length ? 'Encerrados em que "SLA Violated" não bate com resolução > vencimento' : '"SLA Violated" coincide com resolução > vencimento em todos os encerrados', c: div.length ? 'q-bad' : 'q-ok' },
      { l: 'INCONFORMIDADE', v: R.filter(r => r.inconf).length, d: 'Agente "No Agent" ou Categoria vazia (D-14)', c: 'q-inconf' },
      { l: 'Sem agente', v: R.filter(r => r.semAgente).length, d: `"No Agent" • ${fmtInt(R.filter(r => r.semAgente && r.backlog).length)} em aberto`, c: 'q-inconf' },
      { l: 'Sem categoria', v: R.filter(r => r.semCategoria).length, d: `${fmtInt(R.filter(r => r.semAgente && r.semCategoria).length)} também sem agente`, c: 'q-inconf' },
      { l: 'Estados não mapeados', v: naoMap.length, d: naoMap.length ? 'Fora das listas de backlog/encerrados: ' + [...new Set(naoMap.map(r => r.estado))].join(', ') : 'Todos os estados classificados (D-04)', c: naoMap.length ? 'q-bad' : 'q-ok' },
      { l: 'Encerrados sem resolução', v: R.filter(r => r.encerrado && !r.res).length, d: 'Sem hora de resolução: fora dos tempos e da taxa no prazo', c: 'q-warn' },
      { l: 'Encerrados sem status de SLA', v: R.filter(r => r.encerrado && !r.noPrazo && !r.foraPrazo).length, d: 'Fora do denominador da taxa no prazo', c: 'q-warn' },
      { l: 'Sem status de 1ª resposta', v: R.filter(r => !r.slaFr).length, d: 'Fora do denominador do SLA de 1ª resposta', c: 'q-warn' },
      { l: 'Fechamento antes da resolução', v: R.filter(r => r.res && r.fec && r.fec < r.res).length, d: 'Ordem temporal incoerente — mantidos', c: 'q-warn' },
      { l: 'Chamado Indevido', v: R.filter(r => /^0\s*-/.test(r.categoria)).length, d: 'Categoria 0 — contam normalmente (D-11)', c: 'q-warn' },
      { l: 'Tickets associados', v: R.filter(r => r.associacao).length, d: `${fmtInt(R.filter(r => r.associacao === 'Inferior').length)} "Inferior" — contam normalmente (D-11)`, c: 'q-warn' },
      { l: 'Categorias em 2 idiomas', v: R.filter(r => /Services|Desktop Services/.test(r.categoria)).length, d: 'Ex.: "1 - Application Services" e "1 - Serviço Aplicação" — exibidas como na base', c: 'q-warn' },
      { l: 'Serviço / Sistema vazio', v: R.filter(r => !r.sistema).length, d: 'Exibidos como "Não informado"', c: 'q-warn' },
      { l: 'Localização vazia', v: R.filter(r => !r.localizacao).length, d: 'Grafias variantes (ex.: "Site CEA" e "CEA") mantidas como na base', c: 'q-warn' },
      { l: 'Campo OFENSOR preenchido', v: R.filter(r => r.ofensor).length, d: 'Preenchimento insuficiente para indicador — exibido só no detalhe', c: 'q-warn' }
    ];
    const fonteTxt = state.fonte === 'servidor' ? 'base oficial publicada no servidor (data/base-sustentacao.json)' : state.fonte === 'embutida' ? 'base embutida (sustentacao-painel-dados.js)' : 'PRÉVIA LOCAL — arquivo carregado só nesta tela';
    const meta = CFG.metaSla ? `verde ≥ ${CFG.metaSla.verde}% • amarelo ≥ ${CFG.metaSla.amarelo}%` : 'não definida (D-13) — sem semáforo de meta';
    $('gloss-content').innerHTML = `
      <div class="gloss-h">Regras de prazo (padrão do Painel GMUD)</div>
      <div class="gloss-grid">
        ${card('var(--vermelho)', '🚨 Atrasado', 'Em aberto', 'Ticket em aberto cujo vencimento já passou na data de referência da base. Pulsa em vermelho nos KPIs, na fila de Operação e nos cartões.', `<b>Regra:</b> Estado ∈ backlog <b>e</b> Hora de vencimento &lt; data de referência (${fmtDataHora(state.ref)})`)}
        ${card('#B91C1C', '⛔ Fechado fora do prazo', 'Encerrado', 'Ticket resolvido depois do vencimento. Usa o status gravado pelo Freshservice, que coincide com a comparação das datas (ver Regra × Ferramenta).', '<b>Regra:</b> Estado de resolução = SLA Violated (Hora de resolução &gt; Hora de vencimento)')}
        ${card('var(--verde)', '🎯 Taxa no prazo (SLA de resolução)', 'Compromisso', 'Percentual de encerrados entregues até o vencimento.', '<b>Fórmula:</b> Within SLA ÷ (Within SLA + SLA Violated) × 100 — encerrados')}
        ${card('var(--amarelo)', '⏱️ Lead time', 'Eficácia', 'Dias corridos entre a abertura e a resolução. Mede o tempo total percebido pelo solicitante.', '<b>Fórmula:</b> média (Hora de resolução − Hora de criação), encerrados')}
        ${card('var(--amarelo)', '⏳ Aging e Backlog Crítico', 'Gargalos', `Idade dos tickets em aberto. Faixas: ${CFG.faixasAging.map(f => f.rotulo).join(', ')}. Crítico: mais de ${CFG.agingCriticoDias} dias.`, '<b>Fórmula:</b> data de referência − Hora de criação (dias corridos), só em aberto')}
        ${card('var(--azul-medio)', '💬 SLA de 1ª resposta', 'Atendimento', 'Status gravado pela ferramenta. Tickets sem status ficam fora do denominador.', '<b>Fórmula:</b> Within SLA ÷ (Within SLA + SLA Violated) — Estado da primeira resposta')}
        ${card('var(--amarelo)', '📈 Tempo de resolução P50 / P90', 'Ferramenta', 'Horas úteis calculadas pelo Freshservice, sem recálculo (D-03).', '<b>Fórmula:</b> percentis do campo Tempo de resolução (em horas), encerrados')}
        ${card('var(--roxo)', '🟣 INCONFORMIDADE', 'Qualidade', 'Ticket sem responsável ou sem categoria. Entra em todos os indicadores; o filtro permite isolar ou excluir (D-10, D-14).', '<b>Regra:</b> Agente = "No Agent" <b>ou</b> Categoria vazia')}
        ${card('var(--azul)', '📂 Em aberto × Encerrados', 'Estados', `Em aberto: ${CFG.estadosBacklog.join(', ')}. Encerrados: ${CFG.estadosEncerrados.join(', ')}. O ticket sai do backlog na resolução (D-04).`, `<b>Meta de SLA:</b> ${meta}`)}
      </div>
      <div class="gloss-h">Qualidade da base</div>
      <div class="quality-grid">${q.map(x => `<div class="q-card ${x.c}"><span class="q-label">${esc(x.l)}</span><span class="q-val">${fmtInt(x.v)}</span><span class="q-desc">${esc(x.d)}</span></div>`).join('')}</div>
      <div class="gloss-h">Sobre os dados</div>
      <ul class="about-list">
        <li><strong>Fonte em uso:</strong> ${esc(fonteTxt)}.</li>
        <li><strong>Arquivo:</strong> ${esc(m.arquivoOrigem || '—')} • gerado em ${esc(m.geradoEm || '—')} • grupo ${esc([...new Set(R.map(r => r.grupo))].join(', '))}.</li>
        <li><strong>Data de referência:</strong> ${fmtDataHora(state.ref)} (hora da exportação) — usada no aging e nos atrasados.</li>
        <li><strong>Privacidade (D-05):</strong> Descrição, Solução, Nota de resolução, nome e e-mail do solicitante não são carregados; e-mail, CPF e CNPJ no Assunto são mascarados.</li>
        <li><strong>Limitações:</strong> o vencimento não desconta pausas dos estados Pendente; a base não traz histórico de estados nem de atribuição (o agente é o responsável atual); o último mês termina na data de referência.</li>
        <li><strong>Versão do painel:</strong> ${VERSAO}.</li>
      </ul>`;
  }

  /* ======================================================================
     NAVEGAÇÃO, MODO TV E EVENTOS
     ====================================================================== */
  const RENDER = {
    'visao-executiva': () => renderVisao(state.D),
    'backlog-aging': () => renderBacklog(state.D),
    'sla-tempos': () => renderSla(state.D),
    'sistemas': () => renderSistemas(state.D),
    'demanda-areas': () => renderDemanda(state.D),
    'desvios': () => renderDesvios(state.D),
    'operacao': () => renderOperacao(),
    'todos-chamados': () => renderKanban()
  };
  function destruirGraficos() {
    Object.values(state.charts).forEach(c => c.destroy());
    state.charts = {};
  }
  function renderAtiva() {
    destruirGraficos();
    pararMonitores();
    try { RENDER[state.activeTab](); } catch (e) { console.error(e); toast('Erro ao montar a aba: ' + e.message, true); }
    animarKpis();
    iniciarCicloCrescimento();
  }

  /* ---------------- Efeitos de criação (padrão GMUD v2026.11.12-1208) ---------------- */
  // Contagem dos KPIs: mesma função do GMUD (animateCountUp: 1,4 s, desaceleração cúbica),
  // adaptada ao formato pt-BR (2.202 • 83,2% • 7,7d). O valor final exibido é sempre o calculado.
  function contarAte(el, duracao) {
    const final = el.textContent;
    const m = final.match(/^(\D*?)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?(.*)$/s);
    if (!m) return;
    const casas = m[3] ? m[3].length : 0;
    const alvo = parseFloat(m[2].replace(/\./g, '') + (casas ? '.' + m[3] : ''));
    if (!alvo) return;
    const fmt = v => m[1] + v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + m[4];
    const tok = (el._contagem || 0) + 1;
    el._contagem = tok;                       // nova contagem cancela a anterior (troca de filtro/aba)
    const t0 = performance.now();
    const passo = agora => {
      if (el._contagem !== tok) return;
      const p = Math.min((agora - t0) / duracao, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1 ? fmt(alvo * ease) : final;
      if (p < 1) requestAnimationFrame(passo);
    };
    el.textContent = fmt(0);
    requestAnimationFrame(passo);
  }
  function animarKpis() {
    document.querySelectorAll(`#tab-${state.activeTab} .kpi-val`).forEach(el => contarAte(el, CFG.kpiContagemMs || 1400));
  }
  // Ciclo de crescimento: a cada 10 s os gráficos da aba ativa "crescem" de novo (triggerTabGrowth do GMUD)
  function iniciarCicloCrescimento() {
    clearInterval(state.cicloTimer);
    state.cicloTimer = setInterval(() => {
      Object.values(state.charts).forEach(c => { if (c && c.reset && c.update) { c.reset(); c.update(); } });
    }, (CFG.graficosCicloSegundos || 10) * 1000);
  }
  function aplicarFiltros() {
    state.D = filtrados();
    atualizarBadgeFiltros();
    renderAtiva();
  }
  function ativarAba(tab) {
    if (!TABS.includes(tab)) return;
    state.activeTab = tab;
    document.querySelectorAll('.tab-nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    document.body.className = document.body.className.replace(/\btab-active-\S+/g, '').trim();
    document.body.classList.add(`tab-active-${tab}`);
    state.tvTick = 0;
    $('tabs-progress-fill').style.width = '0%';
    renderAtiva();
  }

  function ajustarEscalaTv() {
    const W = window.innerWidth, H = window.innerHeight;
    const w = Math.max(CFG.tvLarguraMinima, W);
    const s = W / w;
    document.body.style.setProperty('--tv-w', `${w}px`);
    document.body.style.setProperty('--tv-h', `${H / s}px`);
    document.body.style.setProperty('--tv-scale', String(s));
  }
  function entrarTv() {
    state.tv = true;
    document.body.classList.add('tv-mode');
    $('filters-bar').classList.remove('open');
    document.body.classList.remove('filters-open');
    $('btn-toggle-filters').classList.remove('active');
    ['modal-details', 'modal-glossary'].forEach(fecharModal);
    ajustarEscalaTv();
    // Igual ao GMUD (handleTvToggle): botão "✕ Sair TV", sem dicas do navegador na tela,
    // esteira Kanban por Estado e velocidade lenta, rotação automática a partir da aba atual
    $('btn-toggle-tv').innerHTML = '<span style="font-size: 12px; font-weight: 900;">✕</span><span id="tv-label">Sair TV</span>';
    $('btn-toggle-tv').title = 'Clique com o mouse para sair do Modo TV';
    document.querySelectorAll('[title]').forEach(el => {
      if (el.closest('#btn-toggle-tv')) return;
      el.setAttribute('data-saved-title', el.getAttribute('title'));
      el.removeAttribute('title');
    });
    state.kbAntesTv = { grupo: state.kb.grupo, vel: state.kb.vel, filtro: state.kb.filtro };
    state.kb.grupo = 'estado'; state.kb.vel = 'lento'; state.kb.filtro = 'todos';
    try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) { /* sem tela cheia */ }
    state.tvTick = 0;
    clearInterval(state.tvTimer);
    state.tvTimer = setInterval(() => {
      state.tvTick++;
      const total = CFG.tvRotacaoSegundos;
      $('tabs-progress-fill').style.width = `${Math.min(100, state.tvTick / total * 100)}%`;
      if (state.tvTick >= total) ativarAba(TABS[(TABS.indexOf(state.activeTab) + 1) % TABS.length]);
    }, 1000);
    renderAtiva();
  }
  function sairTv() {
    state.tv = false;
    clearInterval(state.tvTimer);
    document.body.classList.remove('tv-mode');
    ['--tv-w', '--tv-h', '--tv-scale'].forEach(p => document.body.style.removeProperty(p));
    $('btn-toggle-tv').innerHTML = '<span style="font-size: 11px;">📺</span><span id="tv-label">Modo TV</span>';
    $('btn-toggle-tv').title = 'Ativar Modo TV Apresentação';
    document.querySelectorAll('[data-saved-title]').forEach(el => {
      el.setAttribute('title', el.getAttribute('data-saved-title'));
      el.removeAttribute('data-saved-title');
    });
    if (state.kbAntesTv) { Object.assign(state.kb, state.kbAntesTv); state.kbAntesTv = null; }
    $('tabs-progress-fill').style.width = '0%';
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) { /* ok */ }
    renderAtiva();
  }

  /* ---------------- Base: oficial e prévia local ---------------- */
  function rodapeBase() {
    setT('versao-painel', `Versão ${VERSAO}`);
    const el = $('base-info');
    const m = state.meta;
    const desc = `Freshservice ${fmtDataHora(state.ref)} • ${fmtInt(state.registros.length)} chamados`;
    el.title = `Arquivo: ${m.arquivoOrigem || '—'} • Versão do painel ${VERSAO}`;
    const st = $('status-base');
    if (state.fonte === 'previa') {
      el.innerHTML = `<span class="footer-previa">Prévia: ${desc} <button type="button" id="btn-voltar-oficial">↺ voltar à base oficial</button></span>`;
      $('btn-voltar-oficial').addEventListener('click', () => { if (state.baseOficial) { iniciarComBase(state.baseOficial.base, state.baseOficial.fonte); toast('Base oficial restaurada.'); } });
      st.textContent = 'Prévia Local (não publicada)'; st.style.color = '#B45309';
    } else {
      el.textContent = `Base: ${desc}`;
      if (state.baseParcial) { st.textContent = `Base Parcial (criados até ${fmtData(state.criacaoMax)})`; st.style.color = '#B45309'; }
      else { st.textContent = 'Base Oficial Atualizada'; st.style.color = ''; }
    }
  }
  function iniciarComBase(base, fonte) {
    carregarBase(base, fonte);
    popularFiltros();
    rodapeBase();
    aplicarFiltros();
  }

  function sanitizarPlanilha(linhas, nome) {
    if (!linhas.length) throw new Error('A planilha está vazia.');
    const faltando = COLUNAS.filter(c => !(c in linhas[0]));
    if (faltando.length) throw new Error('Colunas ausentes: ' + faltando.join(', '));
    const opc = COLUNAS_OPCIONAIS.filter(c => c in linhas[0]);
    const cols = COLUNAS.concat(opc);
    const dt = v => v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}` : v;
    const mascarar = s => String(s)
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail oculto]')
      .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ oculto]')
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF oculto]');
    const iA = cols.indexOf('Assunto');
    const dados = linhas.filter(r => Object.values(r).some(v => txt(v) !== '')).map(r => {
      const l = cols.map(c => txt(dt(r[c])));
      l[iA] = mascarar(l[iA]);
      return l;
    });
    const mm = String(nome).match(/([A-Za-z]+)-(\d{1,2})-(\d{4})-(\d{1,2})_(\d{2})/);
    const nomesMes = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    let ref = '';
    if (mm && nomesMes.includes(mm[1].toLowerCase())) ref = `${mm[3]}-${pad(nomesMes.indexOf(mm[1].toLowerCase()) + 1)}-${pad(mm[2])} ${pad(mm[4])}:${mm[5]}:00`;
    if (!ref) { const iU = cols.indexOf('Hora da última atualização'); ref = dados.map(l => l[iU]).filter(Boolean).sort().pop() || ''; }
    return { meta: { arquivoOrigem: nome, dataReferencia: ref, geradoEm: 'prévia local (não publicada)', totalRegistros: dados.length }, colunas: cols, linhas: dados };
  }
  function carregarArquivo(file) {
    if (typeof XLSX === 'undefined') { toast('A leitura de Excel precisa de internet (biblioteca SheetJS). Para atualizar a base oficial use tools/gerar_dados_sustentacao.py.', true); return; }
    const leitor = new FileReader();
    leitor.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
        const base = sanitizarPlanilha(linhas, file.name);
        iniciarComBase(base, 'previa');
        toast(`Prévia carregada: ${fmtInt(base.linhas.length)} tickets. Nada foi publicado — ao recarregar a página volta a base oficial.`);
      } catch (err) {
        toast('Não foi possível ler o arquivo: ' + err.message, true);
      }
    };
    leitor.readAsArrayBuffer(file);
  }
  async function obterBaseOficial() {
    if (/^https?:$/.test(location.protocol)) {
      try {
        const r = await fetch(`data/base-sustentacao.json?t=${Date.now()}`, { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.linhas)) return { base: j, fonte: 'servidor' }; }
      } catch (e) { /* usa a base embutida */ }
    }
    if (window.SUST_BASE && Array.isArray(window.SUST_BASE.linhas)) return { base: window.SUST_BASE, fonte: 'embutida' };
    return null;
  }

  function ligarEventos() {
    document.querySelectorAll('.tab-nav-item').forEach(b => b.addEventListener('click', () => ativarAba(b.dataset.tab)));
    $('btn-toggle-filters').addEventListener('click', () => {
      const aberto = $('filters-bar').classList.toggle('open');
      document.body.classList.toggle('filters-open', aberto);
      $('btn-toggle-filters').classList.toggle('active', aberto);
      if (state.activeTab === 'todos-chamados' || state.activeTab === 'operacao') renderAtiva();
    });
    document.querySelectorAll('.filters-bar select').forEach(s => s.addEventListener('change', () => { state.filtros[s.dataset.f] = s.value; aplicarFiltros(); }));
    $('btn-clear-filters').addEventListener('click', () => {
      Object.keys(state.filtros).forEach(k => { state.filtros[k] = ''; });
      document.querySelectorAll('.filters-bar select').forEach(s => { s.value = ''; });
      aplicarFiltros();
    });
    $('btn-toggle-tv').addEventListener('click', () => state.tv ? sairTv() : entrarTv());
    $('btn-open-glossary').addEventListener('click', () => { renderGlossario(); abrirModal('modal-glossary'); });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => fecharModal(b.dataset.close)));
    document.querySelectorAll('.modal-backdrop').forEach(m => m.addEventListener('click', e => { if (e.target === m) fecharModal(m.id); }));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const aberto = document.querySelector('.modal-backdrop.open');
      if (aberto) fecharModal(aberto.id); else if (state.tv) sairTv();
    });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && state.tv) sairTv(); });

    // Clique em linhas e cartões → detalhe
    document.addEventListener('click', e => {
      if (state.tv) return;
      const alvo = e.target.closest('tr[data-id], .lane-card-item[data-id]');
      if (alvo) abrirDetalhe(alvo.dataset.id);
    });

    // Operação
    document.querySelectorAll('#op-menu-nav .op-menu-btn').forEach(b => b.addEventListener('click', () => { state.op.filtro = b.dataset.op; renderOperacao(); }));
    let tBusca;
    $('op-busca').addEventListener('input', e => { clearTimeout(tBusca); tBusca = setTimeout(() => { state.op.busca = e.target.value.trim(); renderOperacao(); }, 220); });
    $('op-pausa').addEventListener('click', () => { state.op.pausado = !state.op.pausado; renderOperacao(); });
    document.querySelectorAll('[data-op-vel]').forEach(b => b.addEventListener('click', () => { state.op.vel = b.dataset.opVel; renderOperacao(); }));
    $('op-exportar').addEventListener('click', exportarCsv);
    const vp = $('op-body-viewport');
    vp.addEventListener('mouseenter', () => { if (state.tv) return; state.op.hover = true; $('op-marquee-track').style.animationPlayState = 'paused'; atualizarPillOp($('op-marquee-track').style.animation !== 'none' && $('op-marquee-track').style.animation !== ''); });
    vp.addEventListener('mouseleave', () => { state.op.hover = false; $('op-marquee-track').style.animationPlayState = 'running'; atualizarPillOp($('op-marquee-track').style.animation !== 'none' && $('op-marquee-track').style.animation !== ''); });

    // Todos os Chamados
    document.querySelectorAll('[data-kb-filtro]').forEach(b => b.addEventListener('click', () => { state.kb.filtro = b.dataset.kbFiltro; renderKanban(); }));
    document.querySelectorAll('[data-kb-grupo]').forEach(b => b.addEventListener('click', () => { state.kb.grupo = b.dataset.kbGrupo; renderKanban(); }));
    document.querySelectorAll('[data-kb-vel]').forEach(b => b.addEventListener('click', () => { state.kb.vel = b.dataset.kbVel; renderKanban(); }));
    $('kb-pausa').addEventListener('click', () => { state.kb.pausado = !state.kb.pausado; renderKanban(); });

    // Prévia de base (não publica nada)
    const fi = $('file-input');
    $('btn-update-data').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { if (fi.files[0]) carregarArquivo(fi.files[0]); fi.value = ''; });

    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        if (state.tv) ajustarEscalaTv();
        if (['operacao', 'todos-chamados', 'sla-tempos'].includes(state.activeTab)) renderAtiva();
      }, 200);
    });
  }

  async function iniciar() {
    setT('versao-painel', `Versão ${VERSAO}`);
    ligarEventos();
    const of = await obterBaseOficial();
    if (!of) {
      setT('banner-sub', 'Base de dados não encontrada. Gere a base com tools/gerar_dados_sustentacao.py.');
      $('banner-sub').style.display = '';
      toast('Base de dados não encontrada.', true);
      return;
    }
    state.baseOficial = of;
    iniciarComBase(of.base, of.fonte);
  }

  document.addEventListener('DOMContentLoaded', iniciar);
  // Exposto apenas para validação automatizada
  window.__painel = { state, filtrados, sla, percentil, media };
})();
