import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ItemDTO, SupplierDTO, SupplierItemDTO } from "@veridi/shared";
import {
  SUPPLIER_ITEM_QUALIFICATION_LABELS,
  SUPPLIER_OFFER_AMBIGUITY_MESSAGE,
  podeSerComprado,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { ListStatusRow } from "../../components/ListStatusRow";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatDate } from "../../lib/dates";
import { fornecedoresAtivosDaTela } from "../../lib/filter-sources";
import { useListQuery } from "../../lib/list-query";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { listSupplierItems, setSupplierItemPreferred } from "../../lib/supplier-items-api";
import { SupplierItemDetailModal } from "./SupplierItemDetailModal";
import { SupplierItemFormModal } from "./SupplierItemFormModal";
import { SupplierItemPriceCell, qualificationBadgeClass } from "./SupplierItemsPage";
import {
  ConfirmarPreferencialDialog,
  podeSerPreferencial,
  preferencialEntre,
} from "./preferencial";
import type { PreferencialDoItem } from "./preferencial";
import {
  QUEM_HOMOLOGA_A_RELACAO,
  QUEM_MANTEM_A_RELACAO,
  usePodeManterRelacao,
} from "./supplier-item-permissions";

/**
 * Teto da consulta — o da API. A carga real tem no máximo 9 fornecedores por
 * item; passar disso manda para a tela geral, filtrada pelo item.
 */
const LIMITE = 100;

/** Só o que se compra tem fornecedor: a API recusa relação de outro tipo. */
function temFornecedor(item: Pick<ItemDTO, "type">): boolean {
  return podeSerComprado(item.type);
}

/** Preferencial primeiro, depois as relações ativas; as inativas no fim, à vista. */
function ordemDaSecao(relacoes: readonly SupplierItemDTO[]): SupplierItemDTO[] {
  const peso = (relacao: SupplierItemDTO) => (relacao.preferred ? 0 : relacao.active ? 1 : 2);
  return [...relacoes].sort((a, b) => peso(a) - peso(b));
}

/**
 * Fornecedores do Item — a seção administrável do cadastro (ITEM-SUPPLIER-UX-01).
 *
 * A mesma relação Item × Fornecedor da tela de Compras, vista de dentro do
 * Item: quem fornece, homologado ou não, qual é o preferencial e a oferta de
 * hoje. Compras e Administrador adicionam fornecedor com o Item já fixado e
 * definem o preferencial na linha; Qualidade homologa e bloqueia no detalhe da
 * relação, que abre por cima do Item sem tirar a pessoa dele. Os demais perfis
 * consultam e abrem o detalhe.
 *
 * Nada aqui decide regra: criação, situação inicial, troca de preferencial e
 * homologação são as rotas de sempre, com as listas do shared. A tela geral
 * (Compras › Item × Fornecedor) continua a visão transversal e as filas.
 */
