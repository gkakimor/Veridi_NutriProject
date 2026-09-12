"""
Layout de cada workbook do pacote: colunas da aba DADOS, dicionário, valores
permitidos e os textos fixos das abas ORIGEM.

As colunas seguem as TELAS do ERP (mesmos campos, mesma ordem de seções):
Cliente, Fornecedor, Item, Produto e a relação Item × Fornecedor. O que o
legado tem vem preenchido; campo de tela sem dado no legado vem com o padrão
do sistema ou vazio — nunca obrigatório por conveniência.
"""

from __future__ import annotations

import fontes as F
import regras as R
from planilha import DATA, MOEDA, MOEDA_PRECISA, PERCENTUAL, TEXTO, Coluna

PACOTE = "PACOTE DE REVISÃO DA MIGRAÇÃO"
AVISO = PACOTE + " — nenhuma informação é carregada no sistema automaticamente quando o arquivo é devolvido."

INSTRUCOES = (
    "1) Revise todos os registros.  2) Corrija só as colunas de cabeçalho verde (cinza = técnica).  "
    "3) NÃO ALTERE a CHAVE_MIGRACAO (coluna vermelha).  4) Em STATUS_REVISAO marque OK (aprovado para a futura "
    "carga) ou NAO_IMPORTAR; use PENDENTE se ainda faltar resolver algo.  5) Não apague linhas.  6) Preço de mercado "
    "é somente referência, não é custo de compra.  7) Nenhuma informação é carregada automaticamente quando você "
    "devolve o arquivo."
)
LEGENDA = INSTRUCOES + (
    "\n* Campo obrigatório.  Colunas com lista: use a seta da célula.  Significado das colunas: aba DICIONARIO.  "
    "O que resolver: aba PENDENCIAS."
)

TITULOS = {
    F.MAPA: PACOTE + " — MAPA DE CHAVES (consulta, não precisa editar). Uma linha por registro candidato. NÃO ALTERE a "
    "CHAVE_MIGRACAO: é a referência que vale entre os arquivos; o código do ERP só nasce na carga. Nenhuma informação "
    "é carregada automaticamente quando o arquivo é devolvido.",
    F.CLIENTES: PACOTE + " — CLIENTES (campos da tela Cliente)\n" + LEGENDA,
    F.FORNECEDORES: PACOTE + " — FORNECEDORES (campos da tela Fornecedor)\n" + LEGENDA,
    F.MATERIAS_PRIMAS: PACOTE + " — MATÉRIAS-PRIMAS (campos da tela Item, com o custo de referência e todos os preços "
    "do item — 07 e 06 — na própria linha)\n" + LEGENDA,
    F.EMBALAGENS: PACOTE + " — MATERIAIS DE EMBALAGEM (campos da tela Item, com o custo de referência e todos os "
    "preços do item — 07 e 06 — na própria linha)\n" + LEGENDA,
    F.PRODUTOS: PACOTE + " — PRODUTOS ACABADOS (campos da tela Produto; Produto ↔ Item de produto acabado, 1:1)\n"
    + LEGENDA,
    F.PRECOS: PACOTE + " — REFERÊNCIA DE MERCADO: preço público de internet. NÃO é custo real de compra, NÃO é "
    "recebimento e NÃO será importado como custo de aquisição.\n"
    "1) Revise as referências.  2) Corrija só as colunas de cabeçalho verde (cinza = técnica).  3) NÃO ALTERE a "
    "CHAVE_MIGRACAO (coluna vermelha).  4) Em STATUS_REVISAO marque ACEITA ou REJEITADA (SITUACAO_PESQUISA é o "
    "resultado da pesquisa).  5) Não apague linhas.  6) Preço de mercado é somente referência.  7) Nenhuma informação "
    "é carregada automaticamente quando você devolve o arquivo.",
    F.OFERTAS: PACOTE + " — FORNECEDORES DO ITEM E OFERTAS DO LEGADO (campos da relação Item × Fornecedor e da oferta; "
    "preço das planilhas de CMV, sem data de cotação: observação histórica, não é compra real)\n" + LEGENDA,
}

PROXIMA_FASE = [
    ("Devolução", "A Veridi confere a aba DADOS, corrige o que precisar e muda STATUS_REVISAO: OK (entra na carga), "
     "PENDENTE (falta resolver) ou NAO_IMPORTAR (fica fora). Não apagar linhas, não alterar CHAVE_MIGRACAO nem "
     "colunas cinza. Pendências com IMPEDE_CARGA = SIM precisam estar resolvidas antes do OK."),
    ("Validação", "python scripts/veridi-migration-pack/validar_pacote.py <pasta> --devolucao — confere abas, "
     "chaves, obrigatórios, listas, unidades e relações entre os arquivos."),
    ("Carga (outra etapa)", "PROD-MASTER-MIGRATION-APPLY-01: só registros OK; validar → PLAN → relatório de "
     "diferenças → aprovação do PO → backup de produção → APPLY → verify. Nenhuma escrita em produção acontece "
     "neste pacote."),
]

CODIGO_PRODUCAO = (
    "Todos os registros trazem código previsto = 'GERADO NA CARGA'. O importador gera o código real "
    "(CLI-000001, FOR-000001, MP-000001, ME-000001, PA-000001, PROD-000001) pela sequence do banco, só no APPLY; o "
    "PLAN produz apenas marcadores (plan:CLI:13). Num banco vazio a numeração segue a ordem de carga — mas a ordem "
    "e o conjunto final dependem da revisão da Veridi (linhas OK/NAO_IMPORTAR, itens que mudam entre matéria-prima e "
    "embalagem) e do estado das sequences de produção no dia da carga. Prever agora seria inventar: a "
    "CHAVE_MIGRACAO é a referência autoritativa e o mapa chave → código sai do próprio APPLY."
)

# ─────────────────────────── valores permitidos ───────────────────────────

CONTROLE = "não vai para o ERP (controle da revisão)"

