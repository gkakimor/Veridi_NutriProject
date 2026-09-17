/**
 * Classificação dos models do schema para `prod-cleanup.mjs`, e a ordem de
 * remoção que as FKs reais impõem a eles.
 *
 * Módulo puro — sem Prisma, sem ambiente, sem efeito ao importar — para o
 * script e a suíte de scripts lerem as MESMAS listas e a MESMA ordem. O
 * cleanup aborta, até em dry-run, quando o schema tem model fora das três
 * listas: por isso todo model novo entra aqui, em exatamente uma.
 * `prod-cleanup-models.test.ts` confere essa paridade contra o
 * `schema.prisma` versionado.
 */

/** Nome do model -> propriedade do client (Prisma minúscula a 1ª letra). */
export const propDoModel = (nome) => nome.charAt(0).toLowerCase() + nome.slice(1);

/**
 * Tabelas a esvaziar. É um CONJUNTO, não uma ordem: a ordem de remoção é
 * calculada em `calcularOrdem()` a partir das FKs REAIS do banco.
 *
 * Confiar no schema Prisma aqui seria errado — o Prisma documenta várias
 * dessas relações como opcionais (o que sugeriria SET NULL), mas a migration
 * criou `ON DELETE RESTRICT` no Postgres. Foi exatamente isso que derrubou a
 * primeira tentativa em `lots_productionOrderId_fkey`. A fonte da verdade é
 * o `pg_constraint`, não o `schema.prisma`.
 */
export const ALVOS = [
  // Razão de estoque e anexos: folhas puras. Vão primeiro para a contagem
  // sair honesta — se fossem depois, o CASCADE dos pais levaria as linhas
  // embora e o relatório diria "0 removidos".
  "InventoryMovement",
  "Attachment",

  // Inventário físico (INV-): registros, achados, posições e a contagem.
  // Posição e registro se apontam em ciclo — ver `calcularOrdem()`.
  "StockCountEntry",
  "StockCountFinding",
  "StockCountPosition",
  "StockCount",

  // Faturamento e expedição
  "BillingLine",
  "Billing",
  "ShipmentLine",
  "Shipment",

  // Reservas do pedido de venda
  "CustomerOrderReservationLine",
  "CustomerOrderReservation",

  // Produção (pesagens, snapshots, roteiro e agenda da OP, saídas, consumos,
  // reservas, ordens)
  "RecipeWeighing",
  "ProductionOrderCostSnapshot",
  "ProductionOrderPlanningSnapshot",
  "ProductionOrderSchedule",
  "ProductionOutput",
  "ProductionConsumption",
  "MaterialReservationLine",
  "MaterialReservation",
  "ProductionOrderPart",
  "ProductionOrderRequirement",
  "ProductionOrder",

  // Documentação controlada (R.PRO.002, R.COQ.003). Nasce pela tela da
  // Qualidade e é opcional na liberação da OP: configuração de negócio, não
  // dado de referência sem o qual a instalação não existe.
  "ControlledDocumentRevision",

  // Pedidos de venda e entregas programadas
  "CustomerOrderDeliveryLine",
  "CustomerOrderDelivery",
  "CustomerOrderLine",
  "CustomerOrder",

  // Orçamentos
  "QuoteLine",
  "QuoteVersion",

  // Precificação
  "PricingTier",
  "PricingVersion",

  // Custo industrial
  "IndustrialCostCalculation",
  "IndustrialCostResourceUsage",
  "IndustrialCostLine",
  "IndustrialCostVersion",

  // Projetos e amostras
  "SampleConsumption",
  "ProjectSample",
  "ProjectProduct",
  "ProjectStatusHistory",
  "Project",

  // Formulação
  "FormulationComponent",
  "FormulationVersion",

  // Recebimento e compras
  "ReceiptLine",
  "Receipt",
  "PurchaseOrderLine",
  "PurchaseOrder",

  // Relação item x fornecedor
  "SupplierItemOffer",
  "SupplierItemQualificationHistory",
  "SupplierItem",

  // Estoque físico
  "Lot",

  // Cadastros de produto
  "Product",

  // Perfis de produção (PPR-): o Produto aponta para a versão padrão, e o
  // recurso da etapa aponta para o recurso industrial.
  "ProductionProfileStepResource",
  "ProductionProfileStep",
  "ProductionProfileVersion",
  "ProductionProfile",

  // Templates (antes de Item e IndustrialResource: apontam para eles)
  "FormulationTemplateComponent",
  "FormulationTemplateVersion",
  "FormulationTemplate",
  "IndustrialCostTemplateResourceUsage",
  "IndustrialCostTemplateAdditionalCost",
  "IndustrialCostTemplateVersion",
  "IndustrialCostTemplate",
  "PricingPolicyTemplateTier",
  "PricingPolicyTemplateVersion",
  "PricingPolicyTemplate",

  // Cadastros base. A versão do arquivo de rótulo sai com o Item; o objeto
  // no storage não é tocado por este script.
  "ItemLabelFileVersion",
  "ItemCostReference",
  "Item",
  "Supplier",
  "CustomerStatusHistory",
  "Customer",
  "IndustrialResourceRate",
  "IndustrialResource",
];

