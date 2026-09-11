"""
Layout de cada workbook do pacote: colunas da aba DADOS, dicionário, valores
permitidos e os textos fixos das abas ORIGEM.

Regra de conteúdo: só entra coluna que (a) existe no legado, (b) é
indispensável para criar o cadastro ou (c) é chave técnica para relacionar os
arquivos. Campo novo do ERP com padrão seguro fica de fora e é declarado na
seção DEFAULT_DO_SISTEMA da aba ORIGEM.
"""

from __future__ import annotations

import fontes as F
import regras as R
from planilha import DATA, MOEDA, MOEDA_PRECISA, PERCENTUAL, TEXTO, Coluna

AVISO = "NÃO IMPORTAR AINDA — arquivos aguardam validação da Veridi."

LEGENDA = (
    "* Campo obrigatório para migração.   Cabeçalho CINZA = coluna técnica (não editar).   "
    "Colunas com lista: use a seta da célula.   Significado das colunas: aba DICIONARIO.   "
    "O que resolver: aba PENDENCIAS.   STATUS_REVISAO: OK = pronto · REVISAR = conferir, não impede a carga · "
    "PENDENTE = corrigir antes da carga · NAO_IMPORTAR = fica fora (não apagar linhas)."
)

TITULOS = {
    F.MAPA: "MAPA DE CHAVES DA MIGRAÇÃO — uma linha por registro candidato. " + AVISO
    + "  A CHAVE_MIGRACAO é a referência que vale entre os arquivos; o código do ERP só nasce na carga.",
    F.CLIENTES: "CLIENTES — " + AVISO + "\n" + LEGENDA,
    F.FORNECEDORES: "FORNECEDORES — " + AVISO + "\n" + LEGENDA,
    F.MATERIAS_PRIMAS: "MATÉRIAS-PRIMAS — " + AVISO + "\n" + LEGENDA,
    F.EMBALAGENS: "EMBALAGENS E INSUMOS — " + AVISO + "\n" + LEGENDA,
    F.PRODUTOS: "PRODUTOS ACABADOS (Produto ↔ Item de produto acabado, 1:1) — " + AVISO + "\n" + LEGENDA,
    F.PRECOS: "REFERÊNCIA DE MERCADO PARA REVISÃO — preço público de internet. NÃO é custo real de compra, NÃO é "
    "recebimento e NÃO será importado como custo de aquisição. " + AVISO + "\n"
    "Cabeçalho CINZA = coluna técnica (não editar). STATUS_REVISAO: A_REVISAR = preço encontrado, conferir · "
    "NAO_NORMALIZAVEL = unidade da fonte não converte para a do estoque · SEM_REFERENCIA = pesquisado sem "
    "correspondência · PESQUISA_PENDENTE = ainda não pesquisado · ACEITA / REJEITADA = decisão da Veridi.",
    F.OFERTAS: "OFERTAS DE FORNECEDOR DO LEGADO (item × fornecedor × preço) — preço das planilhas de CMV, sem data "
    "de cotação: observação histórica, não é compra real nem preço vigente. " + AVISO + "\n" + LEGENDA,
}

PROXIMA_FASE = [
    ("Devolução", "A Veridi corrige direto na aba DADOS e resolve as PENDENCIAS. Não apagar linhas: para tirar um "
     "registro da carga, usar STATUS_REVISAO = NAO_IMPORTAR. Não alterar CHAVE_MIGRACAO nem colunas cinza."),
    ("Validação", "python scripts/veridi-migration-pack/validar_pacote.py <pasta> — confere abas, chaves, "
     "obrigatórios, listas, unidades e relações entre os arquivos."),
    ("Carga (outra etapa)", "PROD-MASTER-MIGRATION-APPLY-01: validar → PLAN → relatório de diferenças → aprovação do "
     "PO → backup de produção → APPLY → verify. Nenhuma escrita em produção acontece neste pacote."),
]

CODIGO_PRODUCAO = (
    "Todos os registros trazem CODIGO_PRODUCAO_PREVISTO = 'GERADO NA CARGA'. O importador gera o código real "
    "(CLI-000001, FOR-000001, MP-000001, ME-000001, PA-000001, PROD-000001) pela sequence do banco, só no APPLY; o "
    "PLAN produz apenas marcadores (plan:CLI:13). Num banco vazio a numeração segue a ordem de carga — mas a ordem "
    "e o conjunto final dependem das correções da Veridi (linhas marcadas NAO_IMPORTAR, itens que mudam entre "
    "matéria-prima e embalagem) e do estado das sequences de produção no dia da carga. Prever agora seria inventar: "
    "a CHAVE_MIGRACAO é a referência autoritativa e o mapa chave → código sai do próprio APPLY."
)

# ─────────────────────────── valores permitidos ───────────────────────────

CONTROLE = "não vai para o ERP (controle da revisão)"

