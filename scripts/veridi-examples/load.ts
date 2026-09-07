import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { CORPUS_DIR, parseCsv } from "../veridi-data/corpus.js";
import { assertImportEnvironment, hasApplyFlag } from "../veridi-import/environment.js";
import { nextSequenceCode } from "../../apps/api/src/lib/sequence-code.js";

/**
 * Pacote de EXEMPLOS: recursos industriais, tarifas, template de Formulação e
 * template de Estrutura de Custos (TEC).
 *
 * Tudo aqui é sintético e assumido como tal — nome com prefixo `EXEMPLO —`,
 * `notes` com `SINTETICO_EXEMPLO`. Nenhum destes números é custo, tarifa ou
 * formulação oficial da Veridi, e a carga não cria Cliente, Produto, lote,
 * estoque, compra, recebimento, pedido, OP, expedição nem faturamento.
 *
 * Duas regras do domínio que o carregador respeita e não contorna:
 *
 *  - **o código é do ERP.** `RIN-`, `FT-` e `TEC-` saem das sequences oficiais,
 *    nunca do CSV. A `chave_importacao` serve só para amarrar as linhas do
 *    pacote entre si e para dar idempotência;
 *  - **template guarda uso, não tarifa.** A tarifa vive no Recurso e é
 *    resolvida pela data de referência do cálculo. O TEC recebe horas.
 *
 * Componente de formulação que não resolve para um Item existente e único NÃO
 * é criado: vira SKIP com motivo. Item duplicado nascido de uma carga de
 * exemplo é pior que um template incompleto.
 */

const PASTA = path.resolve(CORPUS_DIR, "..", "cargaExemplo");
const MARCA = "SINTETICO_EXEMPLO";

type Linha = Record<string, string>;

function ler(arquivo: string): Linha[] {
  const caminho = path.join(PASTA, arquivo);
  if (!fs.existsSync(caminho)) throw new Error(`Arquivo ausente: ${caminho}`);
  const linhas = parseCsv(fs.readFileSync(caminho, "utf8"));
  const cabecalho = linhas[0]!.map((coluna) => coluna.replace(/^﻿/, "").trim());
  return linhas
    .slice(1)
    .filter((linha) => linha.some((celula) => celula.trim() !== ""))
    .map((linha) => {
      const registro: Linha = {};
      cabecalho.forEach((coluna, indice) => {
        registro[coluna] = (linha[indice] ?? "").trim();
      });
      return registro;
    });
}

const TIPO_RECURSO = { MAO_DE_OBRA: "LABOR", EQUIPAMENTO: "EQUIPMENT", ENERGIA: "ENERGY" } as const;
const UOM_TARIFA = { HORA: "HOUR", KWH: "KWH" } as const;
const CATEGORIA = {
  OVERHEAD: "OVERHEAD",
  EMBALAGEM_SECUNDARIA: "SECONDARY_PACKAGING",
  SERVICO_TERCEIRO: "THIRD_PARTY_SERVICE",
  OUTROS: "OTHER",
} as const;
const APLICACAO = {
  POR_LOTE: "FIXED_PER_BATCH",
  POR_UNIDADE: "PER_OUTPUT_UNIT",
  POR_1000_UNIDADES: "PER_1000_OUTPUT_UNITS",
} as const;
const MODO_ENERGIA = {
  NENHUMA: "NONE",
  DIRETA: "DIRECT",
  DERIVADA_DOS_EQUIPAMENTOS: "FROM_EQUIPMENT",
} as const;

interface Relatorio {
  criados: string[];
  existentes: string[];
  pulados: { o_que: string; motivo: string }[];
}

const relatorio: Relatorio = { criados: [], existentes: [], pulados: [] };

/**
 * Resolve o Item por NOME, e só aceita resposta inequívoca.
 *
 * Prefere o casamento exato; empate no exato é ambiguidade real e vira SKIP.
 * Sem exato, cai para "começa com" e exige um único candidato. Nunca cria Item,
 * nunca escolhe "o mais parecido".
 */
