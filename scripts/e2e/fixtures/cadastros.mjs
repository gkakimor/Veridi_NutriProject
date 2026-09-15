import { exigir } from "./api.mjs";
import { carimbar } from "./run.mjs";

/**
 * Cadastros básicos por API — massa de PRÉ-CONDIÇÃO, nunca o que se prova.
 *
 * Cada fixture recebe a `api` autenticada e a execução (`criarRun`), carimba o
 * nome com o runId, devolve id e código LIDOS da resposta, e não navega nem
 * afirma regra de negócio. Não procura registro existente: nada de "primeiro
 * cliente", nada de código da carga da Veridi. Quando o cadastro É o assunto da
 * suíte, ele nasce pela tela — não por aqui.
 */

function nomeCarimbado(run, nome, rotulo) {
  if (!run?.carimbo) throw new Error("fixture sem execução: passe o run de criarRun()");
  const final = nome ?? carimbar(run, rotulo);
  if (!final.includes(run.carimbo)) {
    throw new Error(`fixture: "${final}" não traz o carimbo ${run.carimbo} desta execução`);
  }
  return final;
}

export async function criarCliente(api, run, { nome, ...campos } = {}) {
  const cliente = await exigir(api, "POST", "/customers", {
    ...campos,
    legalName: nomeCarimbado(run, nome, "Cliente"),
  });
  return { id: cliente.id, codigo: cliente.code, nome: cliente.legalName };
}

export async function criarFornecedor(api, run, { nome, ...campos } = {}) {
  const fornecedor = await exigir(api, "POST", "/suppliers", {
    ...campos,
    legalName: nomeCarimbado(run, nome, "Fornecedor"),
  });
  return { id: fornecedor.id, codigo: fornecedor.code, nome: fornecedor.legalName };
}

/**
 * Item de estoque. Lote, validade e liberação seguem o padrão do tipo quando
 * omitidos — informe só o que a suíte precisa garantir.
 */
export async function criarItem(
  api,
  run,
  { nome, tipo = "RAW_MATERIAL", unidade = "kg", controlaLote, controlaValidade, exigeLiberacao, custoDeReferencia } = {},
) {
  const corpo = {
    type: tipo,
    name: nomeCarimbado(run, nome, tipo === "PACKAGING" ? "Embalagem" : "Insumo"),
    unitCode: unidade,
  };
  if (controlaLote !== undefined) corpo.controlsLot = controlaLote;
  if (controlaValidade !== undefined) corpo.controlsExpiry = controlaValidade;
  if (exigeLiberacao !== undefined) corpo.requiresQualityRelease = exigeLiberacao;
  if (custoDeReferencia !== undefined) {
    corpo.initialCostReference = { unitCost: String(custoDeReferencia), uomCode: unidade };
  }
  const item = await exigir(api, "POST", "/items", corpo);
  return {
    id: item.id,
    codigo: item.code,
    nome: item.name,
    tipo: item.type,
    unidade: item.unitCode,
    controlaLote: item.controlsLot,
    controlaValidade: item.controlsExpiry,
  };
}

/**
 * Produto que a operação aceita (ciclo APPROVED), do cliente informado, com o
 * item de produto acabado criado junto — o caminho normal do cadastro.
 */
export async function criarProdutoOperacional(api, run, { cliente, nome, unidade = "un", unidadesPorCaixa } = {}) {
  if (!cliente?.id) throw new Error("criarProdutoOperacional exige o cliente desta execução");
  const corpo = { name: nomeCarimbado(run, nome, "Produto"), customerId: cliente.id, finishedUnitCode: unidade };
  if (unidadesPorCaixa !== undefined) corpo.unitsPerShippingBox = Number(unidadesPorCaixa);
  const produto = await exigir(api, "POST", "/products", corpo);
  if (produto.lifecycle !== "APPROVED" || !produto.finishedProductItemId) {
    throw new Error(
      `produto ${produto.code} não nasceu operacional (${produto.lifecycle}, item acabado ${produto.finishedProductItemId ?? "ausente"})`,
    );
  }
  return {
    id: produto.id,
    codigo: produto.code,
    nome: produto.name,
    itemAcabadoId: produto.finishedProductItemId,
    unidade,
  };
}

/**
 * Formulação ATIVA do produto: o rascunho do próprio produto (ou um novo), com
 * os componentes informados, ativado. Lança se não terminar ACTIVE.
 *
 *   await criarFormulacaoAtiva(api, run, {
 *     produto,
 *     componentes: [{ item, quantidade: "0.5", unidade: "g" }],
 *   });
 */
export async function criarFormulacaoAtiva(api, run, { produto, componentes, base = "1" } = {}) {
  if (!run?.carimbo) throw new Error("fixture sem execução: passe o run de criarRun()");
  if (!produto?.id) throw new Error("criarFormulacaoAtiva exige o produto desta execução");
  if (!Array.isArray(componentes) || componentes.length === 0) {
    throw new Error("criarFormulacaoAtiva exige ao menos um componente");
  }
  const notas = `Massa E2E ${run.carimbo}`;
  const { versions } = await exigir(api, "GET", `/products/${produto.id}/formulations`);
  const rascunho =
    versions.find((versao) => versao.status === "DRAFT") ??
    (await exigir(api, "POST", `/products/${produto.id}/formulation-versions`, { notes: notas }));
  await exigir(api, "PATCH", `/formulation-versions/${rascunho.id}`, {
    basisQuantity: String(base),
    notes: notas,
    components: componentes.map(({ item, quantidade, unidade }) => ({
      itemId: item.id,
      quantity: String(quantidade),
      unitCode: unidade ?? item.unidade,
    })),
  });
  const ativa = await exigir(api, "POST", `/formulation-versions/${rascunho.id}/activate`);
  if (ativa.status !== "ACTIVE") {
    throw new Error(`formulação V${ativa.versionNumber} de ${produto.codigo} ficou ${ativa.status}, não ACTIVE`);
  }
  return { id: ativa.id, numero: ativa.versionNumber, status: ativa.status };
}
