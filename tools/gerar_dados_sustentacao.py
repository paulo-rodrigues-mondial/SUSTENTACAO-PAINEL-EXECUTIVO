"""
Sustentação Mondial — Painel Executivo
Gera a base oficial do painel a partir da exportação de tickets do Freshservice (.xlsx ou .csv).

Mesmo fluxo do painel GMUD (tools/gerar_dados_gmud.py), com uma diferença de segurança:
a planilha bruta do Freshservice NÃO é publicada (tem descrição, solução, nome e e-mail do
solicitante). O script grava apenas a versão tratada:

  data/base-sustentacao.json   -> lida pelo painel publicado no servidor ao abrir (todos veem)
  sustentacao-painel-dados.js  -> cópia usada quando o index.html é aberto sem servidor

Como rodar (na pasta do repositório):
    pip install openpyxl
    python tools/gerar_dados_sustentacao.py                       (usa o arquivo mais recente de entrada/)
    python tools/gerar_dados_sustentacao.py caminho/exporttickets-<data>.xlsx

Regras de privacidade (decisão D-05):
  - Descrição, Solução, Nota de resolução, nome e e-mail do solicitante não são copiados.
  - No Assunto, e-mails, CPF e CNPJ são mascarados.
  - Apenas as colunas de COLUNAS / COLUNAS_OPCIONAIS são gravadas.
O arquivo original não é alterado.
"""
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "entrada"
SAIDA_JSON = RAIZ / "data" / "base-sustentacao.json"
SAIDA_JS = RAIZ / "sustentacao-painel-dados.js"

# Obrigatórias: sem elas os indicadores não podem ser calculados
COLUNAS = [
    "ID do ticket", "Assunto", "Estado", "Tipo", "Prioridade", "Agente", "Grupo",
    "Categoria", "Subcategoria", "Item", "Serviço / Sistema", "Aplicação",
    "Fornecedor", "Chamado com Fornecedor", "Departamento", "Localização do solicitante",
    "Origem", "Tipo de associação",
    "Hora de criação", "Hora de vencimento", "Tempo de resposta inicial",
    "Tempo da primeira resposta (em horas)", "Estado da primeira resposta",
    "Hora de resolução", "Tempo de resolução (em horas)", "Estado de resolução",
    "Hora de fecho", "Hora da última atualização",
    "Interações do agente", "Interações com o Cliente",
]
# Opcionais: usadas se existirem na exportação (exportação de nov/2026 em diante)
COLUNAS_OPCIONAIS = ["Urgência", "Impacto", "Modulo", "OFENSOR", "Resultado do inquérito"]

# Se a última criação da base estiver mais de N dias antes da data da exportação, avisa
ALERTA_COBERTURA_DIAS = 2

RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
RE_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
RE_CNPJ = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")


def mascarar(txt: str) -> str:
    txt = RE_EMAIL.sub("[e-mail oculto]", txt)
    txt = RE_CNPJ.sub("[CNPJ oculto]", txt)
    txt = RE_CPF.sub("[CPF oculto]", txt)
    return txt


def texto(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def ler_linhas(caminho: Path):
    if caminho.suffix.lower() == ".csv":
        with open(caminho, encoding="utf-8-sig", newline="") as f:
            return [{k.strip(): texto(v) for k, v in r.items() if k} for r in csv.DictReader(f)]
    try:
        from openpyxl import load_workbook
    except ImportError:
        sys.exit("Instale o openpyxl:  pip install openpyxl")
    wb = load_workbook(caminho, read_only=True, data_only=True)
    linhas = wb.worksheets[0].iter_rows(values_only=True)
    cab = [texto(c) for c in next(linhas)]
    saida = []
    for row in linhas:
        if not any(c is not None and str(c).strip() != "" for c in row):
            continue
        saida.append({k: texto(v) for k, v in zip(cab, row) if k})
    return saida


def data_referencia(nome: str):
    """Data/hora da exportação a partir do nome padrão do Freshservice (exporttickets-November-12-2026-11_01)."""
    m = re.search(r"([A-Za-z]+)-(\d{1,2})-(\d{4})-(\d{1,2})_(\d{2})", nome)
    if not m:
        return None
    try:
        dt = datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)} {m.group(4)}:{m.group(5)}", "%B %d %Y %H:%M")
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def escolher_arquivo():
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    candidatos = sorted(
        [p for p in ENTRADA.glob("*") if p.suffix.lower() in (".xlsx", ".csv")],
        key=lambda p: p.stat().st_mtime, reverse=True,
    )
    if not candidatos:
        sys.exit(f"Nenhuma exportação encontrada em {ENTRADA}. Copie o exporttickets-*.xlsx para lá ou informe o caminho.")
    return candidatos[0]