/**
 * O que a limpeza mantém: as contas de login, com as sessões e as preferências
 * de tela de cada uma; o dado de referência do sistema; e a configuração do
 * ambiente — o calendário produtivo (jornada semanal e exceções) é da fábrica,
 * não transação que deva desaparecer.
 */
export const PRESERVAR = [
  "User",
  "UserSession",
  "UserPreference",
  "UnitOfMeasure",
  "ProductionCalendar",
  "ProductionCalendarWeekday",
  "ProductionCalendarException",
];

/**
 * Contadores que não são sequence do Postgres e fazem o mesmo papel.
 * `ProductionOrderNumberCounter` é a numeração oficial anual da OP (001/26):
 * esvaziado só com `--reset-sequences`; sem a flag, preservado.
 */
export const CONTADORES = ["ProductionOrderNumberCounter"];

/**
 * Confere as listas contra os models do schema. Tudo vazio = pode seguir;
 * qualquer nome em qualquer campo é tabela órfã ou ambígua, e isso é decisão
 * de gente, não do script.
 */
export function conferirClassificacao(modelsDoSchema, listas = { ALVOS, PRESERVAR, CONTADORES }) {
  const nomes = Object.keys(listas);
  const classificados = new Set(Object.values(listas).flat());
  return {
    semClassificacao: modelsDoSchema.filter((m) => !classificados.has(m)).sort(),
    emMaisDeUmaLista: [...classificados].filter((m) => nomes.filter((n) => listas[n].includes(m)).length > 1).sort(),
    repetidosNaLista: [...new Set(nomes.flatMap((n) => listas[n].filter((m, i) => listas[n].indexOf(m) !== i)))].sort(),
    semModel: [...classificados].filter((m) => !modelsDoSchema.includes(m)).sort(),
  };
}

/** Letras de `pg_constraint.confdeltype` que impõem ordem: RESTRICT, NO ACTION, CASCADE. */
const ORDENAM = ["r", "a", "c"];

/**
 * Ordem de remoção calculada a partir das FKs REAIS (`pg_constraint`), em
 * TABELAS — quem chama traduz para model.
 *
 * Aresta `filho -> pai` significa "filho sai antes do pai". Entram no grafo
 * RESTRICT/NO ACTION (que travam de verdade) e também CASCADE — CASCADE não
 * travaria, mas se o pai fosse primeiro o banco levaria o filho junto e a
 * contagem informada viraria mentira. SET NULL não impõe ordem.
 *
 * CASCADE que fecha ciclo não ordena. A contagem física tem um: a posição
 * aponta para o registro que vale (`validEntryId`, NO ACTION) e o registro
 * aponta de volta para a posição (`positionId`, CASCADE). Nenhuma ordem
 * atende as duas arestas. O NO ACTION decide: a posição sai primeiro, o banco
 * leva os registros na mesma instrução, e a checagem do NO ACTION — no fim
 * da instrução — já não acha posição apontando para eles. O CASCADE volta em
 * `cascatasEmCiclo`, para a remoção contar o que ele levou. Ciclo só de
 * RESTRICT/NO ACTION continua abortando: esse nenhuma ordem desfaz.
 */
