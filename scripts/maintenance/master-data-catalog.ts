/**
 * Quais cadastros mestre entram no saneamento de duplicidade de nome, e o que
 * torna dois registros do mesmo nome inconciliáveis
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 * Sem banco: escopo, critério de canônico e classificação de conflito moram
 * aqui, e é daqui que a ferramenta, o teste e a documentação leem.
 *
 * **Entra** o cadastro que a pessoa cria e edita e cujo nome é a identidade no
 * catálogo. **Não entra** documento transacional (Pedido, Orçamento, OP,
 * Recebimento, Movimento, Expedição): repetir o nome ali é histórico, não
 * duplicidade. Também não entram:
 *
 *  - `units_of_measure` — catálogo fechado, semeado, sem rota de escrita
 *    (`GET /units` é a única); `code` é a identidade e `label` é descrição;
 *  - `users` — a identidade é o e-mail, e dois usuários podem legitimamente
 *    se chamar igual;
 *  - `production_calendars` — registro único (`GLOBAL`, CHECK no banco);
 *  - versões (`formulation_versions`, `pricing_versions`, …) — pertencem a um
 *    cadastro e são histórico, não catálogo.
 */

export interface CadastroMestreNoBanco {
  /** Chave estável; a mesma de `CadastroMestre` em `@veridi/shared`. */
  chave: string;
  /** Como aparece na tela. */
  rotulo: string;
  tabela: string;
  colunaId: string;
  colunaNome: string;
  /** Código de negócio visível (MP-000001, CLI-000001…). */
  colunaCodigo: string;
  /**
   * Sufixos de coluna que apontam para este cadastro sem FK declarada.
   * Minúsculas; comparados com o nome da coluna sem caixa.
   */
  sufixosDeId: readonly string[];
  /** Sufixos de coluna que guardam o CÓDIGO deste cadastro (snapshot histórico). */
  sufixosDeCodigo: readonly string[];
  /**
   * Colunas que NÃO carregam informação de negócio: divergir nelas nunca é
   * conflito, e elas não contam para "registro mais completo".
   */
  colunasNeutras: readonly string[];
  /** Por que este cadastro entra no escopo. */
  motivo: string;
}

/** Colunas de escrituração presentes em quase todo cadastro. */
const NEUTRAS_COMUNS = [
  "id",
  "code",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "createdByUserId",
  "updatedByUserId",
  "createdByNameSnapshot",
  "updatedByNameSnapshot",
  "archivedAt",
  "archivedBy",
] as const;