CATALOGOS = {
    "STATUS_REVISAO": [
        ("REVISAR", CONTROLE, "A revisar", "Ainda não revisado — todo registro nasce assim e não entra na carga."),
        ("OK", CONTROLE, "Aprovado", "Revisado e aprovado pela Veridi: entra na carga."),
        ("PENDENTE", CONTROLE, "Pendente", "Revisado, mas falta resolver algo — não entra enquanto estiver assim."),
        ("NAO_IMPORTAR", CONTROLE, "Não importar",
         "A Veridi decidiu não migrar o registro (duplicado, obsoleto…). A linha continua no arquivo."),
    ],
    "STATUS_PRECO": [
        ("REVISAR", CONTROLE, "A revisar", "Referência ainda não conferida pela Veridi."),
        ("ACEITA", CONTROLE, "Aceita", "A Veridi aceita a referência (continua sendo só referência, não custo)."),
        ("REJEITADA", CONTROLE, "Rejeitada", "A Veridi descarta a referência."),
    ],
    "SITUACAO_PESQUISA": [
        ("ENCONTRADO", CONTROLE, "Encontrado", "Preço público encontrado e convertido para a unidade de estoque."),
        ("NAO_NORMALIZAVEL", CONTROLE, "Sem conversão",
         "Preço encontrado, mas a unidade da loja (ex.: un) não converte para a unidade de estoque (ex.: kg)."),
        ("SEM_REFERENCIA", CONTROLE, "Sem referência", "Pesquisado, sem correspondência razoável: sem preço."),
        ("PESQUISA_PENDENTE", CONTROLE, "Não pesquisado", "Item ainda sem pesquisa pública de preço."),
    ],
    "STATUS_VALIDACAO": [
        ("REVISAR", CONTROLE, "A revisar", "Situação do registro na geração do pacote (todos começam assim)."),
        ("OK", CONTROLE, "Aprovado", "Aprovado pela Veridi."),
        ("PENDENTE", CONTROLE, "Pendente", "Falta resolver algo."),
        ("NAO_IMPORTAR", CONTROLE, "Não importar", "Fica fora da carga."),
    ],
    "SIM_NAO": [("SIM", "true", "Sim", "Marcado."), ("NÃO", "false", "Não", "Desmarcado.")],
    "TIPO_ITEM": [
        ("MATERIA_PRIMA", "RAW_MATERIAL", "Matéria-prima",
         "Insumo que entra na fórmula (vitamina, mineral, extrato…); em geral controlado em kg."),
        ("EMBALAGEM", "PACKAGING", "Material de embalagem",
         "Pote, tampa, rótulo, selo, sachê, caixa, dosador…; em geral controlado em unidades."),
    ],
    "UNIDADE": [
        ("mg", "mg", "mg — Miligrama", "Massa."),
        ("g", "g", "g — Grama", "Massa."),
        ("kg", "kg", "kg — Quilograma", "Massa — padrão da matéria-prima."),
        ("un", "un", "un — Unidade", "Contagem — padrão de embalagem e de produto acabado."),
        ("mL", "mL", "mL — Mililitro", "Volume."),
        ("L", "L", "L — Litro", "Volume."),
    ],
    "FAMILIA": [
        ("VITAMINA", "VITAMIN", "Vitamina", "Família do CMV 'VITAMINA'."),
        ("MINERAL", "MINERAL", "Mineral", "Família do CMV 'MINERAIS'."),
        ("AMINOACIDO", "AMINO_ACID", "Aminoácido", "Família do CMV 'AMINOÁCIDO'."),
        ("EXCIPIENTE", "EXCIPIENT", "Excipiente", "Família do CMV 'EXCIPIENTE'."),
        ("BOTANICO", "BOTANICAL", "Botânico", "Planta/extrato vegetal (o CMV não usa esta família)."),
        ("OUTRA_MATERIA_PRIMA", "OTHER_RAW_MATERIAL", "Outra matéria-prima",
         "Família do CMV sem equivalente no ERP (SUBT BIOATIVAS, PROTEINAS, FIBRAS…); original em LEGADO_NAO_IMPORTADO."),
        ("EMBALAGEM", "PACKAGING", "Embalagem", "Família do CMV 'Embalagem'."),
        ("OUTRO", "OTHER", "Outro", "Nenhuma das anteriores."),
        ("(vazio)", "null", "Não informada", "Sem família."),
    ],
    "SUBTIPO_EMBALAGEM": [
        ("POTE", "POT", "Pote", "Só para material de embalagem."),
        ("TAMPA", "CAP", "Tampa", "Só para material de embalagem."),
        ("DOSADOR", "SCOOP", "Dosador", "Colher/medidor dosador."),
        ("SELO", "SEAL", "Selo", "Selo/lacre."),
        ("ROTULO", "LABEL", "Rótulo", "Rótulo/etiqueta."),
        ("CAIXA", "BOX", "Caixa", "Só para material de embalagem."),
        ("SACHE_POUCH", "POUCH", "Sachê/Pouch", "Sachê, stand-up pouch, saco."),
        ("CARTUCHO", "CARTON", "Cartucho", "Só para material de embalagem."),
        ("FRASCO", "BOTTLE", "Frasco", "Frasco/garrafa."),
        ("OUTRO", "OTHER", "Outro", "Nenhum dos anteriores."),
        ("(vazio)", "null", "Não informado", "Sem subtipo (sempre vazio para matéria-prima)."),
    ],
    "PERFIL_TRIBUTARIO": [
        ("NAO_INFORMADO", "NOT_INFORMED", "Não informado", "Padrão do sistema. Não calcula imposto."),
        ("MEI", "MEI", "MEI", "Classificação informada pela empresa."),
        ("SIMPLES_NACIONAL", "SIMPLES_NACIONAL", "Simples Nacional", "Classificação informada pela empresa."),
        ("LUCRO_PRESUMIDO", "LUCRO_PRESUMIDO", "Lucro Presumido", "Classificação informada pela empresa."),
        ("LUCRO_REAL", "LUCRO_REAL", "Lucro Real", "Classificação informada pela empresa."),
        ("OUTRO", "OTHER", "Outro", "Classificação informada pela empresa."),
    ],
    "FORMA_FARMACEUTICA": [
        ("CAPSULA", "CAPSULE", "Cápsula", ""), ("PO", "POWDER", "Pó", ""), ("COMPRIMIDO", "TABLET", "Comprimido", ""),
        ("LIQUIDO", "LIQUID", "Líquido", ""), ("OUTRO", "OTHER", "Outro", ""),
        ("(vazio)", "null", "Não informada", ""),
    ],
    "APRESENTACAO": [
        ("POTE", "POT", "Pote", ""), ("SACHE_POUCH", "POUCH", "Sachê/Pouch", ""), ("CARTUCHO", "CARTON", "Cartucho", ""),
        ("GRANEL", "BULK", "Granel", ""), ("FRASCO", "BOTTLE", "Frasco", ""), ("OUTRA", "OTHER", "Outra", ""),
        ("(vazio)", "null", "Não informada", ""),
    ],
    "PUBLICO_ALVO": [
        ("ADULTO", "ADULT", "Adulto", ""), ("INFANTIL", "CHILD", "Infantil", ""), ("GESTANTE", "PREGNANT", "Gestante", ""),
        ("LACTANTE", "LACTATING", "Lactante", ""), ("OUTRO", "OTHER", "Outro", ""),
        ("(vazio)", "null", "Não informado", "Informativo — sem validação regulatória nesta fase."),
    ],
    "HOMOLOGACAO": [
        ("PENDENTE", "PENDING", "Pendente", "Relação sem homologação (a planilha não marca como homologado)."),
        ("HOMOLOGADO", "APPROVED", "Homologado", "A planilha marca o fornecedor como homologado para este item."),
        ("BLOQUEADO", "BLOCKED", "Bloqueado", "Fornecedor bloqueado para este item (decisão da Qualidade)."),
    ],
    "ORIGEM_CUSTO_REFERENCIA": [
        ("OFERTA_FORNECEDOR_LEGADO", CONTROLE, "Oferta do legado", "Mediana das ofertas de fornecedor do arquivo 07."),
        ("PRECO_MERCADO_PUBLICO", CONTROLE, "Preço de mercado", "Mediana dos preços públicos do arquivo 06."),
        ("SEM_REFERENCIA", CONTROLE, "Sem referência", "Nenhum preço utilizável no legado nem na pesquisa."),
        ("INFORMADO_PELA_VERIDI", CONTROLE, "Informado pela Veridi", "Valor digitado ou alterado pela Veridi na revisão."),
    ],
    "UF": [(uf, uf, nome, "Unidade federativa.") for uf, nome in (
        ("AC", "Acre"), ("AL", "Alagoas"), ("AM", "Amazonas"), ("AP", "Amapá"), ("BA", "Bahia"), ("CE", "Ceará"),
        ("DF", "Distrito Federal"), ("ES", "Espírito Santo"), ("GO", "Goiás"), ("MA", "Maranhão"),
        ("MG", "Minas Gerais"), ("MS", "Mato Grosso do Sul"), ("MT", "Mato Grosso"), ("PA", "Pará"),
        ("PB", "Paraíba"), ("PE", "Pernambuco"), ("PI", "Piauí"), ("PR", "Paraná"), ("RJ", "Rio de Janeiro"),
        ("RN", "Rio Grande do Norte"), ("RO", "Rondônia"), ("RR", "Roraima"), ("RS", "Rio Grande do Sul"),
        ("SC", "Santa Catarina"), ("SE", "Sergipe"), ("SP", "São Paulo"), ("TO", "Tocantins"),
    )],
    "CONFIANCA": [
        ("ALTA", CONTROLE, "Alta", "Preço público direto e item claramente equivalente."),
        ("MEDIA", CONTROLE, "Média",
         "Produto comparável, mas marca, grau (P.A., técnico, cosmético) ou apresentação diferente (embalagem fracionada)."),
        ("BAIXA", CONTROLE, "Baixa", "Referência aproximada (outra forma química, produto similar, item de nome genérico)."),
    ],
    "TIPO_FONTE_06": [
        ("PRECO_MERCADO_PUBLICO", "nenhum — não é importado como custo de aquisição", "Preço de mercado público",
         "Preço publicado na internet. Referência para revisão: não é custo real, não é recebimento, não é LAST_REAL."),
    ],
    "TIPO_FONTE_07": [
        ("OFERTA_FORNECEDOR_LEGADO", "SupplierItemOffer (origem LEGACY_IMPORT)", "Oferta de fornecedor do legado",
         "Preço das planilhas de CMV. Sem data de cotação: observação histórica, nunca preço vigente nem compra real."),
    ],
    "MOEDA": [("BRL", "BRL", "Real brasileiro", "Moeda do preço.")],
    "IMPEDE_CARGA": [
        ("SIM", CONTROLE, "Impede", "Precisa ser resolvida (ou o registro marcado NAO_IMPORTAR) antes do OK."),
        ("NÃO", CONTROLE, "Não impede", "Conferência recomendada; o registro pode ir para a carga como está."),
    ],
    "TIPO_ENTIDADE": [
        ("CLIENTE", "Customer", "Cliente", "Arquivo 01."),
        ("FORNECEDOR", "Supplier", "Fornecedor", "Arquivo 02."),
        ("MATERIA_PRIMA", "Item RAW_MATERIAL", "Matéria-prima", "Arquivo 03."),
        ("EMBALAGEM", "Item PACKAGING", "Material de embalagem", "Arquivo 04."),
        ("PRODUTO", "Product", "Produto", "Arquivo 05."),
        ("ITEM_PRODUTO_ACABADO", "Item FINISHED_PRODUCT", "Item de produto acabado", "Arquivo 05 (1:1 com o produto)."),
    ],
}

PROBLEMAS = [
    ("CAMPO_OBRIGATORIO_AUSENTE", "Campo obrigatório ausente", "Campo obrigatório vazio no legado."),
    ("DUPLICIDADE", "Duplicidade",
     "Registro possivelmente repetido (mesmo documento, nome ou código). Nada foi fundido automaticamente."),
    ("UNIDADE_INVALIDA", "Unidade inválida", "Unidade incompatível com o preço ou com o estoque (sem conversão automática)."),
    ("DOCUMENTO_INVALIDO", "Documento inválido", "CNPJ com dígito verificador inválido (o sistema recusa)."),
    ("CLASSIFICACAO_AMBIGUA", "Classificação ambígua",
     "Tipo/classificação não é inequívoco no legado (ex.: a família do CMV diz outra coisa)."),
    ("POSSIVEL_DADO_SINTETICO", "Possível dado sintético", "Texto com sinal de dado de teste/exemplo — validar se é real."),
    ("RELACAO_NAO_ENCONTRADA", "Relação não encontrada", "Referência a cliente, fornecedor ou item que não existe no pacote."),
    ("PRECO_NAO_ENCONTRADO", "Preço não encontrado", "Sem preço (na planilha ou na pesquisa pública)."),
    ("ENDERECO_REVISAR", "Endereço a revisar", "Endereço legado em texto único; a separação em campos ficou incompleta."),
    ("DADO_INCOMPLETO", "Dado incompleto", "Valor provavelmente abreviado ou incompleto."),
    ("ITEM_FORA_DO_CADASTRO", "Item fora do cadastro", "Código que aparece no CMV/preços/fórmulas, mas não no cadastro de itens."),
    ("PRODUTO_SEM_FORMULA_CODIFICADA", "Produto sem fórmula codificada",
     "Produto com fórmula no legado, mas nenhuma linha com código de item."),
    ("PEDIDO_MINIMO_AMBIGUO", "Pedido mínimo ambíguo", "Pedido mínimo em texto que não dá para interpretar com segurança."),
    ("VALOR_INVALIDO", "Valor inválido", "Valor fora da lista permitida ou em conflito com outro campo."),
]


