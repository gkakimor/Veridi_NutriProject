import type {
  FormulationComponentBasis,
  FormulationComponentQuantityMode,
  ItemFamily,
  ItemType,
  PackagingSubtype,
  SecaoDaFormula,
  SupplyResponsibility,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { SECAO_DO_TIPO_DE_ITEM, ajustesAutorizados } from "@veridi/shared";
import { decimalLegivel } from "../../lib/decimal-field";
import { numericInvalidMessage, parsePtBrNumber, toPtBrEditText } from "../../lib/numeric-ptbr";
import { OPCOES_PERCENTUAL_TECNICO, OPCOES_QUANTIDADE } from "../../lib/numeric-scales";
import { errosDosAjustes } from "./ajustes-da-quantidade";
import type { AjustesDaQuantidade } from "./ajustes-da-quantidade";
import type { ItemDaBancada } from "./catalogo-de-itens";

/**
 * A LINHA DA RECEITA — o contrato que as duas bancadas editam.
 *
 * Formulação de produto e Modelo de Formulação escrevem a MESMA receita: item,
 * quantidade, unidade, base, fornecimento, pureza e reserva. O que difere entre
 * as telas é o DOCUMENTO em volta (produto, cliente, custo, ciclo de vida), não
 * a linha — e enquanto cada tela tinha a sua estrutura, a mesma regra precisava
 * ser escrita duas vezes e divergia na primeira correção feita de um lado só.
 *
 * Os nomes são os do DTO da Formulação, e a fatia 1 já alinhou o componente do
 * Modelo a eles: uma leitura só serve às duas telas.
 */
export interface LinhaDaReceita {
  key: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemActive: boolean;
  stockUnitCode: string;
  quantity: string;
  unitCode: string;
  basis: FormulationComponentBasis;
  supplyResponsibility: SupplyResponsibility;
  purityPercentApplied: string;
  overagePercent: string;
  quantityMode: FormulationComponentQuantityMode;
  applyPurityAdjustment: boolean;
  applyOverageAdjustment: boolean;
  notes: string;
  /**
   * Grandezas AUTORITATIVAS do servidor, por unidade acabada e na unidade de
   * estoque. Nada aqui é recalculado a partir de pureza, overage, doses ou
   * conversão: a prévia do rascunho chama a mesma função do motor, e a versão
   * gravada usa o que a API já respondeu. O Modelo não tem servidor que as
   * calcule — ali elas são sempre `null`, e a prévia responde por elas.
   */
  theoreticalPerUnit: string | null;
  physicalPerUnit: string | null;
  /**
   * As mesmas grandezas por DOSE e por CÁPSULA, na unidade declarada. Do
   * servidor na versão gravada; da prévia (mesma função) enquanto se edita.
   */
  theoreticalPerDose: string | null;
  physicalPerDose: string | null;
  physicalPerCapsule: string | null;
  /** Tipo real do Item — decide a seção. `null` enquanto a linha não tem item. */
  itemType: ItemType | null;
  /** Onde a linha nasceu, usado só enquanto ela não tem item. */
  secao: SecaoDaFormula;
  /** Cadastro do Item, para a linha explicar de onde veio — nunca cálculo. */
  itemSourceName: string | null;
  itemDeclaredNutrient: string | null;
  itemFamily: ItemFamily | null;
  itemPackagingSubtype: PackagingSubtype | null;
  /** Pureza do cadastro HOJE; a aplicada nesta versão é `purityPercentApplied`. */
  itemDefaultPurityPercent: string | null;
  /** Código do sistema legado do Item. `null` = item sem legado, e a linha cala. */
  itemExternalCode: string | null;
}

let sequenciaDaChave = 0;

export function proximaChaveDaLinha(): string {
  sequenciaDaChave += 1;
  return `component-${sequenciaDaChave}`;
}

/**
 * O contador reinicia junto com o módulo, e o rascunho atravessa um F5 na
 * tela de cadastro de item: sem empurrá-lo para além das chaves
 * restauradas, "Adicionar componente" devolveria uma chave que uma linha já
 * usa — e duas linhas passariam a mudar juntas.
 */
export function absorverChaves(linhas: { key: string }[]) {
  for (const linha of linhas) {
    const numero = Number(linha.key.split("-")[1]);
    if (Number.isFinite(numero) && numero > sequenciaDaChave) sequenciaDaChave = numero;
  }
}

/** Onde a linha aparece: o tipo real do Item manda; sem item, onde ela nasceu. */
export function secaoDaLinha(row: Pick<LinhaDaReceita, "itemType" | "secao">): SecaoDaFormula {
  return row.itemType ? (SECAO_DO_TIPO_DE_ITEM[row.itemType] ?? "COMPOSICAO") : row.secao;
}

/** A configuração de ajustes da linha — a forma que a validação compartilhada lê. */
export function ajustesDaLinha(row: LinhaDaReceita): AjustesDaQuantidade {
  return {
    quantityMode: row.quantityMode,
    purityPercentApplied: row.purityPercentApplied,
    overagePercent: row.overagePercent,
    applyPurityAdjustment: row.applyPurityAdjustment,
    applyOverageAdjustment: row.applyOverageAdjustment,
  };
}

/**
 * O CONTRATO da bancada, numa linha de matéria-prima: a pureza informada
 * participa da conta, e a reserva de produção não.
 *
 * Antes, preencher a pureza não bastava — era preciso abrir um painel, trocar
 * o modo da quantidade e marcar uma caixa. Três gestos para dizer o que a
 * planilha da Veridi diz com um número, e dois estados possíveis para a mesma
 * coluna preenchida: quem lia "70" não sabia se a conta usava 70. Agora a
 * coluna É a resposta — física por dose = alvo ÷ (pureza ÷ 100), pelo motor de
 * sempre.
 *
 * A RESERVA DE PRODUÇÃO (`overagePercent`) fica registrada e NUNCA multiplica a
 * dose: ela é percentual previsto para o lote, e a planilha real traz 10% no
 * Ácido Fólico e 2% no Beef sem que a dose formulada mude. Aplicá-la aqui
 * inflaria a dose de cada cápsula.
 *
 * Vale só na COMPOSIÇÃO: a linha de embalagem não tem pureza, e mexer no modo
 * dela seria reescrever configuração que ninguém pediu para mudar.
 */
export function comAjustesDaBancada(row: LinhaDaReceita): LinhaDaReceita {
  if (secaoDaLinha(row) !== "COMPOSICAO") return row;
  const pureza = decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO);
  const corrigePelaPureza = pureza !== null && Number(pureza) > 0;
  return {
    ...row,
    quantityMode: corrigePelaPureza ? "THEORETICAL_WITH_ADJUSTMENTS" : "PHYSICAL_DIRECT",
    applyPurityAdjustment: corrigePelaPureza,
    applyOverageAdjustment: false,
  };
}

