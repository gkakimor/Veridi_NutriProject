import { cadastroPorChave, motivoDoFundidoEmTexto } from "./master-data-catalog.js";
import type { AbaDaPlanilha, ValorDeCelula } from "./xlsx-writer.js";
import type { GrupoPlanejado, Plano, ResultadoDoGrupo } from "./master-data-duplicate-sanitization.js";

/**
 * A planilha que a Veridi recebe (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 * Três abas, e nenhuma delas esconde o que não foi feito:
 *
 *  - `Removidos` — uma linha por cadastro absorvido, **inclusive** o que não
 *    foi removido, com a coluna Resultado dizendo por quê. Quem abrir o
 *    arquivo tem que conseguir reconstruir a rodada inteira sem o terminal.
 *  - `Resumo` — por cadastro: grupos, removidos, bloqueados, sem alteração.
 *  - `Revisão necessária` — grupo bloqueado com o conflito exato, e as
 *    variantes que a regra do PO **não** funde (acento e espaço), que ficam
 *    como pergunta, nunca como ação automática.
 *
 * Sem banco: o relatório é função do plano e do resultado do APPLY.
 */

const SEM_APLICACAO = "NÃO APLICADO (somente PLAN)";

function referenciasEmTexto(referencias: readonly { tabela: string; coluna: string; linhas: number }[]): string {
  if (referencias.length === 0) return "nenhuma";
  return referencias.map((r) => `${r.tabela}.${r.coluna}=${r.linhas}`).join("; ");
}

function observacaoDoAbsorvido(grupo: GrupoPlanejado, codigo: string): string {
  const partes: string[] = [];
  const legado = grupo.absorvidos.find((a) => a.codigo === codigo)?.dados["externalCode"];
  if (legado !== null && legado !== undefined && legado !== "") {
    partes.push(`código legado (planilha): ${String(legado)}`);
  }
  const perdidos = grupo.camposPerdidos.filter((c) => c.codigo === codigo);
  if (perdidos.length > 0) {
    partes.push(`campos que só existiam no removido: ${perdidos.map((c) => `${c.coluna}="${c.valor}"`).join("; ")}`);
  }
  if (grupo.conflitos.length > 0) {
    partes.push(
      `conflito: ${grupo.conflitos.map((c) => `${c.coluna} ${c.valores.map((v) => `"${v}"`).join(" × ")}`).join("; ")}`,
    );
  }
  return partes.join(" | ");
}

/** Uma variante de nome que a regra NÃO considera duplicata (acento, espaço). */
export interface VarianteDeNome {
  cadastro: string;
  motivo: "ACENTO" | "ESPAÇO";
  registros: { codigo: string; nome: string }[];
}