def _catalogo(campo: str, nome: str) -> list[dict]:
    return [
        {"CAMPO": campo, "VALOR": v, "VALOR_TECNICO_ERP": t, "ROTULO_PT": r, "SIGNIFICADO": s}
        for v, t, r, s in CATALOGOS[nome]
    ]


_BLOCOS_ITEM = [
    ("TIPO", "TIPO_ITEM"), ("UNIDADE", "UNIDADE"), ("FAMILIA", "FAMILIA"), ("SUBTIPO_EMBALAGEM", "SUBTIPO_EMBALAGEM"),
    ("CONTROLA_LOTE", "SIM_NAO"), ("CONTROLA_VALIDADE", "SIM_NAO"), ("REQUER_LIBERACAO_QUALIDADE", "SIM_NAO"),
    ("EXIGE_COA_LAUDO", "SIM_NAO"), ("ORIGEM_CUSTO_REFERENCIA", "ORIGEM_CUSTO_REFERENCIA"), ("ATIVO", "SIM_NAO"),
    ("STATUS_REVISAO", "STATUS_REVISAO"),
]


def valores_permitidos(arquivo: str) -> list[dict]:
    blocos = {
        F.MAPA: [("TIPO_ENTIDADE", "TIPO_ENTIDADE"), ("STATUS_VALIDACAO", "STATUS_VALIDACAO")],
        F.CLIENTES: [("PERFIL_TRIBUTARIO", "PERFIL_TRIBUTARIO"), ("UF", "UF"), ("ATIVO", "SIM_NAO"),
                     ("STATUS_REVISAO", "STATUS_REVISAO")],
        F.FORNECEDORES: [("UF", "UF"), ("ATIVO", "SIM_NAO"), ("STATUS_REVISAO", "STATUS_REVISAO")],
        F.MATERIAS_PRIMAS: _BLOCOS_ITEM,
        F.EMBALAGENS: _BLOCOS_ITEM,
        F.PRODUTOS: [("UNIDADE_ESTOQUE", "UNIDADE"), ("EXIGE_COA_LAUDO", "SIM_NAO"),
                     ("FORMA_FARMACEUTICA", "FORMA_FARMACEUTICA"), ("APRESENTACAO", "APRESENTACAO"),
                     ("UNIDADE_DOSE", "UNIDADE"), ("PUBLICO_ALVO", "PUBLICO_ALVO"), ("ATIVO", "SIM_NAO"),
                     ("STATUS_REVISAO", "STATUS_REVISAO")],
        F.PRECOS: [("MOEDA", "MOEDA"), ("UNIDADE_REFERENCIA", "UNIDADE"), ("TIPO_FONTE", "TIPO_FONTE_06"),
                   ("CONFIANCA", "CONFIANCA"), ("SITUACAO_PESQUISA", "SITUACAO_PESQUISA"),
                   ("STATUS_REVISAO", "STATUS_PRECO")],
        F.OFERTAS: [("HOMOLOGACAO", "HOMOLOGACAO"), ("PREFERENCIAL", "SIM_NAO"), ("RELACAO_ATIVA", "SIM_NAO"),
                    ("MOEDA", "MOEDA"), ("UNIDADE_DO_PRECO", "UNIDADE"), ("UNIDADE_PEDIDO_MINIMO", "UNIDADE"),
                    ("TIPO_FONTE", "TIPO_FONTE_07"), ("STATUS_REVISAO", "STATUS_REVISAO")],
    }[arquivo]
    linhas = [linha for campo, nome in blocos for linha in _catalogo(campo, nome)]
    linhas += [
        {"CAMPO": "PENDENCIAS › PROBLEMA", "VALOR": codigo, "VALOR_TECNICO_ERP": CONTROLE, "ROTULO_PT": rotulo,
         "SIGNIFICADO": significado}
        for codigo, rotulo, significado in PROBLEMAS
    ]
    linhas += _catalogo("PENDENCIAS › IMPEDE_CARGA", "IMPEDE_CARGA")
    return linhas


def _valores(nome: str) -> tuple[str, ...]:
    return tuple(v for v, *_ in CATALOGOS[nome] if not v.startswith("("))


# ─────────────────────────── colunas ───────────────────────────


def _chave(formato: str, origem: str) -> Coluna:
    return Coluna(
        "CHAVE_MIGRACAO", "Chave estável do registro na migração. Liga os arquivos entre si.", obrigatorio=True,
        tecnica=True, tipo="Chave", formato=formato, pode_vazio=False, origem=origem,
        observacao="NÃO ALTERAR. Chave de rastreabilidade (de-para da carga); não é o código do ERP.", numero=TEXTO,
        bloqueada=True,
    )


def _codigo_previsto(nome: str, formato: str) -> Coluna:
    return Coluna(
        nome, "Código que o ERP vai gerar para o registro.", tecnica=True, formato=f"{formato} ou GERADO NA CARGA",
        origem="migração", observacao="Só é conhecido na carga (sequence do banco de produção) — ver aba ORIGEM.",
    )


def _status(valores: str = "STATUS_REVISAO") -> Coluna:
    return Coluna(
        "STATUS_REVISAO", "Situação do registro na revisão. Todos começam REVISAR.", obrigatorio=True, tipo="Lista",
        formato="Valor da lista", valores=_valores(valores), pode_vazio=False, origem="controle da revisão",
        observacao="Não vai para o ERP. A Veridi muda depois de conferir; só OK entra na carga.",
    )


def _sim_nao(nome: str, descricao: str, origem: str, observacao: str = "") -> Coluna:
    return Coluna(nome, descricao, tipo="Lista", formato="SIM ou NÃO", valores=_valores("SIM_NAO"), pode_vazio=False,
                  origem=origem, observacao=observacao, largura=12)


def _texto(nome: str, descricao: str, origem: str, **extra) -> Coluna:
    return Coluna(nome, descricao, origem=origem, **extra)


def _cinza(nome: str, descricao: str, origem: str, **extra) -> Coluna:
    return Coluna(nome, descricao, tecnica=True, origem=origem, **extra)


OBS_REVISAO = Coluna(
    "OBSERVACAO_REVISAO", "Anotação livre da Veridi (ex.: chave mantida numa duplicidade).", origem="controle da revisão",
    observacao="Não vai para o ERP.", quebra=True, largura=40,
)

_VAZIO_LEGADO = "vazio — não existe no legado; preencher se souber"
_ENDERECO_MANUAL = "vazio — preenchimento manual na revisão (o legado só tem o nome do fornecedor)"
_ENDERECO_OPCIONAL = "Opcional. O fornecedor pode ser aprovado sem endereço; deixar vazio não gera pendência."


