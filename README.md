# Sustentação Mondial — Painel Executivo

Painel executivo de chamados do time **Sustentação & GMUD** (grupo *N3 - Sistemas Sustentação*), com dados exportados do Freshservice. Segue o padrão visual e as regras do **Painel Executivo de GMUD** (`mkmondial/GMUD-PAINEL-EXECUTIVO`, v2026.11.11-1740): cabeçalho azul Mondial, 8 abas, KPIs com semáforo, atrasados pulsando em vermelho, fila com rolagem contínua, esteira Kanban e Modo TV.

## Estrutura

| Arquivo | Descrição |
| :--- | :--- |
| `index.html` | Página principal |
| `sustentacao-painel-app.js` | Lógica, KPIs, gráficos (Chart.js), Modo TV |
| `sustentacao-painel-estilo.css` | Estilos do GMUD + extensões da Sustentação |
| `sustentacao-painel-config.js` | Regras de negócio configuráveis (estados, faixas, metas) |
| `data/base-sustentacao.json` | Base oficial tratada, lida pelo servidor ao abrir |
| `sustentacao-painel-dados.js` | Cópia da base para abrir sem servidor |
| `tools/gerar_dados_sustentacao.py` | Gera a base a partir da exportação do Freshservice |
| `entrada/` | Exportação bruta (fora do Git — tem dados pessoais) |
| `Dockerfile` | Nginx estático, mesmo padrão do GMUD |

## Abas

1. **Visão Executiva** — 9 KPIs (volume, em aberto, encerrados, taxa no prazo, lead time, atrasados, fechados fora do prazo, SLA de 1ª resposta, inconformidade), evolução mensal, estados, itens, prioridade e tipo.
2. **Backlog & Aging** — backlog ativo, aging médio, backlog crítico (>30 dias), resolvidos no prazo, faixas de aging, lista dos abertos.
3. **SLA & Tempos** — taxa no prazo e SLA de 1ª resposta por mês, por tipo × prioridade, lead time e tempos P50/P90.
4. **Sistemas & Fornecedores** — volume e % fora do prazo por sistema, fornecedores e backlog com fornecedor.
5. **Demanda & Áreas** — departamentos, distribuição por agente (alfabética, sem ranking), localização, origem, mapa dia × hora.
6. **Desvios & Qualidade** — fechados fora do prazo por mês, tamanho do atraso, inconformidade por mês, conferência regra × ferramenta.
7. **Operação** — fila com rolagem contínua, filtros com contagem, busca, exportação CSV e detalhe do ticket.
8. **Todos os Chamados** — esteira Kanban por estado, sistema, categoria ou departamento.

## Regras de prazo (padrão GMUD)

- **Atrasado**: em aberto com *Hora de vencimento* anterior à data da exportação.
- **Fechado fora do prazo**: encerrado com *Hora de resolução* posterior à *Hora de vencimento* (igual ao status `SLA Violated` do Freshservice; o painel confere as duas formas).
- **Taxa no prazo**: `Within SLA ÷ (Within SLA + SLA Violated)` dos encerrados.

Fórmulas completas e checagens de qualidade: botão **📖 Regras** no painel.

## Atualizar a base

```bash
# 1. copie exporttickets-<data>.xlsx para entrada/
pip install openpyxl
python tools/gerar_dados_sustentacao.py
# 2. publique (commit / servidor)
```

O script grava só as colunas usadas, mascara e-mail/CPF/CNPJ no Assunto e avisa se a exportação não cobrir até a data em que foi gerada.
