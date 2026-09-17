import { describe, expect, it } from "vitest";
import { USER_ROLES } from "@veridi/shared";
import { entityHref } from "../components/EntityLink";
import { findActiveNavItem, visibleNavGroups } from "./navigation";

/**
 * Inventário Físico no menu — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * O menu continua visível para todos os perfis: consultar inventário é de
 * qualquer sessão, e quem não opera só não recebe as ações. Toda tela sob
 * `/estoque/inventario` acende o mesmo item — a Contagem rápida não ganhou item
 * próprio (DU-2), e um item novo sob esse prefixo apagaria o destaque do
 * detalhe e da contagem.
 */

describe("Inventário Físico no menu", () => {
  it.each(USER_ROLES)("%s vê o item no menu", (role) => {
    const estoque = visibleNavGroups(role).find((grupo) => grupo.id === "inventory");
    expect(estoque?.items.map((item) => item.label)).toContain("Inventário Físico");
  });

  it.each([
    "/estoque/inventario",
    "/estoque/inventario/novo",
    "/estoque/inventario/contagem-rapida",
    "/estoque/inventario/3f1c2b7a-1111-4a4a-8b8b-000000000001",
    "/estoque/inventario/3f1c2b7a-1111-4a4a-8b8b-000000000001/contagem",
  ])("%s acende Estoque › Inventário Físico", (caminho) => {
    const ativo = findActiveNavItem(visibleNavGroups("PRODUCTION"), caminho, "");
    expect(ativo?.item.label).toBe("Inventário Físico");
    expect(ativo?.group.title).toBe("Estoque");
  });

  it("nenhum item de menu mora sob o prefixo do inventário", () => {
    const soDoInventario = visibleNavGroups("ADMIN")
      .flatMap((grupo) => grupo.items)
      .filter((item) => item.path.startsWith("/estoque/inventario/"));
    expect(soDoInventario).toEqual([]);
  });

  it("o código INV- é link para o próprio inventário", () => {
    expect(entityHref("stockCount", "inv-1")).toBe("/estoque/inventario/inv-1");
  });
});