def colunas(arquivo: str) -> list[Coluna]:
    if arquivo == F.MAPA:
        return [
            Coluna("TIPO_ENTIDADE", "Tipo de cadastro.", obrigatorio=True, tecnica=True, tipo="Lista",
                   valores=_valores("TIPO_ENTIDADE"), pode_vazio=False, origem="migração"),
            Coluna("CHAVE_LEGADO", "Código (ou nome, para fornecedor) do registro na planilha original.", obrigatorio=True,
                   tecnica=True, pode_vazio=False, origem="planilha legada", numero=TEXTO),
            Coluna("CHAVE_MIGRACAO", "Chave estável do registro na migração.", obrigatorio=True, tecnica=True,
                   tipo="Chave", formato="CLI-LEG-0000, FOR-LEG-NOME, ITEM-LEG-0000, PROD-LEG-0000PL, PA-LEG-0000PL",
                   pode_vazio=False, origem="migração", observacao="NÃO ALTERAR. Autoritativa entre os arquivos.",
                   numero=TEXTO, bloqueada=True),
            _codigo_previsto("CODIGO_PRODUCAO_PREVISTO", "CLI/FOR/MP/ME/PA/PROD-000000"),
            Coluna("NOME", "Nome para conferência humana.", obrigatorio=True, tecnica=True, pode_vazio=False,
                   origem="planilha legada", quebra=True, largura=45),
            _cinza("FONTE", "Arquivo e linha de origem.", "migração", quebra=True, largura=40),
            Coluna("STATUS_VALIDACAO", "STATUS_REVISAO do registro na geração do pacote (REVISAR para todos).",
                   obrigatorio=True, tecnica=True, tipo="Lista", valores=_valores("STATUS_VALIDACAO"), pode_vazio=False,
                   origem="migração"),
            _cinza("OBSERVACAO", "Códigos das pendências do registro; '(impede)' = impede a carga.", "migração",
                   quebra=True, largura=45),
        ]
    if arquivo == F.CLIENTES:
        return [
            _chave("CLI-LEG-0000", "'CLI-LEG-' + cod_planilha com 4 dígitos"),
            _codigo_previsto("CODIGO_PRODUCAO_PREVISTO", "CLI-000000"),
            _cinza("CODIGO_PLANILHA", "Código do cliente na planilha (vai para 'código externo').",
                   "clientes.csv › cod_planilha", numero=TEXTO),
            Coluna("RAZAO_SOCIAL_NOME", "Tela Cliente › Identificação › Razão Social / Nome.", obrigatorio=True,
                   pode_vazio=False, origem="clientes.csv › razao_social", quebra=True, largura=40),
            _texto("NOME_FANTASIA", "Tela Cliente › Identificação › Nome Fantasia.", "clientes.csv › nome_fantasia",
                   largura=30),
            _texto("CNPJ", "Tela Cliente › Identificação › CNPJ.", "clientes.csv › cnpj_digitos",
                   formato="00.000.000/0000-00 (aceita o formato alfanumérico)",
                   observacao="O sistema recusa CNPJ inválido.", numero=TEXTO, largura=20),
            Coluna("PERFIL_TRIBUTARIO", "Tela Cliente › Identificação › Perfil tributário.", tipo="Lista",
                   valores=_valores("PERFIL_TRIBUTARIO"), origem="padrão do sistema: NAO_INFORMADO (o legado não tem)",
                   observacao="Classificação informada pela empresa. Não calcula imposto.", largura=18),
            _texto("EMAIL", "Tela Cliente › Contato › Email.", _VAZIO_LEGADO, formato="contato@empresa.com.br", largura=28),
            _texto("TELEFONE", "Tela Cliente › Contato › Telefone.", _VAZIO_LEGADO, formato="(11) 99999-8888",
                   numero=TEXTO, largura=16),
            _texto("CEP", "Tela Cliente › Endereço › CEP.", "extraído do endereço da planilha só quando rotulado 'CEP'",
                   formato="00000-000", numero=TEXTO, largura=11),
            _texto("LOGRADOURO", "Tela Cliente › Endereço › Logradouro.",
                   "derivado do endereço da planilha (regra conservadora do importador)", quebra=True, largura=32),
            _texto("NUMERO", "Tela Cliente › Endereço › Número.", "derivado do endereço da planilha", numero=TEXTO,
                   largura=10),
            _texto("COMPLEMENTO", "Tela Cliente › Endereço › Complemento.",
                   "não separado automaticamente — ver endereço original em NOTAS_INTERNAS", largura=16),
            _texto("BAIRRO", "Tela Cliente › Endereço › Bairro.", "derivado do endereço (só quando rotulado 'bairro')",
                   largura=22),
            _texto("CIDADE", "Tela Cliente › Endereço › Cidade.", "clientes.csv › cidade", largura=22),
            Coluna("UF", "Tela Cliente › Endereço › UF.", tipo="Lista", formato="2 letras", valores=_valores("UF"),
                   origem="clientes.csv › uf", largura=8),
            _texto("NOTAS_INTERNAS", "Tela Cliente › Observações › Notas internas.",
                   "começa com o endereço original da planilha (como o importador faz)", quebra=True, largura=45),
            _sim_nao("ATIVO", "Tela Cliente › Status (Ativo/Inativo).", "padrão do sistema: SIM"),
            _status(),
            OBS_REVISAO,
        ]
    if arquivo == F.FORNECEDORES:
        return [
            _chave("FOR-LEG-NOME-NORMALIZADO", "'FOR-LEG-' + nome da planilha sem acento, maiúsculo, espaços → '-'"),
            _codigo_previsto("CODIGO_PRODUCAO_PREVISTO", "FOR-000000"),
            _cinza("NOME_PLANILHA", "Nome do fornecedor como está na planilha.", "fornecedores.csv › nome_fornecedor",
                   largura=30),
            Coluna("RAZAO_SOCIAL_NOME", "Tela Fornecedor › Identificação › Razão Social / Nome.", obrigatorio=True,
                   pode_vazio=False, origem="fornecedores.csv › nome_fornecedor (o legado só tem o nome)",
                   observacao="Veio igual ao nome da planilha; completar se souber a razão social.", largura=36),
            _texto("NOME_FANTASIA", "Tela Fornecedor › Identificação › Nome Fantasia.", _VAZIO_LEGADO, largura=24),
            _texto("CNPJ", "Tela Fornecedor › Identificação › CNPJ.", _VAZIO_LEGADO, formato="00.000.000/0000-00",
                   numero=TEXTO, largura=20),
            _texto("EMAIL", "Tela Fornecedor › Contato › Email.", _VAZIO_LEGADO, formato="contato@empresa.com.br",
                   largura=28),
            _texto("TELEFONE", "Tela Fornecedor › Contato › Telefone.", _VAZIO_LEGADO, formato="(11) 99999-8888",
                   numero=TEXTO, largura=16),
            _texto("CEP", "Tela Fornecedor › Endereço › CEP.", _ENDERECO_MANUAL, formato="00000-000",
                   observacao=_ENDERECO_OPCIONAL + " Quando preenchido, precisa ter 8 dígitos.", numero=TEXTO,
                   largura=11),
            _texto("LOGRADOURO", "Tela Fornecedor › Endereço › Logradouro (rua, avenida, rodovia…).",
                   _ENDERECO_MANUAL, observacao=_ENDERECO_OPCIONAL, quebra=True, largura=32),
            _texto("NUMERO", "Tela Fornecedor › Endereço › Número.", _ENDERECO_MANUAL,
                   observacao=_ENDERECO_OPCIONAL, numero=TEXTO, largura=10),
            _texto("COMPLEMENTO", "Tela Fornecedor › Endereço › Complemento (sala, galpão, bloco…).",
                   _ENDERECO_MANUAL, observacao=_ENDERECO_OPCIONAL, largura=16),
            _texto("BAIRRO", "Tela Fornecedor › Endereço › Bairro.", _ENDERECO_MANUAL,
                   observacao=_ENDERECO_OPCIONAL, largura=22),
            _texto("CIDADE", "Tela Fornecedor › Endereço › Cidade.", _ENDERECO_MANUAL,
                   observacao=_ENDERECO_OPCIONAL, largura=22),
            Coluna("UF", "Tela Fornecedor › Endereço › UF (sigla do estado).", tipo="Lista", formato="2 letras",
                   valores=_valores("UF"), origem=_ENDERECO_MANUAL,
                   observacao=_ENDERECO_OPCIONAL + " Quando preenchida, precisa ser uma das siglas da lista.",
                   largura=8),
            _texto("NOTAS_INTERNAS", "Tela Fornecedor › Observações › Notas internas.", _VAZIO_LEGADO, quebra=True,
                   largura=36),
            _sim_nao("ATIVO", "Tela Fornecedor › Status (Ativo/Inativo).", "padrão do sistema: SIM"),
            _cinza("ITENS_FORNECIDOS", "Itens com preço deste fornecedor (detalhe no arquivo 07) e compras no legado.",
                   "precos_fornecedores.csv e compras_recebimentos.csv", quebra=True, largura=40),
            _status(),
            OBS_REVISAO,
        ]
    if arquivo in (F.MATERIAS_PRIMAS, F.EMBALAGENS):
        mp = arquivo == F.MATERIAS_PRIMAS
        return [
            _chave("ITEM-LEG-0000", "'ITEM-LEG-' + cod_planilha com 4 dígitos (a mesma para MP e embalagem)"),
            _codigo_previsto("CODIGO_PRODUCAO_PREVISTO", "MP-000000" if mp else "ME-000000"),
            _cinza("CODIGO_PLANILHA", "Código do item na planilha (vai para 'código externo').",
                   "itens.csv › cod_planilha (ou itens_enriquecimento/precos_fornecedores › cod_item)", numero=TEXTO),
            Coluna("TIPO", "Tela Item › Identificação › Tipo.", obrigatorio=True, tipo="Lista",
                   valores=_valores("TIPO_ITEM"), pode_vazio=False,
                   origem="itens.csv › tipo_sugerido (classificação feita por nome na extração)",
                   observacao="O tipo informado aqui é o que vale, mesmo que a linha fique neste arquivo.", largura=16),
            Coluna("UNIDADE", "Tela Item › Identificação › Unidade (unidade de estoque).", obrigatorio=True, tipo="Lista",
                   valores=tuple(R.UNIDADES), pode_vazio=False,
                   origem="regra do importador: matéria-prima = kg, embalagem = un",
                   observacao="Catálogo oficial: mg, g, kg, un, mL, L. Não há conversão automática entre massa e unidade.",
                   largura=11),
            Coluna("NOME", "Tela Item › Identificação › Nome.", obrigatorio=True, pode_vazio=False,
                   origem="itens.csv › materia_prima_fonte", quebra=True, largura=45),
            _texto("FONTE", "Tela Item › Classificação industrial › Fonte (forma química usada).",
                   "itens.csv › materia_prima_fonte (matéria-prima; embalagem fica vazio)", quebra=True, largura=36),
            _texto("NUTRIENTE_DECLARADO", "Tela Item › Classificação industrial › Nutriente declarado.",
                   "itens.csv › nutriente_declarado", largura=24),
            Coluna("FAMILIA", "Tela Item › Classificação industrial › Família.", tipo="Lista", valores=_valores("FAMILIA"),
                   origem="itens_enriquecimento.csv › familia (convertida para a lista do ERP)",
                   observacao="Vazio = Não informada.", largura=20),
            Coluna("PUREZA_PADRAO", "Tela Item › Classificação industrial › Pureza padrão (%).", tipo="Percentual",
                   formato="percentual (ex.: 98,5%)", origem="itens_enriquecimento.csv › grau_pureza (0–1)",
                   observacao="Vazio = pureza desconhecida — nunca 100%.", numero=PERCENTUAL,
                   validacao_numero="fracao", largura=12),
            Coluna("SUBTIPO_EMBALAGEM", "Tela Item › Classificação industrial › Subtipo de embalagem.", tipo="Lista",
                   valores=_valores("SUBTIPO_EMBALAGEM"),
                   origem="sugerido pela primeira palavra do nome (pote, tampa, rótulo…) — conferir",
                   observacao="Só para material de embalagem; vazio = Não informado.", largura=16),
            _sim_nao("CONTROLA_LOTE", "Tela Item › Controles de rastreabilidade › Controla lote.",
                     "padrão do sistema por tipo: SIM"),
            _sim_nao("CONTROLA_VALIDADE", "Tela Item › Controles de rastreabilidade › Controla validade.",
                     "padrão do sistema por tipo: matéria-prima SIM, embalagem NÃO"),
            _sim_nao("REQUER_LIBERACAO_QUALIDADE", "Tela Item › Controles de rastreabilidade › Requer liberação da Qualidade.",
                     "padrão do sistema por tipo: matéria-prima SIM, embalagem NÃO"),
            _sim_nao("EXIGE_COA_LAUDO", "Tela Item › Controles de rastreabilidade › Exige CoA / Laudo.",
                     "padrão do sistema: NÃO"),
            _texto("BARCODE_EXTERNO", "Tela Item › Códigos › Barcode externo (código de barras do fornecedor).",
                   _VAZIO_LEGADO, numero=TEXTO, largura=16),
            Coluna("CUSTO_REFERENCIA", "Tela Item › Custo de referência › valor (R$ por unidade do item).", tipo="Moeda",
                   formato="R$ por UNIDADE do item",
                   origem="mediana das ofertas do legado (07); sem oferta utilizável, mediana dos preços públicos (06)",
                   observacao="Estimativa (referência manual), NÃO é custo real de compra. Vazio = Não informado.",
                   numero=MOEDA_PRECISA, validacao_numero="nao_negativo", largura=15),
            Coluna("ORIGEM_CUSTO_REFERENCIA", "De onde veio o custo de referência.", tipo="Lista",
                   valores=_valores("ORIGEM_CUSTO_REFERENCIA"), origem="migração",
                   observacao="Se a Veridi alterar o valor, marcar INFORMADO_PELA_VERIDI.", largura=24),
            _texto("OBSERVACAO_REFERENCIA", "Tela Item › Custo de referência › Observação da referência.",
                   "migração (a conta feita, com todos os valores)", quebra=True, largura=45),
            _cinza("FORNECEDORES_E_PRECOS_LEGADO", "Todos os fornecedores e preços do item no legado (detalhe no 07).",
                   "arquivo 07 (precos_fornecedores.csv)", quebra=True, largura=55),
            _cinza("PRECOS_DE_MERCADO", "Todos os preços públicos do item (detalhe no 06).",
                   "arquivo 06 (pesquisa pública)", quebra=True, largura=55),
            _sim_nao("ATIVO", "Tela Item › Status (Ativo/Inativo).", "padrão do sistema: SIM"),
            _cinza("ONDE_APARECE_NO_LEGADO", "Em que planilha o item existe.", "migração", quebra=True, largura=26),
            _status(),
            OBS_REVISAO,
        ]
    if arquivo == F.PRODUTOS:
        return [
            Coluna("CHAVE_MIGRACAO", "Chave do Produto (CHAVE_PRODUTO).", obrigatorio=True, tecnica=True, tipo="Chave",
                   formato="PROD-LEG-<código>", pode_vazio=False, origem="'PROD-LEG-' + cod_produto",
                   observacao="NÃO ALTERAR. Chave de rastreabilidade (de-para da carga).", numero=TEXTO,
                   bloqueada=True),
            _codigo_previsto("CODIGO_PRODUTO_PREVISTO", "PROD-000000"),
            Coluna("CHAVE_CLIENTE", "Tela Produto › Identificação › Cliente (chave do arquivo 01).", obrigatorio=True,
                   tipo="Lista", lista="CLIENTES", pode_vazio=False, formato="CLI-LEG-0000",
                   origem="projetos.csv › cod_cliente",
                   observacao="A tela exige cliente. A chave manda; o nome ao lado é só conferência.", numero=TEXTO,
                   largura=16),
            _cinza("CLIENTE", "Nome do cliente, só para conferência.", "01_CLIENTES", largura=26),
            Coluna("NOME_PRODUTO", "Tela Produto › Identificação › Nome (também é o nome do item de produto acabado).",
                   obrigatorio=True, pode_vazio=False, origem="projetos.csv › produto", quebra=True, largura=45),
            _texto("REFERENCIA_EXTERNA", "Tela Produto › Identificação › Referência externa.",
                   "formulacoes.csv / projetos.csv › cod_produto (código legado)", numero=TEXTO, largura=14),
            Coluna("CHAVE_ITEM_PA", "Item de produto acabado — exatamente um por produto.", obrigatorio=True,
                   tecnica=True, tipo="Chave", formato="PA-LEG-<código>", pode_vazio=False,
                   origem="'PA-LEG-' + cod_produto", observacao="Regra 1:1 Produto ↔ Item de produto acabado.",
                   numero=TEXTO),
            _codigo_previsto("CODIGO_PA_PREVISTO", "PA-000000"),
            Coluna("UNIDADE_ESTOQUE", "Tela Produto › Produto acabado / estoque › Unidade de estoque.", obrigatorio=True,
                   tipo="Lista", valores=tuple(R.UNIDADES), pode_vazio=False,
                   origem="padrão da tela: un (o legado conta o lote em unidades)", largura=11),
            _sim_nao("EXIGE_COA_LAUDO", "Tela Produto › Produto acabado / estoque › Exige CoA / Laudo.",
                     "padrão do sistema: NÃO"),
            Coluna("FORMA_FARMACEUTICA", "Tela Produto › Perfil do produto › Forma farmacêutica.", tipo="Lista",
                   valores=_valores("FORMA_FARMACEUTICA"), origem=_VAZIO_LEGADO, largura=16),
            Coluna("APRESENTACAO", "Tela Produto › Perfil do produto › Apresentação.", tipo="Lista",
                   valores=_valores("APRESENTACAO"), origem=_VAZIO_LEGADO, largura=14),
            Coluna("CAPSULAS_POR_DOSE", "Tela Produto › Dose e apresentação › Cápsulas por dose.", tipo="Inteiro",
                   formato="número inteiro", origem=_VAZIO_LEGADO, numero="0", validacao_numero="inteiro_positivo",
                   largura=11),
            Coluna("DOSE", "Tela Produto › Dose e apresentação › Dose.", tipo="Número", formato="ex.: 500",
                   origem=_VAZIO_LEGADO, validacao_numero="positivo", largura=10),
            Coluna("UNIDADE_DOSE", "Tela Produto › Dose e apresentação › Unidade da dose.", tipo="Lista",
                   valores=tuple(R.UNIDADES), origem=_VAZIO_LEGADO, largura=10),
            Coluna("DOSES_POR_EMBALAGEM", "Tela Produto › Dose e apresentação › Doses por embalagem.", tipo="Inteiro",
                   formato="número inteiro", origem=_VAZIO_LEGADO, numero="0", validacao_numero="inteiro_positivo",
                   largura=11),
            Coluna("UNIDADES_POR_CAIXA", "Tela Produto › Dose e apresentação › Unidades por caixa.", tipo="Inteiro",
                   formato="número inteiro", origem=_VAZIO_LEGADO, numero="0", validacao_numero="inteiro_positivo",
                   largura=11),
            Coluna("PUBLICO_ALVO", "Tela Produto › Industrial › Público-alvo.", tipo="Lista",
                   valores=_valores("PUBLICO_ALVO"), origem=_VAZIO_LEGADO,
                   observacao="Informativo — sem validação regulatória nesta fase.", largura=12),
            Coluna("VIDA_UTIL_MESES", "Tela Produto › Industrial › Vida útil (meses).", tipo="Inteiro",
                   formato="número inteiro", origem=_VAZIO_LEGADO, numero="0", validacao_numero="inteiro_positivo",
                   largura=11),
            Coluna("LOTE_MINIMO", "Tela Produto › Industrial › Lote mínimo.", tipo="Número",
                   formato="na unidade do item de produto acabado", origem=_VAZIO_LEGADO, validacao_numero="positivo",
                   largura=11),
            _texto("NOTAS_INTERNAS", "Tela Produto › Observações › Notas internas.", _VAZIO_LEGADO, quebra=True,
                   largura=36),
            _sim_nao("ATIVO", "Tela Produto › Status (Ativo/Inativo).", "padrão do sistema: SIM"),
            _status(),
            OBS_REVISAO,
        ]
    if arquivo == F.PRECOS:
        return [
            _chave("REF-XXXXXXXXXXXX", "hash de item, URL, preço e embalagem (ou item + situação)"),
            Coluna("CHAVE_ITEM", "Item (chave dos arquivos 03/04).", obrigatorio=True, tecnica=True, tipo="Chave",
                   pode_vazio=False, origem="03/04", numero=TEXTO),
            _codigo_previsto("CODIGO_ITEM_PREVISTO", "MP/ME-000000"),
            _cinza("ITEM", "Nome do item, para conferência.", "03/04", quebra=True, largura=36),
            _cinza("TIPO_ITEM", "Tipo do item.", "03/04", largura=15),
            _cinza("UNIDADE_ESTOQUE", "Unidade de estoque do item.", "03/04", largura=10),
            Coluna("PRECO_PUBLICADO", "Preço exibido pela loja para a embalagem pesquisada.", tipo="Moeda",
                   formato="R$ 0,00", origem="pesquisa pública", numero=MOEDA, validacao_numero="positivo", largura=14),
            Coluna("MOEDA", "Moeda do preço.", tipo="Lista", valores=("BRL",), origem="pesquisa pública", largura=8),
            Coluna("QUANTIDADE_REFERENCIA", "Quantidade da embalagem vendida por aquele preço.", tipo="Número",
                   origem="pesquisa pública", validacao_numero="positivo", largura=12),
            Coluna("UNIDADE_REFERENCIA", "Unidade da quantidade de referência.", tipo="Lista",
                   valores=tuple(R.UNIDADES), origem="pesquisa pública", largura=11),
            Coluna("PRECO_NORMALIZADO_POR_UNIDADE_ESTOQUE", "Preço convertido para a unidade de estoque do item.",
                   tecnica=True, tipo="Moeda", formato="R$ por unidade de estoque",
                   origem="calculado (Decimal) — ver MEMORIA_CALCULO", numero=MOEDA_PRECISA, largura=16,
                   observacao="Recalculado na próxima etapa se preço, quantidade ou unidade forem corrigidos."),
            _cinza("MEMORIA_CALCULO", "A conta feita, com a quantidade-base explícita.", "calculado", quebra=True,
                   largura=38),
            Coluna("TIPO_FONTE", "Natureza da fonte.", obrigatorio=True, tipo="Lista", valores=("PRECO_MERCADO_PUBLICO",),
                   pode_vazio=False, origem="migração", observacao="Nunca custo real de compra.", largura=24),
            _texto("FORNECEDOR_OU_SITE", "Loja, distribuidor ou fabricante que publicou o preço.", "pesquisa pública",
                   quebra=True, largura=26),
            _texto("URL_OU_DOCUMENTO", "Página onde o preço foi visto.", "pesquisa pública", quebra=True, largura=45),
            Coluna("DATA_DA_PESQUISA", "Dia da consulta.", tipo="Data", formato="dd/mm/aaaa", origem="pesquisa pública",
                   numero=DATA, largura=12),
            Coluna("CONFIANCA", "Quão equivalente é a referência (critério na aba ORIGEM).", tipo="Lista",
                   valores=_valores("CONFIANCA"), origem="classificação da migração", largura=11),
            Coluna("SITUACAO_PESQUISA", "Resultado da pesquisa para o item.", tecnica=True, tipo="Lista",
                   valores=_valores("SITUACAO_PESQUISA"), pode_vazio=False, origem="migração", largura=18),
            _status("STATUS_PRECO"),
            _texto("OBSERVACAO", "Apresentação, grau, equivalência, evidência e ofertas do legado (07).",
                   "pesquisa pública / migração", quebra=True, largura=60),
        ]
    if arquivo == F.OFERTAS:
        par = "Campo da relação item × fornecedor: repetir o mesmo valor em todas as linhas do par."
        return [
            _chave("OFE-LEG-XXXXXXXXXXXX", "12 primeiros caracteres da chave de idempotência do importador"),
            Coluna("CHAVE_ITEM", "Relação › Item (chave dos arquivos 03/04).", obrigatorio=True, tipo="Lista",
                   lista="ITENS", pode_vazio=False, origem="precos_fornecedores.csv › cod_item", numero=TEXTO, largura=15),
            _cinza("ITEM", "Nome do item, só para conferência.", "03/04", quebra=True, largura=34),
            _codigo_previsto("CODIGO_ITEM_PREVISTO", "MP/ME-000000"),
            _cinza("TIPO_ITEM", "Tipo do item.", "03/04", largura=15),
            _cinza("UNIDADE_ITEM", "Unidade de estoque do item.", "03/04", largura=10),
            Coluna("CHAVE_FORNECEDOR", "Relação › Fornecedor (chave do arquivo 02).", obrigatorio=True, tipo="Lista",
                   lista="FORNECEDORES", pode_vazio=False, origem="precos_fornecedores.csv › fornecedor",
                   numero=TEXTO, largura=26),
            _cinza("FORNECEDOR", "Nome do fornecedor, só para conferência.", "02_FORNECEDORES", largura=24),
            _texto("CODIGO_DO_ITEM_NO_FORNECEDOR", "Relação › Código do item no fornecedor.", _VAZIO_LEGADO,
                   observacao=par, numero=TEXTO, largura=16),
            _texto("OBSERVACOES_COMERCIAIS", "Relação › Observações comerciais.", _VAZIO_LEGADO, observacao=par,
                   quebra=True, largura=28),
            Coluna("HOMOLOGACAO", "Homologação › Situação.", tipo="Lista", valores=_valores("HOMOLOGACAO"),
                   pode_vazio=False, origem="precos_fornecedores.csv › homologado (SIM em qualquer linha do par)",
                   observacao=par, largura=13),
            _texto("OBSERVACAO_DA_DECISAO", "Homologação › Observação da decisão.",
                   "migração (quando a planilha marca homologado)", observacao=par, quebra=True, largura=30),
            _sim_nao("PREFERENCIAL", "Homologação › Fornecedor preferencial deste item.", "padrão do sistema: NÃO",
                     observacao="Só com HOMOLOGADO e no máximo um por item. 'melhor_preco' do CMV não é preferência. "
                     + par),
            _sim_nao("RELACAO_ATIVA", "Relação ativa (Inativar/Reativar relação).", "padrão do sistema: SIM",
                     observacao=par),
            Coluna("PRECO", "Oferta › Preço.", tipo="Moeda", formato="R$ 0,00",
                   origem="precos_fornecedores.csv › preco_brl_kg", numero=MOEDA, validacao_numero="nao_negativo",
                   observacao="Zero veio da planilha como está (provável célula não preenchida) e virou pendência.",
                   largura=13),
            Coluna("MOEDA", "Oferta › Moeda.", tipo="Lista", valores=("BRL",), origem="precos_fornecedores.csv", largura=8),
            Coluna("UNIDADE_DO_PRECO", "Oferta › Unidade do preço.", tipo="Lista", valores=tuple(R.UNIDADES),
                   origem="cabeçalho preco_brl_kg (R$/kg)",
                   observacao="Mudar só se o preço não for por kg (ex.: embalagem por unidade).", largura=11),
            Coluna("PEDIDO_MINIMO", "Oferta › Pedido mínimo.", tipo="Número",
                   origem="precos_fornecedores.csv › pedido_minimo (interpretado)", validacao_numero="positivo",
                   largura=12),
            Coluna("UNIDADE_PEDIDO_MINIMO", "Oferta › Unidade do pedido mínimo.", tipo="Lista", valores=tuple(R.UNIDADES),
                   origem="pedido_minimo; número sem unidade = unidade do item (regra do importador)", largura=11),
            _cinza("PEDIDO_MINIMO_PLANILHA", "Pedido mínimo como está na planilha.",
                   "precos_fornecedores.csv › pedido_minimo", numero=TEXTO, largura=14),
            Coluna("VALIDA_A_PARTIR_DE", "Oferta › Válida a partir de.", tipo="Data", formato="dd/mm/aaaa",
                   origem="vazio — o legado não tem data de cotação",
                   observacao="Vazio = observação histórica (nunca preço vigente). Preencher só com data real da cotação.",
                   numero=DATA, largura=12),
            Coluna("VALIDADE", "Oferta › Validade.", tipo="Data", formato="dd/mm/aaaa", origem=_VAZIO_LEGADO,
                   numero=DATA, largura=12),
            _texto("OBSERVACAO_DA_OFERTA", "Oferta › Observação.",
                   "nome do material como está na linha de preço do CMV (como o importador faz)", quebra=True, largura=30),
            Coluna("TIPO_FONTE", "Natureza da fonte.", obrigatorio=True, tipo="Lista",
                   valores=("OFERTA_FORNECEDOR_LEGADO",), pode_vazio=False, origem="migração", largura=26),
            _status(),
            OBS_REVISAO,
        ]
    raise KeyError(arquivo)