export const CADASTROS_MESTRE_NO_BANCO: readonly CadastroMestreNoBanco[] = [
  {
    chave: "ITEM",
    rotulo: "Item",
    tabela: "items",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
    sufixosDeId: ["itemid"],
    sufixosDeCodigo: ["itemcode"],
    // `externalCode` é o código da planilha legada: rastro da carga, não
    // decisão de negócio. Divergir nele é esperado entre duas linhas da mesma
    // planilha e não deve, sozinho, bloquear o grupo.
    colunasNeutras: [...NEUTRAS_COMUNS, "name", "externalCode"],
    motivo: "Catálogo de matéria-prima, embalagem e produto acabado; o nome é a identidade operacional.",
  },
  {
    chave: "CUSTOMER",
    rotulo: "Cliente",
    tabela: "customers",
    colunaId: "id",
    colunaNome: "legalName",
    colunaCodigo: "code",
    sufixosDeId: ["customerid"],
    sufixosDeCodigo: ["customercode"],
    colunasNeutras: [...NEUTRAS_COMUNS, "legalName", "externalCode"],
    motivo: "Cadastro comercial; a razão social é a identidade do cliente no catálogo.",
  },
  {
    chave: "SUPPLIER",
    rotulo: "Fornecedor",
    tabela: "suppliers",
    colunaId: "id",
    colunaNome: "legalName",
    colunaCodigo: "code",
    sufixosDeId: ["supplierid"],
    sufixosDeCodigo: ["suppliercode"],
    colunasNeutras: [...NEUTRAS_COMUNS, "legalName", "externalCode"],
    motivo: "Cadastro de compras; a razão social é a identidade do fornecedor no catálogo.",
  },
  {
    chave: "PRODUCT",
    rotulo: "Produto",
    tabela: "products",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
    sufixosDeId: ["productid"],
    sufixosDeCodigo: ["productcode"],
    colunasNeutras: [...NEUTRAS_COMUNS, "name", "externalCode"],
    motivo: "Catálogo comercial/industrial; o nome é como o produto é pedido e cotado.",
  },
  {
    chave: "INDUSTRIAL_RESOURCE",
    rotulo: "Recurso industrial",
    tabela: "industrial_resources",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
    sufixosDeId: ["industrialresourceid", "resourceid"],
    sufixosDeCodigo: ["industrialresourcecode", "resourcecode"],
    colunasNeutras: [...NEUTRAS_COMUNS, "name"],
    motivo: "Cadastro de recurso (equipamento, mão de obra, energia) reutilizado por custo e planejamento.",
  },
  {
    chave: "FORMULATION_TEMPLATE",
    rotulo: "Modelo de formulação",
    tabela: "formulation_templates",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
    sufixosDeId: ["formulationtemplateid"],
    sufixosDeCodigo: ["formulationtemplatecode"],
    colunasNeutras: [...NEUTRAS_COMUNS, "name"],
    motivo: "Biblioteca reutilizável: o modelo é escolhido pelo nome ao criar uma formulação.",
  },
  {
    chave: "INDUSTRIAL_COST_TEMPLATE",
    rotulo: "Modelo de custo industrial",
    tabela: "industrial_cost_templates",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
    sufixosDeId: ["industrialcosttemplateid", "costtemplateid"],
    sufixosDeCodigo: ["industrialcosttemplatecode"],
    colunasNeutras: [...NEUTRAS_COMUNS, "name"],
    motivo: "Biblioteca reutilizável: o modelo é escolhido pelo nome ao montar o custo industrial.",
  },
  {
    chave: "PRICING_POLICY_TEMPLATE",
    rotulo: "Modelo de política de preço",
    tabela: "pricing_policy_templates",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
    sufixosDeId: ["pricingpolicytemplateid", "pricingpolicyid"],
    sufixosDeCodigo: ["pricingpolicytemplatecode"],
    colunasNeutras: [...NEUTRAS_COMUNS, "name"],
    motivo: "Biblioteca reutilizável: a política é escolhida pelo nome ao precificar.",
  },
  {
    chave: "PRODUCTION_PROFILE",
    rotulo: "Perfil de produção",
    tabela: "production_profiles",
    colunaId: "id",
    colunaNome: "name",
    colunaCodigo: "code",
    sufixosDeId: ["productionprofileid"],
    sufixosDeCodigo: ["productionprofilecode"],
    colunasNeutras: [...NEUTRAS_COMUNS, "name"],
    motivo: "Biblioteca reutilizável: o perfil é escolhido pelo nome ao planejar a produção.",
  },
];

export function cadastroPorChave(chave: string): CadastroMestreNoBanco {
  const achado = CADASTROS_MESTRE_NO_BANCO.find((c) => c.chave === chave);
  if (!achado) {
    const nomes = CADASTROS_MESTRE_NO_BANCO.map((c) => c.chave).join(", ");
    throw new Error(`Cadastro "${chave}" não está no escopo. Conhecidos: ${nomes}.`);
  }
  return achado;
}

/* ------------------------------------------------------------------ *
 * Critério de canônico
 * ------------------------------------------------------------------ */