CATALOGOS = {
    "STATUS_REVISAO": [
        ("OK", CONTROLE, "Pronto", "Pronto para a carga: sem pendência que impeça."),
        ("REVISAR", CONTROLE, "Conferir", "Há pendência que não impede a carga; conferir antes de devolver."),
        ("PENDENTE", CONTROLE, "Corrigir", "Há pendência que impede a carga: corrigir e mudar para OK."),
        ("NAO_IMPORTAR", CONTROLE, "Não importar",
         "A Veridi decidiu não migrar o registro (duplicado, obsoleto…). A linha continua no arquivo."),
    ],
    "STATUS_PRECO": [
        ("A_REVISAR", CONTROLE, "Conferir", "Preço público encontrado e normalizado; aguarda a revisão da Veridi."),
        ("NAO_NORMALIZAVEL", CONTROLE, "Sem conversão",
         "Preço encontrado, mas a unidade da loja (ex.: un) não converte para a unidade de estoque (ex.: kg)."),
        ("SEM_REFERENCIA", CONTROLE, "Sem referência", "Pesquisado, sem correspondência razoável: sem preço."),
        ("PESQUISA_PENDENTE", CONTROLE, "Não pesquisado", "Item ainda sem pesquisa pública de preço."),
        ("ACEITA", CONTROLE, "Aceita", "A Veridi aceita a referência para revisão de custo."),
        ("REJEITADA", CONTROLE, "Rejeitada", "A Veridi descarta a referência."),
    ],
    "STATUS_VALIDACAO": [
        ("OK", CONTROLE, "Pronto", "Sem pendência na geração do pacote."),
        ("REVISAR", CONTROLE, "Conferir", "Há pendência que não impede a carga."),
        ("PENDENTE", CONTROLE, "Corrigir", "Há pendência que impede a carga."),
    ],
    "TIPO_ITEM": [
        ("MATERIA_PRIMA", "RAW_MATERIAL", "Matéria-prima",
         "Insumo que entra na fórmula (vitamina, mineral, extrato…); em geral controlado em kg."),
        ("EMBALAGEM", "PACKAGING", "Embalagem / insumo",
         "Pote, tampa, rótulo, lacre, sachê, caixa, dosador…; em geral controlado em unidades."),
    ],
    "UNIDADE": [
        ("mg", "mg", "Miligrama", "Massa."),
        ("g", "g", "Grama", "Massa."),
        ("kg", "kg", "Quilograma", "Massa — padrão da matéria-prima."),
        ("un", "un", "Unidade", "Contagem — padrão de embalagem e de produto acabado."),
        ("mL", "mL", "Mililitro", "Volume."),
        ("L", "L", "Litro", "Volume."),
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
        ("PRECO_MERCADO_PUBLICO", "nenhum — não é importado como custo", "Preço de mercado público",
         "Preço publicado na internet. Referência para revisão: não é custo real, não é recebimento, não é LAST_REAL."),
    ],
    "TIPO_FONTE_07": [
        ("OFERTA_FORNECEDOR_LEGADO", "SupplierItemOffer (origem LEGACY_IMPORT, sem vigência)",
         "Oferta de fornecedor do legado",
         "Preço das planilhas de CMV, sem data de cotação: observação histórica, nunca preço vigente nem compra real."),
    ],
    "MOEDA": [("BRL", "BRL", "Real brasileiro", "Moeda do preço.")],
    "HOMOLOGADO": [
        ("SIM", "APPROVED", "Homologado", "A planilha marca o fornecedor como homologado para este item."),
        ("NÃO", "PENDING", "Não homologado", "Relação entra como pendente de homologação (nunca como bloqueio)."),
        ("(vazio)", "PENDING", "Não informado", "A planilha não informa; relação entra como pendente de homologação."),
    ],
    "IMPEDE_CARGA": [
        ("SIM", CONTROLE, "Impede", "Precisa ser resolvida (ou o registro marcado NAO_IMPORTAR) antes da carga."),
        ("NÃO", CONTROLE, "Não impede", "Conferência recomendada; o registro pode ser carregado como está."),
    ],
    "TIPO_ENTIDADE": [
        ("CLIENTE", "Customer", "Cliente", "Arquivo 01."),
        ("FORNECEDOR", "Supplier", "Fornecedor", "Arquivo 02."),
        ("MATERIA_PRIMA", "Item RAW_MATERIAL", "Matéria-prima", "Arquivo 03."),
        ("EMBALAGEM", "Item PACKAGING", "Embalagem / insumo", "Arquivo 04."),
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
    ("VALOR_INVALIDO", "Valor inválido", "Valor fora da lista permitida."),
]


def _catalogo(campo: str, nome: str) -> list[dict]:
    return [
        {"CAMPO": campo, "VALOR": v, "VALOR_TECNICO_ERP": t, "ROTULO_PT": r, "SIGNIFICADO": s}
        for v, t, r, s in CATALOGOS[nome]
    ]


def valores_permitidos(arquivo: str) -> list[dict]:
    blocos = {
        F.MAPA: [("TIPO_ENTIDADE", "TIPO_ENTIDADE"), ("STATUS_VALIDACAO", "STATUS_VALIDACAO")],
        F.CLIENTES: [("UF", "UF"), ("STATUS_REVISAO", "STATUS_REVISAO")],
        F.FORNECEDORES: [("STATUS_REVISAO", "STATUS_REVISAO")],
        F.MATERIAS_PRIMAS: [("TIPO_ITEM", "TIPO_ITEM"), ("UNIDADE_ESTOQUE", "UNIDADE"), ("FAMILIA", "FAMILIA"),
                            ("STATUS_REVISAO", "STATUS_REVISAO")],
        F.EMBALAGENS: [("TIPO_ITEM", "TIPO_ITEM"), ("UNIDADE_ESTOQUE", "UNIDADE"), ("STATUS_REVISAO", "STATUS_REVISAO")],
        F.PRODUTOS: [("UNIDADE_PA", "UNIDADE"), ("STATUS_REVISAO", "STATUS_REVISAO")],
        F.PRECOS: [("MOEDA", "MOEDA"), ("UNIDADE_REFERENCIA", "UNIDADE"), ("TIPO_FONTE", "TIPO_FONTE_06"),
                   ("CONFIANCA", "CONFIANCA"), ("STATUS_REVISAO", "STATUS_PRECO")],
        F.OFERTAS: [("MOEDA", "MOEDA"), ("UNIDADE_DO_PRECO", "UNIDADE"), ("HOMOLOGADO_NO_LEGADO", "HOMOLOGADO"),
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
        observacao="Autoritativa. Nunca editar nem apagar. Não é o código do ERP.", numero=TEXTO,
    )


def _codigo_previsto(nome: str, formato: str) -> Coluna:
    return Coluna(
        nome, "Código que o ERP vai gerar para o registro.", tecnica=True, formato=f"{formato} ou GERADO NA CARGA",
        origem="migração", observacao="Só é conhecido na carga (sequence do banco de produção) — ver aba ORIGEM.",
    )


def _status(valores: str = "STATUS_REVISAO") -> Coluna:
    return Coluna(
        "STATUS_REVISAO", "Situação do registro na revisão.", obrigatorio=True, tipo="Lista",
        formato="Valor da lista", valores=_valores(valores), pode_vazio=False, origem="controle da revisão",
        observacao="Não vai para o ERP. Veio preenchido pela geração; a Veridi atualiza.",
    )


OBS_REVISAO = Coluna(
    "OBSERVACAO_REVISAO", "Anotação livre da Veridi (ex.: chave mantida numa duplicidade).", origem="controle da revisão",
    observacao="Não vai para o ERP.", quebra=True, largura=40,
)


def colunas(arquivo: str) -> list[Coluna]:
    if arquivo == F.MAPA:
        return [
            Coluna("TIPO_ENTIDADE", "Tipo de cadastro.", obrigatorio=True, tecnica=True, tipo="Lista",
                   valores=_valores("TIPO_ENTIDADE"), pode_vazio=False, origem="migração"),
            Coluna("CHAVE_LEGADO", "Código (ou nome, para fornecedor) do registro na planilha original.", obrigatorio=True,
                   tecnica=True, pode_vazio=False, origem="planilha legada", numero=TEXTO),
            Coluna("CHAVE_MIGRACAO", "Chave estável do registro na migração.", obrigatorio=True, tecnica=True,
                   tipo="Chave", formato="CLI-LEG-0000, FOR-LEG-NOME, ITEM-LEG-0000, PROD-LEG-0000PL, PA-LEG-0000PL",
                   pode_vazio=False, origem="migração", observacao="Autoritativa entre os arquivos.", numero=TEXTO),
            _codigo_previsto("CODIGO_PRODUCAO_PREVISTO", "CLI/FOR/MP/ME/PA/PROD-000000"),
            Coluna("NOME", "Nome para conferência humana.", obrigatorio=True, tecnica=True, pode_vazio=False,
                   origem="planilha legada", quebra=True, largura=45),
            Coluna("FONTE", "Arquivo e linha de origem.", tecnica=True, origem="migração", quebra=True, largura=40),
            Coluna("STATUS_VALIDACAO", "STATUS_REVISAO do registro na geração do pacote.", obrigatorio=True,
                   tecnica=True, tipo="Lista", valores=_valores("STATUS_VALIDACAO"), pode_vazio=False,
                   origem="migração"),
            Coluna("OBSERVACAO", "Códigos das pendências do registro (detalhe no arquivo do cadastro).", tecnica=True,
                   origem="migração", quebra=True, largura=40),
        ]
    if arquivo == F.CLIENTES:
        return [
            _chave("CLI-LEG-0000", "'CLI-LEG-' + cod_planilha com 4 dígitos"),
            _codigo_previsto("CODIGO_PRODUCAO_PREVISTO", "CLI-000000"),
            Coluna("CODIGO_PLANILHA", "Código do cliente na planilha (vai para 'código externo' no ERP).", tecnica=True,
                   origem="clientes.csv › cod_planilha", numero=TEXTO),
            Coluna("RAZAO_SOCIAL", "Razão social do cliente.", obrigatorio=True, pode_vazio=False,
                   origem="clientes.csv › razao_social", quebra=True, largura=40),
            Coluna("NOME_FANTASIA", "Nome fantasia.", origem="clientes.csv › nome_fantasia", largura=30),
            Coluna("CNPJ", "CNPJ do cliente.", formato="00.000.000/0000-00 (o sistema grava só os dígitos)",
                   origem="clientes.csv › cnpj_digitos", observacao="Validado pelo dígito verificador.", numero=TEXTO,
                   largura=20),
            Coluna("ENDERECO_ORIGINAL", "Endereço como está na planilha (texto único).", tecnica=True,
                   origem="clientes.csv › endereco",
                   observacao="Vai para Observações do cliente, como no importador. Corrija usando as colunas ao lado.",
                   quebra=True, largura=45),
            Coluna("LOGRADOURO", "Rua/avenida.", origem="derivado de endereco (regra conservadora do importador)",
                   quebra=True, largura=32),
            Coluna("NUMERO", "Número do imóvel.", origem="derivado de endereco", numero=TEXTO, largura=10),
            Coluna("COMPLEMENTO", "Sala, loja, apto…", origem="não separado automaticamente — preencher a partir de "
                   "ENDERECO_ORIGINAL, se quiser", largura=16),
            Coluna("BAIRRO", "Bairro.", origem="derivado de endereco (só quando rotulado 'bairro')", largura=22),
            Coluna("CEP", "CEP.", formato="00000-000", origem="extraído de endereco só quando rotulado 'CEP'",
                   numero=TEXTO, largura=11),
            Coluna("CIDADE", "Cidade.", origem="clientes.csv › cidade", largura=22),
            Coluna("UF", "Sigla do estado.", tipo="Lista", formato="2 letras", valores=_valores("UF"),
                   origem="clientes.csv › uf", largura=8),
            _status(),
            OBS_REVISAO,
        ]
    if arquivo == F.FORNECEDORES:
        return [
            _chave("FOR-LEG-NOME-NORMALIZADO", "'FOR-LEG-' + nome da planilha sem acento, maiúsculo, espaços → '-'"),
            _codigo_previsto("CODIGO_PRODUCAO_PREVISTO", "FOR-000000"),
            Coluna("NOME_PLANILHA", "Nome do fornecedor como está na planilha.", tecnica=True,
                   origem="fornecedores.csv › nome_fornecedor", largura=32),
            Coluna("RAZAO_SOCIAL", "Razão social do fornecedor.", obrigatorio=True, pode_vazio=False,
                   origem="fornecedores.csv › nome_fornecedor (o legado só tem o nome)",
                   observacao="Veio igual ao nome da planilha; completar se souber a razão social.", largura=36),
            _status(),
            OBS_REVISAO,
        ]
    if arquivo in (F.MATERIAS_PRIMAS, F.EMBALAGENS):
        mp = arquivo == F.MATERIAS_PRIMAS
        cols = [
            _chave("ITEM-LEG-0000", "'ITEM-LEG-' + cod_planilha com 4 dígitos (a mesma para MP e embalagem)"),
            _codigo_previsto("CODIGO_PRODUCAO_PREVISTO", "MP-000000" if mp else "ME-000000"),
            Coluna("CODIGO_PLANILHA", "Código do item na planilha (vai para 'código externo' no ERP).", tecnica=True,
                   origem="itens.csv › cod_planilha (ou itens_enriquecimento/precos_fornecedores › cod_item)",
                   numero=TEXTO),
            Coluna("DESCRICAO", "Nome do item (também alimenta 'fonte/forma química' no ERP, como no importador).",
                   obrigatorio=True, pode_vazio=False, origem="itens.csv › materia_prima_fonte", quebra=True, largura=45),
        ]
        if mp:
            cols.append(Coluna("NUTRIENTE_DECLARADO", "Nutriente declarado (ex.: Vitamina B1).",
                               origem="itens.csv › nutriente_declarado", largura=24))
        cols += [
            Coluna("TIPO_ITEM", "Matéria-prima ou embalagem/insumo.", obrigatorio=True, tipo="Lista",
                   valores=_valores("TIPO_ITEM"), pode_vazio=False,
                   origem="itens.csv › tipo_sugerido (classificação feita por nome na extração)",
                   observacao="O valor informado aqui é o que vale, mesmo que a linha fique neste arquivo.", largura=16),
            Coluna("UNIDADE_ESTOQUE", "Unidade em que o estoque do item é controlado.", obrigatorio=True, tipo="Lista",
                   valores=tuple(R.UNIDADES), pode_vazio=False,
                   origem="regra do importador: matéria-prima = kg, embalagem = un",
                   observacao="Catálogo oficial: mg, g, kg, un, mL, L. Não há conversão automática entre massa e unidade.",
                   largura=12),
        ]
        if mp:
            cols += [
                Coluna("FAMILIA", "Família industrial do item.", tipo="Lista", valores=_valores("FAMILIA"),
                       origem="itens_enriquecimento.csv › familia (convertida para a lista do ERP)", largura=20),
                Coluna("PUREZA_PADRAO", "Pureza padrão conhecida da matéria-prima.", tipo="Percentual",
                       formato="percentual (ex.: 98,5%)", origem="itens_enriquecimento.csv › grau_pureza (0–1)",
                       observacao="Vazio = desconhecida (nunca lida como 100%). O ERP grava 98,5.", numero=PERCENTUAL,
                       validacao_numero="fracao", largura=12),
            ]
        cols += [
            Coluna("FONTE_DO_REGISTRO", "Onde o item aparece no legado.", tecnica=True, origem="migração", largura=30,
                   quebra=True),
            _status(),
            OBS_REVISAO,
        ]
        return cols
    if arquivo == F.PRODUTOS:
        return [
            Coluna("CHAVE_MIGRACAO", "Chave do Produto (CHAVE_PRODUTO).", obrigatorio=True, tecnica=True, tipo="Chave",
                   formato="PROD-LEG-<código>", pode_vazio=False, origem="'PROD-LEG-' + cod_produto",
                   observacao="Autoritativa. Nunca editar nem apagar.", numero=TEXTO),
            _codigo_previsto("CODIGO_PRODUTO_PREVISTO", "PROD-000000"),
            Coluna("CODIGO_PLANILHA", "Código do produto na planilha (vai para 'código externo').", tecnica=True,
                   origem="formulacoes.csv / projetos.csv › cod_produto", numero=TEXTO),
            Coluna("NOME_PRODUTO", "Nome do produto (também é o nome do item de produto acabado).", obrigatorio=True,
                   pode_vazio=False, origem="projetos.csv › produto", quebra=True, largura=45),
            Coluna("CHAVE_ITEM_PA", "Chave do Item de produto acabado — exatamente um por produto.", obrigatorio=True,
                   tecnica=True, tipo="Chave", formato="PA-LEG-<código>", pode_vazio=False,
                   origem="'PA-LEG-' + cod_produto", observacao="Regra 1:1 Produto ↔ Item de produto acabado.",
                   numero=TEXTO),
            _codigo_previsto("CODIGO_PA_PREVISTO", "PA-000000"),
            Coluna("UNIDADE_PA", "Unidade de estoque do item de produto acabado.", obrigatorio=True, tipo="Lista",
                   valores=tuple(R.UNIDADES), pode_vazio=False,
                   origem="regra do importador (o legado conta o lote em unidades)", largura=11),
            Coluna("CHAVE_CLIENTE", "Cliente dono do produto (chave do arquivo 01).", tipo="Lista", lista="CLIENTES",
                   formato="CLI-LEG-0000 ou vazio", origem="projetos.csv › cod_cliente",
                   observacao="Vazio = produto sem cliente (permitido). A chave manda; o nome ao lado é só conferência.",
                   numero=TEXTO, largura=16),
            Coluna("CLIENTE", "Nome do cliente, só para conferência.", tecnica=True, origem="01_CLIENTES",
                   largura=26),
            _status(),
            OBS_REVISAO,
        ]
    if arquivo == F.PRECOS:
        return [
            _chave("REF-XXXXXXXXXXXX", "hash de item, URL, preço e embalagem (ou item + situação)"),
            Coluna("CHAVE_ITEM", "Item (chave dos arquivos 03/04).", obrigatorio=True, tecnica=True, tipo="Chave",
                   pode_vazio=False, origem="03/04", numero=TEXTO),
            _codigo_previsto("CODIGO_ITEM_PREVISTO", "MP/ME-000000"),
            Coluna("ITEM", "Descrição do item, para conferência.", tecnica=True, origem="03/04", quebra=True, largura=36),
            Coluna("TIPO_ITEM", "Tipo do item.", tecnica=True, origem="03/04", largura=15),
            Coluna("UNIDADE_ESTOQUE", "Unidade de estoque do item.", tecnica=True, origem="03/04", largura=10),
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
            Coluna("MEMORIA_CALCULO", "A conta feita, com a quantidade-base explícita.", tecnica=True,
                   origem="calculado", quebra=True, largura=38),
            Coluna("TIPO_FONTE", "Natureza da fonte.", obrigatorio=True, tipo="Lista", valores=("PRECO_MERCADO_PUBLICO",),
                   pode_vazio=False, origem="migração", observacao="Nunca custo real de compra.", largura=24),
            Coluna("FORNECEDOR_OU_SITE", "Loja, distribuidor ou fabricante que publicou o preço.",
                   origem="pesquisa pública", quebra=True, largura=26),
            Coluna("URL_OU_DOCUMENTO", "Página onde o preço foi visto.", origem="pesquisa pública", quebra=True,
                   largura=45),
            Coluna("DATA_DA_PESQUISA", "Dia da consulta.", tipo="Data", formato="dd/mm/aaaa", origem="pesquisa pública",
                   numero=DATA, largura=12),
            Coluna("CONFIANCA", "Quão equivalente é a referência (critério na aba ORIGEM).", tipo="Lista",
                   valores=_valores("CONFIANCA"), origem="classificação da migração", largura=11),
            _status("STATUS_PRECO"),
            Coluna("OBSERVACAO", "Apresentação, grau, equivalência, evidência e ofertas do legado (07).",
                   origem="pesquisa pública / migração", quebra=True, largura=60),
        ]
    if arquivo == F.OFERTAS:
        return [
            _chave("OFE-LEG-XXXXXXXXXXXX", "12 primeiros caracteres da chave de idempotência do importador"),
            Coluna("CHAVE_FORNECEDOR", "Fornecedor (chave do arquivo 02).", obrigatorio=True, tipo="Lista",
                   lista="FORNECEDORES", pode_vazio=False, origem="precos_fornecedores.csv › fornecedor",
                   numero=TEXTO, largura=26),
            Coluna("FORNECEDOR", "Nome do fornecedor, só para conferência.", tecnica=True, origem="02_FORNECEDORES",
                   largura=24),
            Coluna("CHAVE_ITEM", "Item (chave dos arquivos 03/04).", obrigatorio=True, tipo="Lista", lista="ITENS",
                   pode_vazio=False, origem="precos_fornecedores.csv › cod_item", numero=TEXTO, largura=15),
            _codigo_previsto("CODIGO_ITEM_PREVISTO", "MP/ME-000000"),
            Coluna("ITEM", "Descrição do item, só para conferência.", tecnica=True, origem="03/04", quebra=True, largura=36),
            Coluna("TIPO_ITEM", "Tipo do item.", tecnica=True, origem="03/04", largura=15),
            Coluna("UNIDADE_ESTOQUE", "Unidade de estoque do item.", tecnica=True, origem="03/04", largura=10),
            Coluna("PRECO_BRL", "Preço da planilha de CMV.", tipo="Moeda", formato="R$ 0,00",
                   origem="precos_fornecedores.csv › preco_brl_kg", numero=MOEDA, validacao_numero="nao_negativo",
                   observacao="Zero veio da planilha como está (provável célula não preenchida) e virou pendência.",
                   largura=13),
            Coluna("MOEDA", "Moeda do preço.", tipo="Lista", valores=("BRL",), origem="precos_fornecedores.csv", largura=8),
            Coluna("UNIDADE_DO_PRECO", "Unidade a que o preço se refere.", obrigatorio=True, tipo="Lista",
                   valores=tuple(R.UNIDADES), pode_vazio=False, origem="cabeçalho preco_brl_kg (R$/kg)",
                   observacao="Mudar só se o preço não for por kg (ex.: embalagem por unidade).", largura=11),
            Coluna("PEDIDO_MINIMO_PLANILHA", "Pedido mínimo como está na planilha.",
                   origem="precos_fornecedores.csv › pedido_minimo",
                   observacao="Número sem unidade é lido na unidade do item (regra do importador).", numero=TEXTO,
                   largura=14),
            Coluna("HOMOLOGADO_NO_LEGADO", "Fornecedor homologado para este item na planilha.", tipo="Lista",
                   valores=("SIM", "NÃO"), origem="precos_fornecedores.csv › homologado",
                   observacao="Vazio = a planilha não informa (não significa reprovado).", largura=12),
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
        Coluna("IMPEDE_CARGA", "SIM = resolver antes da carga (ou marcar NAO_IMPORTAR).", obrigatorio=True, tecnica=True,
               largura=10),
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
    Coluna("DESCRICAO", "O que a coluna guarda.", quebra=True, largura=45),
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
    Coluna("ROTULO_PT", "Rótulo em português.", largura=26),
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

REGRAS = {
    F.MAPA: [
        ("Conteúdo", "Uma linha por registro candidato dos arquivos 01 a 05: clientes, fornecedores, matérias-primas, "
         "embalagens, produtos e itens de produto acabado. Ofertas (07) e referências de mercado (06) não geram código."),
        ("STATUS_VALIDACAO", "Repete o STATUS_REVISAO do registro na geração do pacote; OBSERVACAO lista os códigos "
         "das pendências (detalhe no arquivo do cadastro e na aba PENDENCIAS deste arquivo)."),
    ],
    F.CLIENTES: [
        ("Fonte", "clientes.csv (aba CAD CLIENTE da PL CONTROLE)."),
        ("RAZAO_SOCIAL", "razao_social. Vazia no legado ⇒ vazia + pendência (o importador atual repetiria o nome "
         "fantasia; aqui a decisão é da Veridi)."),
        ("CNPJ", "cnpj_digitos, conferido pelo dígito verificador. Inválido fica como está + pendência — nunca "
         "'corrigido'."),
        ("Endereço", "ENDERECO_ORIGINAL guarda o texto (vai para Observações, como no importador). LOGRADOURO, NUMERO e "
         "BAIRRO seguem a regra conservadora do importador (legacy-address.ts): logradouro só com tipo reconhecido, "
         "número rotulado ou isolado, bairro só quando rotulado. CEP só quando rotulado 'CEP'. COMPLEMENTO não é "
         "separado automaticamente. O que não dá para afirmar fica vazio — nunca 'S/N'."),
        ("Marcadores", "'-', '**' e similares da planilha viram célula vazia."),
        ("Duplicidade", "CNPJ repetido e razão social repetida viram pendência; nada foi fundido."),
    ],
    F.FORNECEDORES: [
        ("Fonte", "fornecedores.csv (nomes distintos das compras + abas MP dos CMVs). O legado só tem o nome: CNPJ, "
         "e-mail, telefone e endereço não existem na planilha e não foram inventados."),
        ("RAZAO_SOCIAL", "Começa igual ao nome da planilha; NOME_PLANILHA guarda o original."),
        ("Duplicidade", "Nomes parecidos são apontados (mesmo nome sem espaços ou sem anotação, um contido no outro, "
         "grafia quase igual, palavra própria em comum) com o uso de cada um em preços e compras. Nada foi fundido."),
    ],
    F.MATERIAS_PRIMAS: [
        ("Fonte", "Cadastro principal: itens.csv (CAD ITEM da PL CONTROLE + R.PRO.002). Família e pureza: "
         "itens_enriquecimento.csv (CMV › Cadastros)."),
        ("TIPO_ITEM", "Vem de tipo_sugerido — classificação por nome feita na extração das planilhas (16/08/2026), não "
         "é coluna original. Por isso matérias-primas e embalagens estão em arquivos separados. Conflito com a família "
         "do CMV ou com o nome (inclusive itens em cápsula) vira pendência: nada foi reclassificado em silêncio."),
        ("UNIDADE_ESTOQUE", "Regra do importador: matéria-prima em kg, embalagem em un (o legado controla saldo e preço "
         "em kg e conta embalagem em unidades na fórmula). Nenhuma conversão foi inventada."),
        ("Itens fora do cadastro", "Códigos que existem só no CMV (itens_enriquecimento.csv) ou só na planilha de preços "
         "entram com STATUS_REVISAO = PENDENTE: a Veridi confirma se devem ser cadastrados."),
        ("FAMILIA", "VITAMINA→VITAMINA, MINERAIS→MINERAL, AMINOÁCIDO→AMINOACIDO, EXCIPIENTE→EXCIPIENTE, "
         "Embalagem→EMBALAGEM. Sem equivalente no ERP (SUBT BIOATIVAS, PROTEINAS, FIBRAS, OUT. NUTRIENTES, "
         "CARBOIDRATOS, ENZIMAS, LIPIDIOS) ⇒ OUTRA_MATERIA_PRIMA, com o texto original em LEGADO_NAO_IMPORTADO. "
         "Nota para a carga: o importador atual não reconhece o plural MINERAIS."),
        ("PUREZA_PADRAO", "grau_pureza (0–1) mostrado em %. '**' e '-' são vazio; potência em UI não cabe no campo e "
         "fica em LEGADO_NAO_IMPORTADO."),
        ("Materiais sem código", "Linhas de fórmula sem código de item estão em LEGADO_NAO_IMPORTADO (sem código não há o "
         "que referenciar)."),
    ],
    F.PRODUTOS: [
        ("Conjunto", "Produto acabado = código de produto com fórmula no legado (formulacoes.csv). Nome e cliente vêm "
         "de projetos.csv."),
        ("1:1", "Cada Produto (CHAVE_MIGRACAO, PROD-LEG-…) tem exatamente um Item de produto acabado (CHAVE_ITEM_PA, "
         "PA-LEG-…) com o mesmo nome e código de planilha; o item de produto acabado nasce na carga junto com o produto."),
        ("Cliente", "O do projeto do produto. Todos os produtos do legado têm um cliente; nenhum foi inventado. Produto "
         "sem cliente é permitido no ERP (CHAVE_CLIENTE vazia)."),
        ("UNIDADE_PA", "un (o legado conta o lote de produto acabado em unidades)."),
        ("Fora da carga", "Códigos que só existem em projetos.csv (sem fórmula) e atributos de produto do CMV (ligados só "
         "por nome) estão em LEGADO_NAO_IMPORTADO. Formulações, projetos, orçamentos e amostras migram em etapa própria."),
    ],
    F.PRECOS: [
        ("Natureza", "REFERÊNCIA DE MERCADO PARA REVISÃO. Não é custo real de compra, não é recebimento, não é LAST_REAL "
         "e não será importada como custo de aquisição."),
        ("Normalização", "PRECO_PUBLICADO ÷ QUANTIDADE_REFERENCIA, convertido para a UNIDADE_ESTOQUE pelo catálogo de "
         "unidades (mg/g/kg; mL/L; un), em Decimal. Sem conversão entre dimensões. Sem frete, imposto ou desconto "
         "negociado. Preço de loja/varejo não é preço industrial negociado: use como ordem de grandeza."),
        ("CONFIANCA", "ALTA = preço público direto e item claramente equivalente. MEDIA = produto comparável, mas marca, "
         "grau (P.A., técnico, cosmético, ração) ou apresentação diferente (embalagem menor que 1 kg / 1 L / 100 un). "
         "BAIXA = referência aproximada (outra forma química, produto similar ou item de nome genérico). Sem "
         "correspondência razoável: sem preço (SEM_REFERENCIA)."),
        ("Ofertas do legado", "Não estão aqui: ficam no arquivo 07 (OFERTA_FORNECEDOR_LEGADO)."),
    ],
    F.OFERTAS: [
        ("Fonte", "precos_fornecedores.csv (abas MP de 9 arquivos de CMV): uma observação por linha; preços diferentes "
         "para o mesmo par item × fornecedor são preservados."),
        ("Preço", "Coluna preco_brl_kg (R$/kg). O legado não tem data de cotação: observação histórica, nunca preço "
         "vigente e nunca compra real."),
        ("Unidade", "Item controlado em unidade com preço 'por kg' fica PENDENTE: converter kg em unidade exigiria peso "
         "por unidade, que ninguém tem."),
        ("Homologação", "SIM quando a planilha diz; vazio = a planilha não informa (não significa reprovado)."),
        ("melhor_preco", "Indicador do CMV; não é fornecedor preferencial oficial. Preservado em LEGADO_NAO_IMPORTADO."),
    ],
}
REGRAS[F.EMBALAGENS] = REGRAS[F.MATERIAS_PRIMAS]

DEFAULTS = {
    F.MAPA: [],
    F.CLIENTES: [
        ("Perfil tributário", "NÃO INFORMADO (NOT_INFORMED) — padrão do sistema; o legado não tem."),
        ("Situação comercial", "Não é campo: o sistema deriva."),
        ("Ativo", "SIM (padrão do sistema)."),
        ("E-mail, telefone, sufixo de lote comercial", "Vazios — não existem no legado."),
    ],
    F.FORNECEDORES: [
        ("Ativo", "SIM (padrão do sistema)."),
        ("Nome fantasia, CNPJ, e-mail, telefone, observações", "Vazios — não existem no legado."),
    ],
    F.MATERIAS_PRIMAS: [
        ("Controla lote", "SIM (regra do importador)."),
        ("Controla validade / exige liberação da Qualidade", "SIM para matéria-prima, NÃO para embalagem (regra do importador)."),
        ("Exige laudo (CoA)", "NÃO (padrão do sistema)."),
        ("Subtipo de embalagem, código de barras", "Vazios — não existem no legado."),
        ("Ativo", "SIM (padrão do sistema)."),
    ],
    F.PRODUTOS: [
        ("Ciclo de vida", "APROVADO (padrão do sistema para produto legado)."),
        ("Perfil industrial (forma, apresentação, dose, validade, lote mínimo…)", "Vazio — sem vínculo confiável no legado."),
        ("Item de produto acabado", "Controla lote, validade e liberação da Qualidade = SIM (regra do importador)."),
        ("Ativo", "SIM (padrão do sistema)."),
    ],
    F.PRECOS: [("Custo do item", "Nada desta planilha vira ItemCostReference, Receipt ou custo de aquisição.")],
    F.OFERTAS: [
        ("Fornecedor preferencial", "NÃO para todas (melhor_preco não é preferência oficial)."),
        ("Vigência da oferta", "Vazia — o legado não tem data; a oferta nunca vira preço vigente."),
    ],
}
DEFAULTS[F.EMBALAGENS] = DEFAULTS[F.MATERIAS_PRIMAS]