def colunas_pendencias(com_arquivo: bool) -> list[Coluna]:
    cols = [
        Coluna("CHAVE_MIGRACAO", "Registro com problema (chave da aba DADOS).", obrigatorio=True, tecnica=True,
               numero=TEXTO, largura=22),
        Coluna("REGISTRO", "Nome do registro, para localizar.", tecnica=True, quebra=True, largura=34),
        Coluna("PROBLEMA", "Código do problema (lista na aba VALORES_PERMITIDOS).", obrigatorio=True, tecnica=True,
               largura=26),
        Coluna("VALOR_ATUAL", "O que está no legado hoje.", tecnica=True, quebra=True, largura=60),
        Coluna("ACAO_ESPERADA_DO_USUARIO", "O que a Veridi precisa fazer.", tecnica=True, quebra=True, largura=50),
        Coluna("IMPEDE_CARGA", "SIM = resolver antes de marcar o registro OK (ou marcar NAO_IMPORTAR).", obrigatorio=True,
               tecnica=True, largura=10),
    ]
    if com_arquivo:
        cols.insert(0, Coluna("ARQUIVO", "Arquivo onde o registro está.", obrigatorio=True, tecnica=True, largura=26))
    return cols


COLUNAS_LEGADO = [
    Coluna("CHAVE_MIGRACAO", "Registro a que a informação pertence (quando existe chave).", tecnica=True, numero=TEXTO,
           largura=24),
    Coluna("CAMPO", "Campo do legado.", tecnica=True, largura=30),
    Coluna("VALOR", "Valor como está no legado.", tecnica=True, quebra=True, largura=55),
    Coluna("FONTE", "Arquivo (e linha) de origem.", tecnica=True, quebra=True, largura=34),
    Coluna("MOTIVO_NAO_IMPORTACAO", "Por que não entra na carga.", tecnica=True, quebra=True, largura=60),
]