async function resolverItem(
  prisma: PrismaClient,
  nome: string,
): Promise<{ id: string; code: string; name: string; unitCode: string } | { erro: string }> {
  const exatos = await prisma.item.findMany({
    where: { name: { equals: nome, mode: "insensitive" }, type: "RAW_MATERIAL", active: true },
    select: { id: true, code: true, name: true, unitCode: true },
  });
  if (exatos.length === 1) return exatos[0]!;
  if (exatos.length > 1) {
    return { erro: `nome "${nome}" casa com ${exatos.length} itens — ambíguo` };
  }

  const parciais = await prisma.item.findMany({
    where: { name: { startsWith: nome, mode: "insensitive" }, type: "RAW_MATERIAL", active: true },
    select: { id: true, code: true, name: true, unitCode: true },
  });
  if (parciais.length === 1) return parciais[0]!;
  if (parciais.length === 0) return { erro: `nenhum Item ativo começa por "${nome}"` };
  return {
    erro:
      `"${nome}" tem ${parciais.length} candidatos ` +
      `(${parciais.slice(0, 3).map((item) => item.code).join(", ")}…) — ambíguo`,
  };
}

/** mg → unidade do item. Só massa; sem inventar conversão de embalagem. */
function converterParaUnidadeDoItem(
  valorEmMg: string,
  unidadeDoItem: string,
): { quantidade: string; unidade: string } | { erro: string } {
  const numero = Number(valorEmMg);
  if (!Number.isFinite(numero)) return { erro: `quantidade ilegível: "${valorEmMg}"` };
  if (unidadeDoItem === "kg") return { quantidade: (numero / 1_000_000).toFixed(12), unidade: "kg" };
  if (unidadeDoItem === "g") return { quantidade: (numero / 1000).toFixed(12), unidade: "g" };
  if (unidadeDoItem === "mg") return { quantidade: numero.toFixed(12), unidade: "mg" };
  return { erro: `unidade do item (${unidadeDoItem}) não é de massa — conversão não é inventada` };
}

