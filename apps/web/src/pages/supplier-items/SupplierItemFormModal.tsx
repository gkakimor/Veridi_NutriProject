import { useCallback, useEffect, useRef, useState } from "react";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import {
  assinaturaDoDocumento,
  decimalComparavel,
  textoComparavel,
} from "../../lib/dirty-fields";
import type { FormEvent } from "react";
import type {
  ItemDTO,
  SupplierDTO,
  SupplierItemDTO,
  SupplierItemDetailDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  ITEM_TYPES_COMPRAVEIS,
  SUPPLIER_ITEM_QUALIFICATION_LABELS,
  hojeComercial,
  motivoDoBloqueioValido,
  podeSerComprado,
} from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { getItem, listItems } from "../../lib/items-api";
import { createSupplierItem, listSupplierItems } from "../../lib/supplier-items-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { AlreadyExistsApiError, apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal } from "../../lib/decimal-field";
import {
  CASAS_PRECO_UNITARIO,
  CASAS_QUANTIDADE,
  OPCOES_PRECO_UNITARIO,
  OPCOES_QUANTIDADE,
} from "../../lib/numeric-scales";
import { DecimalField, MoneyField } from "../../components/NumericField";
import { listUnits } from "../../lib/units-api";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { SELETOR_DE_ITEM_SEM_CADASTRO, usePodeCriarItem } from "../items/item-permissions";
import {
  SELETOR_DE_FORNECEDOR_SEM_CADASTRO,
  usePodeEditarFornecedor,
} from "../suppliers/supplier-permissions";
import { QUEM_HOMOLOGA_A_RELACAO, usePodeDecidirHomologacao } from "./supplier-item-permissions";
import { ConfirmarPreferencialDialog, preferencialEntre } from "./preferencial";

/**
 * O que a relação leva junto ao sair para cadastrar item ou fornecedor.
 *
 * Só o formulário. As listas de item e fornecedor chegam por prop da
 * listagem e são recarregadas por ela na volta; as unidades vêm do
 * servidor. Nada disso é rascunho.
 */
type RascunhoRelacao = {
  itemId: string;
  supplierId: string;
  supplierItemCode: string;
  commercialNotes: string;
  qualificationStatus: "PENDING" | "APPROVED" | "BLOCKED";
  qualificationNote: string;
  preferred: boolean;
  unitPrice: string;
  priceUomCode: string;
  minimumOrderQuantity: string;
  minimumOrderUomCode: string;
  effectiveAt: string;
  validUntil: string;
  offerNotes: string;
};

/** Quantos resultados a busca no servidor traz por tipo. */
const PAGINA_DA_BUSCA = 50;

/** Quantos fornecedores a busca no servidor traz. */
const PAGINA_DA_BUSCA_DE_FORNECEDORES = 20;

/** Um formato só de rótulo: o da lista inicial e o da busca não podem divergir. */
function opcaoDoItem(item: ItemDTO): EntityOption {
  return { id: item.id, code: item.code, name: item.name, hint: item.unitCode };
}

/** Razão social na linha, nome fantasia ao lado, e o CNPJ só para a busca. */
function opcaoDoFornecedor(supplier: SupplierDTO): EntityOption {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.legalName,
    ...(supplier.tradeName ? { hint: supplier.tradeName } : {}),
    searchTerms: [supplier.tradeName ?? "", supplier.cnpj ?? ""].filter(Boolean).join(" "),
  };
}

/** Mescla sem duplicar e sem trocar a referência à toa. */
function mesclarPorId<T extends { id: string }>(atual: T[], novos: T[]): T[] {
  const conhecidos = new Set(atual.map((registro) => registro.id));
  const ineditos = novos.filter((registro) => !conhecidos.has(registro.id));
  return ineditos.length === 0 ? atual : [...atual, ...ineditos];
}

/**
 * Com o Item fixo, o cadastro de fornecedor novo não sai daqui: sair desmonta o
 * cadastro do Item inteiro, e na volta não haveria Item aberto para receber o
 * fornecedor. A busca vazia diz onde cadastrar.
 */
