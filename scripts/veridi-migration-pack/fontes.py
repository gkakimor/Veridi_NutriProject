"""
Fontes reais da migração e consolidação do pacote de revisão.

Lê SOMENTE o corpus histórico real da Veridi em `.local-data/veridi/`:

- `csv/` ............... planilhas extraídas em 16/08/2026 (`veridi-dados-csv.zip`);
- `market-reference/` .. pesquisa pública de preço de 07/09/2026 e, quando
                          existir, a pesquisa complementar desta rodada.

Nunca lê: `cargaExemplo/` (pacote sintético), `out/` e `de-para/` (derivados
de bancos DEV — os códigos de lá são de outro ambiente), banco de qualquer
ambiente, seed, E2E ou golden path.

Cada registro traz TODOS os campos da tela do ERP. O que existe no legado vem
preenchido; campo de tela sem dado no legado vem com o padrão do sistema (ou
vazio). Nada é "corrigido": o que não dá para afirmar fica vazio e vira
pendência. Todo registro nasce STATUS_REVISAO = REVISAR — só a Veridi aprova.
"""

from __future__ import annotations

import csv
import hashlib
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

import regras as R

GERADO_NA_CARGA = "GERADO NA CARGA"
STATUS_INICIAL = "REVISAR"

MAPA = "00_MAPA_CHAVES_PRODUCAO"
CLIENTES = "01_CLIENTES"
FORNECEDORES = "02_FORNECEDORES"
MATERIAS_PRIMAS = "03_MATERIAS_PRIMAS"
EMBALAGENS = "04_EMBALAGENS_INSUMOS"
PRODUTOS = "05_PRODUTOS_ACABADOS"
PRECOS = "06_PRECOS_REFERENCIA_MERCADO"
OFERTAS = "07_FORNECEDOR_ITENS_PRECOS"
ARQUIVOS = [MAPA, CLIENTES, FORNECEDORES, MATERIAS_PRIMAS, EMBALAGENS, PRODUTOS, PRECOS, OFERTAS]

DATA_PESQUISA_ANTERIOR = date(2026, 9, 7)

ONDE_APARECE = {
    "CADASTRO": "Cadastro de itens (itens.csv)",
    "SO_CMV": "Só no cadastro do CMV (itens_enriquecimento.csv)",
    "SO_PRECOS": "Só na planilha de preços (precos_fornecedores.csv)",
}

# ITEM_TYPE_DEFAULTS de @veridi/shared (o mesmo que o formulário aplica) —
# requiresCoa não tem padrão por tipo: o formulário sempre começa em NÃO.
PADRAO_POR_TIPO = {
    "MATERIA_PRIMA": {"CONTROLA_LOTE": "SIM", "CONTROLA_VALIDADE": "SIM", "REQUER_LIBERACAO_QUALIDADE": "SIM"},
    "EMBALAGEM": {"CONTROLA_LOTE": "SIM", "CONTROLA_VALIDADE": "NÃO", "REQUER_LIBERACAO_QUALIDADE": "NÃO"},
}


@dataclass
class Pendencia:
    arquivo: str
    chave: str
    registro: str
    problema: str
    valor_atual: str
    acao: str
    impede_carga: bool


@dataclass
class Legado:
    arquivo: str
    chave: str
    campo: str
    valor: str
    fonte: str
    motivo: str


@dataclass
class Fonte:
    arquivo: str
    linhas: int | None
    sha256: str
    natureza: str
    uso: str
    detalhe: str


@dataclass
class Pacote:
    dados: Path
    clientes: list[dict] = field(default_factory=list)
    fornecedores: list[dict] = field(default_factory=list)
    itens: list[dict] = field(default_factory=list)
    produtos: list[dict] = field(default_factory=list)
    precos: list[dict] = field(default_factory=list)
    ofertas: list[dict] = field(default_factory=list)
    pendencias: list[Pendencia] = field(default_factory=list)
    legado: list[Legado] = field(default_factory=list)
    fontes: list[Fonte] = field(default_factory=list)
    excluidos: list[dict] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)
    pesquisa: dict = field(default_factory=dict)

    def pendencia(self, arquivo, chave, registro, problema, valor, acao, impede):
        self.pendencias.append(Pendencia(arquivo, chave, registro, problema, valor, acao, impede))

    def pendencias_de(self, arquivo: str) -> list[Pendencia]:
        return [p for p in self.pendencias if p.arquivo == arquivo]

    def legado_de(self, arquivo: str) -> list[Legado]:
        return [item for item in self.legado if item.arquivo == arquivo]


# ─────────────────────────── leitura ───────────────────────────


def ler_csv(caminho: Path) -> list[dict[str, str]]:
    """Como `readCorpusCsv`: cabeçalho e células aparados, linha toda vazia ignorada."""
    with caminho.open(encoding="utf-8-sig", newline="") as arquivo:
        linhas = []
        for bruta in csv.DictReader(arquivo):
            linha = {(k or "").strip(): (v or "").strip() for k, v in bruta.items() if k is not None}
            if any(linha.values()):
                linhas.append(linha)
        return linhas


def sha256(caminho: Path) -> str:
    return hashlib.sha256(caminho.read_bytes()).hexdigest()


def texto_legado(valor: str) -> str:
    """Espelha `cleanText` do importador (sem tratar marcador): chave de idempotência."""
    return re.sub(r"\s+", " ", valor or "").strip()


def data_iso(valor: str) -> date | None:
    try:
        return date.fromisoformat((valor or "").strip()[:10])
    except ValueError:
        return None


def decimal_legado(valor: str) -> Decimal | None:
    """Espelha `safeDecimal`: vazio, erro do Excel (#VALUE!) e texto viram None."""
    texto = (valor or "").strip()
    if not texto or texto.startswith("#"):
        return None
    try:
        numero = Decimal(texto)
    except InvalidOperation:
        return None
    return numero if numero.is_finite() else None


_PEDIDO_MINIMO = re.compile(r"^(\d+(?:[.,]\d+)?)\s*([A-Za-z]*)$")
_ALIAS_PEDIDO_MINIMO = {"MG": "mg", "G": "g", "KG": "kg", "UN": "un", "UNI": "un", "UNID": "un", "ML": "mL", "L": "L"}


def interpretar_pedido_minimo(bruto: str) -> tuple[Decimal, str | None] | None:
    """Espelha `parseMinimumOrder`: aceita `25`, `500G`, `1 KG`; recusa `1mil`, `KG`."""
    texto = texto_legado(bruto)
    achado = _PEDIDO_MINIMO.match(texto) if texto else None
    if not achado:
        return None
    try:
        quantidade = Decimal(achado.group(1).replace(",", "."))
    except InvalidOperation:
        return None
    if quantidade <= 0:
        return None
    sufixo = achado.group(2).upper()
    if not sufixo:
        return quantidade, None
    unidade = _ALIAS_PEDIDO_MINIMO.get(sufixo)
    return (quantidade, unidade) if unidade else None


def afirmativo(valor: str) -> bool:
    return texto_legado(valor).upper() in {"SIM", "S", "OK", "TRUE", "1"}


# ─────────────────────────── consolidação ───────────────────────────


def consolidar(dados: Path, pesquisa_nova: Path | None) -> Pacote:
    pac = Pacote(dados=dados)
    csvdir = dados / "csv"
    fontes = {
        nome: ler_csv(csvdir / nome)
        for nome in [
            "clientes.csv", "fornecedores.csv", "itens.csv", "itens_enriquecimento.csv", "formulacoes.csv",
            "projetos.csv", "precos_fornecedores.csv", "compras_recebimentos.csv", "estoque_saldos.csv",
            "cmv_produtos.csv",
        ]
    }
    _registrar_fontes(pac, fontes, pesquisa_nova)

    _clientes(pac, fontes)
    _fornecedores(pac, fontes)
    _itens(pac, fontes)
    _produtos(pac, fontes)
    _ofertas(pac, fontes)
    _precos_mercado(pac, fontes, pesquisa_nova)
    _custos_de_referencia(pac)
    _varredura_sintetica(pac)
    _status(pac)
    return pac