/**
 * Esta linha tem pureza gravada que a conta NÃO usa?
 *
 * Só acontece em versão histórica, gravada sob o contrato antigo (pureza
 * registrada sem autorizar a correção). A tela diz isso onde acontece, porque
 * um documento fechado que mostra "70%" ao lado de um físico não corrigido
 * estaria mentindo por omissão. Num rascunho a resposta é sempre `false`: o
 * contrato de hoje não produz esse estado.
 */
export function purezaRegistradaSemAplicar(row: LinhaDaReceita): boolean {
  return row.purityPercentApplied.trim() !== "" && !ajustesAutorizados(row).purity;
}

/**
 * Validação por CAMPO e por LINHA, antes de qualquer chamada.
 *
 * `exigirDecimal` interrompia na primeira recusa com uma frase na faixa do
 * topo. Numa receita de doze linhas isso obrigava a procurar a linha — e se o
 * campo morasse no painel de ajustes fechado, nem havia pista. Cada erro agora
 * nomeia o componente E o campo, marca o próprio campo (`aria-invalid`, mensagem
 * ligada por `aria-describedby`) e a tela leva a pessoa até o primeiro deles.
 */
export type CampoDoComponente =
  | "quantity"
  | "unitCode"
  | "purityPercentApplied"
  | "overagePercent";

