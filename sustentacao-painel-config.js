/**
 * Sustentação Mondial — Painel Executivo
 * CONFIGURAÇÃO DE REGRAS DE NEGÓCIO
 *
 * Todas as regras ficam aqui, separadas da interface (sustentacao-painel-app.js) e dos dados
 * (sustentacao-painel-dados.js / data/base-sustentacao.json). Nenhuma meta ou faixa fica fixa no código.
 * Regras de prazo seguem o painel GMUD (v2026.11.11-1740):
 *   ATRASADO            = ticket em aberto com Hora de vencimento anterior à data de referência
 *   FECHADO FORA DO PRAZO = ticket encerrado com Hora de resolução posterior à Hora de vencimento
 *                           (na base de 12/11/2026 coincide 100% com "SLA Violated" do Freshservice)
 */
window.SUST_CONFIG = {
  // D-04 — Estados que compõem o backlog (ticket em aberto)
  estadosBacklog: ['Aberto', 'ReOpen', 'Pendente', 'Pendente Aprovação', 'Pendente Fornecedor'],

  // D-04 — Estados encerrados (o ticket sai do backlog na resolução)
  estadosEncerrados: ['Resolvido', 'Fechado'],

  // Ordem das colunas no Kanban por Estado
  ordemEstados: ['Aberto', 'ReOpen', 'Pendente', 'Pendente Aprovação', 'Pendente Fornecedor', 'Resolvido', 'Fechado'],

  // D-03 — Valores gravados pela ferramenta para o status de SLA (não recalculados)
  slaDentro: 'Within SLA',
  slaViolado: 'SLA Violated',

  // D-07 / D-14 — Regras de INCONFORMIDADE
  inconformidade: {
    agenteSemResponsavel: 'No Agent',   // Agente = "No Agent"
    categoriaVazia: true                // Categoria em branco
  },
  rotuloSemAgente: 'Sem agente',
  rotuloNaoInformado: 'Não informado',

  // Faixas de aging do backlog (dias corridos) — padrão GMUD. O último limite antes de "Infinity"
  // define o "Backlog Crítico" (padrão GMUD: mais de 30 dias).
  faixasAging: [
    { rotulo: 'Até 7 dias', max: 7 },
    { rotulo: '8 a 15 dias', max: 15 },
    { rotulo: '16 a 30 dias', max: 30 },
    { rotulo: 'Mais de 30 dias', max: Infinity }
  ],
  agingCriticoDias: 30,

  // Faixas de atraso dos fechados fora do prazo (horas corridas entre vencimento e resolução)
  faixasAtraso: [
    { rotulo: 'Até 1 dia', max: 24 },
    { rotulo: '1 a 3 dias', max: 72 },
    { rotulo: '3 a 7 dias', max: 168 },
    { rotulo: 'Mais de 7 dias', max: Infinity }
  ],

  // D-13 — Não há meta corporativa de SLA. Com null, o painel não aplica semáforo de meta.
  // Para ativar: { verde: 90, amarelo: 80 }  (≥ verde = verde; ≥ amarelo = amarelo; abaixo = vermelho)
  metaSla: null,

  // Gráficos de % por grupo: grupos com menos encerrados que isto são somados em "Demais"
  // (evita exibir 100% com base em 1 ou 2 tickets). Nenhum ticket sai do cálculo.
  amostraMinimaPercentual: 10,

  // Avisa quando a última criação da base estiver mais de N dias antes da data da exportação
  alertaCoberturaDias: 2,

  // Modo TV — mesmo padrão do GMUD
  tvRotacaoSegundos: 25,
  tvLarguraMinima: 1600,

  // Efeitos de criação — mesmos valores do painel GMUD v2026.11.11-1740
  kpiContagemMs: 1400,          // contagem dos números dos KPIs (animateCountUp)
  graficosAnimacaoMs: 3200,     // crescimento dos gráficos (createChart: easeOutQuart)
  graficosCicloSegundos: 10,    // gráficos da aba ativa crescem de novo a cada N segundos
  monitorVarreduraMs: 4500,     // SLA & Tempos: varredura do "Monitor ao Vivo" (aba Eficiência & SLA do GMUD)

  // Esteiras (Operação e Todos os Chamados): segundos por linha/cartão em cada velocidade
  velocidades: { lento: 2.4, normal: 1.5, rapido: 0.8 },

  // Todos os Chamados: máximo de cartões por coluna (os mais recentes); o restante fica na aba Operação
  maxCartoesPorColuna: 150,
  maxColunasKanban: 6
};