export function calcularOrdem(fks, alvoTabelas) {
  const ordenam = fks.filter(
    (fk) =>
      alvoTabelas.has(fk.src) &&
      alvoTabelas.has(fk.tgt) &&
      fk.src !== fk.tgt && // auto-referência: some no mesmo DELETE
      ORDENAM.includes(fk.acao),
  );

  /** Tabela -> tabelas que só saem depois dela. Aresta repetida conta uma vez. */
  const grafo = (arestas) => {
    const pais = new Map([...alvoTabelas].map((t) => [t, new Set()]));
    for (const fk of arestas) pais.get(fk.src).add(fk.tgt);
    return pais;
  };
  const todas = grafo(ordenam);
  const alcanca = (de, ate) => {
    const vistas = new Set();
    const pilha = [de];
    while (pilha.length) {
      const t = pilha.pop();
      if (t === ate) return true;
      if (vistas.has(t)) continue;
      vistas.add(t);
      pilha.push(...todas.get(t));
    }
    return false;
  };
  // `filho -> pai` fecha ciclo quando o pai alcança o filho.
  const cascatasEmCiclo = ordenam.filter((fk) => fk.acao === "c" && alcanca(fk.tgt, fk.src));

  // `libera`: ao remover o filho, o pai fica um pré-requisito mais perto de
  // poder sair. `pendentes[pai]` = quantos filhos ainda precisam sair antes.
  const libera = grafo(ordenam.filter((fk) => !cascatasEmCiclo.includes(fk)));
  const pendentes = new Map([...alvoTabelas].map((t) => [t, 0]));
  for (const pais of libera.values()) for (const pai of pais) pendentes.set(pai, pendentes.get(pai) + 1);

  // Kahn, com desempate alfabético para a ordem ser reproduzível.
  // Sai primeiro quem ninguém referencia (folha), por último a raiz.
  const ordem = [];
  const prontos = [...alvoTabelas].filter((t) => pendentes.get(t) === 0).sort();
  while (prontos.length) {
    const t = prontos.shift();
    ordem.push(t);
    for (const pai of [...libera.get(t)].sort()) {
      pendentes.set(pai, pendentes.get(pai) - 1);
      if (pendentes.get(pai) === 0) {
        prontos.push(pai);
        prontos.sort();
      }
    }
  }

  if (ordem.length !== alvoTabelas.size) {
    const presas = [...alvoTabelas].filter((t) => !ordem.includes(t));
    throw new Error(`Ciclo de FK impede ordenar: ${presas.join(", ")}`);
  }
  return { ordem, cascatasEmCiclo };
}

/**
 * Apaga cada model na ordem, pela transação `tx`, e devolve quantas linhas
 * saíram de cada um. `levaJunto` (model pai -> models filhos) são os CASCADE
 * em ciclo: o filho é contado antes e depois do DELETE do pai, e o que o pai
 * levou entra na conta do filho — sem isso o relatório diria "0 removidos"
 * para linhas que saíram.
 */
export async function removerNaOrdem(tx, ordem, levaJunto = new Map(), aoRemover = () => {}) {
  const levadas = new Map();
  const resultado = [];
  for (const model of ordem) {
    const filhos = [...(levaJunto.get(model) ?? [])];
    const antes = new Map();
    for (const filho of filhos) antes.set(filho, await tx[propDoModel(filho)].count());
    const { count } = await tx[propDoModel(model)].deleteMany({});
    for (const filho of filhos) {
      const levou = antes.get(filho) - (await tx[propDoModel(filho)].count());
      levadas.set(filho, (levadas.get(filho) ?? 0) + levou);
    }
    const peloCascade = levadas.get(model) ?? 0;
    const linha = { model, removidos: count + peloCascade, peloCascade };
    resultado.push(linha);
    aoRemover(linha);
  }
  return resultado;
}