/** Um registro do grupo, já com o que a decisão precisa saber. */
export interface RegistroDoGrupo {
  id: string;
  codigo: string;
  nome: string;
  /** `to_jsonb(linha)` — a linha inteira, do jeito que o banco a devolve. */
  dados: Record<string, unknown>;
  /** Quantas linhas de outras tabelas apontam para este registro. */
  referencias: number;
  /** Quantas tabelas distintas apontam para ele. */
  tabelasQueReferenciam: number;
  criadoEm: string | null;
}

export type MotivoDoCanonico =
  | "referenciado"
  | "mais-historico"
  | "mais-completo"
  | "mais-antigo"
  | "menor-codigo";

export interface EscolhaDoCanonico {
  canonico: RegistroDoGrupo;
  absorvidos: RegistroDoGrupo[];
  motivo: MotivoDoCanonico;
  /** A frase que vai para o PLAN e para o Excel. */
  explicacao: string;
}

/** Campos de negócio preenchidos — o "mais completo" da ordem do PO. */
export function camposPreenchidos(
  registro: RegistroDoGrupo,
  cadastro: CadastroMestreNoBanco,
): number {
  const neutras = new Set(cadastro.colunasNeutras);
  return Object.entries(registro.dados).filter(
    ([coluna, valor]) => !neutras.has(coluna) && valor !== null && valor !== undefined && valor !== "",
  ).length;
}

/**
 * Quem fica, e por quê. Determinístico e na ordem que o PO fixou:
 *
 *  1. registro referenciado (quem já é apontado por outra tabela);
 *  2. registro com mais histórico (mais linhas apontando, e em mais tabelas);
 *  3. registro mais completo (mais campos de negócio preenchidos);
 *  4. registro mais antigo; empatado, o de menor código.
 *
 * O desempate final é o código, que é único: a escolha nunca depende da ordem
 * em que o banco devolveu as linhas.
 */
export function escolherCanonico(
  registros: readonly RegistroDoGrupo[],
  cadastro: CadastroMestreNoBanco,
): EscolhaDoCanonico {
  if (registros.length < 2) throw new Error("Grupo de duplicidade tem menos de dois registros.");

  const completude = new Map(registros.map((r) => [r.id, camposPreenchidos(r, cadastro)]));
  const ordenados = [...registros].sort((a, b) => {
    const referenciado = Number(b.referencias > 0) - Number(a.referencias > 0);
    if (referenciado !== 0) return referenciado;
    if (b.referencias !== a.referencias) return b.referencias - a.referencias;
    if (b.tabelasQueReferenciam !== a.tabelasQueReferenciam) {
      return b.tabelasQueReferenciam - a.tabelasQueReferenciam;
    }
    const completo = (completude.get(b.id) ?? 0) - (completude.get(a.id) ?? 0);
    if (completo !== 0) return completo;
    const antiguidade = (a.criadoEm ?? "").localeCompare(b.criadoEm ?? "");
    if (antiguidade !== 0) return antiguidade;
    return a.codigo.localeCompare(b.codigo);
  });

  const [canonico, ...absorvidos] = ordenados as [RegistroDoGrupo, ...RegistroDoGrupo[]];
  const motivo = motivoDaEscolha(canonico, absorvidos, completude);
  return {
    canonico,
    absorvidos,
    motivo,
    explicacao: EXPLICACAO_DO_MOTIVO[motivo],
  };
}

const EXPLICACAO_DO_MOTIVO: Record<MotivoDoCanonico, string> = {
  referenciado: "Canônico é o único lado referenciado por outros registros.",
  "mais-historico": "Canônico é o lado com mais referências (mais histórico apontando para ele).",
  "mais-completo": "Nenhum lado tem mais referência; canônico é o cadastro mais completo.",
  "mais-antigo": "Empate em referência e completude; canônico é o cadastro mais antigo.",
  "menor-codigo": "Empate total; canônico é o de menor código.",
};