def _registrar_fontes(pac: Pacote, fontes: dict, pesquisa_nova: Path | None) -> None:
    usos = {
        "clientes.csv": "Clientes (01)",
        "fornecedores.csv": "Fornecedores (02)",
        "itens.csv": "Matérias-primas e embalagens (03, 04) — cadastro principal",
        "itens_enriquecimento.csv": "Família e pureza dos itens; itens que só existem no CMV (03, 04)",
        "formulacoes.csv": "Conjunto de produtos acabados (05); uso dos itens; materiais sem código",
        "projetos.csv": "Nome e cliente dos produtos (05)",
        "precos_fornecedores.csv": "Relação item × fornecedor e ofertas do legado (07); custo de referência (03, 04)",
        "compras_recebimentos.csv": "Conferência: uso dos fornecedores (não importado — política do runbook)",
        "estoque_saldos.csv": "Conferência: uso dos itens (saldo não entra neste pacote)",
        "cmv_produtos.csv": "Atributos de produto sem código (LEGADO_NAO_IMPORTADO de 05)",
    }
    for nome, linhas in fontes.items():
        caminho = pac.dados / "csv" / nome
        pac.fontes.append(Fonte(f"csv/{nome}", len(linhas), sha256(caminho), "REAL", "UTILIZADA", usos[nome]))

    zip_path = pac.dados / "veridi-dados-csv.zip"
    if zip_path.exists():
        iguais, total = 0, 0
        with zipfile.ZipFile(zip_path) as pacote_zip:
            for membro in pacote_zip.namelist():
                destino = pac.dados / "csv" / Path(membro).name
                if not destino.exists():
                    continue
                total += 1
                if hashlib.sha256(pacote_zip.read(membro)).hexdigest() == sha256(destino):
                    iguais += 1
        pac.fontes.append(
            Fonte(
                "veridi-dados-csv.zip", None, sha256(zip_path), "REAL", "PROVENIENCIA",
                f"{iguais} de {total} arquivos do zip idênticos (SHA-256) aos CSVs usados — origem: planilhas da Veridi.",
            )
        )

    mercado = pac.dados / "market-reference" / "market-prices.csv"
    if mercado.exists():
        linhas = ler_csv(mercado)
        publicas = sum(1 for linha in linhas if linha.get("categoria_fonte") == "PESQUISA_MERCADO")
        pac.fontes.append(
            Fonte(
                "market-reference/market-prices.csv", len(linhas), sha256(mercado), "REAL", "UTILIZADA (parcial)",
                f"Só as {publicas} linhas PESQUISA_MERCADO (pesquisa pública de 07/09/2026). As linhas "
                "OFERTA_FORNECEDOR foram montadas a partir de um banco DEV e NÃO são usadas: a oferta vem "
                "direto da fonte original, precos_fornecedores.csv.",
            )
        )
    tier3 = pac.dados / "market-reference" / "tier3-web-findings.tsv"
    if tier3.exists():
        pac.fontes.append(
            Fonte(
                "market-reference/tier3-web-findings.tsv", None, sha256(tier3), "REAL", "CONFERENCIA",
                "Achados brutos da pesquisa de 07/09/2026 (códigos de item do banco DEV); a mesma pesquisa "
                "já resolvida por código de planilha em market-prices.csv.",
            )
        )
    if pesquisa_nova and pesquisa_nova.exists():
        pac.fontes.append(
            Fonte(
                str(pesquisa_nova.relative_to(pac.dados)).replace("\\", "/"), None, sha256(pesquisa_nova),
                "REAL", "UTILIZADA", "Pesquisa pública complementar desta rodada (itens nunca pesquisados).",
            )
        )

    exemplo = pac.dados / "cargaExemplo"
    if exemplo.exists():
        for arquivo in sorted(exemplo.iterdir()):
            pac.fontes.append(
                Fonte(
                    f"cargaExemplo/{arquivo.name}", None, sha256(arquivo), "SINTETICO", "EXCLUIDA",
                    "Pacote sintético de exemplos (prefixo 'EXEMPLO —'); não é dado da Veridi.",
                )
            )
    for pasta, motivo in (
        ("out", "Saída do importador rodado em banco DEV: códigos (CLI-000001…) de outro ambiente."),
        ("de-para", "De-para de uma carga antiga em banco DEV: códigos de outro ambiente."),
        ("overrides", "Modelos de decisão do importador, sem nenhuma decisão preenchida."),
    ):
        caminho = pac.dados / pasta
        if caminho.exists():
            pac.fontes.append(Fonte(f"{pasta}/", None, "", "DERIVADO", "EXCLUIDA", motivo))


def _clientes(pac: Pacote, fontes: dict) -> None:
    por_cnpj: dict[str, list[str]] = defaultdict(list)
    por_razao: dict[str, list[str]] = defaultdict(list)
    for numero_linha, linha in enumerate(fontes["clientes.csv"], start=2):
        codigo = R.limpar(linha["cod_planilha"])
        chave = R.chave_cliente(codigo)
        razao = R.limpar(linha["razao_social"])
        fantasia = R.limpar(linha["nome_fantasia"])
        cnpj = R.so_digitos(linha["cnpj_digitos"])
        endereco = R.limpar(linha["endereco"])
        partes = R.interpretar_endereco(endereco)
        cep = R.extrair_cep(endereco)
        registro = {
            "CHAVE_MIGRACAO": chave,
            "CODIGO_PRODUCAO_PREVISTO": GERADO_NA_CARGA,
            "CODIGO_PLANILHA": codigo,
            "RAZAO_SOCIAL_NOME": razao,
            "NOME_FANTASIA": fantasia,
            "CNPJ": R.formatar_cnpj(cnpj) if cnpj else "",
            "PERFIL_TRIBUTARIO": "NAO_INFORMADO",
            "EMAIL": "",
            "TELEFONE": "",
            "CEP": cep,
            "LOGRADOURO": partes["logradouro"],
            "NUMERO": partes["numero"],
            "COMPLEMENTO": "",
            "BAIRRO": R.sem_cep_no_fim(partes["bairro"]) if cep else partes["bairro"],
            "CIDADE": R.limpar(linha["cidade"]),
            "UF": R.limpar(linha["uf"]).upper(),
            # Como o importador: o texto original do endereço vai para as notas.
            "NOTAS_INTERNAS": f"Endereço original (planilha): {endereco}" if endereco else "",
            "ATIVO": "SIM",
            "STATUS_REVISAO": "",
            "OBSERVACAO_REVISAO": "",
            "_nome": fantasia or razao,
            "_fonte": f"clientes.csv linha {numero_linha} (cod_planilha {codigo})",
            "_cod": codigo,
        }
        pac.clientes.append(registro)
        nome = registro["_nome"]

        if not razao:
            pac.pendencia(
                CLIENTES, chave, nome, "CAMPO_OBRIGATORIO_AUSENTE",
                f"Razão social vazia no legado (nome fantasia: {fantasia or '—'}).",
                "Informar a Razão Social / Nome. Se o cliente não tiver outra, repetir o nome fantasia.", True,
            )
        if cnpj:
            if R.cnpj_valido(cnpj):
                por_cnpj[cnpj].append(chave)
            else:
                pac.pendencia(
                    CLIENTES, chave, nome, "DOCUMENTO_INVALIDO",
                    f"CNPJ {R.formatar_cnpj(cnpj)} — dígito verificador não confere.",
                    "Corrigir o CNPJ ou deixar a célula vazia (o sistema recusa CNPJ inválido).", True,
                )
        if razao:
            por_razao[R.normalizar_nome(razao)].append(chave)
        if endereco and partes["revisar"]:
            pac.pendencia(
                CLIENTES, chave, nome, "ENDERECO_REVISAR",
                f"{partes['motivo']} — original: \"{endereco}\"",
                "Conferir CEP, LOGRADOURO, NUMERO, COMPLEMENTO e BAIRRO a partir do endereço original (em "
                "NOTAS_INTERNAS); o que não for possível afirmar pode ficar vazio.", False,
            )
        if registro["UF"] and registro["UF"] not in R.UFS:
            pac.pendencia(
                CLIENTES, chave, nome, "VALOR_INVALIDO", f"UF \"{registro['UF']}\" não é sigla válida.",
                "Informar a UF com a sigla de 2 letras.", True,
            )
        uf_no_endereco = re.search(r"cidade de\s+([^,/]+?)\s*/\s*([A-Za-z]{2})\b", endereco, re.I)
        if uf_no_endereco and registro["UF"] and uf_no_endereco.group(2).upper() != registro["UF"]:
            pac.pendencia(
                CLIENTES, chave, nome, "VALOR_INVALIDO",
                f"UF da coluna ({registro['UF']}) diverge da UF escrita no endereço "
                f"({uf_no_endereco.group(1).strip()}/{uf_no_endereco.group(2).upper()}).",
                "Conferir e corrigir a UF (e a cidade, se for o caso).", False,
            )

    nomes = {c["CHAVE_MIGRACAO"]: c for c in pac.clientes}
    for cnpj, chaves in por_cnpj.items():
        if len(chaves) > 1:
            for chave in chaves:
                outros = ", ".join(f"{c} ({nomes[c]['_nome']})" for c in chaves if c != chave)
                pac.pendencia(
                    CLIENTES, chave, nomes[chave]["_nome"], "DUPLICIDADE",
                    f"Mesmo CNPJ {R.formatar_cnpj(cnpj)} de: {outros}.",
                    "Manter um cadastro e marcar o outro como NAO_IMPORTAR (o sistema não aceita CNPJ repetido).",
                    True,
                )
    for _razao, chaves in por_razao.items():
        if len(chaves) > 1:
            for chave in chaves:
                outros = "; ".join(
                    f"{c} ({nomes[c]['NOME_FANTASIA']}, CNPJ {nomes[c]['CNPJ'] or 'vazio'})" for c in chaves if c != chave
                )
                pac.pendencia(
                    CLIENTES, chave, nomes[chave]["_nome"], "DUPLICIDADE",
                    f"Mesma razão social de: {outros}. Este: CNPJ {nomes[chave]['CNPJ'] or 'vazio'}.",
                    "Confirmar se são o mesmo cliente (ex.: marca própria) ou dois cadastros; se for o mesmo, "
                    "manter um e marcar o outro como NAO_IMPORTAR. Nada foi fundido automaticamente.",
                    False,
                )


