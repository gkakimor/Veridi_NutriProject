#!/usr/bin/env python3
"""
Gera o pacote de revisão de cadastros para a migração de produção
(PROD-MASTER-MIGRATION-PACK-01, revisão 01).

    python scripts/veridi-migration-pack/gerar_pacote.py
        [--dados ../.local-data/veridi] [--saida handoff/migracao-producao/revisao-01]
        [--pesquisa-nova market-reference/pesquisa-publica-2026-09-11.tsv]

Só LÊ as fontes locais (nenhum banco, nenhuma rede) e só ESCREVE os .xlsx e o
MANIFESTO na pasta de saída. A pasta de saída tem dado real de cliente e
fornecedor: fica fora do Git (`handoff/` e `.local-data/` estão no .gitignore).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

import fontes as F  # noqa: E402
import layout as L  # noqa: E402
from planilha import Tabela, salvar_workbook  # noqa: E402

REPO = AQUI.parents[1]
DADOS_PADRAO = REPO.parent / ".local-data" / "veridi"
SAIDA_PADRAO = REPO / "handoff" / "migracao-producao" / "revisao-01"
PESQUISA_PADRAO = Path("market-reference") / "pesquisa-publica-2026-09-11.tsv"

ORDEM_ENTIDADES = ["CLIENTE", "FORNECEDOR", "MATERIA_PRIMA", "EMBALAGEM", "PRODUTO", "ITEM_PRODUTO_ACABADO"]


def commit_atual() -> str:
    try:
        commit = subprocess.run(
            ["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True
        ).stdout.strip()
        sujo = subprocess.run(
            ["git", "-C", str(REPO), "status", "--porcelain", "--", str(AQUI)], capture_output=True, text=True, check=True
        ).stdout.strip()
        return commit + (" + alterações locais no gerador" if sujo else "")
    except (OSError, subprocess.CalledProcessError):
        return "desconhecido"


def contagem(contador: Counter) -> str:
    ordem = ["REVISAR", "OK", "PENDENTE", "NAO_IMPORTAR", "ENCONTRADO", "NAO_NORMALIZAVEL", "SEM_REFERENCIA",
             "PESQUISA_PENDENTE", "ALTA", "MEDIA", "BAIXA", "OFERTA_FORNECEDOR_LEGADO", "PRECO_MERCADO_PUBLICO"]
    chaves = sorted(contador, key=lambda k: (ordem.index(k) if k in ordem else len(ordem), str(k)))
    return " · ".join(f"{k} {contador[k]}" for k in chaves)


def linhas_mapa(pac: F.Pacote) -> list[dict]:
    problemas: dict[str, dict[str, bool]] = defaultdict(dict)
    for p in pac.pendencias:
        problemas[p.chave][p.problema] = problemas[p.chave].get(p.problema, False) or p.impede_carga
    linhas: list[dict] = []

    def resumo(chave: str) -> str:
        return ", ".join(f"{codigo} (impede)" if impede else codigo for codigo, impede in sorted(problemas.get(chave, {}).items()))

    def incluir(tipo, legado, chave, nome, fonte, status, observacao=None):
        linhas.append(
            {
                "TIPO_ENTIDADE": tipo,
                "CHAVE_LEGADO": legado,
                "CHAVE_MIGRACAO": chave,
                "CODIGO_PRODUCAO_PREVISTO": F.GERADO_NA_CARGA,
                "NOME": nome,
                "FONTE": fonte,
                "STATUS_VALIDACAO": status,
                "OBSERVACAO": observacao if observacao is not None else resumo(chave),
            }
        )

    for c in pac.clientes:
        incluir("CLIENTE", c["CODIGO_PLANILHA"], c["CHAVE_MIGRACAO"], c["_nome"], c["_fonte"], c["STATUS_REVISAO"])
    for f in pac.fornecedores:
        incluir("FORNECEDOR", f["NOME_PLANILHA"], f["CHAVE_MIGRACAO"], f["_nome"], f["_fonte"], f["STATUS_REVISAO"])
    for i in pac.itens:
        incluir(i["TIPO"], i["CODIGO_PLANILHA"], i["CHAVE_MIGRACAO"], i["NOME"], i["_fonte"], i["STATUS_REVISAO"])
    for p in pac.produtos:
        incluir("PRODUTO", p["_cod"], p["CHAVE_MIGRACAO"], p["NOME_PRODUTO"], p["_fonte"], p["STATUS_REVISAO"])
        incluir(
            "ITEM_PRODUTO_ACABADO", p["_cod"], p["CHAVE_ITEM_PA"], p["NOME_PRODUTO"],
            f"nasce 1:1 com {p['CHAVE_MIGRACAO']}", p["STATUS_REVISAO"], f"segue o produto {p['CHAVE_MIGRACAO']}",
        )
    return sorted(linhas, key=lambda r: (ORDEM_ENTIDADES.index(r["TIPO_ENTIDADE"]), r["CHAVE_MIGRACAO"]))


def linhas_por_arquivo(pac: F.Pacote) -> dict[str, list[dict]]:
    itens = sorted(pac.itens, key=lambda i: int(i["_codigo"]))
    return {
        F.MAPA: linhas_mapa(pac),
        F.CLIENTES: pac.clientes,
        F.FORNECEDORES: pac.fornecedores,
        F.MATERIAS_PRIMAS: [i for i in itens if i["_arquivo"] == F.MATERIAS_PRIMAS],
        F.EMBALAGENS: [i for i in itens if i["_arquivo"] == F.EMBALAGENS],
        F.PRODUTOS: pac.produtos,
        F.PRECOS: pac.precos,
        F.OFERTAS: sorted(
            pac.ofertas,
            key=lambda o: (
                int(o["_codigo_item"]) if o["_codigo_item"].isdigit() else 10**9,
                o["FORNECEDOR"],
                o["PRECO"] if o["PRECO"] is not None else -1,
            ),
        ),
    }


def listas_de(arquivo: str, pac: F.Pacote) -> dict[str, list[str]] | None:
    if arquivo == F.PRODUTOS:
        return {"CLIENTES": [c["CHAVE_MIGRACAO"] for c in pac.clientes]}
    if arquivo == F.OFERTAS:
        return {
            "FORNECEDORES": [f["CHAVE_MIGRACAO"] for f in pac.fornecedores],
            "ITENS": sorted(i["CHAVE_MIGRACAO"] for i in pac.itens),
        }
    return None


def secao_fonte(uso: str) -> str:
    if uso.startswith("UTILIZADA"):
        return "FONTE_UTILIZADA"
    return {"EXCLUIDA": "FONTE_EXCLUIDA", "PROVENIENCIA": "PROVENIENCIA", "CONFERENCIA": "FONTE_CONFERENCIA"}.get(uso, uso)


def resumo_pesquisa(pac: F.Pacote) -> dict:
    def itens(condicao) -> set[str]:
        return {p["CHAVE_ITEM"] for p in pac.precos if condicao(p)}

    com_preco = itens(lambda p: p["PRECO_PUBLICADO"] is not None)
    return {
        "linhas": len(pac.precos),
        "por_situacao": Counter(p["SITUACAO_PESQUISA"] for p in pac.precos),
        "itens_com_preco": len(com_preco),
        "itens_normalizados": len(itens(lambda p: p["SITUACAO_PESQUISA"] == "ENCONTRADO")),
        "itens_sem_referencia": len(itens(lambda p: p["SITUACAO_PESQUISA"] == "SEM_REFERENCIA")),
        "itens_pendentes": len(itens(lambda p: p["SITUACAO_PESQUISA"] == "PESQUISA_PENDENTE")),
        "linhas_reaproveitadas": sum(1 for p in pac.precos if p["_rodada"] == "ANTERIOR" and p["PRECO_PUBLICADO"] is not None),
        "linhas_novas": sum(1 for p in pac.precos if p["_rodada"] == "NOVA" and p["PRECO_PUBLICADO"] is not None),
        "itens_reaproveitados": len(itens(lambda p: p["_rodada"] == "ANTERIOR" and p["PRECO_PUBLICADO"] is not None)),
        "itens_novos": len(itens(lambda p: p["_rodada"] == "NOVA" and p["PRECO_PUBLICADO"] is not None)),
        "confianca": Counter(p["CONFIANCA"] for p in pac.precos if p["CONFIANCA"]),
    }


def resumo_custos(itens: list[dict]) -> str:
    origem = Counter(i["ORIGEM_CUSTO_REFERENCIA"] for i in itens)
    return (
        f"{sum(1 for i in itens if i['CUSTO_REFERENCIA'] is not None)} de {len(itens)} itens com custo de referência — "
        f"{origem.get('OFERTA_FORNECEDOR_LEGADO', 0)} pela mediana das ofertas do legado (07), "
        f"{origem.get('PRECO_MERCADO_PUBLICO', 0)} pela mediana dos preços públicos (06), "
        f"{origem.get('SEM_REFERENCIA', 0)} sem referência."
    )


def linhas_origem(arquivo: str, pac: F.Pacote, info: dict, registros: list[dict], pendencias: list[F.Pendencia]) -> list[dict]:
    linhas: list[dict] = []

    def incluir(secao, item, detalhe):
        linhas.append({"SECAO": secao, "ITEM": item, "DETALHE": detalhe})

    incluir("PACOTE", "Situação", L.AVISO)
    incluir("PACOTE", "Identificação", f"PROD-MASTER-MIGRATION-PACK-01 · revisão 01 · {arquivo}")
    incluir("PACOTE", "Gerado em", info["gerado_em"].strftime("%d/%m/%Y %H:%M"))
    incluir("PACOTE", "Gerador", f"scripts/veridi-migration-pack/gerar_pacote.py · commit {info['commit']}")
    incluir("PACOTE", "Registros na aba DADOS", str(len(registros)))
    incluir("PACOTE", "Pendências", f"{len(pendencias)} — {sum(1 for p in pendencias if p.impede_carga)} impedem a carga")
    incluir("CHAVE", "CHAVE_MIGRACAO", L.CHAVES[arquivo])
    incluir("CODIGO_PRODUCAO", "Código previsto", L.CODIGO_PRODUCAO)
    for item, detalhe in L.REGRAS[arquivo]:
        incluir("REGRA", item, detalhe)
    for item, detalhe in L.DEFAULTS[arquivo]:
        incluir("DEFAULT_DO_SISTEMA", item, detalhe)
    if arquivo in (F.MATERIAS_PRIMAS, F.EMBALAGENS):
        incluir("CUSTO_REFERENCIA", "Cobertura", resumo_custos(registros))
    if arquivo == F.PRECOS:
        r = resumo_pesquisa(pac)
        incluir("PESQUISA", "Pesquisa reaproveitada (07/09/2026)",
                f"{r['linhas_reaproveitadas']} preço(s) de {r['itens_reaproveitados']} item(ns), de "
                f"{pac.pesquisa['itens_pesquisa_anterior']} itens pesquisados naquela rodada (market-prices.csv, "
                "linhas PESQUISA_MERCADO).")
        data_nova = pac.pesquisa.get("data_pesquisa_nova")
        incluir("PESQUISA", "Pesquisa complementar",
                (f"{data_nova:%d/%m/%Y}: {pac.pesquisa['itens_pesquisa_nova']} item(ns) pesquisado(s), "
                 f"{r['linhas_novas']} preço(s) em {r['itens_novos']} item(ns).") if data_nova else "Não realizada.")
        incluir("PESQUISA", "Situação por item",
                f"com preço público: {r['itens_com_preco']} · normalizado: {r['itens_normalizados']} · "
                f"sem referência: {r['itens_sem_referencia']} · pesquisa pendente: {r['itens_pendentes']}")
        incluir("PESQUISA", "Confiança das linhas com preço", contagem(r["confianca"]) or "—")
        for descartada in pac.pesquisa.get("descartadas", []):
            incluir("PESQUISA", "Linha descartada", descartada)
    for fonte in pac.fontes:
        detalhe = fonte.natureza
        if fonte.linhas is not None:
            detalhe += f" · {fonte.linhas} linhas"
        if fonte.sha256:
            detalhe += f" · SHA-256 {fonte.sha256[:16]}…"
        incluir(secao_fonte(fonte.uso), fonte.arquivo, f"{detalhe} · {fonte.detalhe}")
    for excluido in pac.excluidos:
        incluir("REGISTRO_EXCLUIDO", excluido["registro"], f"{excluido['fonte']}: {excluido['motivo']}")
    sinteticos = [p for p in pac.pendencias if p.problema == "POSSIVEL_DADO_SINTETICO"]
    incluir("SINTETICO", "Varredura de conteúdo",
            "Todos os textos candidatos foram varridos por termos de teste/exemplo (teste, test, example, exemplo, demo, "
            "mock, fixture, golden path, localhost, veridi.local, e2e…). Resultado: "
            f"{len(pac.excluidos)} registro(s) excluído(s), {len(sinteticos)} em pendência para validar.")
    for item, detalhe in L.PROXIMA_FASE:
        incluir("PROXIMA_FASE", item, detalhe)
    return linhas


def escrever_arquivo(saida: Path, arquivo: str, linhas: list[dict], pac: F.Pacote, info: dict) -> dict:
    colunas = L.colunas(arquivo)
    pendencias = pac.pendencias if arquivo == F.MAPA else pac.pendencias_de(arquivo)
    linhas_pendencias = sorted(
        (
            {
                "ARQUIVO": p.arquivo,
                "CHAVE_MIGRACAO": p.chave,
                "REGISTRO": p.registro,
                "PROBLEMA": p.problema,
                "VALOR_ATUAL": p.valor_atual,
                "ACAO_ESPERADA_DO_USUARIO": p.acao,
                "IMPEDE_CARGA": "SIM" if p.impede_carga else "NÃO",
            }
            for p in pendencias
        ),
        key=lambda r: (r["ARQUIVO"], r["IMPEDE_CARGA"] != "SIM", r["PROBLEMA"], r["CHAVE_MIGRACAO"]),
    )
    colunas_pendencias = L.colunas_pendencias(arquivo == F.MAPA)
    legado = pac.legado_de(arquivo)
    linhas_legado = [
        {"CHAVE_MIGRACAO": x.chave, "CAMPO": x.campo, "VALOR": x.valor, "FONTE": x.fonte, "MOTIVO_NAO_IMPORTACAO": x.motivo}
        for x in legado
    ]
    dicionario = L.linhas_dicionario(colunas) + L.linhas_dicionario(colunas_pendencias, "PENDENCIAS › ")
    if legado:
        dicionario += L.linhas_dicionario(L.COLUNAS_LEGADO, "LEGADO_NAO_IMPORTADO › ")
    bloqueantes = sum(1 for p in pendencias if p.impede_carga)
    tabelas = [
        Tabela("DADOS", L.TITULOS[arquivo], colunas, linhas, validar=True, sufixo_obrigatorio=True,
               congelar_coluna=True, comentarios=True),
        Tabela("DICIONARIO", f"DICIONÁRIO — {arquivo}. OBRIGATORIO = SIM corresponde às colunas com * na aba DADOS. "
               "Colunas cinza são técnicas (não editar).", L.COLUNAS_DICIONARIO, dicionario),
        Tabela("VALORES_PERMITIDOS", "VALORES PERMITIDOS — VALOR é o que aparece na planilha; VALOR_TECNICO_ERP é o que "
               "a carga grava no sistema; ROTULO_PT é o texto da tela. Booleanos sempre SIM / NÃO.",
               L.COLUNAS_VALORES, L.valores_permitidos(arquivo)),
        Tabela("PENDENCIAS", f"PENDÊNCIAS — {len(pendencias)} no total, {bloqueantes} impedem a carga (IMPEDE_CARGA = SIM: "
               "resolver antes de marcar o registro OK). Corrigir na aba DADOS; não apagar linhas.",
               colunas_pendencias, linhas_pendencias, vazia="Nenhuma pendência."),
        Tabela("ORIGEM", "ORIGEM — fontes usadas, fontes excluídas e critérios de transformação deste arquivo.",
               L.COLUNAS_ORIGEM, linhas_origem(arquivo, pac, info, linhas, pendencias)),
    ]
    if legado:
        tabelas.append(
            Tabela("LEGADO_NAO_IMPORTADO", "LEGADO NÃO IMPORTADO — informação REAL do legado que não entra nesta carga "
                   "(sem campo ou sem vínculo no ERP). Preservada aqui para não se perder.", L.COLUNAS_LEGADO,
                   linhas_legado)
        )
    salvar_workbook(saida / f"{arquivo}.xlsx", tabelas, listas_de(arquivo, pac), titulo=arquivo)
    return {
        "registros": len(linhas),
        "pendencias": len(pendencias),
        "bloqueantes": bloqueantes,
        "legado": len(legado),
        "status": Counter(r.get("STATUS_REVISAO") or r.get("STATUS_VALIDACAO") for r in linhas),
    }


def escrever_manifesto(saida: Path, pac: F.Pacote, info: dict, resumo: dict[str, dict]) -> None:
    r = resumo_pesquisa(pac)
    itens = {i["CHAVE_MIGRACAO"]: i for i in pac.itens}
    fora = Counter(i["_origem"] for i in pac.itens)
    mp = [i for i in pac.itens if i["TIPO"] == "MATERIA_PRIMA"]
    me = [i for i in pac.itens if i["TIPO"] == "EMBALAGEM"]
    duplicidades = Counter(p.arquivo for p in pac.pendencias if p.problema == "DUPLICIDADE")
    com_preco = {p["CHAVE_ITEM"] for p in pac.precos if p["PRECO_PUBLICADO"] is not None}
    sem_preco = sorted(
        {(p["CHAVE_ITEM"], p["SITUACAO_PESQUISA"]) for p in pac.precos
         if p["SITUACAO_PESQUISA"] in ("SEM_REFERENCIA", "PESQUISA_PENDENTE") and p["CHAVE_ITEM"] not in com_preco}
    )
    linhas = [
        "# MANIFESTO — Migração de cadastros para produção (revisão 01)",
        "",
        f"> **{L.AVISO}**",
        "",
        f"- Pacote: PROD-MASTER-MIGRATION-PACK-01 · gerado em {info['gerado_em']:%d/%m/%Y %H:%M}",
        f"- Gerador: `scripts/veridi-migration-pack/gerar_pacote.py` · commit {info['commit']}",
        f"- Fonte de dados: `{pac.dados}` (corpus real da Veridi, fora do Git)",
        "- Produção: **não lida e não escrita**. Nenhum loader APPLY executado. Nenhum banco consultado.",
        "- Todos os registros nascem **STATUS_REVISAO = REVISAR**: nada foi aprovado pela geração; só entra na carga o "
        "que a Veridi marcar OK.",
        "",
        "## Arquivos produzidos",
        "",
        "| Arquivo | Registros (DADOS) | Pendências | Impedem a carga | Legado não importado |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for arquivo in F.ARQUIVOS:
        x = resumo[arquivo]
        linhas.append(f"| {arquivo}.xlsx | {x['registros']} | {x['pendencias']} | {x['bloqueantes']} | {x['legado']} |")
    linhas += [
        "",
        "Cada arquivo tem as abas DADOS, DICIONARIO, VALORES_PERMITIDOS, PENDENCIAS e ORIGEM; LEGADO_NAO_IMPORTADO "
        "onde há informação real que não cabe na carga. As colunas de DADOS seguem os campos das telas do ERP "
        "(Cliente, Fornecedor, Item, Produto e Item × Fornecedor).",
        "",
        "## Registros por cadastro",
        "",
        f"- Clientes: {len(pac.clientes)} — {contagem(resumo[F.CLIENTES]['status'])}",
        f"- Fornecedores: {len(pac.fornecedores)} — {contagem(resumo[F.FORNECEDORES]['status'])}",
        f"- Matérias-primas: {len(mp)} — {contagem(resumo[F.MATERIAS_PRIMAS]['status'])}",
        f"- Materiais de embalagem: {len(me)} — {contagem(resumo[F.EMBALAGENS]['status'])}",
        f"  - itens do cadastro principal: {fora['CADASTRO']}; só no CMV: {fora['SO_CMV']}; só em preços: "
        f"{fora['SO_PRECOS']} (os fora do cadastro têm pendência que impede a carga)",
        f"- Produtos acabados: {len(pac.produtos)} (+ {len(pac.produtos)} itens de produto acabado, 1:1) — "
        f"{contagem(resumo[F.PRODUTOS]['status'])}",
        f"- Fornecedores dos itens e ofertas do legado (07): {len(pac.ofertas)} — {contagem(resumo[F.OFERTAS]['status'])}",
        f"- Duplicidades apontadas: {' · '.join(f'{a} {n}' for a, n in sorted(duplicidades.items()))} "
        "(nada fundido automaticamente)",
        "",
        "## Custo de referência dos materiais (03, 04)",
        "",
        f"- Matérias-primas: {resumo_custos(mp)}",
        f"- Materiais de embalagem: {resumo_custos(me)}",
        "- Regra: mediana das ofertas de fornecedor do legado (07) na unidade do item; sem oferta utilizável, mediana "
        "dos preços públicos (06). Todas as ofertas e preços do item aparecem na própria linha. É referência manual "
        "(estimativa), não custo real de compra.",
        "",
        "## Fontes",
        "",
    ]
    for fonte in pac.fontes:
        tamanho = f", {fonte.linhas} linhas" if fonte.linhas is not None else ""
        hash_txt = f", SHA-256 `{fonte.sha256[:16]}…`" if fonte.sha256 else ""
        linhas.append(f"- **{fonte.uso}** · `{fonte.arquivo}` ({fonte.natureza}{tamanho}{hash_txt}) — {fonte.detalhe}")
    if pac.excluidos:
        linhas += ["", "Registros excluídos por serem sintéticos/modelo:"]
        linhas += [f"- {e['fonte']}: {e['registro']} — {e['motivo']}" for e in pac.excluidos]
    linhas += [
        "",
        "## Preços de referência de mercado (06)",
        "",
        "- Pesquisa antiga encontrada: **SIM** — `.local-data/veridi/market-reference/market-prices.csv` "
        "(linhas PESQUISA_MERCADO, pesquisa pública de 07/09/2026, com loja, URL, apresentação e preço) e os achados "
        "brutos em `tier3-web-findings.tsv`.",
        f"- Reaproveitado: {r['linhas_reaproveitadas']} preço(s) de {r['itens_reaproveitados']} item(ns); os demais "
        f"itens daquela pesquisa ({pac.pesquisa['itens_pesquisa_anterior']} no total) seguem como SEM_REFERENCIA com o motivo registrado.",
        "- As linhas OFERTA_FORNECEDOR do mesmo arquivo NÃO foram usadas (montadas a partir de um banco DEV); a oferta do "
        "legado vem direto de `precos_fornecedores.csv`, no arquivo 07, separada da referência de mercado.",
    ]
    data_nova = pac.pesquisa.get("data_pesquisa_nova")
    if data_nova:
        linhas.append(
            f"- Pesquisa nova realizada: **SIM (parcial)** — {data_nova:%d/%m/%Y}, "
            f"{pac.pesquisa['itens_pesquisa_nova']} item(ns) pesquisado(s), {r['linhas_novas']} preço(s) em "
            f"{r['itens_novos']} item(ns). Fonte: `.local-data/veridi/market-reference/{PESQUISA_PADRAO.name}`."
        )
    else:
        linhas.append("- Pesquisa nova realizada: **NÃO**.")
    linhas += [
        f"- Itens com preço público: {r['itens_com_preco']} (normalizado para a unidade de estoque: {r['itens_normalizados']}); "
        f"sem referência: {r['itens_sem_referencia']}; pesquisa pendente: {r['itens_pendentes']}.",
        f"- Confiança das linhas com preço: {contagem(r['confianca'])}.",
        "- Preço de mercado ≠ custo real: nada do arquivo 06 vira Receipt, LAST_REAL ou custo de aquisição.",
        "",
        "## Regras de chave",
        "",
        f"- {L.CHAVES[F.MAPA]}",
        f"- Ofertas: {L.CHAVES[F.OFERTAS]}",
        f"- Referências de mercado: {L.CHAVES[F.PRECOS]}",
        "",
        "## Códigos de produção",
        "",
        f"Previsíveis: **NÃO**. {L.CODIGO_PRODUCAO}",
        "",
        "## Campos das telas",
        "",
        "Todos os campos das telas do ERP estão nas planilhas. Nenhum é obrigatório além dos que a tela exige. Campo sem "
        "dado no legado vem com o padrão do sistema (perfil tributário NAO_INFORMADO, ativo SIM, controles de "
        "rastreabilidade por tipo, preferencial NÃO…) ou vazio para a Veridi preencher se souber. Nenhum dado foi "
        "inventado: o que falta ficou vazio e, quando importa, virou pendência.",
        "",
        "## Dados sensíveis e Git",
        "",
        "- Versionado (branch `data/prod-master-migration-pack`): só código e documentação técnica — "
        "`scripts/veridi-migration-pack/` e a seção do runbook em `docs/VERIDI_MIGRATION.md`.",
        "- Somente local (fora do Git): esta pasta (`handoff/` no .gitignore), com os .xlsx e este manifesto, e a "
        "pesquisa complementar em `.local-data/veridi/market-reference/`.",
        "",
        "## Próximos passos",
        "",
    ]
    linhas += [f"1. **{item}** — {detalhe}" for item, detalhe in L.PROXIMA_FASE]
    if sem_preco:
        linhas += [
            "",
            f"## Itens sem preço de mercado ({len(sem_preco)})",
            "",
            "<details><summary>Lista</summary>",
            "",
        ]
        linhas += [f"- {k} — {itens[k]['NOME']} ({s})" for k, s in sem_preco if k in itens]
        linhas += ["", "</details>"]
    (saida / "MANIFESTO_MIGRACAO.md").write_text("\n".join(linhas) + "\n", encoding="utf-8")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dados", type=Path, default=DADOS_PADRAO, help="pasta .local-data/veridi")
    parser.add_argument("--saida", type=Path, default=SAIDA_PADRAO, help="pasta de saída dos .xlsx")
    parser.add_argument("--pesquisa-nova", type=Path, default=None,
                        help=f"TSV da pesquisa complementar (padrão: <dados>/{PESQUISA_PADRAO.as_posix()}, se existir)")
    args = parser.parse_args()

    dados = args.dados.resolve()
    if not (dados / "csv" / "clientes.csv").exists():
        print(f"Corpus não encontrado em {dados}/csv — os CSVs reais ficam fora do repositório.", file=sys.stderr)
        return 1
    pesquisa = args.pesquisa_nova or (dados / PESQUISA_PADRAO)
    pac = F.consolidar(dados, pesquisa if pesquisa.exists() else None)
    info = {"gerado_em": datetime.now(), "commit": commit_atual()}

    saida = args.saida.resolve()
    saida.mkdir(parents=True, exist_ok=True)
    resumo = {}
    for arquivo, linhas in linhas_por_arquivo(pac).items():
        resumo[arquivo] = escrever_arquivo(saida, arquivo, linhas, pac, info)
        x = resumo[arquivo]
        print(f"{arquivo}.xlsx: {x['registros']} registros · {x['pendencias']} pendências "
              f"({x['bloqueantes']} impedem) · legado não importado {x['legado']} · {contagem(x['status'])}")
    escrever_manifesto(saida, pac, info, resumo)
    for aviso in pac.avisos:
        print(f"AVISO: {aviso}")
    print(f"\nPacote em {saida}\n{L.AVISO}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