COLUNAS_DICIONARIO = [
    Coluna("COLUNA", "Nome da coluna.", largura=30),
    Coluna("DESCRICAO", "O que a coluna guarda (e onde fica na tela do ERP).", quebra=True, largura=48),
    Coluna("OBRIGATORIO", "SIM = obrigatória para a migração.", largura=12),
    Coluna("TIPO", "Tipo do conteúdo.", largura=11),
    Coluna("FORMATO", "Como preencher.", quebra=True, largura=26),
    Coluna("VALORES_PERMITIDOS", "Lista fechada, quando houver.", quebra=True, largura=34),
    Coluna("PODE_FICAR_VAZIO", "SIM/NÃO.", largura=12),
    Coluna("ORIGEM", "De onde o valor vem.", quebra=True, largura=36),
    Coluna("OBSERVACAO", "Cuidados.", quebra=True, largura=45),
]

COLUNAS_VALORES = [
    Coluna("CAMPO", "Coluna que usa o valor.", largura=26),
    Coluna("VALOR", "Valor que aparece na planilha.", largura=26),
    Coluna("VALOR_TECNICO_ERP", "Valor gravado no ERP.", quebra=True, largura=30),
    Coluna("ROTULO_PT", "Rótulo em português (como na tela).", largura=26),
    Coluna("SIGNIFICADO", "Significado.", quebra=True, largura=70),
]