const FORNECEDOR_NOVO_FORA_DO_ITEM = {
  emptyMessage:
    "Nenhum fornecedor ativo encontrado. Fornecedor novo se cadastra em Cadastros › Fornecedores.",
  noOptionsMessage:
    "Nenhum fornecedor ativo disponível. Fornecedor novo se cadastra em Cadastros › Fornecedores.",
} as const;

/** A relação do par, se o servidor tiver uma — a recusa 409 não traz o id. */
async function relacaoDoPar(itemId: string, supplierId: string): Promise<SupplierItemDTO | null> {
  try {
    const { supplierItems } = await listSupplierItems({ itemId, supplierId, pageSize: 1 });
    return supplierItems[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Nova relação item × fornecedor.
 *
 * A grade da lista mostra homologação, preferencial, preço e pedido mínimo.
 * Este formulário pedia apenas item, fornecedor, código e observações, e a
 * relação nascia Pendente e sem preço — quem cadastrava quatro materiais
 * terminava com quatro relações que não sabiam precificar nada, e só
 * descobria isso ao calcular custo.
 *
 * Os quatro campos cabem aqui agora. Continuam OPCIONAIS: uma relação sem
 * oferta é registro legítimo, e é melhor dizer "sem oferta cadastrada" do
 * que fingir completude.
 *
 * Com `itemFixo`, é o "Adicionar fornecedor" do cadastro do Item
 * (ITEM-SUPPLIER-UX-01): o Item vem escolhido e não se troca, as mesmas regras
 * de situação inicial e oferta valem, e o fornecedor que o item já tem leva à
 * relação existente em vez de a uma recusa.
 */
export function SupplierItemFormModal({
  items = [],
  suppliers,
  itemFixo,
  relacoesDoItem = [],
  onOpenExisting,
  onClose,
  onSaved,
}: {
  /** Primeira página do seletor de Item — sem uso com `itemFixo`. */
  items?: ItemDTO[];
  suppliers: SupplierDTO[];
  /** O Item de onde a relação nasce: sem seletor de Item, sem trocá-lo. */
  itemFixo?: ItemDTO;
  /** As relações que o `itemFixo` já tem: duplicidade e preferencial atual. */
  relacoesDoItem?: readonly SupplierItemDTO[];
  /** "Abrir relação existente" — quem hospeda abre o detalhe sem perder o contexto. */
  onOpenExisting?: (supplierItemId: string) => void;
  onClose: () => void;
  onSaved: (created: SupplierItemDetailDTO) => void;
}) {
  /* Cadastrar Item ou Fornecedor no meio da relação só para quem cadastra
     (MASTER-DATA-EDIT-PERMISSIONS-01); escolher existente segue livre. */
  const podeCadastrarItem = usePodeCriarItem();
  const podeCadastrarFornecedor = usePodeEditarFornecedor();
  /* Situação inicial diferente de Pendente, e o preferencial que depende dela,
     só para quem decide a homologação (ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01). */
  const podeDecidirHomologacao = usePodeDecidirHomologacao();
  const [itemId, setItemId] = useState(itemFixo?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [supplierItemCode, setSupplierItemCode] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");

  const [qualificationStatus, setQualificationStatus] = useState<"PENDING" | "APPROVED" | "BLOCKED">(
    "PENDING",
  );
  const [qualificationNote, setQualificationNote] = useState("");
  const [preferred, setPreferred] = useState(false);

  const [unitPrice, setUnitPrice] = useState("");
  /* Com o Item fixo a unidade dele já é a sugestão da abertura — pelo efeito, ela
     chegaria depois da linha de base, e abrir o formulário já pediria descarte. */
  const [priceUomCode, setPriceUomCode] = useState(itemFixo?.unitCode ?? "");
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState("");
  const [minimumOrderUomCode, setMinimumOrderUomCode] = useState(itemFixo?.unitCode ?? "");
  /** Sugestão visível e editável — nunca um "hoje" assumido pelo servidor. */
  const [effectiveAt, setEffectiveAt] = useState(hojeComercial());
  const [validUntil, setValidUntil] = useState("");
  const [offerNotes, setOfferNotes] = useState("");

  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A relação do par que o servidor recusou com 409 — criada depois da lista do Item. */
  const [existenteNoServidor, setExistenteNoServidor] = useState<SupplierItemDTO | null>(null);
  /** O preferencial pede confirmação antes do envio, com o Item fixo (ITEM-SUPPLIER-UX-01). */
  const [confirmandoPreferencial, setConfirmandoPreferencial] = useState(false);

  /**
   * A relação como ela está na tela, em forma comparável.
   *
   * Os catorze campos que o formulário tem — nem um a mais. "Válida a partir
   * de" nasce com o dia de hoje: é sugestão visível, e abrir a tela não pode
   * virar pergunta de descarte na saída.
   */
  const camposComparaveis = {
    itemId: textoComparavel(itemId),
    supplierId: textoComparavel(supplierId),
    supplierItemCode: textoComparavel(supplierItemCode),
    commercialNotes: textoComparavel(commercialNotes),
    qualificationStatus,
    qualificationNote: textoComparavel(qualificationNote),
    preferred,
    unitPrice: decimalComparavel(unitPrice),
    priceUomCode: textoComparavel(priceUomCode),
    minimumOrderQuantity: decimalComparavel(minimumOrderQuantity),
    minimumOrderUomCode: textoComparavel(minimumOrderUomCode),
    effectiveAt: textoComparavel(effectiveAt),
    validUntil: textoComparavel(validUntil),
    offerNotes: textoComparavel(offerNotes),
  };
  const assinaturaAtual = assinaturaDoDocumento(camposComparaveis);
  /* Só o fornecedor escolhido não é trabalho a perder: quem escolheu um que o
     item já tem vai para a relação existente sem pergunta de descarte. */
  const assinaturaSemFornecedor = assinaturaDoDocumento({ ...camposComparaveis, supplierId: null });

  const baseline = useRef<string | null>(null);
  if (baseline.current === null) baseline.current = assinaturaAtual;

  const { confirmarDescarte, liberarGuarda } = useUnsavedChangesGuard({
    isDirty: baseline.current !== assinaturaAtual,
    substantivo: "relação",
    genero: "a",
  });

  /**
   * Cancelar, ✕ e Esc: o router não vê nada disso — a guarda vê.
   *
   * Memorizado porque vai para `onClose` do `FullWorkspaceModal`: um
   * `onClose` novo a cada renderização é o defeito que a Wave 01 fechou.
   */
  const fechar = useCallback(() => confirmarDescarte(onClose), [confirmarDescarte, onClose]);

  useEffect(() => {
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  /*
   * Cadastro no contexto — item e fornecedor.
   *
   * As duas listas chegam por prop da listagem — só a primeira página —, e
   * ela as recarrega ao montar. Como sair para cadastrar DESMONTA este
   * formulário, o que nasce lá fora volta escolhido pelo id, e o rótulo é
   * resolvido pelo id quando o registro novo não está na primeira página:
   * não há o que guardar aqui.
   */
  const origem = useContextualCreateOrigin<RascunhoRelacao>({
    // Com o Item fixo nada sai para cadastrar, e nada volta para retomar aqui.
    enabled: !itemFixo,
    collectDraft: () => ({
      itemId,
      supplierId,
      supplierItemCode,
      commercialNotes,
      qualificationStatus,
      qualificationNote,
      preferred,
      unitPrice,
      priceUomCode,
      minimumOrderQuantity,
      minimumOrderUomCode,
      effectiveAt,
      validUntil,
      offerNotes,
    }),
    restoreDraft: (draft) => {
      setItemId(itemFixo?.id ?? draft.itemId ?? "");
      setSupplierId(draft.supplierId ?? "");
      setSupplierItemCode(draft.supplierItemCode ?? "");
      setCommercialNotes(draft.commercialNotes ?? "");
      setQualificationStatus(draft.qualificationStatus ?? "PENDING");
      setQualificationNote(draft.qualificationNote ?? "");
      setPreferred(draft.preferred === true);
      setUnitPrice(draft.unitPrice ?? "");
      setPriceUomCode(draft.priceUomCode ?? "");
      setMinimumOrderQuantity(draft.minimumOrderQuantity ?? "");
      setMinimumOrderUomCode(draft.minimumOrderUomCode ?? "");
      setEffectiveAt(draft.effectiveAt || hojeComercial());
      setValidUntil(draft.validUntil ?? "");
      setOfferNotes(draft.offerNotes ?? "");
    },
    // Pelo id: os dois campos são de entidade, e o texto digitado na busca
    // escolheria o registro errado.
    onCreated: (result, record) => {
      if (record.entityType === "item") {
        if (!itemFixo) setItemId(result.entityId);
      } else setSupplierId(result.entityId);
    },
  });

  /**
   * O que a busca no servidor achou, somado à página que a listagem passou.
   *
   * Mora aqui e não na listagem porque quem conhece a regra do campo é este
   * formulário: a listagem só abastece a abertura.
   */
  const [encontrados, setEncontrados] = useState<ItemDTO[]>([]);
  const catalogo = mesclarPorId(items, encontrados);

  // Produto acabado é produzido, não comprado — fica fora da lista.
  const purchasableItems = catalogo.filter((item) => podeSerComprado(item.type));
  const selectedItem = itemFixo ?? purchasableItems.find((item) => item.id === itemId);

  /**
   * Busca no servidor, com os MESMOS filtros de negócio da lista de hoje:
   * `active: true`, como a carga da listagem, e só o que se compra.
   *
   * O tipo era filtrado só no navegador, e na busca ele PRECISA ir junto:
   * perguntando sem tipo, o servidor devolveria produto acabado e a lista
   * ofereceria justamente o que este formulário recusa. Uma consulta por tipo
   * comprável porque o filtro do servidor é de um tipo por vez — as mesmas
   * que Pedido de Compra já faz.
   */
  async function buscarItens(termo: string): Promise<EntityOption[]> {
    const paginas = await Promise.all(
      ITEM_TYPES_COMPRAVEIS.map((type) =>
        listItems({ type, active: true, search: termo, pageSize: PAGINA_DA_BUSCA }),
      ),
    );
    const achados = paginas.flatMap((pagina) => pagina.items);
    setEncontrados((atual) => mesclarPorId(atual, achados));
    return achados.map(opcaoDoItem);
  }

  /**
   * Rótulo do item que chega de FORA da lista.
   *
   * Cadastrar item no contexto sai desta tela e volta com o id escolhido, e
   * a listagem remonta trazendo só a primeira página do catálogo — onde o
   * item recém-criado, de código mais alto, não está. Sem isto o campo
   * voltaria em branco depois do cadastro, que lê como "não salvou".
   */
  const rotuloPedido = useRef("");
  useEffect(() => {
    if (itemFixo || !itemId || rotuloPedido.current === itemId) return;
    if (catalogo.some((item) => item.id === itemId)) return;
    rotuloPedido.current = itemId;
    void getItem(itemId)
      .then((item) => setEncontrados((atual) => mesclarPorId(atual, [item])))
      .catch(() => undefined);
    // `catalogo` é recalculado a cada render; as fontes dele é que importam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, items, encontrados]);

  /**
   * Fornecedor: primeira página que a listagem passou, somada ao que a busca
   * no servidor achou e ao escolhido que chegou de fora.
   *
   * Eram 1000 ativos passados pela listagem e filtrados só no navegador: do
   * fornecedor ativo 1001 em diante ele existia, o servidor aceitaria a
   * relação, e o campo não o achava — com "+ Novo fornecedor" logo ali
   * convidando a duplicar.
   */
  const [fornecedoresEncontrados, setFornecedoresEncontrados] = useState<SupplierDTO[]>([]);
  const catalogoDeFornecedores = mesclarPorId(suppliers, fornecedoresEncontrados);

  /** Busca no servidor com o MESMO filtro da primeira página: só ativos. */
  async function buscarFornecedores(termo: string): Promise<EntityOption[]> {
    const { suppliers: achados } = await listSuppliers({
      active: true,
      search: termo,
      pageSize: PAGINA_DA_BUSCA_DE_FORNECEDORES,
    });
    setFornecedoresEncontrados((atual) => mesclarPorId(atual, achados));
    return achados.map(opcaoDoFornecedor);
  }

  /**
   * Rótulo do fornecedor que chega de FORA da lista — cadastro no contexto
   * (código novo, fora da primeira página) ou rascunho restaurado. Pelo id e
   * com o mesmo filtro: o que deixou de ser ativo não volta como se pudesse.
   */
  const fornecedorPedido = useRef("");
  useEffect(() => {
    if (!supplierId || fornecedorPedido.current === supplierId) return;
    if (catalogoDeFornecedores.some((supplier) => supplier.id === supplierId)) return;
    fornecedorPedido.current = supplierId;
    void listSuppliers({ ids: [supplierId], active: true, pageSize: 1 })
      .then(({ suppliers: achados }) =>
        setFornecedoresEncontrados((atual) => mesclarPorId(atual, achados)),
      )
      .catch(() => undefined);
    // `catalogoDeFornecedores` é recalculado a cada render; as fontes dele é que importam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, suppliers, fornecedoresEncontrados]);

  /*
   * A unidade do preço acompanha a unidade de estoque do item por padrão.
   *
   * Escolher item e ter de repetir "kg" logo abaixo é trabalho que o
   * sistema já sabe fazer — e a unidade continua editável para quem compra
   * em outra (saco, tonelada).
   */
  useEffect(() => {
    if (!selectedItem) return;
    setPriceUomCode((current) => current || selectedItem.unitCode);
    setMinimumOrderUomCode((current) => current || selectedItem.unitCode);
  }, [selectedItem]);

  const preencheuOferta = unitPrice.trim() !== "";
  const podeSerPreferencial = qualificationStatus === "APPROVED";
  /* Nascer bloqueada é bloquear: o motivo é obrigatório aqui como no detalhe
     (SUPPLIER-QUALITY-REJECTION-REASON-01). */
  const bloqueando = podeDecidirHomologacao && qualificationStatus === "BLOCKED";

  // Bloquear/despender a homologação derruba a preferência: mesma regra do
  // domínio, aplicada já na tela para o estado não ficar impossível.
  useEffect(() => {
    if (!podeSerPreferencial && preferred) setPreferred(false);
  }, [podeSerPreferencial, preferred]);

  /**
   * O fornecedor que o Item fixo já tem: pela lista do cadastro do Item ou pela
   * recusa do servidor, quando a relação nasceu depois dela. Não há segunda
   * relação do mesmo par — a tela leva à que existe, em vez de ao 409.
   */
  const relacaoExistente =
    itemFixo && supplierId
      ? (relacoesDoItem.find((relacao) => relacao.supplierId === supplierId) ??
        (existenteNoServidor?.supplierId === supplierId ? existenteNoServidor : null))
      : null;

  const fornecedorEscolhido = catalogoDeFornecedores.find((supplier) => supplier.id === supplierId);
  const preferencialAtual = itemFixo ? preferencialEntre(relacoesDoItem) : null;

  function abrirRelacaoExistente(id: string) {
    const abrir = () => liberarGuarda(() => onOpenExisting?.(id));
    if (assinaturaSemFornecedor === baseline.current) abrir();
    else confirmarDescarte(abrir);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (relacaoExistente) return;
    /* Com o Item fixo o preferencial de hoje é conhecido, e trocá-lo se confirma
       antes — como na linha da seção. Sem o Item fixo, a tela geral segue como era. */
    if (itemFixo && podeDecidirHomologacao && preferred) {
      setConfirmandoPreferencial(true);
      return;
    }
    void criar();
  }

  async function criar() {
    setSaving(true);
    setError(null);
    try {
      const created = await createSupplierItem({
        itemId,
        supplierId,
        ...(supplierItemCode.trim() ? { supplierItemCode: supplierItemCode.trim() } : {}),
        ...(commercialNotes.trim() ? { commercialNotes: commercialNotes.trim() } : {}),
        // Quem não decide a homologação não pede situação: a relação nasce Pendente.
        ...(podeDecidirHomologacao
          ? {
              ...(qualificationStatus !== "PENDING" ? { qualificationStatus } : {}),
              ...(qualificationNote.trim() ? { qualificationNote: qualificationNote.trim() } : {}),
              ...(preferred ? { preferred: true } : {}),
            }
          : {}),
        ...(preencheuOferta
          ? {
              initialOffer: {
                unitPrice: exigirDecimal(unitPrice, "Preço", OPCOES_PRECO_UNITARIO),
                priceUomCode: priceUomCode || selectedItem?.unitCode || "",
                ...(minimumOrderQuantity.trim()
                  ? {
                      minimumOrderQuantity: exigirDecimal(
                        minimumOrderQuantity,
                        "Pedido mínimo",
                        OPCOES_QUANTIDADE,
                      ),
                      minimumOrderUomCode: minimumOrderUomCode || selectedItem?.unitCode || "",
                    }
                  : {}),
                effectiveAt,
                ...(validUntil ? { validUntil } : {}),
                ...(offerNotes.trim() ? { notes: offerNotes.trim() } : {}),
              },
            }
          : {}),
      });
      /*
       * Gravou: o que está na tela virou registro. `onSaved` fecha o modal e
       * recarrega a listagem na mesma função, antes de qualquer renderização.
       */
      baseline.current = assinaturaAtual;
      liberarGuarda(() => onSaved(created));
    } catch (err) {
      if (itemFixo && err instanceof AlreadyExistsApiError) {
        const existente = await relacaoDoPar(itemFixo.id, supplierId);
        if (existente) {
          setExistenteNoServidor(existente);
          return;
        }
      }
      setError(apiErrorMessage(err, "Falha ao criar a relação"));
    } finally {
      setSaving(false);
    }
  }

  /** O que a linha vai mostrar na grade — dito antes de salvar. */
  const resumo = preencheuOferta
    ? `Será criada com oferta de ${unitPrice}/${priceUomCode || "?"}.`
    : "Será criada sem oferta cadastrada — o preço pode ser registrado depois.";

  return (
    <FullWorkspaceModal
      open
      onClose={fechar}
      crumb={itemFixo ? `Cadastros / Itens de estoque / ${itemFixo.code}` : "Compras / Item × Fornecedor"}
      crumbActive={itemFixo ? "Adicionar fornecedor" : "Nova"}
      title={itemFixo ? "Adicionar fornecedor ao item" : "Nova relação item × fornecedor"}
      {...(itemFixo ? { codeChip: itemFixo.code } : {})}
      footer={
        <>
          <span className="modal-fullscreen__foot-meta">{resumo}</span>
          <div className="modal-fullscreen__actions">
            <button type="button" className="btn btn--ghost" onClick={fechar}>
              Cancelar
            </button>
            <button
              type="submit"
              form="supplier-item-form"
              className="btn btn--accent"
              disabled={
                saving ||
                !itemId ||
                !supplierId ||
                relacaoExistente !== null ||
                (preencheuOferta && !effectiveAt) ||
                (bloqueando && !motivoDoBloqueioValido(qualificationNote))
              }
            >
              {itemFixo
                ? saving
                  ? "Adicionando…"
                  : "Adicionar fornecedor"
                : saving
                  ? "Criando…"
                  : "Criar relação"}
            </button>
          </div>
        </>
      }
    >
      <form id="supplier-item-form" onSubmit={handleSubmit}>
        {error && <p className="form-alert" role="alert">{error}</p>}

        <FormSection title="Relação">
          {/* O Item de onde a relação nasce é dito, não oferecido: não há o que trocar. */}
          {itemFixo && (
            <dl className="definition-list">
              <dt>Item</dt>
              <dd>
                <span className="code">{itemFixo.code}</span> {itemFixo.name} ({itemFixo.unitCode})
              </dd>
            </dl>
          )}

          <div className="field-grid-2">
            {/*
                Catálogo de matéria-prima passa de mil itens: rolar um
                `select` nativo até achar não é trabalho de gente, e a lista
                ainda vinha truncada. Mesmo componente que o Projeto usa
                para cliente.
            */}
            {!itemFixo && (
              <div className="field">
                <label htmlFor="supplier-item-item">
                  Item <span className="req">*</span>
                </label>
                <SearchableEntitySelect
                  id="supplier-item-item"
                  value={itemId}
                  onChange={setItemId}
                  required
                  placeholder="Digite código ou nome do item…"
                  options={purchasableItems.map(opcaoDoItem)}
                  onSearch={buscarItens}
                  canCreate={podeCadastrarItem}
                  {...(podeCadastrarItem ? {} : SELETOR_DE_ITEM_SEM_CADASTRO)}
                  createLabel="Novo item de estoque"
                  onCreateNew={() =>
                    liberarGuarda(() =>
                      origem.goCreate({
                        route: "/cadastros/itens/novo",
                        fieldKey: "itemId",
                        entityType: "item",
                      }),
                    )
                  }
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="supplier-item-supplier">
                Fornecedor <span className="req">*</span>
              </label>
              <SearchableEntitySelect
                id="supplier-item-supplier"
                value={supplierId}
                onChange={setSupplierId}
                required
                placeholder="Digite código ou nome do fornecedor…"
                options={catalogoDeFornecedores.map(opcaoDoFornecedor)}
                onSearch={buscarFornecedores}
                canCreate={!itemFixo && podeCadastrarFornecedor}
                {...(!podeCadastrarFornecedor
                  ? SELETOR_DE_FORNECEDOR_SEM_CADASTRO
                  : itemFixo
                    ? FORNECEDOR_NOVO_FORA_DO_ITEM
                    : {})}
                createLabel="Novo fornecedor"
                onCreateNew={() =>
                  liberarGuarda(() =>
                    origem.goCreate({
                      route: "/cadastros/fornecedores/novo",
                      fieldKey: "supplierId",
                      entityType: "supplier",
                    }),
                  )
                }
              />
              {relacaoExistente && (
                <div className="callout" role="status">
                  <p>
                    {`${relacaoExistente.supplierName} já está cadastrado para este item${
                      relacaoExistente.active ? "" : " (relação inativa)"
                    }. Cada fornecedor tem uma relação só com o item.`}
                  </p>
                  {onOpenExisting && (
                    <div className="line-actions">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => abrirRelacaoExistente(relacaoExistente.id)}
                      >
                        Abrir relação existente
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="supplier-item-code">Código do item no fornecedor</label>
              <input
                id="supplier-item-code"
                type="text"
                value={supplierItemCode}
                onChange={(event) => setSupplierItemCode(event.target.value)}
                placeholder="Ex.: VC-ASC-001"
              />
              <span className="field__hint">
                Referência do catálogo do fornecedor — não é o código interno nem o legado.
              </span>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-notes">Observações comerciais</label>
              <textarea
                id="supplier-item-notes"
                rows={3}
                value={commercialNotes}
                onChange={(event) => setCommercialNotes(event.target.value)}
              />
              <span className="field__hint">
                Condição negociada, contato, prazo — texto livre, lido depois por gente.
              </span>
            </div>
          </div>
        </FormSection>

        {podeDecidirHomologacao ? (
          <FormSection
            title="Homologação (opcional)"
            subtitle="Homologação é por item, não pelo fornecedor inteiro. Pendente significa ausência de homologação — não é reprovação."
          >
            <div className="field-grid-2">
              <div className="field">
                <label htmlFor="supplier-item-qualification">Situação</label>
                <select
                  id="supplier-item-qualification"
                  value={qualificationStatus}
                  onChange={(event) =>
                    setQualificationStatus(event.target.value as "PENDING" | "APPROVED" | "BLOCKED")
                  }
                >
                  <option value="PENDING">Pendente</option>
                  <option value="APPROVED">Homologado</option>
                  <option value="BLOCKED">Bloqueado</option>
                </select>
                <span className="field__hint">
                  Fica registrado como decisão de quem cadastrou, com data e autoria.
                </span>
              </div>

              <div className="field">
                <label htmlFor="supplier-item-qualification-note">
                  {bloqueando ? (
                    <>
                      Motivo do bloqueio <span className="req">*</span>
                    </>
                  ) : (
                    "Observação da decisão"
                  )}
                </label>
                <input
                  id="supplier-item-qualification-note"
                  type="text"
                  value={qualificationNote}
                  onChange={(event) => setQualificationNote(event.target.value)}
                  placeholder={
                    bloqueando
                      ? "Ex.: laudo reprovado, especificação divergente"
                      : "Ex.: auditoria de 2026, CoA aprovado"
                  }
                />
                {bloqueando && (
                  <span className="field__hint">
                    Este motivo ficará registrado no histórico de homologação.
                  </span>
                )}
              </div>

              <div className="field field--checkbox">
                <label htmlFor="supplier-item-preferred">
                  <input
                    id="supplier-item-preferred"
                    type="checkbox"
                    checked={preferred}
                    disabled={!podeSerPreferencial}
                    onChange={(event) => setPreferred(event.target.checked)}
                  />
                  Fornecedor preferencial deste item
                </label>
                <span className="field__hint">
                  {!podeSerPreferencial
                    ? "Só um fornecedor homologado pode ser preferencial."
                    : preferencialAtual
                      ? `Um por item. Hoje é ${preferencialAtual.supplierName}, que deixa de ser.`
                      : "Um por item. Se já houver outro preferencial, ele deixa de ser."}
                </span>
              </div>
            </div>
          </FormSection>
        ) : (
          /* Compras cria a relação Pendente: a situação é dita, não oferecida —
             um seletor com Homologado e Bloqueado terminaria no 403 da API, e o
             preferencial exige a relação homologada. */
          <FormSection
            title="Homologação"
            subtitle="Homologação é por item, não pelo fornecedor inteiro. Pendente significa ausência de homologação — não é reprovação."
          >
            <dl className="definition-list">
              <dt>Situação inicial</dt>
              <dd>
                <span className="badge badge--neutral">
                  {SUPPLIER_ITEM_QUALIFICATION_LABELS.PENDING}
                </span>
              </dd>
            </dl>
            <p className="field__hint">
              {`Homologar ou bloquear é decisão de ${QUEM_HOMOLOGA_A_RELACAO}, no detalhe da relação. O preferencial só pode ser marcado depois da homologação.`}
            </p>
          </FormSection>
        )}

        <FormSection
          title="Primeira oferta (opcional)"
          subtitle="Opcional. Preço aqui é referência comercial do fornecedor — o custo real continua vindo do recebimento. Uma vez registrada, a oferta é imutável: mudou preço, registra-se outra."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="supplier-item-price">Preço</label>
              <MoneyField
                id="supplier-item-price"
                scale={CASAS_PRECO_UNITARIO}
                value={unitPrice}
                onChangeValue={setUnitPrice}
                placeholder="Deixe vazio para criar sem oferta"
              />
              <span className="field__hint">
                O preço libera os demais campos da oferta. Sem ele, a relação nasce sem oferta
                cadastrada.
              </span>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-price-uom">Unidade do preço</label>
              <select
                id="supplier-item-price-uom"
                value={priceUomCode}
                onChange={(event) => setPriceUomCode(event.target.value)}
                disabled={!preencheuOferta}
              >
                <option value="">Selecione…</option>
                {units.map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {unit.code} — {unit.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-moq">Pedido mínimo</label>
              <DecimalField
                id="supplier-item-moq"
                scale={CASAS_QUANTIDADE}
                value={minimumOrderQuantity}
                onChangeValue={setMinimumOrderQuantity}
                disabled={!preencheuOferta}
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-item-moq-uom">Unidade do pedido mínimo</label>
              <select
                id="supplier-item-moq-uom"
                value={minimumOrderUomCode}
                onChange={(event) => setMinimumOrderUomCode(event.target.value)}
                disabled={!preencheuOferta || !minimumOrderQuantity.trim()}
              >
                <option value="">Selecione…</option>
                {units.map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {unit.code} — {unit.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-effective">Válida a partir de *</label>
              <input
                id="supplier-item-effective"
                type="date"
                required
                value={effectiveAt}
                onChange={(event) => setEffectiveAt(event.target.value)}
                disabled={!preencheuOferta}
              />
              {/* Era "Vazio = vale a partir de agora" — e "agora" era o
                  instante do POST. A data comercial de um preço é do
                  negócio, não do relógio de quem cadastrou. */}
              <span className="field__hint">
                Sugerida como hoje. Sem esta data o preço não entra no custo.
              </span>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-valid-until">Validade</label>
              <input
                id="supplier-item-valid-until"
                type="date"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
                disabled={!preencheuOferta}
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-item-offer-notes">Observação da oferta</label>
              <input
                id="supplier-item-offer-notes"
                type="text"
                value={offerNotes}
                onChange={(event) => setOfferNotes(event.target.value)}
                disabled={!preencheuOferta}
              />
            </div>
          </div>
        </FormSection>
      </form>

      <ConfirmarPreferencialDialog
        candidato={
          confirmandoPreferencial
            ? { id: supplierId, supplierName: fornecedorEscolhido?.legalName ?? "o fornecedor escolhido" }
            : null
        }
        atual={preferencialAtual}
        onCancel={() => setConfirmandoPreferencial(false)}
        onConfirm={() => {
          setConfirmandoPreferencial(false);
          void criar();
        }}
      />
    </FullWorkspaceModal>
  );
}
