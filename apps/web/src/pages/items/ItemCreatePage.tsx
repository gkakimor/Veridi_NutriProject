import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { listUnits } from "../../lib/units-api";
import { useContextualCreateTarget } from "../../lib/use-contextual-create";
import {
  ITEM_FORM_ID,
  ItemFormFields,
  parseCreatableItemType,
  useItemForm,
} from "./item-form";

/** Query que pré-escolhe o tipo: `/cadastros/itens/novo?tipo=RAW_MATERIAL`. */
const PARAM_TIPO = "tipo";

/**
 * Tela oficial de cadastro de item de estoque — `/cadastros/itens/novo`.
 *
 * Mesmos campos do modal, importados do mesmo módulo: o que a página traz de
 * novo é a URL. Com ela o cadastro sobrevive a um F5, pode ser aberto por
 * link direto e aparece no histórico do navegador — três coisas que um modal
 * não tem como dar.
 *
 * Serve a dois caminhos que não se misturam:
 *
 * - **Direto**, pelo menu ou pelo botão da listagem. Salvar volta para a
 *   lista; cancelar também.
 * - **Contextual**, quando alguém estava montando uma formulação ou uma ordem
 *   de compra, precisou de um item que ainda não existe e clicou em "+ Novo
 *   item". Aí salvar devolve ao documento com o rascunho intacto e o item já
 *   selecionado; cancelar devolve sem selecionar nada.
 *
 * A trilha permanece canônica nos dois casos — `Cadastros › Itens de estoque
 * › Novo item de estoque`. De onde a pessoa veio é caminho de volta, não
 * hierarquia do sistema.
 *
 * As unidades são carregadas aqui: no modal elas chegavam prontas da
 * listagem, que já as tinha para a tabela. A página não tem essa listagem
 * atrás dela, então busca a sua.
 */
export function ItemCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contexto = useContextualCreateTarget("item");

  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);

  useEffect(() => {
    // Falha na carga não trava o cadastro: o seletor fica vazio e o campo
    // continua obrigatório, então nada é criado sem unidade.
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  const controller = useItemForm({
    mode: "create",
    item: null,
    units,
    initialType: parseCreatableItemType(searchParams.get(PARAM_TIPO)),
    onSaved: (created?: ItemDTO) => {
      if (created && contexto.completeAndReturn({ entityId: created.id, label: created.name })) {
        return;
      }
      // Caminho normal: a lista é onde o registro recém-criado passa a viver.
      navigate("/cadastros/itens", { replace: true });
    },
  });

  function cancelar() {
    if (contexto.cancelAndReturn()) return;
    navigate("/cadastros/itens");
  }

  return (
    <>
      <PageBreadcrumbs
        items={[
          { label: "Cadastros" },
          { label: "Itens de estoque", href: "/cadastros/itens" },
          { label: "Novo item de estoque", current: true },
        ]}
      />

      <div className="page__header">
        <div>
          <h1 className="page__title">Novo item de estoque</h1>
          <p className="page__subtitle">
            O código é gerado ao salvar. O item será criado como <b>Ativo</b>.
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

      <ItemFormFields {...controller} />

      <div className="doc-actions">
        <div className="doc-actions__primary">
          <button type="button" className="btn btn--ghost" onClick={cancelar}>
            Cancelar
          </button>
          <button
            type="submit"
            form={ITEM_FORM_ID}
            className="btn btn--accent"
            disabled={controller.saving}
          >
            {controller.saving ? "Criando…" : "Criar item"}
          </button>
        </div>
      </div>
    </>
  );
}