async function principal(): Promise<void> {
  const escrever = hasApplyFlag();
  const ambiente = assertImportEnvironment({ write: escrever });
  const prisma = new PrismaClient();

  console.log(
    `\nCARGA DE EXEMPLOS — banco ${ambiente.database}@${ambiente.host}` +
      `${escrever ? " (APPLY)" : " (dry-run — nada é escrito)"}\n`,
  );

  // -------------------------------------------------------------------------
  // 1. Recursos industriais
  // -------------------------------------------------------------------------
  const recursoPorChave = new Map<string, { id: string; code: string }>();
  for (const linha of ler("01_recursos_industriais_exemplo.csv")) {
    const chave = linha["chave_importacao"]!;
    const nome = linha["nome"]!;
    const existente = await prisma.industrialResource.findFirst({ where: { name: nome } });
    if (existente) {
      recursoPorChave.set(chave, existente);
      relatorio.existentes.push(`Recurso ${existente.code} ${nome}`);
      continue;
    }
    const tipo = TIPO_RECURSO[linha["tipo_semantico"] as keyof typeof TIPO_RECURSO];
    const uom = UOM_TARIFA[linha["unidade_tarifaria"] as keyof typeof UOM_TARIFA];
    if (!tipo || !uom) {
      relatorio.pulados.push({ o_que: `Recurso ${chave}`, motivo: "tipo ou unidade desconhecidos" });
      continue;
    }
    if (!escrever) {
      relatorio.criados.push(`Recurso (a criar) ${nome}`);
      recursoPorChave.set(chave, { id: `dry-run:${chave}`, code: "RIN-??????" });
      continue;
    }
    const code = await nextSequenceCode(prisma, "industrial_resource_code_seq", "RIN");
    const criado = await prisma.industrialResource.create({
      data: {
        code,
        name: nome,
        type: tipo,
        defaultUsageUom: uom,
        powerKw: linha["potencia_kw"] ? linha["potencia_kw"] : null,
        active: linha["ativo"] !== "false",
        notes: `${MARCA} — ${linha["observacoes"] ?? ""}`.trim(),
        createdByNameSnapshot: "Carga de exemplos",
      },
    });
    recursoPorChave.set(chave, criado);
    relatorio.criados.push(`Recurso ${criado.code} ${nome}`);
  }

  // -------------------------------------------------------------------------
  // 2. Tarifas — vivem no RECURSO, nunca dentro do template
  // -------------------------------------------------------------------------
  for (const linha of ler("02_tarifas_recursos_exemplo.csv")) {
    const recurso = recursoPorChave.get(linha["recurso_chave_importacao"]!);
    if (!recurso) {
      relatorio.pulados.push({
        o_que: `Tarifa de ${linha["recurso_chave_importacao"]}`,
        motivo: "recurso não resolvido",
      });
      continue;
    }
    const vigenteDesde = new Date(`${linha["vigente_desde"]}T00:00:00.000Z`);
    if (escrever) {
      const existente = await prisma.industrialResourceRate.findFirst({
        where: { industrialResourceId: recurso.id, effectiveAt: vigenteDesde },
      });
      if (existente) {
        relatorio.existentes.push(`Tarifa ${recurso.code} @ ${linha["vigente_desde"]}`);
        continue;
      }
      await prisma.industrialResourceRate.create({
        data: {
          industrialResourceId: recurso.id,
          rateValue: linha["valor_tarifa"]!,
          currencyCode: linha["moeda"] ?? "BRL",
          rateUom: UOM_TARIFA[linha["unidade_tarifaria"] as keyof typeof UOM_TARIFA]!,
          effectiveAt: vigenteDesde,
          source: "MANUAL",
          notes: `${MARCA} — ${linha["observacoes"] ?? ""}`.trim(),
          createdByNameSnapshot: "Carga de exemplos",
        },
      });
    }
    relatorio.criados.push(
      `Tarifa ${recurso.code} R$ ${linha["valor_tarifa"]}/${linha["unidade_tarifaria"]}`,
    );
  }

  // -------------------------------------------------------------------------
  // 3. Templates de Formulação
  // -------------------------------------------------------------------------
  const componentesPorTemplate = new Map<string, Linha[]>();
  for (const linha of ler("04_templates_formulacao_componentes_exemplo.csv")) {
    const chave = linha["template_chave_importacao"]!;
    componentesPorTemplate.set(chave, [...(componentesPorTemplate.get(chave) ?? []), linha]);
  }

  for (const linha of ler("03_templates_formulacao_exemplo.csv")) {
    const chave = linha["template_chave_importacao"]!;
    const nome = linha["nome"]!;
    if (await prisma.formulationTemplate.findFirst({ where: { name: nome } })) {
      relatorio.existentes.push(`Template de Formulação ${nome}`);
      continue;
    }

    // Resolver TODOS os componentes antes de criar qualquer coisa: template
    // pela metade é pior que template ausente.
    const resolvidos: {
      itemId: string;
      itemCode: string;
      quantidade: string;
      unidade: string;
      linha: Linha;
    }[] = [];
    let bloqueio: string | null = null;
    for (const componente of componentesPorTemplate.get(chave) ?? []) {
      const item = await resolverItem(prisma, componente["item_nome_esperado"]!);
      if ("erro" in item) {
        bloqueio = `componente "${componente["item_nome_esperado"]}": ${item.erro}`;
        break;
      }
      const convertido = converterParaUnidadeDoItem(
        componente["quantidade_informada"]!,
        item.unitCode,
      );
      if ("erro" in convertido) {
        bloqueio = `componente ${item.code}: ${convertido.erro}`;
        break;
      }
      resolvidos.push({
        itemId: item.id,
        itemCode: item.code,
        quantidade: convertido.quantidade,
        unidade: convertido.unidade,
        linha: componente,
      });
    }
    if (bloqueio || resolvidos.length === 0) {
      relatorio.pulados.push({
        o_que: `Template de Formulação ${nome}`,
        motivo: bloqueio ?? "sem componentes utilizáveis",
      });
      continue;
    }

    if (!escrever) {
      relatorio.criados.push(
        `Template de Formulação (a criar) ${nome} — ${resolvidos.length} componentes`,
      );
      continue;
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const code = await nextSequenceCode(tx, "formulation_template_code_seq", "FT");
      const template = await tx.formulationTemplate.create({
        data: { code, name: nome, description: linha["descricao"] || null, createdBy: "Carga de exemplos" },
      });
      const versao = await tx.formulationTemplateVersion.create({
        data: {
          formulationTemplateId: template.id,
          versionNumber: 1,
          status: linha["status_desejado"] === "ATIVO" ? "ACTIVE" : "DRAFT",
          basisQuantity: linha["base_quantidade"]!,
          calculationMode: linha["modo_calculo_semantico"] === "POR_DOSE" ? "PER_DOSE" : "FIXED_BASIS",
          dosesPerPackage: linha["doses_por_embalagem"] ? Number(linha["doses_por_embalagem"]) : null,
          outputUnitCode: "un",
          notes: `${MARCA} — exemplo sintético; não representa formulação oficial da Veridi.`,
          createdBy: "Carga de exemplos",
          activatedAt: linha["status_desejado"] === "ATIVO" ? new Date() : null,
          activatedBy: linha["status_desejado"] === "ATIVO" ? "Carga de exemplos" : null,
        },
      });
      for (const [indice, componente] of resolvidos.entries()) {
        const modo =
          componente.linha["modo_quantidade_sugerido"] === "THEORETICAL_WITH_ADJUSTMENTS"
            ? "THEORETICAL_WITH_ADJUSTMENTS"
            : "PHYSICAL_DIRECT";
        const aplicarPureza = componente.linha["aplicar_pureza_sugerido"] === "true";
        const aplicarOverage = componente.linha["aplicar_overage_sugerido"] === "true";
        await tx.formulationTemplateComponent.create({
          data: {
            formulationTemplateVersionId: versao.id,
            itemId: componente.itemId,
            quantity: componente.quantidade,
            unitCode: componente.unidade,
            basis: "PER_DOSE",
            quantityMode: modo,
            applyPurityAdjustment: aplicarPureza,
            applyOverageAdjustment: aplicarOverage,
            purityPercentApplied:
              aplicarPureza && componente.linha["pureza_percentual"]
                ? componente.linha["pureza_percentual"]!
                : null,
            overagePercent:
              aplicarOverage && componente.linha["overage_percentual"]
                ? componente.linha["overage_percentual"]!
                : null,
            position: indice + 1,
            notes: MARCA,
          },
        });
      }
      relatorio.criados.push(
        `Template de Formulação ${code} ${nome} — ${resolvidos.length} componentes`,
      );
    });
  }

  // -------------------------------------------------------------------------
  // 4. Templates de Estrutura de Custos (TEC)
  // -------------------------------------------------------------------------
  const usosPorTemplate = new Map<string, Linha[]>();
  for (const linha of ler("06_templates_estrutura_recursos_exemplo.csv")) {
    const chave = linha["template_chave_importacao"]!;
    usosPorTemplate.set(chave, [...(usosPorTemplate.get(chave) ?? []), linha]);
  }
  const premissasPorTemplate = new Map<string, Linha[]>();
  for (const linha of ler("07_templates_estrutura_premissas_exemplo.csv")) {
    const chave = linha["template_chave_importacao"]!;
    premissasPorTemplate.set(chave, [...(premissasPorTemplate.get(chave) ?? []), linha]);
  }

  for (const linha of ler("05_templates_estrutura_custos_exemplo.csv")) {
    const chave = linha["template_chave_importacao"]!;
    const nome = linha["nome"]!;
    if (await prisma.industrialCostTemplate.findFirst({ where: { name: nome } })) {
      relatorio.existentes.push(`Template de Estrutura de Custos ${nome}`);
      continue;
    }
    const recursoEnergia = recursoPorChave.get(linha["recurso_energia_chave"] ?? "");
    const usos = usosPorTemplate.get(chave) ?? [];
    const semRecurso = usos.find((uso) => !recursoPorChave.get(uso["recurso_chave_importacao"]!));
    if (semRecurso) {
      relatorio.pulados.push({
        o_que: `Template de Estrutura de Custos ${nome}`,
        motivo: `recurso ${semRecurso["recurso_chave_importacao"]} não resolvido`,
      });
      continue;
    }

    if (!escrever) {
      relatorio.criados.push(
        `Template de Estrutura de Custos (a criar) ${nome} — ${usos.length} recursos`,
      );
      continue;
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const code = await nextSequenceCode(tx, "industrial_cost_template_code_seq", "TEC");
      const template = await tx.industrialCostTemplate.create({
        data: { code, name: nome, description: linha["descricao"] || null, createdBy: "Carga de exemplos" },
      });
      const versao = await tx.industrialCostTemplateVersion.create({
        data: {
          industrialCostTemplateId: template.id,
          versionNumber: 1,
          status: linha["status_desejado"] === "ATIVO" ? "ACTIVE" : "DRAFT",
          referenceOutputQuantity: linha["base_quantidade"]!,
          referenceOutputUomCode: "un",
          energyCalculationMode:
            MODO_ENERGIA[linha["modo_energia_semantico"] as keyof typeof MODO_ENERGIA] ?? "NONE",
          energyResourceId: recursoEnergia?.id ?? null,
          notes: `${MARCA} — estrutura sintética; guarda uso, nunca tarifa.`,
          createdBy: "Carga de exemplos",
          activatedAt: linha["status_desejado"] === "ATIVO" ? new Date() : null,
          activatedBy: linha["status_desejado"] === "ATIVO" ? "Carga de exemplos" : null,
        },
      });
      for (const uso of usos) {
        const recurso = recursoPorChave.get(uso["recurso_chave_importacao"]!)!;
        await tx.industrialCostTemplateResourceUsage.create({
          data: {
            industrialCostTemplateVersionId: versao.id,
            industrialResourceId: recurso.id,
            usageBasis: "FIXED_PER_REFERENCE_BATCH",
            usageQuantity: uso["quantidade_uso"]!,
            usageUom: UOM_TARIFA[uso["unidade_uso"] as keyof typeof UOM_TARIFA]!,
            sortOrder: Number(uso["ordem"] ?? 0),
            notes: MARCA,
          },
        });
      }
      for (const premissa of premissasPorTemplate.get(chave) ?? []) {
        await tx.industrialCostTemplateAdditionalCost.create({
          data: {
            industrialCostTemplateVersionId: versao.id,
            category: CATEGORIA[premissa["categoria_semantica"] as keyof typeof CATEGORIA] ?? "OTHER",
            description: premissa["descricao"]!,
            calculationBasis:
              APLICACAO[premissa["aplicacao_semantica"] as keyof typeof APLICACAO] ??
              "FIXED_PER_BATCH",
            rateValue: premissa["valor"] || null,
            sortOrder: Number(premissa["ordem"] ?? 0),
            notes: MARCA,
          },
        });
      }
      relatorio.criados.push(
        `Template de Estrutura de Custos ${code} ${nome} — ${usos.length} recursos, ` +
          `${(premissasPorTemplate.get(chave) ?? []).length} premissas`,
      );
    });
  }

  console.log(`CRIADOS (${relatorio.criados.length})`);
  for (const item of relatorio.criados) console.log(`  +  ${item}`);
  console.log(`\nJÁ EXISTENTES (${relatorio.existentes.length})`);
  for (const item of relatorio.existentes) console.log(`  =  ${item}`);
  console.log(`\nSKIPS (${relatorio.pulados.length})`);
  for (const item of relatorio.pulados) console.log(`  -  ${item.o_que}: ${item.motivo}`);
  if (!escrever) console.log(`\nNada foi escrito. Para aplicar: --apply`);

  await prisma.$disconnect();
}

principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
