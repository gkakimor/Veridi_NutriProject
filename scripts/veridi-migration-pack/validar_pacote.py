#!/usr/bin/env python3
"""
Valida o pacote de revisão da migração — o gerado agora ou o devolvido pela Veridi.

    python scripts/veridi-migration-pack/validar_pacote.py <pasta> [--devolucao] [--relatorio arquivo.txt]

ERRO reprova (exit 1); AVISO só informa. Com --devolucao, as regras que dependem
da decisão da Veridi (STATUS × pendência, preço normalizado recalculado) viram AVISO.
Só lê os .xlsx: não conecta em banco nenhum.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

from openpyxl import load_workbook  # noqa: E402
from openpyxl.utils import get_column_letter  # noqa: E402

import fontes as F  # noqa: E402
import layout as L  # noqa: E402
import regras as R  # noqa: E402
from planilha import LINHA_CABECALHO, PRIMEIRA_LINHA  # noqa: E402

ABAS = ["DADOS", "DICIONARIO", "VALORES_PERMITIDOS", "PENDENCIAS", "ORIGEM"]
COM_LEGADO = {F.MATERIAS_PRIMAS, F.EMBALAGENS, F.PRODUTOS, F.OFERTAS}
ERRO_EXCEL = re.compile(r"^#(REF!|N/A|VALUE!|DIV/0!|NAME\?|NUM!|NULL!)")
PROIBIDO_06 = re.compile(r"CUSTO_REAL|LAST_REAL|RECEBIMENTO|ACTUAL_UNIT_COST|CUSTO_AQUISICAO", re.I)
PROBLEMAS = {codigo for codigo, *_ in L.PROBLEMAS}


class Relatorio:
    def __init__(self) -> None:
        self.erros: list[str] = []
        self.avisos: list[str] = []

    def erro(self, arquivo: str, mensagem: str) -> None:
        self.erros.append(f"[{arquivo}] {mensagem}")

    def aviso(self, arquivo: str, mensagem: str) -> None:
        self.avisos.append(f"[{arquivo}] {mensagem}")


def ler(ws) -> tuple[list[str], list[dict]]:
    cabecalho = [str(c.value).removesuffix(" *") if c.value is not None else "" for c in ws[LINHA_CABECALHO]]
    linhas = []
    for numero, valores in enumerate(ws.iter_rows(min_row=PRIMEIRA_LINHA, values_only=True), start=PRIMEIRA_LINHA):
        preenchidos = [v for v in valores if v not in (None, "")]
        if not preenchidos:
            continue
        if len(preenchidos) == 1 and isinstance(valores[0], str) and valores[0].startswith("Nenhum"):
            continue
        linha = dict(zip(cabecalho, valores))
        linha["_linha"] = numero
        linhas.append(linha)
    return cabecalho, linhas


def decimal(valor) -> Decimal | None:
    try:
        return Decimal(str(valor)) if valor not in (None, "") else None
    except InvalidOperation:
        return None


def validar_arquivo(pasta: Path, arquivo: str, rel: Relatorio, devolucao: bool) -> dict | None:
    caminho = pasta / f"{arquivo}.xlsx"
    if not caminho.exists():
        rel.erro(arquivo, "arquivo ausente")
        return None
    try:
        wb = load_workbook(caminho)
    except Exception as falha:  # noqa: BLE001 — qualquer falha de abertura reprova
        rel.erro(arquivo, f"não abre: {falha}")
        return None

    for aba in ABAS:
        if aba not in wb.sheetnames:
            rel.erro(arquivo, f"aba {aba} ausente")
    if arquivo in COM_LEGADO and "LEGADO_NAO_IMPORTADO" not in wb.sheetnames:
        rel.erro(arquivo, "aba LEGADO_NAO_IMPORTADO ausente")
    if wb.sheetnames[0] != "DADOS":
        rel.aviso(arquivo, "a primeira aba não é DADOS")
    if any(a not in wb.sheetnames for a in ABAS):
        return None

    for ws in wb.worksheets:
        for linha in ws.iter_rows():
            for celula in linha:
                if celula.data_type == "f" or (isinstance(celula.value, str) and celula.value.startswith("=")):
                    rel.erro(arquivo, f"fórmula em {ws.title}!{celula.coordinate}")
                elif isinstance(celula.value, str) and ERRO_EXCEL.match(celula.value):
                    rel.erro(arquivo, f"erro do Excel em {ws.title}!{celula.coordinate}: {celula.value}")

    ws = wb["DADOS"]
    specs = L.colunas(arquivo)
    cabecalho, linhas = ler(ws)
    esperado = [s.nome for s in specs]
    if cabecalho[: len(esperado)] != esperado:
        rel.erro(arquivo, f"cabeçalho da aba DADOS difere do esperado: {cabecalho} × {esperado}")
        return None
    for indice, spec in enumerate(specs, start=1):
        bruto = str(ws.cell(row=LINHA_CABECALHO, column=indice).value or "")
        if spec.obrigatorio != bruto.endswith(" *"):
            rel.erro(arquivo, f"marca de obrigatório incoerente em {spec.nome}")

    _, dicionario = ler(wb["DICIONARIO"])
    por_coluna = {d["COLUNA"]: d for d in dicionario}
    for spec in specs:
        entrada = por_coluna.get(spec.nome)
        if not entrada:
            rel.erro(arquivo, f"coluna {spec.nome} sem linha no DICIONARIO")
        elif (entrada["OBRIGATORIO"] == "SIM") != spec.obrigatorio:
            rel.erro(arquivo, f"DICIONARIO diverge da aba DADOS quanto a {spec.nome} ser obrigatório")
    for entrada in dicionario:
        if entrada["OBRIGATORIO"] not in ("SIM", "NÃO") or entrada["PODE_FICAR_VAZIO"] not in ("SIM", "NÃO"):
            rel.erro(arquivo, f"DICIONARIO linha {entrada['_linha']}: OBRIGATORIO/PODE_FICAR_VAZIO devem ser SIM ou NÃO")

    _, valores = ler(wb["VALORES_PERMITIDOS"])
    documentados: dict[str, set] = defaultdict(set)
    for v in valores:
        documentados[v["CAMPO"]].add(v["VALOR"])
    validacoes = ws.data_validations.dataValidation
    for indice, spec in enumerate(specs, start=1):
        if spec.valores:
            faltam = set(spec.valores) - documentados.get(spec.nome, set())
            if faltam:
                rel.erro(arquivo, f"VALORES_PERMITIDOS não documenta {sorted(faltam)} de {spec.nome}")
        if spec.valores or spec.lista:
            celula = f"{get_column_letter(indice)}{PRIMEIRA_LINHA}"
            if not any(celula in v.sqref for v in validacoes):
                rel.erro(arquivo, f"coluna {spec.nome} sem lista suspensa")

    _, pendencias = ler(wb["PENDENCIAS"])
    pend_por_chave: dict[str, list[dict]] = defaultdict(list)
    for p in pendencias:
        if p.get("PROBLEMA") not in PROBLEMAS:
            rel.erro(arquivo, f"PENDENCIAS linha {p['_linha']}: PROBLEMA desconhecido {p.get('PROBLEMA')!r}")
        if p.get("IMPEDE_CARGA") not in ("SIM", "NÃO"):
            rel.erro(arquivo, f"PENDENCIAS linha {p['_linha']}: IMPEDE_CARGA deve ser SIM ou NÃO")
        pend_por_chave[p.get("CHAVE_MIGRACAO")].append(p)

    coluna_status = "STATUS_VALIDACAO" if arquivo == F.MAPA else "STATUS_REVISAO"
    chaves: set[str] = set()
    for linha in linhas:
        numero = linha["_linha"]
        chave = str(linha.get("CHAVE_MIGRACAO") or "")
        if not chave:
            rel.erro(arquivo, f"linha {numero}: CHAVE_MIGRACAO vazia")
            continue
        if not R.PADRAO_CHAVE.match(chave):
            rel.erro(arquivo, f"linha {numero}: CHAVE_MIGRACAO fora do padrão: {chave}")
        if chave in chaves:
            rel.erro(arquivo, f"CHAVE_MIGRACAO repetida: {chave}")
        chaves.add(chave)
        status = linha.get(coluna_status)
        textos = [str(v) for k, v in linha.items() if k != "_linha" and v is not None]
        if any(R.PADRAO_UUID.search(t) for t in textos):
            rel.erro(arquivo, f"linha {numero} ({chave}): UUID técnico no registro")
        texto = " ".join(str(v) for k, v in linha.items() if k not in ("_linha", "URL_OU_DOCUMENTO") and isinstance(v, str))
        if R.PADRAO_SINTETICO_CERTO.search(texto):
            rel.erro(arquivo, f"linha {numero} ({chave}): conteúdo reconhecidamente sintético")
        elif R.marcador_sintetico(texto) and arquivo != F.MAPA:
            marcado = any(p["PROBLEMA"] == "POSSIVEL_DADO_SINTETICO" for p in pend_por_chave.get(chave, []))
            if not (marcado and status in ("PENDENTE", "NAO_IMPORTAR")):
                rel.erro(arquivo, f"linha {numero} ({chave}): possível dado sintético sem pendência")

        for spec in specs:
            valor = linha.get(spec.nome)
            vazio = valor is None or valor == ""
            if spec.obrigatorio and vazio:
                if status == "NAO_IMPORTAR" or (status == "PENDENTE" and pend_por_chave.get(chave)):
                    continue
                rel.erro(arquivo, f"linha {numero} ({chave}): obrigatório {spec.nome} vazio")
                continue
            if vazio:
                continue
            if spec.valores and str(valor) not in spec.valores:
                rel.erro(arquivo, f"linha {numero} ({chave}): {spec.nome} = {valor!r} fora da lista")
            if spec.tipo == "Data" and not isinstance(valor, (date, datetime)):
                rel.erro(arquivo, f"linha {numero} ({chave}): {spec.nome} não é data")
            if spec.tipo in ("Moeda", "Número", "Percentual") and not isinstance(valor, (int, float)):
                rel.erro(arquivo, f"linha {numero} ({chave}): {spec.nome} não é número")
            elif spec.validacao_numero == "positivo" and valor <= 0:
                rel.erro(arquivo, f"linha {numero} ({chave}): {spec.nome} deve ser maior que zero")
            elif spec.validacao_numero == "nao_negativo" and valor < 0:
                rel.erro(arquivo, f"linha {numero} ({chave}): {spec.nome} não pode ser negativo")
            elif spec.validacao_numero == "fracao" and not (0 < valor <= 1):
                rel.erro(arquivo, f"linha {numero} ({chave}): {spec.nome} fora de 0–100%")

        if arquivo not in (F.MAPA, F.PRECOS):
            bloqueia = any(p["IMPEDE_CARGA"] == "SIM" for p in pend_por_chave.get(chave, []))
            if bloqueia and status == "OK":
                (rel.aviso if devolucao else rel.erro)(arquivo, f"{chave}: STATUS OK com pendência que impede a carga")
            if not devolucao and status == "PENDENTE" and not bloqueia:
                rel.erro(arquivo, f"{chave}: PENDENTE sem pendência que impeça a carga")
        if arquivo == F.CLIENTES and linha.get("CNPJ"):
            digitos = R.so_digitos(str(linha["CNPJ"]))
            if not R.cnpj_valido(digitos) and status not in ("PENDENTE", "NAO_IMPORTAR"):
                rel.erro(arquivo, f"{chave}: CNPJ inválido sem estar PENDENTE")
        if arquivo == F.PRECOS:
            _validar_preco(arquivo, linha, rel, devolucao)

    if arquivo != F.MAPA:
        for p in pendencias:
            if p.get("CHAVE_MIGRACAO") not in chaves:
                rel.erro(arquivo, f"PENDENCIAS: chave {p.get('CHAVE_MIGRACAO')} não está na aba DADOS")
    if arquivo == F.PRECOS:
        if any(PROIBIDO_06.search(c or "") for c in cabecalho):
            rel.erro(arquivo, "coluna de custo real na planilha de referência de mercado")
        if "NÃO é custo real" not in str(ws.cell(row=1, column=1).value or ""):
            rel.erro(arquivo, "aba DADOS sem o aviso 'NÃO é custo real'")

    return {
        "chaves": chaves,
        "linhas": linhas,
        "status": Counter(l.get(coluna_status) for l in linhas),
        "pendencias": len(pendencias),
        "bloqueantes": sum(1 for p in pendencias if p.get("IMPEDE_CARGA") == "SIM"),
    }


def _validar_preco(arquivo: str, linha: dict, rel: Relatorio, devolucao: bool) -> None:
    chave = linha["CHAVE_MIGRACAO"]
    status = linha.get("STATUS_REVISAO")
    preco, quantidade = decimal(linha.get("PRECO_PUBLICADO")), decimal(linha.get("QUANTIDADE_REFERENCIA"))
    unidade, normalizado = linha.get("UNIDADE_REFERENCIA"), decimal(linha.get("PRECO_NORMALIZADO_POR_UNIDADE_ESTOQUE"))
    if status in ("A_REVISAR", "ACEITA"):
        exigidos = ("PRECO_PUBLICADO", "QUANTIDADE_REFERENCIA", "UNIDADE_REFERENCIA",
                    "PRECO_NORMALIZADO_POR_UNIDADE_ESTOQUE", "URL_OU_DOCUMENTO", "DATA_DA_PESQUISA", "CONFIANCA")
        faltam = [c for c in exigidos if linha.get(c) in (None, "")]
        if faltam:
            rel.erro(arquivo, f"{chave}: {status} sem {', '.join(faltam)}")
    if status in ("SEM_REFERENCIA", "PESQUISA_PENDENTE") and (preco or normalizado or linha.get("CONFIANCA")):
        rel.erro(arquivo, f"{chave}: {status} não pode ter preço nem confiança")
    if preco and quantidade and unidade and linha.get("UNIDADE_ESTOQUE"):
        calculado = R.normalizar_preco(preco, quantidade, unidade, linha["UNIDADE_ESTOQUE"])
        if calculado is None and normalizado is not None:
            rel.erro(arquivo, f"{chave}: preço normalizado sem conversão possível entre {unidade} e {linha['UNIDADE_ESTOQUE']}")
        elif calculado is not None and normalizado is not None:
            tolerancia = max(Decimal("0.0001"), calculado * Decimal("0.000001"))
            if abs(normalizado - calculado) > tolerancia:
                (rel.aviso if devolucao else rel.erro)(arquivo, f"{chave}: normalizado {normalizado} ≠ recalculado {calculado}")


def validar_relacoes(resultados: dict, rel: Relatorio) -> None:
    def chaves(arquivo: str) -> set[str]:
        return resultados[arquivo]["chaves"] if resultados.get(arquivo) else set()

    itens_mp, itens_me = chaves(F.MATERIAS_PRIMAS), chaves(F.EMBALAGENS)
    for chave in itens_mp & itens_me:
        rel.erro("RELACOES", f"item {chave} está em 03 e em 04")
    itens = itens_mp | itens_me
    status_de = {}
    for arquivo in (F.CLIENTES, F.FORNECEDORES, F.MATERIAS_PRIMAS, F.EMBALAGENS, F.PRODUTOS):
        for linha in (resultados.get(arquivo) or {}).get("linhas", []):
            status_de[linha["CHAVE_MIGRACAO"]] = linha.get("STATUS_REVISAO")

    pa: set[str] = set()
    for linha in (resultados.get(F.PRODUTOS) or {}).get("linhas", []):
        chave_pa = str(linha.get("CHAVE_ITEM_PA") or "")
        if chave_pa in pa:
            rel.erro(F.PRODUTOS, f"CHAVE_ITEM_PA repetida: {chave_pa} (regra 1:1)")
        pa.add(chave_pa)
        if chave_pa.removeprefix("PA-LEG-") != str(linha["CHAVE_MIGRACAO"]).removeprefix("PROD-LEG-"):
            rel.erro(F.PRODUTOS, f"{linha['CHAVE_MIGRACAO']}: item de produto acabado {chave_pa} não corresponde (1:1)")
        cliente = linha.get("CHAVE_CLIENTE")
        if cliente and cliente not in chaves(F.CLIENTES):
            rel.erro(F.PRODUTOS, f"{linha['CHAVE_MIGRACAO']}: CHAVE_CLIENTE {cliente} não existe em 01")
        elif cliente and status_de.get(cliente) == "NAO_IMPORTAR" and linha.get("STATUS_REVISAO") != "NAO_IMPORTAR":
            rel.aviso(F.PRODUTOS, f"{linha['CHAVE_MIGRACAO']}: cliente {cliente} marcado NAO_IMPORTAR")

    cobertos = set()
    for linha in (resultados.get(F.PRECOS) or {}).get("linhas", []):
        cobertos.add(linha.get("CHAVE_ITEM"))
        if linha.get("CHAVE_ITEM") not in itens:
            rel.erro(F.PRECOS, f"{linha['CHAVE_MIGRACAO']}: CHAVE_ITEM {linha.get('CHAVE_ITEM')} não existe em 03/04")
    for chave in sorted(itens - cobertos):
        rel.aviso(F.PRECOS, f"item {chave} sem linha de referência de mercado")

    for linha in (resultados.get(F.OFERTAS) or {}).get("linhas", []):
        if linha.get("CHAVE_FORNECEDOR") not in chaves(F.FORNECEDORES):
            rel.erro(F.OFERTAS, f"{linha['CHAVE_MIGRACAO']}: CHAVE_FORNECEDOR {linha.get('CHAVE_FORNECEDOR')} não existe em 02")
        if linha.get("CHAVE_ITEM") not in itens:
            rel.erro(F.OFERTAS, f"{linha['CHAVE_MIGRACAO']}: CHAVE_ITEM {linha.get('CHAVE_ITEM')} não existe em 03/04")
        for alvo in (linha.get("CHAVE_FORNECEDOR"), linha.get("CHAVE_ITEM")):
            if status_de.get(alvo) == "NAO_IMPORTAR" and linha.get("STATUS_REVISAO") != "NAO_IMPORTAR":
                rel.aviso(F.OFERTAS, f"{linha['CHAVE_MIGRACAO']}: aponta para {alvo}, marcado NAO_IMPORTAR")

    if resultados.get(F.MAPA):
        mapa = chaves(F.MAPA)
        esperadas = chaves(F.CLIENTES) | chaves(F.FORNECEDORES) | itens | chaves(F.PRODUTOS) | pa
        for chave in sorted(esperadas - mapa):
            rel.erro(F.MAPA, f"registro {chave} fora do mapa de chaves")
        for chave in sorted(mapa - esperadas):
            rel.erro(F.MAPA, f"chave {chave} do mapa não existe nos arquivos de cadastro")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("pasta", type=Path)
    parser.add_argument("--devolucao", action="store_true", help="valida arquivos já editados pela Veridi")
    parser.add_argument("--relatorio", type=Path, help="grava o relatório neste arquivo")
    args = parser.parse_args()

    rel = Relatorio()
    resultados = {arquivo: validar_arquivo(args.pasta, arquivo, rel, args.devolucao) for arquivo in F.ARQUIVOS}
    validar_relacoes(resultados, rel)

    saida = [f"VALIDAÇÃO DO PACOTE — {args.pasta}", ""]
    for arquivo, r in resultados.items():
        if r:
            saida.append(
                f"{arquivo}: {len(r['linhas'])} registros · {r['pendencias']} pendências ({r['bloqueantes']} impedem) · "
                f"{dict(r['status'])}"
            )
        else:
            saida.append(f"{arquivo}: NÃO VALIDADO")
    saida += ["", f"ERROS: {len(rel.erros)}"] + [f"  {e}" for e in rel.erros[:500]]
    saida += ["", f"AVISOS: {len(rel.avisos)}"] + [f"  {a}" for a in rel.avisos[:500]]
    saida += ["", "RESULTADO: " + ("APROVADO" if not rel.erros else "REPROVADO")]
    texto = "\n".join(saida)
    print(texto)
    if args.relatorio:
        args.relatorio.write_text(texto + "\n", encoding="utf-8")
    return 1 if rel.erros else 0


if __name__ == "__main__":
    sys.exit(main())