function motivoDaEscolha(
  canonico: RegistroDoGrupo,
  absorvidos: readonly RegistroDoGrupo[],
  completude: Map<string, number>,
): MotivoDoCanonico {
  const outros = absorvidos;
  if (canonico.referencias > 0 && outros.every((r) => r.referencias === 0)) return "referenciado";
  if (outros.every((r) => r.referencias < canonico.referencias)) return "mais-historico";
  const meu = completude.get(canonico.id) ?? 0;
  if (outros.every((r) => (completude.get(r.id) ?? 0) < meu)) return "mais-completo";
  if (outros.every((r) => (canonico.criadoEm ?? "") < (r.criadoEm ?? ""))) return "mais-antigo";
  return "menor-codigo";
}

/* ------------------------------------------------------------------ *
 * Conflito material
 * ------------------------------------------------------------------ */

export interface ConflitoDeCampo {
  coluna: string;
  valores: string[];
}

export interface CampoPerdido {
  coluna: string;
  codigo: string;
  valor: string;
}

export interface LeituraDeCampos {
  /** Coluna com DOIS valores diferentes e não nulos: ninguém decide isso sozinho. */
  conflitos: ConflitoDeCampo[];
  /** Coluna preenchida só no absorvido: some com ele, e por isso vai para o Excel. */
  perdidos: CampoPerdido[];
}

const comoTexto = (valor: unknown): string | null => {
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date) return valor.toISOString();
  return typeof valor === "object" ? JSON.stringify(valor) : String(valor);
};

/**
 * Compara campo a campo o canônico com os absorvidos.
 *
 * Fail closed por padrão: **toda** coluna que não está declarada como neutra
 * é material. Coluna nova no schema nasce bloqueando o grupo, em vez de ser
 * fundida em silêncio por ninguém ter lembrado de listá-la.
 *
 * Valor diferente dos dois lados = conflito (grupo bloqueado). Valor só no
 * absorvido = perda declarada: não impede a consolidação, mas vai inteiro
 * para o Excel e para o PLAN, porque some junto com o registro.
 */
export function compararCampos(
  canonico: RegistroDoGrupo,
  absorvidos: readonly RegistroDoGrupo[],
  cadastro: CadastroMestreNoBanco,
): LeituraDeCampos {
  const neutras = new Set(cadastro.colunasNeutras);
  const colunas = [...new Set([canonico, ...absorvidos].flatMap((r) => Object.keys(r.dados)))]
    .filter((coluna) => !neutras.has(coluna))
    .sort();

  const conflitos: ConflitoDeCampo[] = [];
  const perdidos: CampoPerdido[] = [];

  for (const coluna of colunas) {
    const doCanonico = comoTexto(canonico.dados[coluna]);
    const divergentes = new Set<string>();
    const soDoAbsorvido: CampoPerdido[] = [];
    for (const absorvido of absorvidos) {
      const dele = comoTexto(absorvido.dados[coluna]);
      if (dele === null) continue;
      if (doCanonico === null) {
        soDoAbsorvido.push({ coluna, codigo: absorvido.codigo, valor: dele });
        divergentes.add(dele);
        continue;
      }
      if (dele !== doCanonico) divergentes.add(dele);
    }

    // Canônico vazio e um valor só: perda declarada, não conflito — não há
    // duas versões da verdade, há uma que some com o registro.
    if (doCanonico === null && divergentes.size <= 1) {
      perdidos.push(...soDoAbsorvido);
      continue;
    }
    // Canônico vazio e valores diferentes entre os absorvidos ainda é
    // conflito: as linhas não descrevem a mesma coisa, mesmo que nenhuma
    // delas fosse sobreviver.
    if (divergentes.size > 0) {
      const valores = doCanonico === null ? [...divergentes].sort() : [doCanonico, ...[...divergentes].sort()];
      conflitos.push({ coluna, valores });
    }
  }

  return { conflitos, perdidos };
}