export function planilhaDoSaneamento(
  plano: Plano,
  resultados: readonly ResultadoDoGrupo[],
  variantes: readonly VarianteDeNome[] = [],
): AbaDaPlanilha[] {
  const porGrupo = new Map(resultados.map((r) => [r.grupo, r]));

  /* --- Removidos --------------------------------------------------- */
  const removidos: ValorDeCelula[][] = [];
  for (const grupo of plano.grupos) {
    const resultado = porGrupo.get(grupo.grupo);
    for (const absorvido of grupo.absorvidos) {
      const situacao =
        grupo.situacao === "BLOQUEADO"
          ? "BLOQUEADO — revisão necessária"
          : resultado?.situacao === "APLICADO"
            ? "REMOVIDO"
            : resultado?.situacao === "FALHOU"
              ? `FALHOU — ${resultado.motivo ?? ""}`
              : SEM_APLICACAO;
      const movidas =
        resultado?.situacao === "APLICADO"
          ? referenciasEmTexto(absorvido.referencias)
          : grupo.situacao === "BLOQUEADO"
            ? "nenhuma (grupo bloqueado)"
            : `previsto: ${referenciasEmTexto(absorvido.referencias)}`;
      removidos.push([
        grupo.rotulo,
        absorvido.codigo,
        absorvido.nome,
        grupo.canonico.codigo,
        grupo.canonico.nome,
        grupo.situacao === "BLOQUEADO" ? grupo.motivos.join(" | ") : grupo.explicacao,
        referenciasEmTexto(absorvido.referencias),
        movidas,
        resultado?.aplicadoEm ?? "",
        situacao,
        observacaoDoAbsorvido(grupo, absorvido.codigo),
      ]);
    }
  }

  /* --- Resumo ------------------------------------------------------- */
  const cadastros = [...new Set([...plano.cadastros, ...plano.grupos.map((g) => g.cadastro)])].sort();
  const resumo: ValorDeCelula[][] = cadastros.map((chave) => {
    const cadastro = cadastroPorChave(chave);
    const grupos = plano.grupos.filter((g) => g.cadastro === chave);
    const bloqueados = grupos.filter((g) => g.situacao === "BLOQUEADO");
    const aplicados = grupos.filter((g) => porGrupo.get(g.grupo)?.situacao === "APLICADO");
    const naoAplicados = grupos.filter(
      (g) => g.situacao === "PRONTO" && porGrupo.get(g.grupo)?.situacao !== "APLICADO",
    );
    return [
      cadastro.rotulo,
      cadastro.tabela,
      grupos.length,
      grupos.reduce((soma, g) => soma + g.absorvidos.length + 1, 0),
      aplicados.length,
      aplicados.reduce((soma, g) => soma + g.absorvidos.length, 0),
      bloqueados.length,
      naoAplicados.length,
    ];
  });

  const revisao = linhasDeRevisao(plano.grupos, variantes);

  return [
    {
      nome: "Removidos",
      cabecalho: [
        "Tipo de cadastro",
        "Código/ID removido",
        "Nome original",
        "Código/ID canônico",
        "Nome canônico",
        "Motivo da consolidação",
        "Referências encontradas",
        "Referências movidas",
        "Data da ação",
        "Resultado",
        "Observação",
      ],
      linhas: removidos,
    },
    {
      nome: "Resumo",
      cabecalho: [
        "Cadastro",
        "Tabela",
        "Grupos encontrados",
        "Registros nos grupos",
        "Grupos consolidados",
        "Registros removidos",
        "Grupos bloqueados",
        "Grupos sem alteração",
      ],
      linhas: resumo,
    },
    {
      nome: "Revisão necessária",
      cabecalho: ["Cadastro", "Nome", "Registros envolvidos", "Por que não foi consolidado", "Conflito", "O que fazer"],
      linhas: revisao,
    },
  ];
}

/** O que ficou para gente decidir: grupo bloqueado e variante fora da regra. */
function linhasDeRevisao(
  grupos: readonly GrupoPlanejado[],
  variantes: readonly VarianteDeNome[],
): ValorDeCelula[][] {
  const revisao: ValorDeCelula[][] = [];
  for (const grupo of grupos.filter((g) => g.situacao === "BLOQUEADO")) {
    revisao.push([
      grupo.rotulo,
      grupo.chaveDoNome,
      [grupo.canonico, ...grupo.absorvidos].map((l) => `${l.codigo} (${l.nome})`).join(" | "),
      grupo.motivos.join(" | "),
      grupo.conflitos
        .map((c) => `${c.coluna}: ${c.valores.map((v) => `"${v}"`).join(" × ")}`)
        .join(" | "),
      "Decisão de produto: escolher o canônico ou manter os dois cadastros.",
    ]);
  }
  for (const variante of variantes) {
    revisao.push([
      cadastroPorChave(variante.cadastro).rotulo,
      variante.registros.map((r) => r.nome).join(" | "),
      variante.registros.map((r) => `${r.codigo} (${r.nome})`).join(" | "),
      variante.motivo === "ACENTO"
        ? "Nomes diferem só por ACENTO — a regra do PO preserva acento, então não são duplicatas"
        : "Nomes diferem só por ESPAÇO interno — a regra do PO é trim + caixa, e não junta espaço interno",
      "",
      "Fora da regra automática. Só a Veridi decide se é o mesmo material.",
    ]);
  }
  return revisao;
}

