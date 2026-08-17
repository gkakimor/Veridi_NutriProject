import type { User } from "@prisma/client";
import type { ProjectProductDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  ProjectLockedError,
  ProjectNotFoundError,
  ProjectProductCustomerMismatchError,
  ProjectProductDuplicateError,
  ProjectProductNotFoundError,
} from "./projects.errors.js";
import { createProjectProduct } from "./technical-product.service.js";
import type { AddProjectProductInput } from "./projects.schemas.js";

/**
 * Produtos de um projeto.
 *
 * Uma negociação real cobre mais de um produto — a mesma linha em três
 * sabores nasce de um briefing só. São duas formas legítimas de entrar:
 * criar o produto técnico aqui dentro, ou vincular um produto que já existe.
 * Não há uma terceira: produto tem ciclo de vida e regras, e "digitar um
 * nome e resolver depois" produziria cadastro sem dono.
 */

const projectProductInclude = {
  product: true,
  samples: { orderBy: { testSequence: "desc" as const }, take: 1 },
} as const;

function toDTO(link: {
  id: string;
  projectId: string;
  productId: string;
  sequence: number;
  status: string;
  createdAt: Date;
  createdByNameSnapshot: string | null;
  product: { code: string; name: string; lifecycle: string; active: boolean };
  samples: { code: string; testSequence: number }[];
}): ProjectProductDTO {
  const latestSample = link.samples[0] ?? null;
  return {
    id: link.id,
    projectId: link.projectId,
    productId: link.productId,
    productCode: link.product.code,
    productName: link.product.name,
    productLifecycle: link.product.lifecycle,
    productActive: link.product.active,
    sequence: link.sequence,
    status: link.status as ProjectProductDTO["status"],
    costing: null,
    latestSampleCode: latestSample ? latestSample.code : null,
    latestSampleLabel: latestSample ? `T${latestSample.testSequence}` : null,
    createdAt: link.createdAt.toISOString(),
    createdByName: link.createdByNameSnapshot,
  };
}

export async function listProjectProducts(projectId: string): Promise<ProjectProductDTO[]> {
  const links = await getPrisma().projectProduct.findMany({
    where: { projectId },
    orderBy: { sequence: "asc" },
    include: projectProductInclude,
  });
  return links.map(toDTO);
}

/**
 * Adiciona um produto ao projeto.
 *
 * Projeto aprovado ou cancelado é histórico: não recebe produto novo. E
 * produto de outro cliente não entra em silêncio — private label é
 * propriedade de quem encomendou.
 */
export async function addProjectProduct(
  projectId: string,
  input: AddProjectProductInput,
  actor: User,
): Promise<ProjectProductDTO> {
  const prisma = getPrisma();

  const link = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;

    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { products: true },
    });
    if (!project) throw new ProjectNotFoundError(projectId);
    if (project.status === "APPROVED" || project.status === "CANCELLED") {
      throw new ProjectLockedError(project.status);
    }

    const sequence = project.products.length + 1;

    if (input.operation === "create") {
      // O produto nasce em desenvolvimento, com item de produto acabado e
      // fórmula V1 em rascunho — mesma construção da preparação técnica.
      // Aprovar é outro momento, e depende do orçamento aceito.
      const finishedUnitCode = input.finishedUnitCode ?? project.doseUomCode ?? "un";
      const created = await createProjectProduct(
        tx,
        project,
        {
          finishedUnitCode,
          lifecycle: "DEVELOPMENT",
          ...(input.name ? { name: input.name } : {}),
        },
        actor,
      );

      return tx.projectProduct.create({
        data: {
          projectId,
          productId: created.id,
          sequence,
          status: "ACTIVE",
          createdByUserId: actor.id,
          createdByNameSnapshot: actor.name,
        },
        include: projectProductInclude,
      });
    }

    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) throw new ProjectProductNotFoundError(input.productId);

    // Produto de private label pertence a um cliente. Vincular a projeto de
    // outro cliente misturaria propriedade — recusa explícita, nunca vínculo
    // silencioso.
    if (product.customerId && product.customerId !== project.customerId) {
      throw new ProjectProductCustomerMismatchError();
    }
    if (project.products.some((existing) => existing.productId === product.id)) {
      throw new ProjectProductDuplicateError(product.code);
    }

    return tx.projectProduct.create({
      data: {
        projectId,
        productId: product.id,
        sequence,
        status: "ACTIVE",
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
      include: projectProductInclude,
    });
  });

  return toDTO(link);
}

/**
 * Desvincula um produto do projeto.
 *
 * Só enquanto o projeto está aberto e o produto ainda não foi orçado: linha
 * de orçamento é história comercial, e produto citado numa proposta não
 * some do projeto que a originou.
 */
export async function removeProjectProduct(projectProductId: string): Promise<void> {
  const prisma = getPrisma();
  const link = await prisma.projectProduct.findUnique({
    where: { id: projectProductId },
    include: { project: true, quoteLines: true },
  });
  if (!link) throw new ProjectProductNotFoundError(projectProductId);
  if (link.project.status === "APPROVED" || link.project.status === "CANCELLED") {
    throw new ProjectLockedError(link.project.status);
  }
  if (link.quoteLines.length > 0) {
    throw new ProjectProductDuplicateError(
      "produto já citado em orçamento — remova a linha da proposta primeiro",
    );
  }

  await prisma.projectProduct.delete({ where: { id: projectProductId } });
}