/* ------------------------------------------------------------------ *
 * Consolidação de campo no canônico (Onda 2)
 * ------------------------------------------------------------------ */

/** Separador dos termos consolidados — o mesmo do arquivo de decisão. */
export const SEPARADOR_DE_TERMOS = " · ";

/**
 * Dois termos são o mesmo termo? `trim` e sem caixa — a mesma regra do nome,
 * acento contando.
 *
 * Asterisco NÃO é removido: "Clorogênico" e "Clorogênico**" são termos
 * diferentes para a regra. O que o `*`/`**` da planilha legada significa é a
 * pergunta V4, aberta com a Veridi; juntar os dois é decisão, e mora na
 * decisão do grupo (`equivalentes`), nunca aqui.
 */
export function chaveDoTermo(termo: string): string {
  return termo.trim().toUpperCase();
}

/** Por que um termo sumiu da consolidação. */
export type MotivoDoFundido = "caixa" | "decisão";

export interface Consolidacao {
  /** "A · B · C", ou `null` quando nenhum registro tinha valor. */
  valor: string | null;
  /** Termo que ficou em outra grafia: só pela caixa, ou por equivalência declarada na decisão. */
  fundidos: { termo: string; em: string; motivo: MotivoDoFundido }[];
}

/**
 * Junta os valores de um campo dos registros de um grupo, na ORDEM dada:
 *
 *  - valor já consolidado entra termo a termo (rodar de novo dá o mesmo);
 *  - espaço nas pontas sai, termo vazio sai;
 *  - termo repetido (mesma chave: `trim` + caixa) fica uma vez só, na PRIMEIRA
 *    grafia encontrada;
 *  - `equivalentes` é o que a DECISÃO do grupo declara igual — `{ "Clorogênico":
 *    "Clorogênico**" }` — e vale só para quem a passa: o termo da esquerda vira
 *    o da direita antes de comparar. Sem declaração, termo diferente continua
 *    diferente;
 *  - nada é inventado: só entra termo que já estava em algum registro, ou a
 *    grafia que a decisão declarou para ele.
 *
 * Quem chama decide a ordem — na Onda 2, o canônico primeiro e depois os
 * absorvidos pelo código, para o valor de antes ser o começo do valor de
 * depois.
 */
export function consolidarTermos(
  valores: readonly (string | null | undefined)[],
  equivalentes: Readonly<Record<string, string>> = {},
): Consolidacao {
  const termos: string[] = [];
  const porChave = new Map<string, string>();
  const fundidos: Consolidacao["fundidos"] = [];
  for (const valor of valores) {
    if (valor === null || valor === undefined) continue;
    for (const parte of valor.split(/\s*·\s*/u)) {
      const original = parte.trim();
      const declarado = equivalentes[original];
      const termo = declarado ?? original;
      const chave = chaveDoTermo(termo);
      if (!chave) continue;
      const existente = porChave.get(chave);
      if (existente === undefined) {
        porChave.set(chave, termo);
        termos.push(termo);
        if (declarado !== undefined && declarado !== original) {
          fundidos.push({ termo: original, em: termo, motivo: "decisão" });
        }
      } else if (existente !== original && !fundidos.some((f) => f.termo === original && f.em === existente)) {
        fundidos.push({ termo: original, em: existente, motivo: declarado !== undefined ? "decisão" : "caixa" });
      }
    }
  }
  return { valor: termos.length > 0 ? termos.join(SEPARADOR_DE_TERMOS) : null, fundidos };
}

/**
 * O porquê de um termo fundido, em texto. Sem motivo (plano gravado antes de o
 * motivo existir) não inventa um: diz só que ficou a outra grafia.
 */
export function motivoDoFundidoEmTexto(motivo: MotivoDoFundido | undefined): string {
  if (motivo === "decisão") return "equivalência declarada na decisão do grupo";
  if (motivo === "caixa") return "só difere por caixa";
  return "mesmo termo";
}