/** Ordem de leitura na linha: é a ordem em que o primeiro erro é escolhido. */
export const CAMPOS_DO_COMPONENTE: readonly CampoDoComponente[] = [
  "quantity",
  "unitCode",
  "purityPercentApplied",
  "overagePercent",
];

/** Um id só por campo: o input, a mensagem e o foco falam dele pelo mesmo nome. */
export function idDoCampo(rowKey: string, campo: CampoDoComponente): string {
  return `comp-${rowKey}-${campo}`;
}

export function chaveDeErro(rowKey: string, campo: CampoDoComponente): string {
  return `components.${rowKey}.${campo}`;
}

/**
 * Como a reserva de matéria-prima se chama NA TELA das duas bancadas.
 *
 * `overagePercent` continua interno; a recusa nomeia o campo que a pessoa vê.
 */
export const ROTULO_DA_RESERVA = "Reserva %";

/**
 * A unidade GRAVADA que a lista da linha não oferece — `null` quando está tudo
 * certo.
 *
 * Acontece em receita antiga: unidade fora do catálogo (`abc`) ou de outra
 * dimensão que a do Item (um `un` numa matéria-prima em massa). Ela NÃO é
 * trocada em silêncio — o que está gravado continua à vista, porque trocar
 * sozinho mudaria o que a quantidade quer dizer —, e a linha diz o que fazer.
 * Só se julga com o Item na mão e com o catálogo carregado: antes disso, "não
 * está na lista" é só "ainda não chegou".
 */
export function unidadeLegadaDaLinha(
  row: Pick<LinhaDaReceita, "itemId" | "unitCode">,
  unidades: { code: string }[],
): string | null {
  if (row.itemId === "" || unidades.length === 0) return null;
  if (unidades.some((unidade) => unidade.code === row.unitCode)) return null;
  return row.unitCode
    ? `Unidade inválida ou legada: ${row.unitCode}. Escolha uma unidade da lista.`
    : "Escolha a unidade do componente.";
}

/** Regras de uma linha — as mesmas que o servidor aplica, ditas antes de enviar. */
export function errosDaLinha(row: LinhaDaReceita): Partial<Record<CampoDoComponente, string>> {
  const nome = row.itemCode || row.itemName || "Componente";
  const erros: Partial<Record<CampoDoComponente, string>> = {};

  const quantidade = parsePtBrNumber(row.quantity, OPCOES_QUANTIDADE);
  if (quantidade.tipo === "vazio") {
    erros.quantity = `${nome} — Quantidade é obrigatória.`;
  } else if (quantidade.tipo === "invalido") {
    erros.quantity = `${nome} — ${numericInvalidMessage("Quantidade", quantidade.motivo, OPCOES_QUANTIDADE)}`;
  } else if (/^[0.]+$/.test(quantidade.valor)) {
    erros.quantity = `${nome} — Quantidade deve ser maior que zero.`;
  }
  if (!row.unitCode) erros.unitCode = `${nome} — Unidade é obrigatória.`;

  // Pureza e reserva: as mesmas regras nas duas bancadas, num lugar só.
  return {
    ...erros,
    ...errosDosAjustes(ajustesDaLinha(row), nome, ROTULO_DA_RESERVA),
  };
}

/**
 * Linha nova, na seção em que a pessoa clicou.
 *
 * MATÉRIA-PRIMA nasce como a bancada pergunta: a quantidade digitada é o ALVO
 * ATIVO por dose, e a pureza do cadastro corrige a quantidade física
 * (FORMULATION-WORKBENCH-01). A correção fica visível na coluna Pureza — é
 * escolha declarada da linha, não regra escondida.
 *
 * EMBALAGEM nasce por unidade acabada e com quantidade FÍSICA informada:
 * pureza não se aplica a um pote.
 */