def main():
    origem = escolher_arquivo()
    if not origem.exists():
        sys.exit(f"Arquivo não encontrado: {origem}")
    linhas = ler_linhas(origem)
    if not linhas:
        sys.exit("A exportação está vazia.")
    faltando = [c for c in COLUNAS if c not in linhas[0]]
    if faltando:
        sys.exit(f"Colunas ausentes na exportação: {faltando}")
    opcionais = [c for c in COLUNAS_OPCIONAIS if c in linhas[0]]
    colunas = COLUNAS + opcionais

    registros = []
    for r in linhas:
        reg = [r.get(c, "") for c in colunas]
        reg[colunas.index("Assunto")] = mascarar(reg[colunas.index("Assunto")])
        registros.append(reg)

    i_cri = colunas.index("Hora de criação")
    i_upd = colunas.index("Hora da última atualização")
    i_id = colunas.index("ID do ticket")
    criacoes = sorted(r[i_cri] for r in registros if r[i_cri])
    ref = data_referencia(origem.name) or max((r[i_upd] for r in registros if r[i_upd]), default="")

    meta = {
        "arquivoOrigem": origem.name,
        "dataReferencia": ref,
        "geradoEm": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "totalRegistros": len(registros),
        "criacaoMin": criacoes[0] if criacoes else "",
        "criacaoMax": criacoes[-1] if criacoes else "",
    }
    base = {"meta": meta, "colunas": colunas, "linhas": registros}
    js = json.dumps(base, ensure_ascii=False, separators=(",", ":"))

    SAIDA_JSON.parent.mkdir(parents=True, exist_ok=True)
    SAIDA_JSON.write_text(js, encoding="utf-8")
    with open(SAIDA_JS, "w", encoding="utf-8") as f:
        f.write("/* Base oficial do painel (gerada por tools/gerar_dados_sustentacao.py) — não editar manualmente.\n")
        f.write("   Usada quando o painel é aberto sem servidor ou se data/base-sustentacao.json não carregar. */\n")
        f.write("window.SUST_BASE = " + js + ";\n")

    print(f"OK: {len(registros)} tickets • referência {ref}")
    print(f"    {SAIDA_JSON.relative_to(RAIZ)}")
    print(f"    {SAIDA_JS.relative_to(RAIZ)}")

    # Avisos de qualidade (não bloqueiam a geração)
    ids = [r[i_id] for r in registros]
    if len(ids) != len(set(ids)):
        print(f"AVISO: {len(ids) - len(set(ids))} IDs duplicados na exportação.")
    if ref and criacoes:
        gap = (datetime.strptime(ref[:19], "%Y-%m-%d %H:%M:%S") - datetime.strptime(criacoes[-1][:19], "%Y-%m-%d %H:%M:%S")).days
        if gap > ALERTA_COBERTURA_DIAS:
            print(f"AVISO: a exportação só traz tickets criados até {criacoes[-1][:10]}, {gap} dias antes da exportação.")
            print("       Verifique o filtro de período no Freshservice: tickets abertos depois dessa data não estão na base.")


if __name__ == "__main__":
    main()
