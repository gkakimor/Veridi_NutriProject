"""
Regras puras do pacote de revisão da migração — sem leitura de arquivo e sem Excel.

Tudo aqui é determinístico: a mesma fonte gera as mesmas chaves, as mesmas
pendências e os mesmos números. Onde a regra espelha o importador oficial
(`scripts/veridi-data/*.ts`), o nome da função de lá está citado, para que as
duas implementações possam ser conferidas lado a lado.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from itertools import combinations

# ─────────────────────────── texto ───────────────────────────

# Marcadores que a planilha usa para "não se aplica / não informado". Não são
# dado: viram campo vazio (nunca "S/N", nunca "desconhecido").
MARCADORES_VAZIOS = {"", "-", "--", "*", "**", "***", "N/A", "NA", "#N/A", "0"}


def limpar(valor: object, *, zero_e_vazio: bool = False) -> str:
    """Espaços colapsados; marcador de vazio vira "". `0` só some quando pedido."""
    if valor is None:
        return ""
    texto = re.sub(r"\s+", " ", str(valor)).strip()
    marcadores = MARCADORES_VAZIOS if zero_e_vazio else MARCADORES_VAZIOS - {"0"}
    return "" if texto.upper() in marcadores else texto


def normalizar_nome(valor: str) -> str:
    """Espelha `normalizeSupplierName`: sem acento, maiúsculo, só A-Z0-9 e espaço."""
    texto = unicodedata.normalize("NFD", valor or "")
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9]+", " ", texto.upper()).strip()


def slug(valor: str) -> str:
    return normalizar_nome(valor).replace(" ", "-")


# ─────────────────────────── chaves ───────────────────────────
# CHAVE_MIGRACAO: derivada só do código/nome legado. Nunca UUID, nunca código
# interno do ERP (`MP-000372` sai de sequence e muda de banco para banco).


def chave_cliente(cod_planilha: str) -> str:
    return f"CLI-LEG-{int(cod_planilha):04d}"


def chave_fornecedor(nome_planilha: str) -> str:
    return f"FOR-LEG-{slug(nome_planilha)}"


def chave_item(cod_planilha: str) -> str:
    return f"ITEM-LEG-{int(cod_planilha):04d}"


def chave_produto(cod_produto: str) -> str:
    return f"PROD-LEG-{slug(cod_produto)}"


def chave_item_pa(cod_produto: str) -> str:
    return f"PA-LEG-{slug(cod_produto)}"


def source_key_oferta(cod_item: str, fornecedor: str, preco_bruto: str, pedido_minimo_bruto: str) -> str:
    """Espelha `legacyOfferSourceKey`: a mesma chave de idempotência do importador."""
    payload = "|".join(
        ["precos_fornecedores", cod_item, normalizar_nome(fornecedor), preco_bruto, pedido_minimo_bruto]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def chave_oferta(source_key: str) -> str:
    return f"OFE-LEG-{source_key[:12].upper()}"


def chave_referencia(*partes: str) -> str:
    return "REF-" + hashlib.sha256("|".join(partes).encode("utf-8")).hexdigest()[:12].upper()


PADRAO_CHAVE = re.compile(
    r"^(CLI-LEG-\d{4}|FOR-LEG-[A-Z0-9-]+|ITEM-LEG-\d{4}|PROD-LEG-[A-Z0-9-]+|PA-LEG-[A-Z0-9-]+"
    r"|OFE-LEG-[0-9A-F]{12}|REF-[0-9A-F]{12})$"
)
PADRAO_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


# ─────────────────────────── documento ───────────────────────────


def so_digitos(valor: str) -> str:
    return re.sub(r"\D", "", valor or "")


def cnpj_valido(cnpj: str) -> bool:
    """Espelha `isValidCnpj`: dígitos verificadores; nunca "corrige" o valor."""
    if len(cnpj) != 14 or len(set(cnpj)) == 1 or not cnpj.isdigit():
        return False

    def digito(parte: str, pesos: list[int]) -> int:
        resto = sum(int(c) * p for c, p in zip(parte, pesos)) % 11
        return 0 if resto < 2 else 11 - resto

    primeiro = digito(cnpj[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    segundo = digito(cnpj[:13], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return int(cnpj[12]) == primeiro and int(cnpj[13]) == segundo


def formatar_cnpj(digitos: str) -> str:
    if len(digitos) != 14:
        return digitos
    return f"{digitos[:2]}.{digitos[2:5]}.{digitos[5:8]}/{digitos[8:12]}-{digitos[12:]}"


UFS = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
    "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]


# ─────────────────────────── endereço ───────────────────────────
# Porta fiel de `scripts/veridi-data/legacy-address.ts`: só o que o corpus usa,
# e o que não dá para afirmar fica vazio.

_TIPOS_LOGRADOURO = re.compile(
    r"^(rua|r\.|av\.?|avenida|travessa|tv\.?|alameda|al\.?|rodovia|rod\.?|estrada|est\.?|praça|praca|largo|via)\b",
    re.I,
)
_NUMERO_ROTULADO = re.compile(r"\b(?:n[º°o]?\.?|num\.?|n[uú]mero)\s*[:.]?\s*([0-9]+[a-zA-Z]?)\b", re.I)
_BAIRRO_ROTULADO = re.compile(r"\bbairro\s*[:.]?\s*(.+)$", re.I)
_BAIRRO_ABREVIADO = re.compile(r"\bb\.\s*(.+)$", re.I)
_CEP_ROTULADO = re.compile(r"CEP\W{0,3}(\d[\d.\-\s]{6,11}\d)", re.I)
_CEP_NO_FIM = re.compile(r"[\s,;\-]*CEP\W{0,3}\d[\d.\-\s]{6,11}\d\W*$", re.I)


def _limpar_parte(valor: str | None) -> str | None:
    if not valor:
        return None
    texto = re.sub(r"\s+", " ", valor).strip()
    texto = re.sub(r"^[,;.:\-]+", "", texto)
    texto = re.sub(r"[,;.:\-]+$", "", texto).strip()
    return texto or None


def interpretar_endereco(bruto: str) -> dict:
    """Devolve logradouro/número/bairro e o motivo da revisão (como o importador)."""
    vazio = {"logradouro": "", "numero": "", "bairro": "", "revisar": False, "motivo": ""}
    texto = _limpar_parte(bruto)
    if not texto:
        return vazio
    partes = [p for p in (_limpar_parte(parte) for parte in texto.split(",")) if p]
    if not partes:
        return {**vazio, "revisar": True, "motivo": "endereço vazio depois da limpeza"}

    primeira = partes[0]
    logradouro = primeira if _TIPOS_LOGRADOURO.search(primeira) else None

    rotulado = _NUMERO_ROTULADO.search(texto)
    if rotulado:
        numero = rotulado.group(1)
    else:
        numero = next((p for p in partes[1:] if re.fullmatch(r"[0-9]+[a-zA-Z]?", p)), None)

    bairro = None
    for parte in partes:
        achado = _BAIRRO_ROTULADO.search(parte) or _BAIRRO_ABREVIADO.search(parte)
        if achado:
            bairro = _limpar_parte(achado.group(1))
            break

    faltando = [nome for nome, v in (("logradouro", logradouro), ("número", numero), ("bairro", bairro)) if not v]
    return {
        "logradouro": logradouro or "",
        "numero": numero or "",
        "bairro": bairro or "",
        "revisar": bool(faltando),
        "motivo": f"não foi possível identificar: {', '.join(faltando)}" if faltando else "",
    }


def extrair_cep(bruto: str) -> str:
    """CEP só quando vem ROTULADO ("CEP: 18.285-000"); formato 00000-000."""
    achado = _CEP_ROTULADO.search(bruto or "")
    if not achado:
        return ""
    digitos = so_digitos(achado.group(1))
    return f"{digitos[:5]}-{digitos[5:]}" if len(digitos) == 8 else ""


def sem_cep_no_fim(valor: str) -> str:
    """Tira um "-CEP: 86.041-310" colado no fim do bairro (o parser legado o mantém)."""
    return _CEP_NO_FIM.sub("", valor or "").strip(" ,;-") if valor else valor


# ─────────────────────────── item ───────────────────────────

FAMILIA_LEGADO_PARA_PACOTE = {
    "VITAMINA": "VITAMINA",
    "VITAMINAS": "VITAMINA",
    "MINERAL": "MINERAL",
    "MINERAIS": "MINERAL",
    "AMINOACIDO": "AMINOACIDO",
    "AMINOACIDOS": "AMINOACIDO",
    "EXCIPIENTE": "EXCIPIENTE",
    "EXCIPIENTES": "EXCIPIENTE",
    "BOTANICO": "BOTANICO",
    "BOTANICOS": "BOTANICO",
    "EMBALAGEM": "EMBALAGEM",
    "EMBALAGENS": "EMBALAGEM",
}

FAMILIA_PACOTE_PARA_ERP = {
    "VITAMINA": "VITAMIN",
    "MINERAL": "MINERAL",
    "AMINOACIDO": "AMINO_ACID",
    "EXCIPIENTE": "EXCIPIENT",
    "BOTANICO": "BOTANICAL",
    "OUTRA_MATERIA_PRIMA": "OTHER_RAW_MATERIAL",
    "EMBALAGEM": "PACKAGING",
    "OUTRO": "OTHER",
}

TIPO_PACOTE_PARA_ERP = {"MATERIA_PRIMA": "RAW_MATERIAL", "EMBALAGEM": "PACKAGING"}


def familia_do_pacote(familia_legado: str) -> tuple[str, bool]:
    """(valor da lista FAMILIA, equivalência direta?). Sem equivalência ⇒ OUTRA_MATERIA_PRIMA."""
    chave = normalizar_nome(familia_legado)
    if not chave:
        return "", True
    if chave in FAMILIA_LEGADO_PARA_PACOTE:
        return FAMILIA_LEGADO_PARA_PACOTE[chave], True
    return "OUTRA_MATERIA_PRIMA", False


def pureza_fracao(bruto: str) -> tuple[Decimal | None, str]:
    """(pureza 0–1, texto legado que não cabe no campo de pureza %)."""
    texto = limpar(bruto)
    if not texto:
        return None, ""
    try:
        valor = Decimal(texto)
    except InvalidOperation:
        return None, texto
    if Decimal(0) < valor <= Decimal(1):
        return valor, ""
    return None, texto


PADRAO_EMBALAGEM = re.compile(
    r"\b(pote|potes|tampa|tampas|r[oó]tulo|rot|caixa|caixas|sach[eê]|sachets?|medidor|dosador|dosadora|colher|"
    r"lacre|etiqueta|frasco|blister|saco|sacos|filme|selo|embalagem|pouch|lata|garrafa|monodose|fita)\b",
    re.I,
)
PADRAO_CAPSULA = re.compile(r"\b(caps|c[aá]psulas?|softgel)\b", re.I)
PADRAO_PERSONALIZADA = re.compile(r"(^ROT\b|R[OÓ]TULO|(?<!SEM )ETIQUETA|COM ARTE|PERSONALIZ)", re.I)


# ─────────────────────────── semelhança de nomes ───────────────────────────

PALAVRAS_GENERICAS = {
    "PHARMA", "FARMA", "EMBALAGENS", "EMBALAGEM", "INGREDIENTES", "NUTRIENTES", "INSUMOS",
    "TECNOLOGIA", "ONLINE", "NUTRITION", "PHARMACEUTIC", "PHARMACEUTICA", "FARMOQUIMICOS",
    "DESSECANTES", "EMPREENDIMENTOS", "COMUNICACAO", "MERCADO", "ESTRELAS", "MUNDIAL", "QUATRO",
    "AMOSTRA", "GRATIS", "BRASIL", "LABS", "LTDA",
}


def levenshtein(a: str, b: str) -> int:
    anterior = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        atual = [i]
        for j, cb in enumerate(b, 1):
            atual.append(min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (ca != cb)))
        anterior = atual
    return anterior[-1]


def _base_sem_anotacao(nome: str) -> str:
    return normalizar_nome(re.sub(r"\(.*?\)", " ", nome))


def _tokens_prefixos(curto: str, longo: str) -> bool:
    tokens_longo = longo.split()
    return all(any(t.startswith(p) for t in tokens_longo) for p in curto.split())


def motivo_semelhanca(a: str, b: str) -> str:
    """Motivo objetivo para suspeitar que dois nomes de fornecedor são o mesmo."""
    base_a, base_b = _base_sem_anotacao(a), _base_sem_anotacao(b)
    comp_a, comp_b = base_a.replace(" ", ""), base_b.replace(" ", "")
    if min(len(comp_a), len(comp_b)) <= 3:
        return ""
    if base_a == base_b:
        return "mesmo nome sem a anotação entre parênteses"
    if comp_a == comp_b:
        return "mesmo nome sem espaços"
    if _tokens_prefixos(base_a, base_b) or _tokens_prefixos(base_b, base_a):
        return "um nome contém o outro"
    if len(comp_a) >= 5 and len(comp_b) >= 5 and levenshtein(comp_a, comp_b) <= 2:
        return "grafia quase igual"
    comuns = {t for t in set(base_a.split()) & set(base_b.split()) if len(t) >= 6 and t not in PALAVRAS_GENERICAS}
    if comuns:
        return f"compartilham a palavra {sorted(comuns)[0]}"
    return ""


def grupos_semelhantes(nomes: list[str]) -> dict[str, list[tuple[str, str]]]:
    """nome → [(outro nome, motivo)] para cada par suspeito (sem fundir nada)."""
    pares: dict[str, list[tuple[str, str]]] = {}
    for a, b in combinations(nomes, 2):
        motivo = motivo_semelhanca(a, b)
        if motivo:
            pares.setdefault(a, []).append((b, motivo))
            pares.setdefault(b, []).append((a, motivo))
    return pares


def candidatos_abreviacao(curto: str, nomes: list[str]) -> list[str]:
    """Para nome de 1–3 letras: quais nomes começam por ele (possível abreviação)."""
    base = normalizar_nome(curto)
    if not base:
        return []
    return [n for n in nomes if n != curto and any(t.startswith(base) for t in normalizar_nome(n).split())]


# ─────────────────────────── preço ───────────────────────────

FATOR_PARA_BASE = {
    "kg": Decimal(1000), "g": Decimal(1), "mg": Decimal("0.001"),
    "un": Decimal(1),
    "L": Decimal(1), "mL": Decimal("0.001"),
}
DIMENSAO = {"kg": "MASSA", "g": "MASSA", "mg": "MASSA", "un": "CONTAGEM", "L": "VOLUME", "mL": "VOLUME"}
UNIDADES = ["mg", "g", "kg", "un", "mL", "L"]

_SINONIMOS_UNIDADE = {
    "KG": "kg", "KILO": "kg", "KILOS": "kg", "QUILO": "kg", "QUILOS": "kg",
    "G": "g", "GR": "g", "GRAMA": "g", "GRAMAS": "g",
    "MG": "mg",
    "UN": "un", "UND": "un", "UNID": "un", "UNIDADE": "un", "UNIDADES": "un", "U": "un", "PC": "un", "PCS": "un",
    "L": "L", "LT": "L", "LITRO": "L", "LITROS": "L",
    "ML": "mL",
}


def unidade_do_catalogo(bruto: str) -> str:
    return _SINONIMOS_UNIDADE.get(normalizar_nome(bruto).replace(" ", ""), "")


def decimal_ou_none(bruto: str) -> Decimal | None:
    texto = (bruto or "").strip().replace(" ", "")
    if not texto:
        return None
    if "," in texto and "." in texto:
        texto = texto.replace(".", "").replace(",", ".")
    elif "," in texto:
        texto = texto.replace(",", ".")
    try:
        valor = Decimal(texto)
    except InvalidOperation:
        return None
    return valor if valor.is_finite() else None


SEIS_CASAS = Decimal("0.000001")


def normalizar_preco(preco: Decimal, quantidade: Decimal, unidade_ref: str, unidade_estoque: str) -> Decimal | None:
    """R$ por unidade de estoque. Sem conversão entre dimensões diferentes."""
    if preco is None or quantidade is None or quantidade <= 0 or preco <= 0:
        return None
    if unidade_ref not in FATOR_PARA_BASE or unidade_estoque not in FATOR_PARA_BASE:
        return None
    if DIMENSAO[unidade_ref] != DIMENSAO[unidade_estoque]:
        return None
    valor = preco / quantidade * (FATOR_PARA_BASE[unidade_estoque] / FATOR_PARA_BASE[unidade_ref])
    return valor.quantize(SEIS_CASAS, rounding=ROUND_HALF_UP)


def br(valor: Decimal, casas_min: int = 2, casas_max: int = 6) -> str:
    """Número no formato brasileiro (1.234,56), com casas extras só se existirem."""
    q = valor.quantize(Decimal(1).scaleb(-casas_max), rounding=ROUND_HALF_UP)
    inteiro, _, frac = f"{q:f}".partition(".")
    frac = frac.rstrip("0")
    if len(frac) < casas_min:
        frac = frac.ljust(casas_min, "0")
    sinal = "-" if inteiro.startswith("-") else ""
    inteiro = inteiro.lstrip("-")
    grupos = []
    while len(inteiro) > 3:
        grupos.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    grupos.insert(0, inteiro)
    numero = ".".join(grupos)
    return f"{sinal}{numero},{frac}" if frac else f"{sinal}{numero}"


def memoria_calculo(preco: Decimal, quantidade: Decimal, unidade_ref: str, unidade_estoque: str, resultado: Decimal) -> str:
    base = f"R$ {br(preco)} ÷ {br(quantidade, 0)} {unidade_ref}"
    if unidade_ref != unidade_estoque:
        fator = FATOR_PARA_BASE[unidade_estoque] / FATOR_PARA_BASE[unidade_ref]
        base += f" × {br(fator, 0)} {unidade_ref}/{unidade_estoque}"
    return f"{base} = R$ {br(resultado)}/{unidade_estoque}"


# Confiança da referência de mercado (ALTA / MEDIA / BAIXA), pela evidência.
_GRAU_DIFERENTE = re.compile(r"\bP\.?\s?A\.?\b|reagente|\bA\.?C\.?S\.?\b|anal[ií]tic|t[eé]cnic|cosm[eé]tic", re.I)
_GRAU_PADRAO = {"PA": "PA", "TECNICO": "tecnico", "COSMETICO": "cosmetico"}
_APROXIMACAO = re.compile(r"similar|equivalente|aproximad|outra forma|forma diferente", re.I)
_INDISPONIVEL = re.compile(r"esgotad|indispon[ií]vel", re.I)


def grau_do_texto(texto: str) -> str:
    achado = _GRAU_DIFERENTE.search(texto or "")
    if not achado:
        return "nao informado"
    trecho = normalizar_nome(achado.group(0)).replace(" ", "")
    if trecho in ("PA", "ACS") or "REAGENTE" in trecho or "ANALITIC" in trecho:
        return "PA"
    if trecho.startswith("TECNIC"):
        return "tecnico"
    return "cosmetico"


NOMES_GENERICOS = {
    "VITAMINA", "VITAMINAS", "MINERAL", "MINERAIS", "VERMELHO", "AMARELO", "AZUL", "VERDE", "PRETO", "BRANCO",
    "CORANTE", "AROMA", "EXTRATO", "PROTEINA", "FIBRA", "EMBALAGEM", "INSUMO", "MATERIA PRIMA", "MIX",
    # Só o elemento/nutriente, sem a forma química: qual sal é, não se sabe.
    "CALCIO", "MAGNESIO", "ZINCO", "FERRO", "SELENIO", "CROMO", "COBRE", "IODO", "POTASSIO", "SODIO",
    "FOSFORO", "MANGANES", "MOLIBDENIO", "COLINA",
}


def nome_generico(nome_item: str) -> bool:
    """Nome de item que é só uma categoria (ex.: "VITAMINA", "VERMELHO"): equivalência não verificável."""
    return normalizar_nome(nome_item) in NOMES_GENERICOS


def classificar_confianca(
    *,
    equivalencia: str,
    grau: str,
    quantidade_em_unidade_estoque: Decimal | None,
    unidade_estoque: str,
    texto: str,
    nome_item: str,
) -> tuple[str, str]:
    """(ALTA|MEDIA|BAIXA, motivo curto)."""
    equivalencia = (equivalencia or "IGUAL").upper()
    if equivalencia == "APROXIMADA" or _APROXIMACAO.search(texto or ""):
        return "BAIXA", "produto aproximado (não é exatamente o item)"
    if nome_generico(nome_item):
        return "BAIXA", "nome do item genérico — equivalência não verificável"
    if equivalencia == "COMPARAVEL":
        return "MEDIA", "produto comparável (grau, marca ou apresentação diferente)"
    grau_norm = normalizar_nome(grau).replace(" ", "")
    if grau_norm in _GRAU_PADRAO or _GRAU_DIFERENTE.search(texto or ""):
        return "MEDIA", "grau declarado diferente de alimentício/farmacêutico"
    if _INDISPONIVEL.search(texto or ""):
        return "MEDIA", "produto indisponível na data da consulta"
    minimo = Decimal(1) if unidade_estoque in ("kg", "L") else Decimal(1000) if unidade_estoque in ("g", "mL") else Decimal(100)
    if quantidade_em_unidade_estoque is not None and quantidade_em_unidade_estoque < minimo:
        return "MEDIA", "apresentação fracionada (menor que a de compra industrial)"
    return "ALTA", "preço público direto de item equivalente"


def quantidade_em_unidade_estoque(quantidade: Decimal, unidade_ref: str, unidade_estoque: str) -> Decimal | None:
    if unidade_ref not in FATOR_PARA_BASE or unidade_estoque not in FATOR_PARA_BASE:
        return None
    if DIMENSAO[unidade_ref] != DIMENSAO[unidade_estoque]:
        return None
    return quantidade * FATOR_PARA_BASE[unidade_ref] / FATOR_PARA_BASE[unidade_estoque]


# ─────────────────────────── conteúdo sintético ───────────────────────────

PADRAO_SINTETICO = re.compile(
    r"\b(testes?|tests?|example|exemplos?|demo|mock|fixtures?|golden\s*path|localhost|veridi\.local|e2e|dummy|fake|lorem)\b",
    re.I,
)
PADRAO_SINTETICO_CERTO = re.compile(r"^EXEMPLO\s*[—-]|veridi\.local|localhost|golden\s*path|\be2e\b", re.I)


def marcador_sintetico(texto: str) -> str:
    achado = PADRAO_SINTETICO.search(texto or "")
    return achado.group(0) if achado else ""