export function linhaNova(secao: SecaoDaFormula, receitaPorDose: boolean): LinhaDaReceita {
  const daComposicao = secao === "COMPOSICAO";
  return {
    key: proximaChaveDaLinha(),
    itemId: "",
    itemCode: "",
    itemName: "",
    itemActive: true,
    stockUnitCode: "",
    quantity: "",
    unitCode: "",
    basis: daComposicao ? (receitaPorDose ? "PER_DOSE" : "FIXED_BASIS") : "PER_FINISHED_UNIT",
    // Default do domínio: a Veridi fornece, salvo declaração explícita.
    supplyResponsibility: "VERIDI",
    purityPercentApplied: "",
    overagePercent: "",
    quantityMode: daComposicao ? "THEORETICAL_WITH_ADJUSTMENTS" : "PHYSICAL_DIRECT",
    applyPurityAdjustment: daComposicao,
    applyOverageAdjustment: false,
    notes: "",
    // Linha em branco não tem grandeza calculada: `null` vira travessão,
    // e a prévia assume assim que houver item e quantidade.
    theoreticalPerUnit: null,
    physicalPerUnit: null,
    theoreticalPerDose: null,
    physicalPerDose: null,
    physicalPerCapsule: null,
    itemType: null,
    secao,
    itemSourceName: null,
    itemDeclaredNutrient: null,
    itemFamily: null,
    itemPackagingSubtype: null,
    itemDefaultPurityPercent: null,
    itemExternalCode: null,
  };
}

/**
 * A linha com o item escolhido — e com o que o cadastro do Item já sabe.
 *
 * Fonte, nutriente, família e pureza vêm do cadastro: redigitar o que já está
 * cadastrado é trabalho repetido e é divergência esperando acontecer. A pureza
 * entra como a APLICADA desta versão (snapshot) — mudar o cadastro depois não
 * reescreve versão nenhuma —, e ela é do ITEM: trocar o item não mantém a
 * pureza do anterior.
 *
 * A unidade mantém a que estava quando ela serve ao item novo (trocar o item
 * não pode transformar `500 mg` em `500 kg`) e só cai na unidade de estoque
 * quando a atual é de outra dimensão. Linha por dose em massa nasce em mg, que
 * é como a formulação é escrita.
 */
export function comItemEscolhido(
  row: LinhaDaReceita,
  item: ItemDaBancada | undefined,
  units: UnitOfMeasureDTO[],
): LinhaDaReceita {
  if (!item) {
    return {
      ...row,
      itemId: "",
      itemCode: "",
      itemName: "",
      itemActive: true,
      itemType: null,
      stockUnitCode: "",
      unitCode: "",
      itemSourceName: null,
      itemDeclaredNutrient: null,
      itemFamily: null,
      itemPackagingSubtype: null,
      itemDefaultPurityPercent: null,
      itemExternalCode: null,
    };
  }
  const dimensaoAtual = units.find((unit) => unit.code === row.unitCode)?.dimension ?? null;
  const mantemUnidade = dimensaoAtual !== null && dimensaoAtual === item.unitDimension;
  const unidadePadrao =
    item.unitDimension === "MASS" && row.basis === "PER_DOSE" && units.some((u) => u.code === "mg")
      ? "mg"
      : item.unitCode;
  const daComposicao = (SECAO_DO_TIPO_DE_ITEM[item.type] ?? "COMPOSICAO") === "COMPOSICAO";
  return comAjustesDaBancada({
    ...row,
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    itemActive: item.active,
    itemType: item.type,
    stockUnitCode: item.unitCode,
    unitCode: mantemUnidade ? row.unitCode : unidadePadrao,
    itemSourceName: item.sourceName,
    itemDeclaredNutrient: item.declaredNutrient,
    itemFamily: item.family,
    itemPackagingSubtype: item.packagingSubtype,
    itemDefaultPurityPercent: item.defaultPurityPercent,
    itemExternalCode: item.externalCode,
    purityPercentApplied: daComposicao
      ? toPtBrEditText(item.defaultPurityPercent, OPCOES_PERCENTUAL_TECNICO)
      : "",
  });
}
