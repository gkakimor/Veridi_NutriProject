import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { ProductDTO } from "@veridi/shared";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import {
  useContextualCreateOrigin,
  useContextualCreateTarget,
} from "../../lib/use-contextual-create";
import { PRODUCT_FORM_ID, ProductFormFields, useProductForm } from "./product-form";
import type { ProductCustomerLock, ProductFormState } from "./product-form";

/**
 * Tela oficial de cadastro de produto — `/cadastros/produtos/novo`.
 *
 * Mesmos campos do modal, importados do mesmo módulo: o que a página traz de
 * novo é a URL. Com ela o cadastro sobrevive a um F5, pode ser aberto por
 * link direto e aparece no histórico do navegador — três coisas que um modal
 * não tem como dar. E são 17 campos: perder isso num refresh é o produto
 * inteiro digitado de novo.
 *
 * ## Produto é os DOIS lados da criação contextual
 *
 * É a única entidade que é as duas coisas ao mesmo tempo:
 *
 * - **Alvo**, quando alguém montava um Pedido, precisou de um produto que
 *   ainda não existe e clicou em "+ Novo produto". Salvar devolve ao pedido
 *   com o produto já selecionado; cancelar devolve sem selecionar nada.
 * - **Origem**, porque o próprio produto exige Cliente e o cliente pode não
 *   existir. Aqui "+ Novo cliente" NAVEGA para `/cadastros/clientes/novo` —
 *   e é por isso que ele pode navegar: fora do modal não há `<form>` de
 *   cliente para aninhar no `<form>` de produto, e o rascunho volta inteiro
 *   pelo contexto em vez de depender de a tela continuar montada.
 *
 * A trilha permanece canônica nos dois casos — `Cadastros › Produtos › Novo
 * produto`. De onde a pessoa veio é caminho de volta, não hierarquia do
 * sistema.
 */
export function ProductCreatePage() {
  const navigate = useNavigate();
  const contexto = useContextualCreateTarget("product");

  /*
   * Cliente mandado pela origem. Um Pedido já é de um cliente: o produto que
   * nasce dali é dele, e oferecer o campo seria oferecer a divergência —
   * produto de um cliente dentro do documento de outro.
   */
  const clienteDaOrigem = useMemo(
    () => lerClienteDoContexto(contexto.context),
    [contexto.context],
  );

  /*
   * O ciclo é real e a ref existe por causa dele: o formulário precisa saber
   * o que fazer quando alguém pede "+ Novo cliente", e quem sabe isso é o
   * hook de origem — que por sua vez precisa do formulário para recolher o
   * rascunho. `goCreate` só é chamado em evento, nunca durante o render, e
   * por isso a ref preenchida abaixo já está no lugar quando o clique chega.
   */
  const pedirNovoCliente = useRef<() => void>(() => {});

  const controller = useProductForm({
    mode: "create",
    product: null,
    onSaved: (created?: ProductDTO) => {
      if (created && contexto.completeAndReturn({ entityId: created.id, label: created.name })) {
        return;
      }
      // Caminho normal: a lista é onde o registro recém-criado passa a viver.
      navigate("/cadastros/produtos", { replace: true });
    },
    // Cliente definido pela origem não tem campo, e sem campo não há cadastro
    // no contexto para oferecer.
    onCreateCustomer: clienteDaOrigem ? undefined : () => pedirNovoCliente.current(),
    customerLock: clienteDaOrigem,
  });

  const origem = useContextualCreateOrigin<ProductFormState>({
    // Só o estado do formulário: as listas de unidades e de clientes são
    // recarregadas do servidor na volta, e função nenhuma sobrevive a JSON.
    collectDraft: () => controller.form,
    restoreDraft: (draft) => controller.setForm((prev) => ({ ...prev, ...draft })),
    onCreated: (result) => {
      // Pelo id, sempre. O rótulo só ocupa o campo até a busca de clientes
      // devolver o registro real, com código próprio.
      controller.selectCustomer({
        id: result.entityId,
        code: "",
        legalName: result.label,
        tradeName: null,
        active: true,
      });
    },
  });

  pedirNovoCliente.current = () =>
    origem.goCreate({
      route: "/cadastros/clientes/novo",
      fieldKey: "customerId",
      entityType: "customer",
    });

  function cancelar() {
    if (contexto.cancelAndReturn()) return;
    navigate("/cadastros/produtos");
  }

  return (
    <>
      <PageBreadcrumbs
        items={[
          { label: "Cadastros" },
          { label: "Produtos", href: "/cadastros/produtos" },
          { label: "Novo produto", current: true },
        ]}
      />

      <div className="page__header">
        <div>
          <h1 className="page__title">Novo produto</h1>
          <p className="page__subtitle">
            O código é gerado ao salvar. O produto será criado como <b>Ativo</b>, junto
            com o item de produto acabado que controla o estoque dele.
          </p>
        </div>
        {/*
          Só aparece em criação contextual, e diz PARA ONDE volta. "Voltar"
          sozinho não informa nada a quem saiu do meio de um documento.
        */}
        {contexto.isContextual && (
          <button type="button" className="btn btn--ghost" onClick={cancelar}>
            ← Voltar para {contexto.originLabel}
          </button>
        )}
      </div>

      <ProductFormFields {...controller} />

      <div className="doc-actions">
        <div className="doc-actions__primary">
          <button type="button" className="btn btn--ghost" onClick={cancelar}>
            Cancelar
          </button>
          <button
            type="submit"
            form={PRODUCT_FORM_ID}
            className="btn btn--accent"
            disabled={controller.saving}
          >
            {controller.saving ? "Criando…" : "Criar produto"}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * O cliente que a origem mandou, se mandou um legítimo.
 *
 * O contexto atravessa `sessionStorage` e o token viaja na URL: o conteúdo é
 * lido como dado desconhecido, nunca como promessa. Sem `customerId` string
 * e não vazio não há trava — a tela volta a perguntar o cliente, que é o
 * comportamento normal do cadastro.
 */
function lerClienteDoContexto(
  context: Record<string, unknown> | null,
): ProductCustomerLock | null {
  if (!context) return null;
  const id = context["customerId"];
  if (typeof id !== "string" || id.length === 0) return null;
  const label = context["customerLabel"];
  return { id, label: typeof label === "string" && label ? label : "Cliente da tela de origem" };
}