def _fornecedores(pac: Pacote, fontes: dict) -> None:
    nomes = [R.limpar(linha["nome_fornecedor"]) for linha in fontes["fornecedores.csv"]]
    itens_com_preco: dict[str, set[str]] = defaultdict(set)
    for linha in fontes["precos_fornecedores.csv"]:
        itens_com_preco[R.normalizar_nome(linha["fornecedor"])].add(linha["cod_item"])
    uso_precos = Counter(R.normalizar_nome(l["fornecedor"]) for l in fontes["precos_fornecedores.csv"])
    uso_compras = Counter(R.normalizar_nome(l["fornecedor"]) for l in fontes["compras_recebimentos.csv"])
    ultima_compra: dict[str, date] = {}
    for linha in fontes["compras_recebimentos.csv"]:
        quando = data_iso(linha["data_compra"])
        chave_nome = R.normalizar_nome(linha["fornecedor"])
        if quando and (chave_nome not in ultima_compra or quando > ultima_compra[chave_nome]):
            ultima_compra[chave_nome] = quando

    def uso(nome: str) -> str:
        n = R.normalizar_nome(nome)
        texto = f"{uso_precos.get(n, 0)} preço(s), {uso_compras.get(n, 0)} compra(s)"
        if n in ultima_compra:
            texto += f", última compra {ultima_compra[n]:%d/%m/%Y}"
        return texto

    semelhantes = R.grupos_semelhantes(nomes)
    chaves_vistas: dict[str, str] = {}
    for numero_linha, nome in enumerate(nomes, start=2):
        chave = R.chave_fornecedor(nome)
        n = R.normalizar_nome(nome)
        itens_fornecidos = (
            f"{len(itens_com_preco.get(n, set()))} item(ns) com preço na planilha (ver 07) · "
            f"{uso_compras.get(n, 0)} compra(s) no legado"
            + (f" · última compra {ultima_compra[n]:%d/%m/%Y}" if n in ultima_compra else "")
        )
        pac.fornecedores.append(
            {
                "CHAVE_MIGRACAO": chave,
                "CODIGO_PRODUCAO_PREVISTO": GERADO_NA_CARGA,
                "NOME_PLANILHA": nome,
                "RAZAO_SOCIAL_NOME": nome,
                "NOME_FANTASIA": "",
                "CNPJ": "",
                "EMAIL": "",
                "TELEFONE": "",
                # Endereço: o legado deriva o fornecedor só pelo nome e não tem
                # endereço confiável. Nasce vazio e é opcional — a Veridi
                # preenche à mão na revisão. Nada é pesquisado nem deduzido.
                "CEP": "",
                "LOGRADOURO": "",
                "NUMERO": "",
                "COMPLEMENTO": "",
                "BAIRRO": "",
                "CIDADE": "",
                "UF": "",
                "NOTAS_INTERNAS": "",
                "ATIVO": "SIM",
                "ITENS_FORNECIDOS": itens_fornecidos,
                "STATUS_REVISAO": "",
                "OBSERVACAO_REVISAO": "",
                "_nome": nome,
                "_fonte": f"fornecedores.csv linha {numero_linha}",
            }
        )
        if chave in chaves_vistas:
            pac.pendencia(
                FORNECEDORES, chave, nome, "DUPLICIDADE", f"Gera a mesma chave que \"{chaves_vistas[chave]}\".",
                "Manter um e marcar o outro como NAO_IMPORTAR.", True,
            )
        chaves_vistas[chave] = nome

        if nome in semelhantes:
            partes = [
                f"{R.chave_fornecedor(outro)} \"{outro}\" ({motivo}; {uso(outro)})" for outro, motivo in semelhantes[nome]
            ]
            pac.pendencia(
                FORNECEDORES, chave, nome, "DUPLICIDADE",
                f"Parecido com: {' · '.join(partes)}. Este: {uso(nome)}.",
                "Se for o mesmo fornecedor: manter um, marcar os outros como NAO_IMPORTAR e anotar em "
                "OBSERVACAO_REVISAO a chave mantida. Se forem empresas diferentes: nada a fazer.",
                False,
            )
        compacto = n.replace(" ", "")
        if len(compacto) <= 3:
            candidatos = R.candidatos_abreviacao(nome, nomes)
            if len(compacto) <= 2 or candidatos:
                lista = ", ".join(f"\"{c}\"" for c in candidatos[:6]) + (" …" if len(candidatos) > 6 else "")
                pac.pendencia(
                    FORNECEDORES, chave, nome, "DADO_INCOMPLETO",
                    f"Nome com {len(compacto)} caractere(s)"
                    + (f"; pode ser abreviação de: {lista}" if candidatos else "")
                    + f". Uso: {uso(nome)}.",
                    "Informar a Razão Social / Nome completo ou, se for repetição de outro fornecedor, "
                    "marcar NAO_IMPORTAR.",
                    False,
                )
        if n == "MERCADO LIVRE":
            pac.pendencia(
                FORNECEDORES, chave, nome, "CLASSIFICACAO_AMBIGUA",
                f"Marketplace, não fabricante/distribuidor. Uso: {uso(nome)}.",
                "Confirmar se deve existir como fornecedor (compras feitas pelo marketplace) ou marcar NAO_IMPORTAR.",
                False,
            )
        if n == "VERIDI":
            pac.pendencia(
                FORNECEDORES, chave, nome, "CLASSIFICACAO_AMBIGUA",
                f"Nome da própria Veridi usado como fornecedor. Uso: {uso(nome)}.",
                "Confirmar o uso (material próprio? transferência?) ou marcar NAO_IMPORTAR.", False,
            )


