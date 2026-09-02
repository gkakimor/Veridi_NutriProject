import { useState } from "react";
import type { ProductDTO } from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { CustomerFormModal } from "../customers/CustomerFormModal";
import { formatDate } from "../../lib/dates";
import { PRODUCT_FORM_ID, ProductFormFields, useProductForm } from "./product-form";

interface ProductFormModalProps {
  mode: "create" | "edit";
  product: ProductDTO | null;
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: ProductDTO) => void;
}

/**
 * Modal fullscreen de criação/edição de produto.
 *
 * Os campos vivem em `product-form`, compartilhados com a página
 * `/cadastros/produtos/novo`. Aqui fica a casca — moldura e rodapé — mais o
 * cadastro de Cliente no contexto, que só existe nesta porta: dentro de um
 * modal não há URL para onde sair, então o cliente é cadastrado por cima.
 * Na página, o mesmo "+ Novo cliente" NAVEGA para a tela oficial de Cliente
 * e volta com o rascunho intacto.
 *
 * Editar continua sendo exclusividade deste modal — a página oficial cobre a
 * criação, que é a que precisa de URL própria.
 */
export function ProductFormModal({ mode, product, onClose, onSaved }: ProductFormModalProps) {
  /** Cadastro de cliente aberto a partir do campo de busca. */
  const [criandoCliente, setCriandoCliente] = useState(false);

  const controller = useProductForm({
    mode,
    product,
    onSaved,
    onCreateCustomer: () => setCriandoCliente(true),
  });
  const { saving, selectCustomer } = controller;

  const codeChip = mode === "create" ? "Código gerado automaticamente ao salvar" : product?.code;

  const footer =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O produto será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form={PRODUCT_FORM_ID}
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Criando…" : "Criar produto"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração: {product ? formatDate(product.updatedAt) : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form={PRODUCT_FORM_ID}
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </>
    );

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Produtos"
      crumbActive={mode === "create" ? "Novo" : "Editar"}
      title={mode === "create" ? "Novo produto" : product?.name}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      {/*
        FORA do `<form>` do produto, e isto não é organização de código.
        `CustomerFormModal` tem `<form>` próprio, e `<form>` dentro de
        `<form>` é marcação inválida: o navegador descarta o interno, o
        "Criar cliente" virava submit nativo do formulário do PRODUTO, a
        página navegava, e o cliente não chegava a ser criado — o rascunho
        inteiro ia junto. Todos os outros cadastros no contexto já ficam
        fora de qualquer `<form>`; este era o único aninhado.
      */}
      {criandoCliente && (
        <CustomerFormModal
          mode="create"
          customer={null}
          onClose={() => setCriandoCliente(false)}
          onSaved={(created) => {
            setCriandoCliente(false);
            if (!created) return;
            // Volta selecionado, e o resto do formulário do produto continua
            // como estava: quem cadastrou o cliente queria ESTE cliente e não
            // quer redigitar o que já preencheu.
            selectCustomer(created);
          }}
        />
      )}

      <ProductFormFields {...controller} />
    </FullWorkspaceModal>
  );
}