export function FornecedoresDoItemSection({ item }: { item: ItemDTO }) {
  const podeManter = usePodeManterRelacao();
  const compravel = temFornecedor(item);
  const administra = podeManter && compravel;

  const consulta = useListQuery(
    listSupplierItems,
    { itemId: item.id, page: 1, pageSize: LIMITE },
    { fallbackError: "Falha ao carregar os fornecedores do item" },
  );
  const relacoes = useMemo(
    () => ordemDaSecao(consulta.data?.supplierItems ?? []),
    [consulta.data],
  );
  const totalDeRelacoes = consulta.data?.total ?? 0;
  const preferencialAtual = preferencialEntre(relacoes);
  const ambiguo = relacoes.some((relacao) => relacao.costSourceAmbiguous);

  const [criando, setCriando] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [candidato, setCandidato] = useState<PreferencialDoItem | null>(null);
  const [definindo, setDefinindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  /* A primeira página de fornecedores ativos sai quando o formulário abre, uma vez
     por montagem; a busca do formulário pergunta ao servidor por conta própria. */
  const fornecedoresAtivos = useMemo(fornecedoresAtivosDaTela, []);
  const [fornecedores, setFornecedores] = useState<SupplierDTO[]>([]);

  function abrirCriacao() {
    setErro(null);
    setFeito(null);
    setCriando(true);
    fornecedoresAtivos
      .primeiraPagina()
      .then(setFornecedores)
      .catch(() => setFornecedores([]));
  }

  async function definirPreferencial(alvo: PreferencialDoItem) {
    setCandidato(null);
    setDefinindo(alvo.id);
    setErro(null);
    setFeito(null);
    try {
      await setSupplierItemPreferred(alvo.id, true);
      setFeito(`${alvo.supplierName} é o fornecedor preferencial deste item.`);
    } catch (err) {
      setErro(apiErrorMessage(err, "Não foi possível definir o fornecedor preferencial."));
    } finally {
      setDefinindo(null);
      // Sucesso ou recusa, a lista volta do servidor: é ele quem sabe quem ficou.
      consulta.reload();
    }
  }

  return (
    <FormSection
      title="Fornecedores"
      subtitle="Homologação é por item. Preço é referência comercial do fornecedor — o custo real vem do recebimento."
    >
      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}
      {consulta.error && (
        <p className="form-alert" role="alert">
          {consulta.error}
        </p>
      )}

      {!compravel ? (
        <p className="field__hint">
          Produto acabado é produzido, não comprado: não tem fornecedor cadastrado.
        </p>
      ) : (
        administra && (
          <div className="line-actions">
            <div className="table__actions">
              {item.active ? (
                <button type="button" className="btn btn--secondary btn--sm" onClick={abrirCriacao}>
                  Adicionar fornecedor
                </button>
              ) : (
                <span className="field__hint">
                  Item inativo: para adicionar fornecedor, reative o item.
                </span>
              )}
              {feito && (
                <span className="form-status" role="status">
                  {feito}
                </span>
              )}
            </div>
          </div>
        )
      )}

      {/* A escolha que falta ao custo é dita onde ela se faz: na linha de cada relação. */}
      {ambiguo && (
        <div className="callout">
          <p>{SUPPLIER_OFFER_AMBIGUITY_MESSAGE}</p>
        </div>
      )}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        {/* Em tela estreita a linha empilha (`table--fornecedores-do-item`, components.css). */}
        <table className="table table--clickable-rows table--sticky-actions table--fornecedores-do-item">
          <thead>
            <tr>
              <th className="col-flex">Fornecedor</th>
              <th className="col-tight">Homologação</th>
              <th className="col-tight is-numeric">Oferta de hoje</th>
              <th className="col-actions" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {relacoes.map((relacao) => (
              <tr
                key={relacao.id}
                tabIndex={0}
                onClick={() => setDetalheId(relacao.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setDetalheId(relacao.id);
                }}
              >
                <td className="col-flex">
                  <span className="code">{relacao.supplierCode}</span> {relacao.supplierName}
                  {/* Três conceitos, três marcas: a relação (preferencial, ativa)
                      e o cadastro do fornecedor não se confundem. */}
                  {/* `info`, não o verde de Homologado: as duas marcas vivem lado a lado. */}
                  {relacao.preferred && (
                    <>
                      {" "}
                      <span className="badge badge--info">Preferencial</span>
                    </>
                  )}
                  {!relacao.active && (
                    <>
                      {" "}
                      <span className="badge badge--inactive">Relação inativa</span>
                    </>
                  )}
                  {!relacao.supplierActive && (
                    <>
                      {" "}
                      <span className="badge badge--inactive">Fornecedor inativo</span>
                    </>
                  )}
                  {relacao.supplierItemCode && (
                    <span className="cell-sub">Código no fornecedor: {relacao.supplierItemCode}</span>
                  )}
                </td>
                <td className="col-tight">
                  <span className={qualificationBadgeClass(relacao.qualificationStatus)}>
                    {SUPPLIER_ITEM_QUALIFICATION_LABELS[relacao.qualificationStatus]}
                  </span>
                </td>
                <td className="col-tight is-numeric">
                  <SupplierItemPriceCell row={relacao} />
                  {relacao.currentOffer?.validUntil && (
                    <span className="cell-sub">
                      Válida até {formatDate(relacao.currentOffer.validUntil)}
                    </span>
                  )}
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  {/* "Abrir" por último: fica sempre na mesma borda, com ou sem a ação do preferencial. */}
                  <div className="table__actions">
                    {administra && !relacao.preferred && podeSerPreferencial(relacao) && (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={definindo !== null}
                        onClick={() =>
                          setCandidato({ id: relacao.id, supplierName: relacao.supplierName })
                        }
                      >
                        {definindo === relacao.id ? "Definindo…" : "Definir como preferencial"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setDetalheId(relacao.id)}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            <ListStatusRow colSpan={4} query={consulta} rowCount={relacoes.length}>
              {!compravel
                ? "Nenhum fornecedor."
                : administra
                  ? "Nenhum fornecedor cadastrado para este item."
                  : `Nenhum fornecedor cadastrado para este item. Adicionar fornecedor é de ${QUEM_MANTEM_A_RELACAO}.`}
            </ListStatusRow>
          </tbody>
        </table>
      </div>

      {totalDeRelacoes > relacoes.length && (
        <p className="field__hint">
          {`Mostrando ${formatIntegerPtBr(relacoes.length)} de ${formatIntegerPtBr(totalDeRelacoes)} relações. `}
          <Link to={`/compras/item-fornecedor?itemId=${item.id}`}>Ver todas em Compras › Item × Fornecedor</Link>
        </p>
      )}

      {compravel && relacoes.length > 0 && (
        <p className="field__hint">
          {`Preferencial: no máximo um por item, só entre relações ativas e homologadas. Homologar e bloquear são de ${QUEM_HOMOLOGA_A_RELACAO}, no detalhe da relação.`}
        </p>
      )}

      {criando && (
        <SupplierItemFormModal
          itemFixo={item}
          relacoesDoItem={relacoes}
          suppliers={fornecedores}
          onClose={() => setCriando(false)}
          onOpenExisting={(id) => {
            setCriando(false);
            setDetalheId(id);
          }}
          onSaved={(criada) => {
            setCriando(false);
            setFeito(
              `${criada.supplierName} adicionado a este item — ${SUPPLIER_ITEM_QUALIFICATION_LABELS[criada.qualificationStatus]}.`,
            );
            consulta.reload();
          }}
        />
      )}

      {detalheId && (
        <SupplierItemDetailModal
          supplierItemId={detalheId}
          preferencialDoItem={preferencialAtual}
          onClose={() => {
            setDetalheId(null);
            consulta.reload();
          }}
        />
      )}

      <ConfirmarPreferencialDialog
        candidato={candidato}
        atual={preferencialAtual}
        onCancel={() => setCandidato(null)}
        onConfirm={() => {
          if (candidato) void definirPreferencial(candidato);
        }}
      />
    </FormSection>
  );
}