def _itens(pac: Pacote, fontes: dict) -> None:
    enriquecimento = {linha["cod_item"]: linha for linha in fontes["itens_enriquecimento.csv"]}
    formulas = fontes["formulacoes.csv"]
    precos = fontes["precos_fornecedores.csv"]
    uso_formula = Counter(l["cod_item"] for l in formulas if l["cod_item"])
    produtos_por_item: dict[str, set[str]] = defaultdict(set)
    for linha in formulas:
        if linha["cod_item"]:
            produtos_por_item[linha["cod_item"]].add(linha["cod_produto"])
    precos_por_item: dict[str, list[dict]] = defaultdict(list)
    for linha in precos:
        precos_por_item[linha["cod_item"]].append(linha)
    uso_compras = Counter(l["cod_item"] for l in fontes["compras_recebimentos.csv"] if l["cod_item"])
    saldo = {l["cod_item"]: R.limpar(l["saldo_final_kg"]) for l in fontes["estoque_saldos.csv"]}

    def uso(codigo: str) -> str:
        partes = []
        if uso_formula.get(codigo):
            partes.append(f"{uso_formula[codigo]} linha(s) de fórmula em {len(produtos_por_item[codigo])} produto(s)")
        if precos_por_item.get(codigo):
            nomes_forn = sorted({R.limpar(l["fornecedor"]) for l in precos_por_item[codigo]})
            partes.append(
                f"{len(precos_por_item[codigo])} preço(s) de fornecedor ({', '.join(nomes_forn[:4])}"
                f"{' …' if len(nomes_forn) > 4 else ''})"
            )
        if uso_compras.get(codigo):
            partes.append(f"{uso_compras[codigo]} compra(s)")
        if saldo.get(codigo):
            partes.append(f"saldo legado {saldo[codigo]}")
        return "; ".join(partes) or "sem uso em fórmulas, preços, compras ou estoque"

    candidatos = []
    no_cadastro = set()
    for numero_linha, linha in enumerate(fontes["itens.csv"], start=2):
        codigo = R.limpar(linha["cod_planilha"])
        no_cadastro.add(codigo)
        e = enriquecimento.get(codigo, {})
        tipo_sugerido = R.limpar(linha["tipo_sugerido"]).upper()
        candidatos.append(
            {
                "codigo": codigo,
                "nome": R.limpar(linha["materia_prima_fonte"]) or R.limpar(linha["nutriente_declarado"]),
                "fonte_quimica": R.limpar(linha["materia_prima_fonte"]),
                "nutriente": R.limpar(linha["nutriente_declarado"]),
                "familia_legado": R.limpar(e.get("familia", "")),
                "pureza_bruta": e.get("grau_pureza", ""),
                "tipo": tipo_sugerido if tipo_sugerido in ("MATERIA_PRIMA", "EMBALAGEM") else "",
                "tipo_bruto": tipo_sugerido,
                "origem": "CADASTRO",
                "fonte": f"itens.csv linha {numero_linha} (cod_planilha {codigo})",
                "inferencia": "",
            }
        )

    extras = sorted(
        {c for c in set(enriquecimento) | set(precos_por_item) if c.isdigit() and c not in no_cadastro}, key=int
    )
    for codigo in extras:
        e = enriquecimento.get(codigo, {})
        nomes_preco = Counter(
            R.limpar(l["materia_prima_fonte"]) for l in precos_por_item.get(codigo, []) if R.limpar(l["materia_prima_fonte"])
        )
        nutrientes_preco = Counter(
            R.limpar(l["nutriente"], zero_e_vazio=True)
            for l in precos_por_item.get(codigo, [])
            if R.limpar(l["nutriente"], zero_e_vazio=True)
        )
        nome = R.limpar(e.get("materia_prima_fonte", "")) or (nomes_preco.most_common(1)[0][0] if nomes_preco else "")
        nutriente = R.limpar(e.get("nutriente", ""), zero_e_vazio=True) or (
            nutrientes_preco.most_common(1)[0][0] if nutrientes_preco else ""
        )
        familia_legado = R.limpar(e.get("familia", ""))
        if R.normalizar_nome(familia_legado) in ("EMBALAGEM", "EMBALAGENS"):
            tipo, inferencia = "EMBALAGEM", f"tipo inferido da família do CMV \"{familia_legado}\""
        elif R.PADRAO_EMBALAGEM.search(nome):
            tipo, inferencia = "EMBALAGEM", f"tipo inferido pelo nome (\"{R.PADRAO_EMBALAGEM.search(nome).group(0)}\")"
        else:
            tipo, inferencia = "MATERIA_PRIMA", "sem sinal de embalagem no nome/família ⇒ tratado como matéria-prima"
        if len(nomes_preco) > 1:
            inferencia += f"; nomes diferentes nas linhas de preço: {', '.join(nomes_preco)}"
        candidatos.append(
            {
                "codigo": codigo,
                "nome": nome,
                "fonte_quimica": nome,
                "nutriente": nutriente,
                "familia_legado": familia_legado,
                "pureza_bruta": e.get("grau_pureza", ""),
                "tipo": tipo,
                "tipo_bruto": "",
                "origem": "SO_CMV" if codigo in enriquecimento else "SO_PRECOS",
                "fonte": (
                    f"itens_enriquecimento.csv (cod_item {codigo})"
                    if codigo in enriquecimento
                    else f"precos_fornecedores.csv ({len(precos_por_item[codigo])} linha(s), cod_item {codigo})"
                ),
                "inferencia": inferencia,
            }
        )

    por_nome: dict[str, list[dict]] = defaultdict(list)
    for c in candidatos:
        tipo = c["tipo"] or "MATERIA_PRIMA"
        mp = tipo == "MATERIA_PRIMA"
        arquivo = MATERIAS_PRIMAS if mp else EMBALAGENS
        chave = R.chave_item(c["codigo"])
        familia_norm = R.normalizar_nome(c["familia_legado"])
        familia, direta = R.familia_do_pacote(c["familia_legado"])
        if not mp:
            familia = "EMBALAGEM" if familia_norm in ("EMBALAGEM", "EMBALAGENS") else ""
        pureza, pureza_texto = R.pureza_fracao(c["pureza_bruta"])
        registro = {
            "CHAVE_MIGRACAO": chave,
            "CODIGO_PRODUCAO_PREVISTO": GERADO_NA_CARGA,
            "CODIGO_PLANILHA": c["codigo"],
            "TIPO": tipo,
            "UNIDADE": "kg" if mp else "un",
            "NOME": c["nome"],
            "FONTE": c["fonte_quimica"] if mp else "",
            "NUTRIENTE_DECLARADO": c["nutriente"] if mp else "",
            "FAMILIA": familia,
            "PUREZA_PADRAO": pureza if mp else None,
            "SUBTIPO_EMBALAGEM": "" if mp else R.subtipo_sugerido(c["nome"]),
            **PADRAO_POR_TIPO[tipo],
            "EXIGE_COA_LAUDO": "NÃO",
            "BARCODE_EXTERNO": "",
            "CUSTO_REFERENCIA": None,
            "ORIGEM_CUSTO_REFERENCIA": "",
            "OBSERVACAO_REFERENCIA": "",
            "FORNECEDORES_E_PRECOS_LEGADO": "",
            "PRECOS_DE_MERCADO": "",
            "ATIVO": "SIM",
            "ONDE_APARECE_NO_LEGADO": ONDE_APARECE[c["origem"]],
            "STATUS_REVISAO": "",
            "OBSERVACAO_REVISAO": "",
            "_arquivo": arquivo,
            "_origem": c["origem"],
            "_fonte": c["fonte"],
            "_uso": uso(c["codigo"]),
            "_nome": c["nome"],
            "_codigo": c["codigo"],
        }
        pac.itens.append(registro)
        nome = c["nome"] or f"(sem nome) cód. {c['codigo']}"
        if c["nome"]:
            por_nome[R.normalizar_nome(c["nome"])].append(registro)

        if not c["nome"]:
            pac.pendencia(
                arquivo, chave, nome, "CAMPO_OBRIGATORIO_AUSENTE", "Nome vazio em todas as fontes.",
                "Informar o nome do item ou marcar NAO_IMPORTAR.", True,
            )
        if c["origem"] != "CADASTRO":
            pac.pendencia(
                arquivo, chave, nome, "ITEM_FORA_DO_CADASTRO",
                f"Código {c['codigo']} não está no cadastro de itens (itens.csv). Fonte: {c['fonte']}. "
                f"Uso: {uso(c['codigo'])}. {c['inferencia'].capitalize()}.",
                "Confirmar se o item existe e deve ser cadastrado ou marcar NAO_IMPORTAR. Conferir nome, tipo e unidade.",
                True,
            )
        else:
            motivos = []
            if not c["tipo"]:
                motivos.append(f"tipo_sugerido \"{c['tipo_bruto']}\" fora da lista — assumido MATERIA_PRIMA")
            if not mp and familia_norm not in ("", "EMBALAGEM", "EMBALAGENS"):
                motivos.append(f"tipo EMBALAGEM, mas a família no CMV é \"{c['familia_legado']}\"")
            if mp and familia_norm in ("EMBALAGEM", "EMBALAGENS"):
                motivos.append(f"tipo MATERIA_PRIMA, mas a família no CMV é \"{c['familia_legado']}\"")
            achado = R.PADRAO_EMBALAGEM.search(c["nome"])
            if mp and achado:
                motivos.append(f"o nome sugere embalagem (\"{achado.group(0)}\")")
            if mp and R.PADRAO_CAPSULA.search(c["nome"]):
                motivos.append(
                    "item em forma de cápsula: confirmar se é matéria-prima ou material de embalagem e se o "
                    "estoque é controlado em kg ou em unidades"
                )
            if motivos:
                pac.pendencia(
                    arquivo, chave, nome, "CLASSIFICACAO_AMBIGUA",
                    "; ".join(motivos) + f". Tipo e unidade atuais: {tipo} / {registro['UNIDADE']}.",
                    "Confirmar TIPO e UNIDADE (o tipo informado vale, mesmo que a linha fique neste arquivo).",
                    True,
                )

        if c["familia_legado"] and ((mp and not direta) or (not mp and familia_norm not in ("EMBALAGEM", "EMBALAGENS"))):
            pac.legado.append(
                Legado(
                    arquivo, chave, "familia (CMV)", c["familia_legado"], "itens_enriquecimento.csv",
                    "O ERP não tem família equivalente"
                    + (" — o item entra como OUTRA_MATERIA_PRIMA" if mp else " a um material de embalagem")
                    + "; o texto original fica preservado aqui.",
                )
            )
        if pureza_texto:
            pac.legado.append(
                Legado(
                    arquivo, chave, "grau_pureza (CMV)", pureza_texto, "itens_enriquecimento.csv",
                    "Potência/pureza em formato que não cabe no campo de pureza (%) do ERP (ex.: UI/g); "
                    "o ERP não tem campo de potência.",
                )
            )

    for _nome, grupo in por_nome.items():
        if len(grupo) < 2:
            continue
        for registro in grupo:
            outros = " · ".join(
                f"{o['CHAVE_MIGRACAO']} (nutriente: {o['NUTRIENTE_DECLARADO'] or '—'}; "
                f"pureza: {_pct(o['PUREZA_PADRAO'])}; {o['_uso']})"
                for o in grupo if o is not registro
            )
            pac.pendencia(
                registro["_arquivo"], registro["CHAVE_MIGRACAO"], registro["_nome"], "DUPLICIDADE",
                f"Mesmo nome de: {outros}. Este: nutriente {registro['NUTRIENTE_DECLARADO'] or '—'}; "
                f"pureza {_pct(registro['PUREZA_PADRAO'])}; {registro['_uso']}.",
                "Se for o mesmo item: manter um, marcar o outro como NAO_IMPORTAR e anotar a chave mantida. "
                "Se forem itens diferentes (fonte, grau, fornecedor), diferenciar o NOME.",
                False,
            )

    sem_codigo: dict[str, list[dict]] = defaultdict(list)
    for linha in formulas:
        if not linha["cod_item"] and R.limpar(linha["item_mp"]):
            sem_codigo[R.limpar(linha["item_mp"])].append(linha)
    for material, linhas in sorted(sem_codigo.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        produtos = sorted({l["cod_produto"] for l in linhas})
        eh_embalagem = bool(R.PADRAO_EMBALAGEM.search(material) or R.PADRAO_CAPSULA.search(material))
        pac.legado.append(
            Legado(
                EMBALAGENS if eh_embalagem else MATERIAS_PRIMAS,
                "(sem chave — sem código no legado)",
                "item_mp (linha de fórmula sem cod_item)",
                material,
                f"formulacoes.csv — {len(linhas)} linha(s) em {len(produtos)} produto(s) "
                f"(ex.: {', '.join(produtos[:5])}{' …' if len(produtos) > 5 else ''})",
                "Material usado em fórmula sem código de item no legado: não há item para referenciar. Se for "
                "material real ainda sem cadastro, incluir no cadastro pela revisão."
                + (" Classificado aqui só pelo nome." if eh_embalagem else ""),
            )
        )


def _pct(valor) -> str:
    if valor is None or valor == "":
        return "—"
    return f"{R.br(Decimal(valor) * 100, 0, 4)}%"


def _produtos(pac: Pacote, fontes: dict) -> None:
    clientes = {c["_cod"]: c for c in pac.clientes}
    projetos: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    for numero_linha, linha in enumerate(fontes["projetos.csv"], start=2):
        if R.limpar(linha["cod_produto"]):
            projetos[R.limpar(linha["cod_produto"])].append((numero_linha, linha))
    formulas: dict[str, list[dict]] = defaultdict(list)
    for linha in fontes["formulacoes.csv"]:
        if R.limpar(linha["cod_produto"]):
            formulas[R.limpar(linha["cod_produto"])].append(linha)

    por_nome: dict[str, list[dict]] = defaultdict(list)
    for codigo in sorted(formulas):
        linhas_projeto = projetos.get(codigo, [])
        nome = (
            R.limpar(linhas_projeto[0][1]["produto"]) if linhas_projeto else R.limpar(formulas[codigo][0]["produto"])
        )
        clientes_legado = sorted({R.limpar(l["cod_cliente"]) for _, l in linhas_projeto if R.limpar(l["cod_cliente"])})
        chave = R.chave_produto(codigo)
        cliente = clientes.get(clientes_legado[0]) if len(clientes_legado) == 1 else None
        registro = {
            "CHAVE_MIGRACAO": chave,
            "CODIGO_PRODUTO_PREVISTO": GERADO_NA_CARGA,
            "CHAVE_CLIENTE": cliente["CHAVE_MIGRACAO"] if cliente else "",
            "CLIENTE": (cliente["NOME_FANTASIA"] or cliente["RAZAO_SOCIAL_NOME"]) if cliente else "",
            "NOME_PRODUTO": nome,
            "REFERENCIA_EXTERNA": codigo,
            "CHAVE_ITEM_PA": R.chave_item_pa(codigo),
            "CODIGO_PA_PREVISTO": GERADO_NA_CARGA,
            "UNIDADE_ESTOQUE": "un",
            "EXIGE_COA_LAUDO": "NÃO",
            "FORMA_FARMACEUTICA": "",
            "APRESENTACAO": "",
            "CAPSULAS_POR_DOSE": None,
            "DOSE": None,
            "UNIDADE_DOSE": "",
            "DOSES_POR_EMBALAGEM": None,
            "UNIDADES_POR_CAIXA": None,
            "PUBLICO_ALVO": "",
            "VIDA_UTIL_MESES": None,
            "LOTE_MINIMO": None,
            "NOTAS_INTERNAS": "",
            "ATIVO": "SIM",
            "STATUS_REVISAO": "",
            "OBSERVACAO_REVISAO": "",
            "_nome": nome,
            "_cod": codigo,
            "_fonte": (
                f"formulacoes.csv ({len(formulas[codigo])} linha(s)) + projetos.csv linha {linhas_projeto[0][0]}"
                if linhas_projeto else f"formulacoes.csv ({len(formulas[codigo])} linha(s))"
            ),
        }
        pac.produtos.append(registro)
        por_nome[R.normalizar_nome(nome)].append(registro)

        if not nome:
            pac.pendencia(PRODUTOS, chave, codigo, "CAMPO_OBRIGATORIO_AUSENTE", "Nome vazio.", "Informar o nome do produto.", True)
        if len(clientes_legado) > 1:
            pac.pendencia(
                PRODUTOS, chave, nome, "RELACAO_NAO_ENCONTRADA",
                f"Mais de um cliente no legado: {', '.join(clientes_legado)}.",
                "Informar em CHAVE_CLIENTE o cliente dono do produto.", True,
            )
        elif clientes_legado and not cliente:
            pac.pendencia(
                PRODUTOS, chave, nome, "RELACAO_NAO_ENCONTRADA",
                f"Cliente {clientes_legado[0]} do projeto não existe em clientes.csv.",
                "Informar a CHAVE_CLIENTE correta.", True,
            )
        elif not clientes_legado:
            pac.pendencia(
                PRODUTOS, chave, nome, "CAMPO_OBRIGATORIO_AUSENTE", "Produto sem cliente no legado (a tela exige Cliente).",
                "Informar a CHAVE_CLIENTE.", True,
            )
        codificadas = [l for l in formulas[codigo] if R.limpar(l["cod_item"])]
        if not codificadas:
            nomes_materiais = [R.limpar(l["item_mp"]) for l in formulas[codigo] if R.limpar(l["item_mp"])]
            exemplos = (
                "ex.: " + ", ".join(f"\"{n}\"" for n in nomes_materiais[:4])
                if nomes_materiais else "linha(s) sem código e sem nome de material"
            )
            pac.pendencia(
                PRODUTOS, chave, nome, "PRODUTO_SEM_FORMULA_CODIFICADA",
                f"{len(formulas[codigo])} linha(s) de fórmula, nenhuma com código de item ({exemplos}). "
                "O importador atual não criaria este produto.",
                "Confirmar se o produto acabado deve ser cadastrado (a fórmula terá de ser cadastrada no ERP). "
                "Se não, marcar NAO_IMPORTAR.",
                False,
            )

    for _nome, grupo in por_nome.items():
        if len(grupo) > 1:
            for registro in grupo:
                outros = ", ".join(o["CHAVE_MIGRACAO"] for o in grupo if o is not registro)
                pac.pendencia(
                    PRODUTOS, registro["CHAVE_MIGRACAO"], registro["_nome"], "DUPLICIDADE",
                    f"Mesmo nome de: {outros}.",
                    "Confirmar se são o mesmo produto; se for, manter um e marcar o outro como NAO_IMPORTAR.",
                    False,
                )

    for codigo in sorted(set(projetos) - set(formulas)):
        numero_linha, linha = projetos[codigo][0]
        cliente = clientes.get(R.limpar(linha["cod_cliente"]))
        entrada = data_iso(linha["data_entrada"])
        pac.legado.append(
            Legado(
                PRODUTOS,
                R.chave_produto(codigo),
                "cod_produto / produto (projetos.csv)",
                f"{codigo} — {R.limpar(linha['produto'])}"
                + (f" (cliente {cliente['CHAVE_MIGRACAO']} {cliente['_nome']})" if cliente else "")
                + (f"; entrada {entrada:%d/%m/%Y}" if entrada else "")
                + (f"; obs.: {R.limpar(linha['observacao'])}" if R.limpar(linha["observacao"]) else ""),
                f"projetos.csv linha {numero_linha}",
                "Código só existe em projetos.csv, sem nenhuma linha de fórmula: não vira Produto acabado nesta "
                "carga (segue como Projeto comercial, migrado à parte).",
            )
        )

    for linha in fontes["cmv_produtos.csv"]:
        nome = R.limpar(linha["nome_produto"])
        arquivo = R.limpar(linha["arquivo"])
        if R.normalizar_nome(nome) == "NOME DO PRODUTO" or R.normalizar_nome(arquivo).endswith("MODELO"):
            pac.excluidos.append(
                {
                    "fonte": "cmv_produtos.csv",
                    "registro": f"{arquivo} / {nome}",
                    "motivo": "Linha-modelo da planilha de CMV (\"NOME DO PRODUTO\"): não é produto real.",
                }
            )
            continue
        atributos = [
            f"{rotulo}={R.limpar(linha[coluna])}"
            for coluna, rotulo in (
                ("tipo", "tipo"), ("sub_tipo", "subtipo"), ("capsulas_por_dose", "cápsulas/dose"),
                ("faixa_etaria", "faixa etária"), ("lote_minimo", "lote mínimo"), ("dose_qtd", "dose"),
                ("dose_unidade", "unidade da dose"), ("embalagens_por_cx", "embalagens/caixa"),
                ("reserva_overage_pct", "overage"),
            )
            if R.limpar(linha.get(coluna, ""))
        ]
        pac.legado.append(
            Legado(
                PRODUTOS,
                "(sem chave — vínculo só por nome)",
                "atributos do produto (cmv_produtos.csv)",
                f"{nome or '(sem nome)'}: " + "; ".join(atributos),
                f"cmv_produtos.csv — {arquivo}",
                "O arquivo de CMV identifica o produto só pelo nome, sem código, e nenhum nome coincide "
                "exatamente com o cadastro. Se reconhecer o produto, copie os valores para as colunas de "
                "perfil/dose/industrial dele no arquivo 05.",
            )
        )


def _ofertas(pac: Pacote, fontes: dict) -> None:
    fornecedor_por_nome = {R.normalizar_nome(f["NOME_PLANILHA"]): f for f in pac.fornecedores}
    item_por_codigo = {i["_codigo"]: i for i in pac.itens}
    linhas_fonte = fontes["precos_fornecedores.csv"]
    # Como o importador: o par é homologado se QUALQUER linha dele disser SIM.
    pares_homologados = {
        (texto_legado(l["cod_item"]), R.normalizar_nome(l["fornecedor"])) for l in linhas_fonte if afirmativo(l["homologado"])
    }
    for numero_linha, linha in enumerate(linhas_fonte, start=2):
        codigo = texto_legado(linha["cod_item"])
        fornecedor_nome = texto_legado(linha["fornecedor"])
        preco_bruto = texto_legado(linha["preco_brl_kg"])
        pedido_bruto = texto_legado(linha["pedido_minimo"])
        source_key = R.source_key_oferta(codigo, fornecedor_nome, preco_bruto, pedido_bruto)
        chave = R.chave_oferta(source_key)
        fornecedor = fornecedor_por_nome.get(R.normalizar_nome(fornecedor_nome))
        item = item_por_codigo.get(codigo)
        preco = decimal_legado(preco_bruto)
        homologado = (codigo, R.normalizar_nome(fornecedor_nome)) in pares_homologados
        pedido = interpretar_pedido_minimo(pedido_bruto)
        unidade_item = item["UNIDADE"] if item else ""
        registro = {
            "CHAVE_MIGRACAO": chave,
            "CHAVE_ITEM": item["CHAVE_MIGRACAO"] if item else "",
            "ITEM": item["NOME"] if item else R.limpar(linha["materia_prima_fonte"]),
            "CODIGO_ITEM_PREVISTO": GERADO_NA_CARGA,
            "TIPO_ITEM": item["TIPO"] if item else "",
            "UNIDADE_ITEM": unidade_item,
            "CHAVE_FORNECEDOR": fornecedor["CHAVE_MIGRACAO"] if fornecedor else "",
            "FORNECEDOR": fornecedor["NOME_PLANILHA"] if fornecedor else fornecedor_nome,
            "CODIGO_DO_ITEM_NO_FORNECEDOR": "",
            "OBSERVACOES_COMERCIAIS": "",
            "HOMOLOGACAO": "HOMOLOGADO" if homologado else "PENDENTE",
            "OBSERVACAO_DA_DECISAO": "Homologação marcada na planilha (sem data nem responsável)" if homologado else "",
            "PREFERENCIAL": "NÃO",
            "RELACAO_ATIVA": "SIM",
            "PRECO": preco,
            "MOEDA": "BRL",
            "UNIDADE_DO_PRECO": "kg",
            "PEDIDO_MINIMO": pedido[0] if pedido else None,
            # Número sem unidade é lido na unidade do item (regra do importador).
            "UNIDADE_PEDIDO_MINIMO": (pedido[1] or unidade_item) if pedido else "",
            "PEDIDO_MINIMO_PLANILHA": pedido_bruto,
            "VALIDA_A_PARTIR_DE": None,
            "VALIDADE": None,
            # Como o importador: a nota da oferta guarda o nome do material como está no CMV.
            "OBSERVACAO_DA_OFERTA": R.limpar(linha["materia_prima_fonte"]),
            "TIPO_FONTE": "OFERTA_FORNECEDOR_LEGADO",
            "STATUS_REVISAO": "",
            "OBSERVACAO_REVISAO": "",
            "_nome": f"{item['NOME'] if item else codigo} × {fornecedor_nome}",
            "_fonte": f"precos_fornecedores.csv linha {numero_linha}",
            "_source_key": source_key,
            "_codigo_item": codigo,
        }
        pac.ofertas.append(registro)
        nome = registro["_nome"]
        if not fornecedor:
            pac.pendencia(
                OFERTAS, chave, nome, "RELACAO_NAO_ENCONTRADA", f"Fornecedor \"{fornecedor_nome}\" não está em 02.",
                "Informar a CHAVE_FORNECEDOR correta ou marcar NAO_IMPORTAR.", True,
            )
        if not item:
            pac.pendencia(
                OFERTAS, chave, nome, "RELACAO_NAO_ENCONTRADA", f"Item de código {codigo} não está em 03/04.",
                "Informar a CHAVE_ITEM correta ou marcar NAO_IMPORTAR.", True,
            )
        if preco is None:
            pac.pendencia(
                OFERTAS, chave, nome, "PRECO_NAO_ENCONTRADO",
                f"preco_brl_kg vazio ou ilegível na planilha (\"{preco_bruto}\").",
                "Informar o preço, se conhecido. Sem preço, a relação item × fornecedor (e a homologação) "
                "entra sem oferta.",
                False,
            )
        elif preco <= 0:
            pac.pendencia(
                OFERTAS, chave, nome, "PRECO_NAO_ENCONTRADO",
                f"Preço R$ {R.br(preco)} na planilha — provável célula não preenchida.",
                "Informar o preço real ou apagar o valor (a relação item × fornecedor entra sem oferta).", False,
            )
        elif item and R.DIMENSAO.get(unidade_item) != R.DIMENSAO["kg"]:
            pac.pendencia(
                OFERTAS, chave, nome, "UNIDADE_INVALIDA",
                f"Preço R$ {R.br(preco)} está na coluna 'preco_brl_kg' (R$/kg), mas o item é controlado em "
                f"{unidade_item}.",
                "Informar em UNIDADE_DO_PRECO a unidade real do preço (provavelmente 'un') ou marcar "
                "NAO_IMPORTAR. Não há conversão automática de kg para unidade.",
                True,
            )
        if pedido_bruto and pedido is None:
            pac.pendencia(
                OFERTAS, chave, nome, "PEDIDO_MINIMO_AMBIGUO",
                f"Pedido mínimo \"{pedido_bruto}\" não é número + unidade reconhecível.",
                "Informar PEDIDO_MINIMO e UNIDADE_PEDIDO_MINIMO (ex.: 1000 e un) ou deixar vazios.", False,
            )
        elif pedido and item and R.DIMENSAO.get(registro["UNIDADE_PEDIDO_MINIMO"]) != R.DIMENSAO.get(unidade_item):
            pac.pendencia(
                OFERTAS, chave, nome, "UNIDADE_INVALIDA",
                f"Pedido mínimo \"{pedido_bruto}\" em {registro['UNIDADE_PEDIDO_MINIMO']} para item controlado em {unidade_item}.",
                "Conferir o pedido mínimo e a unidade dele; sem unidade compatível ele não entra.", False,
            )
        pac.legado.append(
            Legado(
                OFERTAS, chave, "melhor_preco", texto_legado(linha["melhor_preco"]) or "(vazio)",
                f"precos_fornecedores.csv linha {numero_linha}",
                "Indicador de snapshot do CMV; não é fornecedor preferencial oficial — o importador não o usa.",
            )
        )


def ler_pesquisa_nova(caminho: Path) -> tuple[date | None, list[dict], list[str]]:
    """Lê a pesquisa complementar (FOUND/NOTFOUND separados por '|')."""
    data_consulta: date | None = None
    registros: list[dict] = []
    problemas: list[str] = []
    for numero, bruta in enumerate(caminho.read_text(encoding="utf-8").splitlines(), start=1):
        linha = bruta.strip()
        if not linha:
            continue
        if linha.startswith("#"):
            achado = re.search(r"data_consulta:\s*(\d{4}-\d{2}-\d{2})", linha)
            if achado:
                data_consulta = date.fromisoformat(achado.group(1))
            continue
        campos = [c.strip() for c in linha.split("|")]
        if campos[0] == "NOTFOUND" and len(campos) >= 3:
            registros.append({"tipo": "NOTFOUND", "codigo": campos[1], "motivo": " | ".join(campos[2:])})
        elif campos[0] == "FOUND" and len(campos) >= 11:
            campos += [""] * (12 - len(campos))
            registros.append(
                {
                    "tipo": "FOUND", "codigo": campos[1], "fonte": campos[2], "url": campos[3], "embalagem": campos[4],
                    "quantidade": campos[5], "unidade": campos[6], "preco": campos[7], "equivalencia": campos[8].upper(),
                    "grau": campos[9], "evidencia": campos[10], "observacao": campos[11],
                }
            )
        else:
            problemas.append(f"linha {numero}: formato não reconhecido")
    return data_consulta, registros, problemas


def _precos_mercado(pac: Pacote, fontes: dict, pesquisa_nova: Path | None) -> None:
    item_por_codigo = {i["_codigo"]: i for i in pac.itens}
    ofertas_por_item = Counter(o["_codigo_item"] for o in pac.ofertas)
    achados: dict[str, list[dict]] = defaultdict(list)
    sem_resultado: dict[str, list[str]] = defaultdict(list)
    pesquisados_antes: set[str] = set()
    pesquisados_agora: set[str] = set()
    descartadas: list[str] = []

    mercado = pac.dados / "market-reference" / "market-prices.csv"
    for linha in ler_csv(mercado) if mercado.exists() else []:
        if linha.get("categoria_fonte") != "PESQUISA_MERCADO":
            continue
        codigo = linha.get("external_code", "")
        if codigo not in item_por_codigo:
            descartadas.append(f"market-prices.csv: código de planilha \"{codigo}\" sem item no pacote")
            continue
        pesquisados_antes.add(codigo)
        preco = R.decimal_ou_none(linha.get("preco_brl", ""))
        quantidade = R.decimal_ou_none(linha.get("quantidade", ""))
        # A pesquisa anterior já julgou cada fonte: descartada por não ser o item
        # não volta como referência. Só a exclusão por unidade (dimensão) é um
        # preço válido que apenas não converte para a unidade de estoque.
        aceita = linha.get("incluido", "").strip().upper() == "SIM" or "dimensão incompatível" in linha.get(
            "motivo_exclusao", ""
        )
        if preco is not None and quantidade is not None and linha.get("url") and aceita:
            achados[codigo].append(
                {
                    "rodada": "ANTERIOR", "data": DATA_PESQUISA_ANTERIOR, "fonte": linha["fonte"], "url": linha["url"],
                    "embalagem": linha["embalagem"], "quantidade": quantidade, "unidade_bruta": linha["unidade"],
                    "preco": preco, "equivalencia": "", "grau": R.grau_do_texto(linha["embalagem"]),
                    "evidencia": "", "observacao": linha.get("motivo_exclusao", ""),
                    "canonico_anterior": R.decimal_ou_none(linha.get("preco_por_unidade_canonica", "")),
                    "uom_anterior": linha.get("uom", ""),
                }
            )
        else:
            sem_resultado[codigo].append(linha.get("motivo_exclusao") or "sem evidência encontrada")

    data_nova = None
    if pesquisa_nova and pesquisa_nova.exists():
        data_nova, registros, problemas = ler_pesquisa_nova(pesquisa_nova)
        descartadas += [f"{pesquisa_nova.name}: {p}" for p in problemas]
        if data_nova is None:
            pac.avisos.append(f"{pesquisa_nova.name}: sem cabeçalho '# data_consulta: AAAA-MM-DD' — pesquisa ignorada")
            registros = []
        for r in registros:
            codigo = r["codigo"]
            if codigo not in item_por_codigo:
                descartadas.append(f"{pesquisa_nova.name}: código \"{codigo}\" sem item no pacote")
                continue
            pesquisados_agora.add(codigo)
            if r["tipo"] == "NOTFOUND":
                sem_resultado[codigo].append(r["motivo"])
                continue
            preco = R.decimal_ou_none(r["preco"])
            quantidade = R.decimal_ou_none(r["quantidade"])
            if preco is None or quantidade is None or quantidade <= 0 or preco <= 0 or not r["url"].startswith("http"):
                descartadas.append(f"{pesquisa_nova.name}: achado inválido para \"{codigo}\" (preço/quantidade/URL)")
                continue
            achados[codigo].append(
                {
                    "rodada": "NOVA", "data": data_nova, "fonte": r["fonte"], "url": r["url"], "embalagem": r["embalagem"],
                    "quantidade": quantidade, "unidade_bruta": r["unidade"], "preco": preco,
                    "equivalencia": r["equivalencia"], "grau": r["grau"], "evidencia": r["evidencia"],
                    "observacao": r["observacao"], "canonico_anterior": None, "uom_anterior": "",
                }
            )

    pac.pesquisa = {
        "itens_pesquisa_anterior": len(pesquisados_antes),
        "itens_pesquisa_nova": len(pesquisados_agora),
        "data_pesquisa_nova": data_nova,
        "descartadas": descartadas,
    }

    for item in sorted(pac.itens, key=lambda i: int(i["_codigo"])):
        codigo = item["_codigo"]
        base = {
            "CHAVE_ITEM": item["CHAVE_MIGRACAO"],
            "CODIGO_ITEM_PREVISTO": GERADO_NA_CARGA,
            "ITEM": item["NOME"],
            "TIPO_ITEM": item["TIPO"],
            "UNIDADE_ESTOQUE": item["UNIDADE"],
            "MOEDA": "BRL",
            "TIPO_FONTE": "PRECO_MERCADO_PUBLICO",
            "_nome": item["NOME"],
            "_codigo_item": codigo,
        }
        ofertas_txt = (
            f" O item tem {ofertas_por_item[codigo]} oferta(s) de fornecedor do legado — ver 07."
            if ofertas_por_item.get(codigo) else ""
        )
        if achados.get(codigo):
            for achado in achados[codigo]:
                unidade_ref = R.unidade_do_catalogo(achado["unidade_bruta"])
                normalizado = (
                    R.normalizar_preco(achado["preco"], achado["quantidade"], unidade_ref, item["UNIDADE"])
                    if unidade_ref else None
                )
                if normalizado is not None:
                    memoria = R.memoria_calculo(achado["preco"], achado["quantidade"], unidade_ref, item["UNIDADE"], normalizado)
                    situacao = "ENCONTRADO"
                    anterior = achado["canonico_anterior"]
                    if anterior is not None and achado["uom_anterior"] == item["UNIDADE"]:
                        if abs(anterior - normalizado) > Decimal("0.01"):
                            pac.avisos.append(
                                f"Preço normalizado de {item['CHAVE_MIGRACAO']} difere do dataset anterior "
                                f"({anterior} × {normalizado})"
                            )
                else:
                    memoria = (
                        f"Sem normalização: a fonte vende em \"{achado['unidade_bruta']}\" e o item é controlado em "
                        f"{item['UNIDADE']} (dimensões diferentes ou unidade fora do catálogo)."
                    )
                    situacao = "NAO_NORMALIZAVEL"
                qtd_estoque = (
                    R.quantidade_em_unidade_estoque(achado["quantidade"], unidade_ref, item["UNIDADE"])
                    if unidade_ref else None
                )
                texto = " ".join([achado["embalagem"], achado["fonte"], achado["observacao"]])
                confianca, motivo_conf = R.classificar_confianca(
                    equivalencia=achado["equivalencia"],
                    grau=achado["grau"],
                    quantidade_em_unidade_estoque=qtd_estoque,
                    unidade_estoque=item["UNIDADE"],
                    texto=texto,
                    nome_item=item["NOME"],
                )
                observacao = [f"Apresentação: {achado['embalagem']}." if achado["embalagem"] else ""]
                if achado["grau"] and achado["grau"] != "nao informado":
                    observacao.append(f"Grau: {achado['grau']}.")
                if achado["equivalencia"]:
                    observacao.append(f"Equivalência: {achado['equivalencia']}.")
                observacao.append(f"Confiança: {motivo_conf}.")
                if achado["evidencia"]:
                    observacao.append(f"Evidência na página: \"{achado['evidencia']}\".")
                if achado["observacao"]:
                    observacao.append(achado["observacao"].rstrip(".") + ".")
                if sem_resultado.get(codigo):
                    outras = list(dict.fromkeys(m.strip() for m in sem_resultado[codigo] if m.strip()))
                    observacao.append("Outras fontes tentadas ou descartadas: " + " | ".join(outras) + ".")
                observacao.append(
                    "Pesquisa de 07/09/2026 (reaproveitada)." if achado["rodada"] == "ANTERIOR"
                    else f"Pesquisa complementar de {achado['data']:%d/%m/%Y}."
                )
                chave = R.chave_referencia(
                    codigo, achado["url"], str(achado["preco"]), str(achado["quantidade"]), achado["unidade_bruta"]
                )
                pac.precos.append(
                    {
                        "CHAVE_MIGRACAO": chave,
                        **base,
                        "PRECO_PUBLICADO": achado["preco"],
                        "QUANTIDADE_REFERENCIA": achado["quantidade"],
                        "UNIDADE_REFERENCIA": unidade_ref or achado["unidade_bruta"],
                        "PRECO_NORMALIZADO_POR_UNIDADE_ESTOQUE": normalizado,
                        "MEMORIA_CALCULO": memoria,
                        "FORNECEDOR_OU_SITE": achado["fonte"],
                        "URL_OU_DOCUMENTO": achado["url"],
                        "DATA_DA_PESQUISA": achado["data"],
                        "CONFIANCA": confianca,
                        "SITUACAO_PESQUISA": situacao,
                        "STATUS_REVISAO": "",
                        "OBSERVACAO": " ".join(p for p in observacao if p) + ofertas_txt,
                        "_rodada": achado["rodada"],
                    }
                )
                if situacao == "NAO_NORMALIZAVEL":
                    pac.pendencia(
                        PRECOS, chave, item["NOME"], "UNIDADE_INVALIDA", f"{item['CHAVE_MIGRACAO']}: {memoria}",
                        "Usar o preço publicado só como ordem de grandeza, ou revisar a unidade do item em 03/04.",
                        False,
                    )
            continue

        personalizada = item["TIPO"] == "EMBALAGEM" and R.PADRAO_PERSONALIZADA.search(item["NOME"])
        if sem_resultado.get(codigo):
            motivos = list(dict.fromkeys(m.strip() for m in sem_resultado[codigo] if m.strip()))
            situacao = "SEM_REFERENCIA"
            observacao = "Pesquisado sem correspondência razoável: " + " | ".join(motivos) + "."
            rodada = "NOVA" if codigo in pesquisados_agora else "ANTERIOR"
            data_ref = data_nova if rodada == "NOVA" else DATA_PESQUISA_ANTERIOR
        elif personalizada:
            situacao = "SEM_REFERENCIA"
            observacao = (
                "Embalagem personalizada/impressa: sem preço de mercado genérico (custo depende de arte, tiragem "
                "e contrato gráfico) — não pesquisada, mesma regra da pesquisa de 07/09/2026."
            )
            rodada, data_ref = "POLITICA", None
        else:
            situacao = "PESQUISA_PENDENTE"
            observacao = "Item ainda sem pesquisa pública de preço."
            rodada, data_ref = "PENDENTE", None
        chave = R.chave_referencia(codigo, situacao)
        pac.precos.append(
            {
                "CHAVE_MIGRACAO": chave,
                **base,
                "PRECO_PUBLICADO": None,
                "QUANTIDADE_REFERENCIA": None,
                "UNIDADE_REFERENCIA": "",
                "PRECO_NORMALIZADO_POR_UNIDADE_ESTOQUE": None,
                "MEMORIA_CALCULO": "",
                "FORNECEDOR_OU_SITE": "",
                "URL_OU_DOCUMENTO": "",
                "DATA_DA_PESQUISA": data_ref,
                "CONFIANCA": "",
                "SITUACAO_PESQUISA": situacao,
                "STATUS_REVISAO": "",
                "OBSERVACAO": observacao + ofertas_txt,
                "_rodada": rodada,
            }
        )
        pac.pendencia(
            PRECOS, chave, item["NOME"], "PRECO_NAO_ENCONTRADO",
            f"{item['CHAVE_MIGRACAO']}: {situacao}. {observacao}",
            "Nenhuma ação obrigatória para a carga de cadastro. Se houver cotação ou compra recente, ela entra "
            "como oferta de fornecedor (07) ou recebimento no ERP — não como referência de mercado.",
            False,
        )


def _custos_de_referencia(pac: Pacote) -> None:
    """Custo de referência (referência manual) de cada item, a partir de 07 e 06.

    Mesma prioridade da carga de referência de 07/09/2026: oferta de fornecedor
    do legado primeiro; sem oferta utilizável, preço público de mercado; sem
    nenhum dos dois, vazio. Valor = mediana, na unidade do item. Todos os
    preços do item ficam listados na própria linha, para conferência.
    """
    ofertas: dict[str, list[dict]] = defaultdict(list)
    for o in pac.ofertas:
        ofertas[o["_codigo_item"]].append(o)
    mercado: dict[str, list[dict]] = defaultdict(list)
    for p in pac.precos:
        if p["PRECO_PUBLICADO"] is not None:
            mercado[p["_codigo_item"]].append(p)

    for item in pac.itens:
        codigo, unidade = item["_codigo"], item["UNIDADE"]
        convertidos: list[Decimal] = []
        textos_ofertas = []
        for o in sorted(ofertas.get(codigo, []), key=lambda x: (x["FORNECEDOR"], x["PRECO"] if x["PRECO"] is not None else -1)):
            convertido = (
                R.normalizar_preco(o["PRECO"], Decimal(1), o["UNIDADE_DO_PRECO"], unidade)
                if o["PRECO"] is not None and o["PRECO"] > 0 else None
            )
            if convertido is not None:
                convertidos.append(convertido)
            texto = f"{o['FORNECEDOR']}: " + (
                f"R$ {R.br(o['PRECO'])}/{o['UNIDADE_DO_PRECO']}" if o["PRECO"] is not None else "sem preço"
            )
            if o["PEDIDO_MINIMO_PLANILHA"]:
                texto += f" · pedido mín. {o['PEDIDO_MINIMO_PLANILHA']}"
            if o["HOMOLOGACAO"] == "HOMOLOGADO":
                texto += " · homologado"
            if o["PRECO"] is not None and o["PRECO"] > 0 and convertido is None:
                texto += " · unidade do preço a confirmar"
            textos_ofertas.append(texto)
        item["FORNECEDORES_E_PRECOS_LEGADO"] = " | ".join(textos_ofertas)

        textos_mercado = []
        normalizados: list[Decimal] = []
        for p in mercado.get(codigo, []):
            if p["PRECO_NORMALIZADO_POR_UNIDADE_ESTOQUE"] is not None:
                normalizados.append(p["PRECO_NORMALIZADO_POR_UNIDADE_ESTOQUE"])
                textos_mercado.append(
                    f"{p['FORNECEDOR_OU_SITE']}: R$ {R.br(p['PRECO_NORMALIZADO_POR_UNIDADE_ESTOQUE'])}/{unidade} "
                    f"(embalagem {R.br(p['QUANTIDADE_REFERENCIA'], 0)} {p['UNIDADE_REFERENCIA']}; confiança {p['CONFIANCA']})"
                )
            else:
                textos_mercado.append(
                    f"{p['FORNECEDOR_OU_SITE']}: R$ {R.br(p['PRECO_PUBLICADO'])} por {R.br(p['QUANTIDADE_REFERENCIA'], 0)} "
                    f"{p['UNIDADE_REFERENCIA']} (sem conversão para {unidade})"
                )
        item["PRECOS_DE_MERCADO"] = " | ".join(textos_mercado)

        if convertidos:
            valor = R.mediana(convertidos)
            item["ORIGEM_CUSTO_REFERENCIA"] = "OFERTA_FORNECEDOR_LEGADO"
            item["OBSERVACAO_REFERENCIA"] = (
                f"Mediana de {len(convertidos)} oferta(s) de fornecedor do legado (arquivo 07): "
                + " · ".join(f"R$ {R.br(v)}" for v in sorted(convertidos))
                + f" por {unidade}. Estimativa para revisão — não é custo real de compra."
            )
        elif normalizados:
            valor = R.mediana(normalizados)
            item["ORIGEM_CUSTO_REFERENCIA"] = "PRECO_MERCADO_PUBLICO"
            item["OBSERVACAO_REFERENCIA"] = (
                f"Mediana de {len(normalizados)} preço(s) público(s) de mercado (arquivo 06): "
                + " · ".join(f"R$ {R.br(v)}" for v in sorted(normalizados))
                + f" por {unidade}. Referência de mercado — não é custo real de compra."
            )
        else:
            valor = None
            item["ORIGEM_CUSTO_REFERENCIA"] = "SEM_REFERENCIA"
            item["OBSERVACAO_REFERENCIA"] = ""
        item["CUSTO_REFERENCIA"] = valor


def _varredura_sintetica(pac: Pacote) -> None:
    """Texto com sinal de teste/exemplo: certo ⇒ sai; duvidoso ⇒ pendência para validar."""
    grupos = [
        (CLIENTES, pac.clientes), (FORNECEDORES, pac.fornecedores), (PRODUTOS, pac.produtos),
        (OFERTAS, pac.ofertas), (PRECOS, pac.precos),
    ]
    grupos += [(i["_arquivo"], [i]) for i in pac.itens]
    remover: set[int] = set()
    for arquivo, registros in grupos:
        for registro in registros:
            campos = {k: v for k, v in registro.items() if not k.startswith("_") and isinstance(v, str)}
            campos.pop("URL_OU_DOCUMENTO", None)
            texto = " ".join(campos.values())
            if R.PADRAO_SINTETICO_CERTO.search(texto):
                remover.add(id(registro))
                pac.excluidos.append(
                    {"fonte": registro.get("_fonte", arquivo), "registro": registro.get("_nome", ""),
                     "motivo": "Conteúdo reconhecidamente sintético (exemplo/teste)."}
                )
                continue
            marcador = R.marcador_sintetico(texto)
            if marcador:
                pac.pendencia(
                    arquivo, registro["CHAVE_MIGRACAO"], registro.get("_nome", ""), "POSSIVEL_DADO_SINTETICO",
                    f"Possível dado sintético — validar (termo \"{marcador}\").",
                    "Confirmar se o registro é real ou marcar NAO_IMPORTAR.", True,
                )
    if remover:
        pac.clientes = [r for r in pac.clientes if id(r) not in remover]
        pac.fornecedores = [r for r in pac.fornecedores if id(r) not in remover]
        pac.produtos = [r for r in pac.produtos if id(r) not in remover]
        pac.ofertas = [r for r in pac.ofertas if id(r) not in remover]
        pac.precos = [r for r in pac.precos if id(r) not in remover]
        pac.itens = [r for r in pac.itens if id(r) not in remover]


def _status(pac: Pacote) -> None:
    """Todo registro nasce REVISAR: nada é aprovado pela geração — só pela Veridi."""
    for registros in (pac.clientes, pac.fornecedores, pac.itens, pac.produtos, pac.ofertas, pac.precos):
        for registro in registros:
            registro["STATUS_REVISAO"] = STATUS_INICIAL