/* ------------------------------------------------------------------ *
 * Planilha de uma onda do arquivo de decisão (Onda 2 em diante)
 * ------------------------------------------------------------------ */

/** O que aconteceu com a relação de um absorvido, em palavras. */
function relacoesEmTexto(grupo: GrupoPlanejado, codigo: string): string[] {
  return (grupo.relacoes ?? [])
    .filter((r) => r.codigo === codigo)
    .map(({ operacao }) =>
      operacao.tipo === "CONSOLIDAR_RELACAO"
        ? `relação com ${operacao.fornecedor} consolidada na do canônico (${operacao.ofertas.length} oferta(s), ${operacao.eventos.length} evento(s) de homologação)`
        : `relação com ${operacao.fornecedor} passou para o canônico (${operacao.ofertas} oferta(s), ${operacao.eventos} evento(s))`,
    );
}

/**
 * A planilha de uma onda (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01): uma
 * linha por registro removido, com o campo que o canônico consolidou — o valor
 * de ANTES e o de DEPOIS do canônico, e na observação o que aquele registro
 * trazia.
 *
 * A aba de revisão vem da RECONTAGEM global depois da onda (regra automática
 * em todos os cadastros): o que continua repetido, com o motivo. Sem recontagem
 * ela diz isso, em vez de sair vazia como se não houvesse nada.
 */