COLUNAS_ORIGEM = [
    Coluna("SECAO", "Assunto.", largura=20),
    Coluna("ITEM", "Arquivo, regra ou campo.", quebra=True, largura=38),
    Coluna("DETALHE", "Detalhe.", quebra=True, largura=110),
]


def linhas_dicionario(cols: list[Coluna], prefixo: str = "") -> list[dict]:
    return [
        {
            "COLUNA": prefixo + c.nome,
            "DESCRICAO": c.descricao + (" (coluna técnica: não editar)" if c.tecnica and not prefixo else ""),
            "OBRIGATORIO": "SIM" if c.obrigatorio else "NÃO",
            "TIPO": c.tipo,
            "FORMATO": c.formato,
            "VALORES_PERMITIDOS": c.valores_permitidos(),
            "PODE_FICAR_VAZIO": "SIM" if c.pode_vazio else "NÃO",
            "ORIGEM": c.origem or "migração",
            "OBSERVACAO": c.observacao,
        }
        for c in cols
    ]


# ─────────────────────────── textos da aba ORIGEM ───────────────────────────

CHAVES = {
    F.MAPA: "Cada entidade tem prefixo próprio: CLI-LEG-0000 (cod_planilha do cliente), FOR-LEG-NOME (nome do "
    "fornecedor normalizado — o legado não tem código de fornecedor), ITEM-LEG-0000 (cod_planilha do item, a mesma "
    "para matéria-prima e embalagem), PROD-LEG-<cód> e PA-LEG-<cód> (cod_produto). Derivadas só do legado: "
    "determinísticas, nunca UUID e nunca código interno do ERP.",
    F.CLIENTES: "CLI-LEG- + cod_planilha com 4 dígitos (clientes.csv).",
    F.FORNECEDORES: "FOR-LEG- + nome da planilha normalizado (sem acento, maiúsculo, espaços viram '-') — a mesma "
    "normalização que o importador usa para casar o fornecedor nas planilhas de preço e compra.",
    F.MATERIAS_PRIMAS: "ITEM-LEG- + código de planilha com 4 dígitos; a mesma chave vale se o item mudar de tipo.",
    F.EMBALAGENS: "ITEM-LEG- + código de planilha com 4 dígitos; a mesma chave vale se o item mudar de tipo.",
    F.PRODUTOS: "PROD-LEG-<cod_produto> para o Produto e PA-LEG-<cod_produto> para o Item de produto acabado (1:1).",
    F.PRECOS: "REF- + hash (item, URL, preço e embalagem); para item sem preço, REF- + hash (item, situação).",
    F.OFERTAS: "OFE-LEG- + 12 caracteres da chave de idempotência do importador (sha256 de item, fornecedor, preço "
    "e pedido mínimo originais) — reimportar não duplica a oferta.",
}

_REGRA_STATUS = ("STATUS_REVISAO", "Todos os registros nascem REVISAR: nada foi aprovado pela geração. A Veridi muda "
                 "para OK, PENDENTE ou NAO_IMPORTAR depois de conferir; só OK entra na carga.")