export function planilhaDaOnda(
  plano: Plano,
  resultados: readonly ResultadoDoGrupo[],
  recontagem: Plano | null,
): AbaDaPlanilha[] {
  const porGrupo = new Map(resultados.map((r) => [r.grupo, r]));

  /* --- REMOVIDOS --------------------------------------------------- */
  const removidos: ValorDeCelula[][] = [];
  for (const grupo of plano.grupos) {
    const resultado = porGrupo.get(grupo.grupo);
    const atualizacao = (grupo.atualizacoes ?? [])[0];
    for (const absorvido of grupo.absorvidos) {
      const situacao =
        grupo.situacao === "BLOQUEADO"
          ? "BLOQUEADO — revisão necessária"
          : grupo.situacao === "JA_SANEADO"
            ? "JÁ SANEADO"
            : resultado?.situacao === "APLICADO"
              ? "REMOVIDO"
              : resultado?.situacao === "FALHOU"
                ? `FALHOU — ${resultado.motivo ?? ""}`
                : SEM_APLICACAO;
      const aplicado = resultado?.situacao === "APLICADO";
      const moveu = [
        ...relacoesEmTexto(grupo, absorvido.codigo),
        ...absorvido.referencias
          .filter((r) => !(r.tabela === "supplier_items" && r.coluna === "itemId"))
          .map((r) => `${r.tabela}.${r.coluna}=${r.linhas}`),
      ];
      const movidas =
        moveu.length === 0
          ? "nenhuma"
          : aplicado
            ? moveu.join("; ")
            : grupo.situacao === "BLOQUEADO"
              ? "nenhuma (grupo bloqueado)"
              : `previsto: ${moveu.join("; ")}`;
      const doRemovido = absorvido.dados["declaredNutrient"];
      // Termo fundido só na linha de quem o trouxe: "Clorogênico" é do MP que
      // o tinha, não de todo absorvido do grupo.
      const termosDoRemovido = new Set(
        typeof doRemovido === "string" ? doRemovido.split(/\s*·\s*/u).map((t) => t.trim()) : [],
      );
      const legado = absorvido.dados["externalCode"];
      const observacao = [
        doRemovido !== null && doRemovido !== undefined && doRemovido !== ""
          ? `nutriente declarado do removido: "${String(doRemovido)}"`
          : null,
        legado !== null && legado !== undefined && legado !== "" ? `código legado (planilha): ${String(legado)}` : null,
        absorvido.nome.trim().toUpperCase() !== grupo.chaveDoNome
          ? `par nomeado por decisão do PO: "${absorvido.nome}" × "${grupo.canonico.nome}" (difere por acento; a regra geral continua preservando acento)`
          : null,
        ...(atualizacao?.fundidos ?? [])
          .filter((f) => termosDoRemovido.has(f.termo))
          .map((f) => `"${f.termo}" é o mesmo termo de "${f.em}" (${motivoDoFundidoEmTexto(f.motivo)}): ficou "${f.em}"`),
        ...grupo.camposPerdidos
          .filter((c) => c.codigo === absorvido.codigo)
          .map((c) => `campo que só existia no removido: ${c.coluna}="${c.valor}"`),
      ]
        .filter((parte): parte is string => parte !== null)
        .join(" | ");

      removidos.push([
        grupo.rotulo,
        absorvido.codigo,
        absorvido.nome,
        grupo.canonico.codigo,
        grupo.canonico.nome,
        atualizacao?.coluna ?? "",
        atualizacao ? (atualizacao.antes ?? "") : "",
        atualizacao?.depois ?? "",
        referenciasEmTexto(absorvido.referencias),
        movidas,
        grupo.situacao === "BLOQUEADO"
          ? grupo.motivos.join(" | ")
          : `Onda ${grupo.decisao?.onda ?? plano.onda ?? ""}, grupo ${grupo.decisao?.grupo ?? ""}: mesmo material, decisão do PO. ${grupo.explicacao}`,
        situacao,
        resultado?.aplicadoEm ?? "",
        observacao,
      ]);
    }
  }

  /* --- RESUMO ------------------------------------------------------ */
  const restantes = recontagem?.grupos ?? [];
  const cadastros = [
    ...new Set([...plano.cadastros, ...(recontagem?.cadastros ?? []), ...restantes.map((g) => g.cadastro)]),
  ].sort();
  const resumo: ValorDeCelula[][] = cadastros.map((chave) => {
    const cadastro = cadastroPorChave(chave);
    const daOnda = plano.grupos.filter((g) => g.cadastro === chave);
    const aplicados = daOnda.filter((g) => porGrupo.get(g.grupo)?.situacao === "APLICADO");
    const restantesDoCadastro = restantes.filter((g) => g.cadastro === chave);
    return [
      cadastro.rotulo,
      cadastro.tabela,
      daOnda.length,
      aplicados.length,
      aplicados.reduce((soma, g) => soma + g.absorvidos.length, 0),
      aplicados.filter((g) => (g.atualizacoes ?? []).length > 0).length,
      recontagem ? restantesDoCadastro.filter((g) => g.situacao === "BLOQUEADO").length : "sem recontagem",
      recontagem ? restantesDoCadastro.length : "sem recontagem",
    ];
  });

  /* --- REVISÃO NECESSÁRIA ------------------------------------------ */
  const revisao = recontagem
    ? linhasDeRevisao(restantes, recontagem.variantes)
    : [["", "", "", "Planilha gerada sem recontagem global: rode com --excel no APPLY ou no VERIFY", "", ""]];

  return [
    {
      nome: "REMOVIDOS",
      cabecalho: [
        "Tipo de cadastro",
        "Código removido",
        "Nome removido",
        "Código canônico",
        "Nome canônico",
        "Campo consolidado",
        "Valor anterior",
        "Valor final",
        "Referências encontradas",
        "Referências movidas",
        "Motivo",
        "Resultado",
        "Data/hora",
        "Observação",
      ],
      linhas: removidos,
    },
    {
      nome: "RESUMO",
      cabecalho: [
        "Cadastro",
        "Tabela",
        "Grupos da onda",
        "Grupos consolidados",
        "Registros removidos",
        "Canônicos com campo consolidado",
        "Grupos em revisão (restantes)",
        "Duplicidades restantes",
      ],
      linhas: resumo,
    },
    {
      nome: "REVISÃO NECESSÁRIA",
      cabecalho: ["Cadastro", "Nome", "Registros envolvidos", "Por que não foi consolidado", "Conflito", "O que fazer"],
      linhas: revisao,
    },
  ];
}