REGRAS = {
    F.MAPA: [
        ("Conteúdo", "Uma linha por registro candidato dos arquivos 01 a 05: clientes, fornecedores, matérias-primas, "
         "embalagens, produtos e itens de produto acabado. Ofertas (07) e referências de mercado (06) não geram código."),
        ("STATUS_VALIDACAO", "REVISAR para todos na geração; OBSERVACAO lista os códigos das pendências do registro "
         "('(impede)' = impede a carga)."),
    ],
    F.CLIENTES: [
        _REGRA_STATUS,
        ("Campos", "Mesmos campos da tela Cliente, na mesma ordem (Identificação, Contato, Endereço, Observações, Status)."),
        ("Legado", "clientes.csv (aba CAD CLIENTE da PL CONTROLE): código, razão social, nome fantasia, CNPJ, "
         "endereço (texto único), cidade e UF."),
        ("RAZAO_SOCIAL_NOME", "razao_social. Vazia no legado ⇒ vazia + pendência (a decisão é da Veridi)."),
        ("CNPJ", "cnpj_digitos, conferido pelo dígito verificador. Inválido fica como está + pendência — nunca 'corrigido'."),
        ("Endereço", "CEP só quando rotulado 'CEP'. LOGRADOURO, NUMERO e BAIRRO seguem a regra conservadora do "
         "importador (legacy-address.ts). COMPLEMENTO não é separado automaticamente. O endereço original vai para "
         "NOTAS_INTERNAS, como no importador. O que não dá para afirmar fica vazio — nunca 'S/N'."),
        ("Sem dado no legado", "PERFIL_TRIBUTARIO = NAO_INFORMADO e ATIVO = SIM (padrão do sistema); EMAIL e TELEFONE "
         "vazios. Preencha se souber — nada disso é obrigatório."),
        ("Duplicidade", "CNPJ repetido e razão social repetida viram pendência; nada foi fundido."),
    ],
    F.FORNECEDORES: [
        _REGRA_STATUS,
        ("Campos", "Mesmos campos da tela Fornecedor (Identificação, Contato, Endereço, Observações, Status)."),
        ("Legado", "fornecedores.csv (nomes distintos das compras + abas MP dos CMVs): só o nome. RAZAO_SOCIAL_NOME "
         "começa igual ao nome da planilha; os demais campos da tela vêm vazios (ATIVO = SIM). Nada foi inventado."),
        ("Endereço", "CEP, LOGRADOURO, NUMERO, COMPLEMENTO, BAIRRO, CIDADE e UF chegam TODOS VAZIOS e são TODOS "
         "OPCIONAIS. A planilha legada não tem endereço de fornecedor: não foi pesquisado, não foi deduzido e não "
         "foi preenchido automaticamente. A Veridi preenche à mão o que souber, no todo ou em parte. Fornecedor sem "
         "endereço pode ser aprovado normalmente — endereço vazio não é pendência e não impede a carga."),
        ("Endereço — conferência", "Só o que estiver preenchido é conferido: CEP com 8 dígitos (a máscara "
         "00000-000 é aceita) e UF entre as 27 siglas da aba VALORES_PERMITIDOS. Preencher apenas a cidade, "
         "apenas a UF ou qualquer combinação parcial é válido."),
        ("Duplicidade", "Nomes parecidos são apontados (mesmo nome sem espaços ou sem anotação, um contido no outro, "
         "grafia quase igual, palavra própria em comum) com o uso de cada um em preços e compras. Nada foi fundido."),
    ],
    F.MATERIAS_PRIMAS: [
        _REGRA_STATUS,
        ("Campos", "Mesmos campos da tela Item (Identificação, Classificação industrial, Controles de rastreabilidade, "
         "Códigos, Custo de referência, Status), mais o resumo dos fornecedores e preços do item."),
        ("Legado", "Cadastro principal: itens.csv (CAD ITEM da PL CONTROLE + R.PRO.002). Família e pureza: "
         "itens_enriquecimento.csv (CMV › Cadastros)."),
        ("TIPO", "Vem de tipo_sugerido — classificação por nome feita na extração das planilhas (16/08/2026). Conflito "
         "com a família do CMV ou com o nome (inclusive itens em cápsula) vira pendência: nada foi reclassificado em silêncio."),
        ("UNIDADE", "Regra do importador: matéria-prima em kg, embalagem em un. Nenhuma conversão foi inventada."),
        ("FONTE", "Nome da matéria-prima na planilha (como o importador faz); vazio para material de embalagem."),
        ("FAMILIA", "VITAMINA→VITAMINA, MINERAIS→MINERAL, AMINOÁCIDO→AMINOACIDO, EXCIPIENTE→EXCIPIENTE, Embalagem→EMBALAGEM. "
         "Sem equivalente no ERP ⇒ OUTRA_MATERIA_PRIMA, com o texto original em LEGADO_NAO_IMPORTADO. Nota para a "
         "carga: o importador atual não reconhece o plural MINERAIS."),
        ("PUREZA_PADRAO", "grau_pureza (0–1) mostrado em %. '**' e '-' são vazio; potência em UI fica em LEGADO_NAO_IMPORTADO."),
        ("SUBTIPO_EMBALAGEM", "Sugerido pela primeira palavra do nome (pote, tampa, dosador, selo/lacre, rótulo/etiqueta, "
         "caixa, sachê/pouch, cartucho, frasco/garrafa); sem palavra reconhecida, vazio. Conferir."),
        ("Controles de rastreabilidade", "Padrão do sistema por tipo (o mesmo do formulário): matéria-prima controla "
         "lote, validade e liberação = SIM; embalagem lote = SIM, validade e liberação = NÃO; laudo = NÃO."),
        ("CUSTO_REFERENCIA", "Referência manual do item (estimativa — não é custo real de compra). Valor = mediana das "
         "ofertas de fornecedor do legado (07) na unidade do item; sem oferta utilizável, mediana dos preços públicos "
         "(06); sem nenhum, vazio. Oferta 'por kg' em item contado em unidade não entra na conta. Todos os preços do "
         "item estão listados na mesma linha (FORNECEDORES_E_PRECOS_LEGADO e PRECOS_DE_MERCADO). Se a Veridi mudar o "
         "valor, marcar ORIGEM_CUSTO_REFERENCIA = INFORMADO_PELA_VERIDI."),
        ("Itens fora do cadastro", "Códigos que existem só no CMV ou só na planilha de preços entram com pendência "
         "que impede a carga: a Veridi confirma se devem ser cadastrados."),
        ("Materiais sem código", "Linhas de fórmula sem código de item estão em LEGADO_NAO_IMPORTADO."),
    ],
    F.PRODUTOS: [
        _REGRA_STATUS,
        ("Campos", "Mesmos campos da tela Produto (Identificação, Produto acabado / estoque, Perfil do produto, "
         "Dose e apresentação, Industrial, Observações, Status)."),
        ("Conjunto", "Produto acabado = código de produto com fórmula no legado (formulacoes.csv). Nome e cliente vêm "
         "de projetos.csv; REFERENCIA_EXTERNA = código do produto na planilha."),
        ("1:1", "Cada Produto (CHAVE_MIGRACAO, PROD-LEG-…) tem exatamente um Item de produto acabado (CHAVE_ITEM_PA, "
         "PA-LEG-…) com o mesmo nome; o item nasce na carga junto com o produto."),
        ("Cliente", "O do projeto do produto (a tela exige cliente). Todos os produtos do legado têm um; nenhum foi inventado."),
        ("Sem dado no legado", "Perfil, dose e campos industriais vêm vazios: o legado não os liga ao código do produto "
         "(os atributos do CMV, ligados só por nome, estão em LEGADO_NAO_IMPORTADO). UNIDADE_ESTOQUE = un, "
         "EXIGE_COA_LAUDO = NÃO e ATIVO = SIM (padrão da tela)."),
        ("Fora da carga", "Códigos que só existem em projetos.csv (sem fórmula) estão em LEGADO_NAO_IMPORTADO. "
         "Formulações, projetos, orçamentos e amostras migram em etapa própria."),
    ],
    F.PRECOS: [
        ("Natureza", "REFERÊNCIA DE MERCADO PARA REVISÃO. Não é custo real de compra, não é recebimento, não é LAST_REAL "
         "e não será importada como custo de aquisição."),
        ("Status", "SITUACAO_PESQUISA é o resultado da pesquisa; STATUS_REVISAO é a decisão da Veridi (REVISAR → "
         "ACEITA ou REJEITADA)."),
        ("Normalização", "PRECO_PUBLICADO ÷ QUANTIDADE_REFERENCIA, convertido para a UNIDADE_ESTOQUE pelo catálogo de "
         "unidades (mg/g/kg; mL/L; un), em Decimal. Sem conversão entre dimensões. Sem frete, imposto ou desconto "
         "negociado. Preço de loja/varejo não é preço industrial negociado: use como ordem de grandeza."),
        ("CONFIANCA", "ALTA = preço público direto e item claramente equivalente. MEDIA = produto comparável, mas marca, "
         "grau (P.A., técnico, cosmético, ração) ou apresentação diferente (embalagem menor que 1 kg / 1 L / 100 un). "
         "BAIXA = referência aproximada (outra forma química, produto similar ou item de nome genérico). Sem "
         "correspondência razoável: sem preço (SEM_REFERENCIA)."),
        ("Uso", "A mediana dos preços ENCONTRADO de um item vira o custo de referência dele em 03/04 só quando o item "
         "não tem oferta de fornecedor utilizável no 07."),
        ("Ofertas do legado", "Não estão aqui: ficam no arquivo 07 (OFERTA_FORNECEDOR_LEGADO)."),
    ],
    F.OFERTAS: [
        _REGRA_STATUS,
        ("Campos", "Mesmos campos da tela da relação Item × Fornecedor (Relação, Homologação) e da oferta de preço."),
        ("Fonte", "precos_fornecedores.csv (abas MP de 9 arquivos de CMV): uma oferta por linha; preços diferentes "
         "para o mesmo par item × fornecedor são preservados."),
        ("Campos do par", "Código no fornecedor, observações comerciais, homologação, observação da decisão, preferencial "
         "e relação ativa valem para o par item × fornecedor: repetir o mesmo valor em todas as linhas do par."),
        ("Preço", "Coluna preco_brl_kg (R$/kg). O legado não tem data de cotação: VALIDA_A_PARTIR_DE vazia = observação "
         "histórica, nunca preço vigente e nunca compra real."),
        ("Unidade", "Item controlado em unidade com preço 'por kg' fica com pendência que impede a carga: converter kg em "
         "unidade exigiria peso por unidade, que ninguém tem."),
        ("Homologação", "HOMOLOGADO quando a planilha diz SIM em qualquer linha do par; senão PENDENTE (nunca bloqueio)."),
        ("Preferencial", "NÃO para todos: melhor_preco do CMV não é preferência oficial (preservado em LEGADO_NAO_IMPORTADO)."),
        ("Uso", "Estas ofertas formam o custo de referência dos itens em 03/04 (mediana, na unidade do item)."),
    ],
}
REGRAS[F.EMBALAGENS] = REGRAS[F.MATERIAS_PRIMAS]

DEFAULTS = {
    F.MAPA: [],
    F.CLIENTES: [
        ("Perfil tributário", "NAO_INFORMADO (preenchido na planilha; altere se souber)."),
        ("Ativo", "SIM (preenchido na planilha)."),
        ("Situação comercial", "Não é campo: o sistema deriva."),
        ("Sufixo do lote comercial", "Não aparece na tela de cadastro: fica com o padrão do sistema (vazio)."),
    ],
    F.FORNECEDORES: [("Ativo", "SIM (preenchido na planilha).")],
    F.MATERIAS_PRIMAS: [
        ("Controles de rastreabilidade", "Padrão do sistema por tipo, preenchido na planilha (altere se precisar)."),
        ("Ativo", "SIM (preenchido na planilha)."),
    ],
    F.PRODUTOS: [
        ("Ciclo de vida", "APROVADO (não é campo da tela; padrão do sistema para produto legado)."),
        ("Item de produto acabado", "Controla lote, validade e liberação da Qualidade = SIM (padrão do sistema)."),
        ("Unidade de estoque / Exige CoA / Ativo", "un / NÃO / SIM (preenchidos na planilha)."),
    ],
    F.PRECOS: [("Custo do item", "Nada desta planilha vira Receipt ou custo de aquisição; a referência só chega ao item "
                "pelo CUSTO_REFERENCIA de 03/04, quando não há oferta do legado.")],
    F.OFERTAS: [
        ("Preferencial / Relação ativa", "NÃO / SIM (preenchidos na planilha)."),
        ("Vigência da oferta", "Vazia — o legado não tem data; a oferta nunca vira preço vigente sem data informada."),
    ],
}
DEFAULTS[F.EMBALAGENS] = DEFAULTS[F.MATERIAS_PRIMAS]
