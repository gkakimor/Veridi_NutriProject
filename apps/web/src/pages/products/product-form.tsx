import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type {
  DosageForm,
  PresentationType,
  ProductDTO,
  TargetAgeGroup,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  DOSAGE_FORMS,
  DOSAGE_FORM_LABELS,
  PRESENTATION_TYPES,
  PRESENTATION_TYPE_LABELS,
  TARGET_AGE_GROUPS,
  TARGET_AGE_GROUP_LABELS,
  PRODUCT_ATTACHMENT_TYPES,
} from "@veridi/shared";
import { RelatedLinks } from "../../components/RelatedLinks";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { AttachmentsSection } from "../../components/AttachmentsSection";
import { FormSection } from "../../components/FormSection";
import { ToggleCard } from "../../components/ToggleCard";
import { createProduct, updateProduct } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { listUnits } from "../../lib/units-api";
import { ApiValidationError } from "../../lib/api-errors";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import { ProductIndustrialCostSummary } from "./ProductIndustrialCostSummary";

/**
 * O formulário de Produto, uma vez só.
 *
 * Existe pelo mesmo motivo do de Fornecedor: o cadastro passou a ter duas
 * portas — o modal, aberto de dentro de outra tela (Pedido, listagem), e a
 * página `/cadastros/produtos/novo`, que tem URL própria e por isso
 * sobrevive a refresh e a link direto. São 17 campos e um payload que muda
 * conforme o modo; duas cópias divergiriam, e a divergência só apareceria
 * meses depois, num produto que entrou por onde não devia.
 *
 * A divisão é a que o HTML já permitia: `useProductForm` guarda estado,
 * dados de apoio, payload e submit; `ProductFormFields` desenha os campos
 * dentro do `<form>`; e quem hospeda monta o próprio rodapé. O botão de
 * commit não precisa estar dentro do `<form>` — `type="submit"
 * form="product-form"` aciona um formulário em que o botão não está
 * aninhado. Por isso o rodapé precisa de UMA coisa daqui: `saving`.
 *
 * ## Por que unidades e clientes vivem AQUI
 *
 * Os dois hospedeiros precisam exatamente das mesmas listas, com as mesmas
 * regras de montagem: unidades para a dose e para o item de produto acabado,
 * clientes ativos mais o vínculo histórico (cliente inativado depois continua
 * aparecendo, senão o produto pareceria ter perdido o dono) mais o cliente
 * recém-criado no contexto. Deixar isso no hospedeiro obrigaria a repetir
 * três regras e a manter a repetição sincronizada. Aqui a busca é uma só e o
 * comportamento é o mesmo em modal e em página, que é o ponto do módulo
 * compartilhado.
 *
 * ## O que NÃO vive aqui
 *
 * Quem hospeda decide o que "+ Novo cliente" faz. No modal, abre o
 * `CustomerFormModal` FORA do `<form>` do produto (ver o comentário lá). Na
 * página, navega para `/cadastros/clientes/novo` e volta com o rascunho
 * intacto. O formulário só avisa que alguém pediu — `onCreateCustomer` — e
 * recebe o cliente de volta por `selectCustomer`.
 */

/** O `<form>` que o botão de commit aciona pelo atributo `form`. */
export const PRODUCT_FORM_ID = "product-form";

/**
 * Cliente exibível no campo de busca.
 *
 * Mais largo que `ProductCustomerSummary` de propósito: `cnpj` entra na
 * busca (quem não lembra o nome lembra o documento) e `active` distingue o
 * vínculo histórico do catálogo corrente.
 */
export interface ProductCustomerOption {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  /** Entra na busca do campo: quem não lembra o nome lembra o CNPJ. */
  cnpj?: string | null;
  active: boolean;
}

/**
 * Estado do formulário.
 *
 * `type` e não `interface` porque ele viaja como rascunho da criação
 * contextual, e `useContextualCreateOrigin` exige `Record<string, unknown>`
 * — que interface não satisfaz (não ganha índice implícito). O rascunho é
 * este objeto e nada mais: nenhuma lista carregada do servidor, nenhuma
 * função, nada de credencial.
 */
export type ProductFormState = {
  name: string;
  externalCode: string;
  customerId: string;
  finishedProductItemId: string;
  /** Unidade do item de estoque criado junto com o produto (só na criação). */
  finishedUnitCode: string;
  /** Se os lotes deste produto exigem laudo aprovado (só na criação). */
  finishedRequiresCoa: boolean;
  dosageForm: string;
  presentationType: string;
  capsulesPerDose: string;
  doseAmount: string;
  doseUomCode: string;
  dosesPerPackage: string;
  unitsPerShippingBox: string;
  targetAgeGroup: string;
  shelfLifeMonths: string;
  minimumBatchQuantity: string;
  notes: string;
};

/** Cliente imposto pela origem — o campo vira fato, não escolha. */
export interface ProductCustomerLock {
  id: string;
  /** Só para exibir enquanto o catálogo não chegou. */
  label: string;
}

/** Número opcional vira texto do formulário; vazio continua vazio. */
function numberField(value: number | string | null): string {
  return value === null || value === undefined ? "" : String(value);
}

function initialState(product: ProductDTO | null): ProductFormState {
  if (product) {
    return {
      name: product.name,
      externalCode: product.externalCode ?? "",
      customerId: product.customerId ?? "",
      finishedProductItemId: product.finishedProductItemId ?? "",
      finishedUnitCode: product.finishedProductItem ? "" : "un",
      finishedRequiresCoa: product.finishedProductItem?.requiresCoa ?? false,
      dosageForm: product.dosageForm ?? "",
      presentationType: product.presentationType ?? "",
      capsulesPerDose: numberField(product.capsulesPerDose),
      doseAmount: numberField(product.doseAmount),
      doseUomCode: product.doseUomCode ?? "",
      dosesPerPackage: numberField(product.dosesPerPackage),
      unitsPerShippingBox: numberField(product.unitsPerShippingBox),
      targetAgeGroup: product.targetAgeGroup ?? "",
      shelfLifeMonths: numberField(product.shelfLifeMonths),
      minimumBatchQuantity: numberField(product.minimumBatchQuantity),
      notes: product.notes ?? "",
    };
  }
  return {
    name: "",
    externalCode: "",
    customerId: "",
    finishedProductItemId: "",
    finishedUnitCode: "un",
    finishedRequiresCoa: false,
    dosageForm: "",
    presentationType: "",
    capsulesPerDose: "",
    doseAmount: "",
    doseUomCode: "",
    dosesPerPackage: "",
    unitsPerShippingBox: "",
    targetAgeGroup: "",
    shelfLifeMonths: "",
    minimumBatchQuantity: "",
    notes: "",
  };
}

export function useProductForm({
  mode,
  product,
  onSaved,
  onCreateCustomer,
  customerLock,
}: {
  mode: "create" | "edit";
  product: ProductDTO | null;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: ProductDTO) => void;
  /**
   * Alguém pediu "+ Novo cliente" no campo de busca, com o texto digitado.
   * Sem isto o campo não oferece cadastro: CTA que não leva a lugar nenhum é
   * pior que CTA nenhum.
   */
  onCreateCustomer?: ((typed: string) => void) | undefined;
  /**
   * Cliente definido pela origem. O campo deixa de ser editável — permitir
   * divergência aqui criaria um produto de um cliente e um documento de
   * outro, com a tela dizendo que estava tudo certo.
   */
  customerLock?: ProductCustomerLock | null | undefined;
}) {
  const [form, setForm] = useState<ProductFormState>(() => {
    const base = initialState(product);
    return customerLock ? { ...base, customerId: customerLock.id } : base;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  const [activeCustomers, setActiveCustomers] = useState<ProductCustomerOption[]>([]);
  /**
   * Clientes que não vieram da busca: o criado agora (no modal ou na volta da
   * criação contextual). Lista separada de propósito — se entrasse em
   * `activeCustomers`, a resposta da busca, que pode chegar DEPOIS da volta,
   * apagaria a seleção recém-feita.
   */
  const [extraCustomers, setExtraCustomers] = useState<ProductCustomerOption[]>([]);

  useEffect(() => {
    // A dose pode ser em mg/g/ml — unidades vêm do cadastro existente.
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) => setActiveCustomers(result.customers))
      .catch(() => setActiveCustomers([]));
  }, []);

  // Vinculo historico: se o cliente associado nao estiver mais na lista de
  // ativos (foi inativado depois), ele continua aparecendo no select.
  const customerOptions: ProductCustomerOption[] = useMemo(() => {
    const conhecidos = new Set(activeCustomers.map((customer) => customer.id));
    // O recém-criado encabeça a lista até a busca devolvê-lo com código
    // próprio — aí o registro real assume e o provisório some por id.
    const novos = extraCustomers.filter((customer) => !conhecidos.has(customer.id));
    const lista = [...novos, ...activeCustomers];
    if (product?.customer && !conhecidos.has(product.customer.id)) {
      if (!novos.some((customer) => customer.id === product.customer?.id)) {
        lista.push({ ...product.customer, active: false });
      }
    }
    return lista;
  }, [activeCustomers, extraCustomers, product]);

  /**
   * Um cliente chegou de fora — cadastrado no modal ou na página oficial.
   *
   * Entra na lista e no campo. O resto do formulário continua como estava:
   * quem cadastrou o cliente queria ESTE cliente e não quer redigitar o que
   * já preencheu.
   */
  const selectCustomer = useCallback((customer: ProductCustomerOption) => {
    setExtraCustomers((prev) => [customer, ...prev.filter((row) => row.id !== customer.id)]);
    setForm((prev) => ({ ...prev, customerId: customer.id }));
  }, []);

  /** O cliente travado, com o nome real assim que o catálogo o conhece. */
  const lockedCustomer = useMemo(() => {
    if (!customerLock) return null;
    const conhecido = customerOptions.find((customer) => customer.id === customerLock.id);
    return {
      id: customerLock.id,
      code: conhecido?.code ?? "",
      name: conhecido?.legalName ?? customerLock.label,
    };
  }, [customerLock, customerOptions]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError(null);
    setFieldErrors({});

    // No edit sempre envia as chaves opcionais (mesmo vazias) para permitir
    // limpar/desvincular; no create so envia quando preenchido.
    const optionalField = (value: string) =>
      mode === "edit" || value.trim() ? { value: value.trim() } : null;

    const externalCode = optionalField(form.externalCode);
    const customerId = optionalField(form.customerId);
    const finishedProductItemId = optionalField(form.finishedProductItemId);
    const notes = optionalField(form.notes);

    /*
     * Campo numérico: no edit sempre envia (vazio limpa), no create só
     * quando preenchido. A vírgula do usuário passa pelo parser central —
     * mesma leitura da web inteira — e o que ele não consegue ler para no
     * próprio campo, com o nome do campo, em vez de seguir para a API.
     */
    const ilegiveis: Record<string, string> = {};
    const numeric = (campo: string, rotulo: string, value: string) => {
      const trimmed = value.trim() === "" ? "" : parseDecimalInput(value);
      if (trimmed === null) {
        ilegiveis[campo] = mensagemDecimalInvalido(rotulo);
        return null;
      }
      if (mode === "edit") return { value: trimmed };
      return trimmed ? { value: trimmed } : null;
    };
    const enumField = (value: string) =>
      mode === "edit" || value ? { value } : null;

    const dosageForm = enumField(form.dosageForm);
    const presentationType = enumField(form.presentationType);
    const targetAgeGroup = enumField(form.targetAgeGroup);
    const doseUomCode = enumField(form.doseUomCode);
    const capsulesPerDose = numeric("capsulesPerDose", "Cápsulas por dose", form.capsulesPerDose);
    const doseAmount = numeric("doseAmount", "Dose", form.doseAmount);
    const dosesPerPackage = numeric("dosesPerPackage", "Doses por embalagem", form.dosesPerPackage);
    const unitsPerShippingBox = numeric(
      "unitsPerShippingBox",
      "Unidades por caixa",
      form.unitsPerShippingBox,
    );
    const shelfLifeMonths = numeric("shelfLifeMonths", "Vida útil (meses)", form.shelfLifeMonths);
    const minimumBatchQuantity = numeric(
      "minimumBatchQuantity",
      "Lote mínimo",
      form.minimumBatchQuantity,
    );

    // Nada sai daqui com um número ilegível: o erro pousa no campo.
    if (Object.keys(ilegiveis).length > 0) {
      setFieldErrors(ilegiveis);
      setError("Corrija os campos destacados.");
      setSaving(false);
      return;
    }

    const payload = {
      name: form.name.trim(),
      ...(dosageForm ? { dosageForm: dosageForm.value as DosageForm | "" } : {}),
      ...(presentationType
        ? { presentationType: presentationType.value as PresentationType | "" }
        : {}),
      ...(targetAgeGroup
        ? { targetAgeGroup: targetAgeGroup.value as TargetAgeGroup | "" }
        : {}),
      ...(doseUomCode ? { doseUomCode: doseUomCode.value } : {}),
      ...(capsulesPerDose ? { capsulesPerDose: capsulesPerDose.value } : {}),
      ...(doseAmount ? { doseAmount: doseAmount.value } : {}),
      ...(dosesPerPackage ? { dosesPerPackage: dosesPerPackage.value } : {}),
      ...(unitsPerShippingBox ? { unitsPerShippingBox: unitsPerShippingBox.value } : {}),
      ...(shelfLifeMonths ? { shelfLifeMonths: shelfLifeMonths.value } : {}),
      ...(minimumBatchQuantity ? { minimumBatchQuantity: minimumBatchQuantity.value } : {}),
      ...(externalCode ? { externalCode: externalCode.value } : {}),
      ...(customerId ? { customerId: customerId.value } : {}),
      ...(finishedProductItemId ? { finishedProductItemId: finishedProductItemId.value } : {}),
      // O item de estoque nasce com o produto: a unidade é a única coisa que
      // a tela precisa dizer sobre ele.
      ...(mode === "create"
        ? {
            finishedUnitCode: form.finishedUnitCode,
            finishedRequiresCoa: form.finishedRequiresCoa,
          }
        : {}),
      ...(notes ? { notes: notes.value } : {}),
    };

    try {
      if (mode === "create") {
        const created = await createProduct(payload);
        onSaved(created);
      } else {
        if (product) await updateProduct(product.id, payload);
        onSaved();
      }
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          nextFieldErrors[issue.path] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao salvar produto");
      }
    } finally {
      setSaving(false);
    }
  }

  return {
    form,
    setForm,
    saving,
    error,
    fieldErrors,
    handleSubmit,
    mode,
    product,
    units,
    customerOptions,
    selectCustomer,
    onCreateCustomer,
    lockedCustomer,
  };
}

export type ProductFormController = ReturnType<typeof useProductForm>;

export function ProductFormFields({
  form,
  setForm,
  error,
  fieldErrors,
  handleSubmit,
  mode,
  product,
  units,
  customerOptions,
  onCreateCustomer,
  lockedCustomer,
}: ProductFormController) {
  /** Liga input, `aria-invalid` e a mensagem, para leitor de tela também. */
  function fieldProps(field: string) {
    const message = fieldErrors[field];
    return {
      ...(message ? { "aria-invalid": true as const } : {}),
      ...(message ? { "aria-describedby": `product-${field}-error` } : {}),
    };
  }

  function fieldError(field: string) {
    const message = fieldErrors[field];
    if (!message) return null;
    return (
      <p className="field__error" id={`product-${field}-error`}>
        {message}
      </p>
    );
  }

  return (
    <form id={PRODUCT_FORM_ID} onSubmit={handleSubmit}>
      {error && <p className="form-alert" role="alert">{error}</p>}

      {product && (
        <RelatedLinks
          /* A cadeia INTEIRA, na ordem de dependência, com os mesmos rótulos
             das cinco telas irmãs. Faltavam CMV e Precificação: quem abria o
             produto para ver o CMV não achava link nenhum aqui e precisava
             rolar o formulário inteiro até o resumo de custo lá embaixo. E
             "Custos" era o único lugar do sistema que chamava a estrutura de
             custo industrial por outro nome. */
          links={[
            { label: "Formulação", to: `/producao/formulacoes/${product.id}` },
            { label: "Custos industriais", to: `/produtos/${product.id}/custos` },
            { label: "CMV", to: `/produtos/${product.id}/cmv` },
            { label: "Precificação", to: `/gestao/precificacao?productId=${product.id}` },
            { label: "Ordens de produção", to: `/producao/ordens?productId=${product.id}` },
            ...(product.originProjectId
              ? [
                  {
                    label: "Projeto de origem",
                    to: `/comercial/projetos/${product.originProjectId}`,
                  },
                ]
              : []),
          ]}
        />
      )}

      <FormSection
        title="Identificação"
        subtitle="Definição comercial/industrial do produto fabricado pela Veridi."
      >
        <div className="field-grid-2">
          {/*
            Cliente travado é FATO, não campo.

            Quando a origem já disse de quem é o produto — veio do documento
            daquele cliente — oferecer o campo seria oferecer a divergência:
            produto de um cliente dentro do documento de outro, sem nada na
            tela dizendo que há conflito.
          */}
          {lockedCustomer ? (
            <div className="field field--full">
              <dl className="definition-list">
                <dt>Cliente</dt>
                <dd>
                  {lockedCustomer.code && (
                    <>
                      <span className="is-code">{lockedCustomer.code}</span>{" "}
                    </>
                  )}
                  {lockedCustomer.name}
                </dd>
              </dl>
              <p className="field__hint">
                Definido pela tela de origem — o produto nasce deste cliente.
              </p>
              {/*
                Também aqui: sem isto, a recusa da API viraria "Corrija os
                campos destacados" sem nenhum campo destacado — e o campo
                recusado é justamente o que a tela não deixa editar.
              */}
              {fieldError("customerId")}
            </div>
          ) : (
            <div className="field field--full">
              <label htmlFor="product-customer">
                Cliente <span className="req">*</span>
              </label>
              <SearchableEntitySelect
                id="product-customer"
                value={form.customerId}
                onChange={(selectedId) => setForm((prev) => ({ ...prev, customerId: selectedId }))}
                placeholder="Digite código, razão social, fantasia ou CNPJ…"
                required
                options={customerOptions.map((customer) => ({
                  id: customer.id,
                  code: customer.code,
                  // Razão social assina contrato; nome fantasia é como o
                  // cliente se chama no telefone. Quem procura usa o
                  // segundo, e o CNPJ quando não lembra nenhum dos dois.
                  name: customer.legalName,
                  ...(customer.tradeName ? { hint: customer.tradeName } : {}),
                  searchTerms: [customer.tradeName ?? "", customer.cnpj ?? ""]
                    .filter(Boolean)
                    .join(" "),
                }))}
                canCreate={Boolean(onCreateCustomer)}
                createLabel="Novo cliente"
                {...(onCreateCustomer ? { onCreateNew: onCreateCustomer } : {})}
                {...fieldProps("customerId")}
              />
              {fieldError("customerId")}
            </div>
          )}

          <div className="field field--full">
            <label htmlFor="product-name">
              Nome <span className="req">*</span>
            </label>
            <input
              id="product-name"
              type="text"
              required
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              {...fieldProps("name")}
            />
            {fieldError("name")}
          </div>

          <div className="field field--full">
            <label htmlFor="product-external-code">Referência externa</label>
            <input
              id="product-external-code"
              type="text"
              placeholder="Ex.: código legado, código do cliente…"
              value={form.externalCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, externalCode: event.target.value }))
              }
            />
          </div>
        </div>
      </FormSection>

      {/*
        O item de estoque deixou de ser um cadastro à parte que o usuário
        precisava criar antes e escolher aqui. Na criação ele é gerado
        junto; na edição, é mostrado como fato — trocar o item de um
        produto que já tem lote e histórico não é operação de formulário.
      */}
      <FormSection
        title="Produto acabado / estoque"
        subtitle="Como este produto é identificado e controlado no estoque."
      >
        {mode === "create" ? (
          <>
            <div className="field-grid-2">
              <div className="field">
                <label htmlFor="product-finished-unit">
                  Unidade de estoque <span className="req">*</span>
                </label>
                <select
                  id="product-finished-unit"
                  value={form.finishedUnitCode}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, finishedUnitCode: event.target.value }))
                  }
                  {...fieldProps("finishedUnitCode")}
                >
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code} — {unit.label}
                    </option>
                  ))}
                </select>
                {fieldError("finishedUnitCode")}
              </div>
            </div>
            <p className="field__hint">
              O item de estoque será criado automaticamente ao salvar, com
              código próprio (PA-000123). Ele já nasce controlando lote,
              controlando validade e exigindo liberação da Qualidade — esses
              três são padrão da casa e não se desligam aqui.
            </p>
            {/*
              O laudo é o único dos quatro controles que varia de produto
              para produto, e por isso é o único que a tela pergunta.
              Perguntar os outros três daria a impressão de que dá para
              produzir um acabado sem lote, o que não é verdade.
            */}
            <div className="toggle-row">
              <ToggleCard
                id="product-requires-coa"
                checked={form.finishedRequiresCoa}
                onChange={(checked) =>
                  setForm((prev) => ({ ...prev, finishedRequiresCoa: checked }))
                }
                label="Exige CoA / Laudo"
                description="Lotes deste produto só são liberados com o laudo aprovado pela Qualidade."
              />
            </div>
          </>
        ) : product?.finishedProductItem ? (
          <dl className="definition-list">
            <dt>Item de produto acabado</dt>
            <dd>
              <span className="is-code">{product.finishedProductItem.code}</span>{" "}
              {product.finishedProductItem.name}
            </dd>
            {/*
              Fato, não campo: mudar o controle de um item que já tem lote
              e histórico é operação do cadastro de Itens, com as travas
              dele. Aqui só se responde "como o estoque deste produto é
              controlado?" — pergunta que antes obrigava a sair da tela.
            */}
            <dt>Controles de estoque</dt>
            <dd>
              {[
                product.finishedProductItem.controlsLot ? "controla lote" : null,
                product.finishedProductItem.controlsExpiry ? "controla validade" : null,
                product.finishedProductItem.requiresQualityRelease
                  ? "exige liberação da Qualidade"
                  : null,
                product.finishedProductItem.requiresCoa ? "exige CoA / laudo" : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Sem controles — lote e validade não são acompanhados."}
            </dd>
            <dt>Estoque</dt>
            <dd>
              <Link to={`/estoque/${product.finishedProductItem.id}`}>Ver estoque e lotes</Link>
            </dd>
          </dl>
        ) : (
          <p className="field__hint">
            Este produto não tem item de produto acabado vinculado. Produtos
            importados do legado podem estar nessa situação.
          </p>
        )}
      </FormSection>

      {/* Perfil industrial (capacidade 33): cadastro puro — nada aqui
          bloqueia OP, muda validade de lote ou entra em custo. */}
      <FormSection
        title="Perfil do produto"
        subtitle="Forma e apresentação comercial usadas pela operação private label."
      >
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="product-dosage-form">Forma farmacêutica</label>
            <select
              id="product-dosage-form"
              value={form.dosageForm}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, dosageForm: event.target.value }))
              }
            >
              <option value="">Não informada</option>
              {DOSAGE_FORMS.map((option) => (
                <option key={option} value={option}>
                  {DOSAGE_FORM_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="product-presentation">Apresentação</label>
            <select
              id="product-presentation"
              value={form.presentationType}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, presentationType: event.target.value }))
              }
            >
              <option value="">Não informada</option>
              {PRESENTATION_TYPES.map((option) => (
                <option key={option} value={option}>
                  {PRESENTATION_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Dose e apresentação"
        subtitle="A unidade da dose pode ser diferente da unidade de estoque do produto acabado."
      >
        <div className="field-grid-2">
          <div className="field field--narrow">
            <label htmlFor="product-capsules-per-dose">Cápsulas por dose</label>
            <input
              id="product-capsules-per-dose"
              type="text"
              inputMode="numeric"
              value={form.capsulesPerDose}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, capsulesPerDose: event.target.value }))
              }
              {...fieldProps("capsulesPerDose")}
            />
            {fieldError("capsulesPerDose")}
          </div>

          <div className="field field--narrow">
            <label htmlFor="product-dose-amount">Dose</label>
            <input
              id="product-dose-amount"
              type="text"
              inputMode="decimal"
              placeholder="Ex.: 500"
              value={form.doseAmount}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, doseAmount: event.target.value }))
              }
              {...fieldProps("doseAmount")}
            />
            {fieldError("doseAmount")}
          </div>

          <div className="field field--narrow">
            <label htmlFor="product-dose-uom">Unidade da dose</label>
            <select
              id="product-dose-uom"
              value={form.doseUomCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, doseUomCode: event.target.value }))
              }
            >
              <option value="">Não informada</option>
              {units.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unit.code} — {unit.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field field--narrow">
            <label htmlFor="product-doses-per-package">Doses por embalagem</label>
            <input
              id="product-doses-per-package"
              type="text"
              inputMode="numeric"
              value={form.dosesPerPackage}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, dosesPerPackage: event.target.value }))
              }
              {...fieldProps("dosesPerPackage")}
            />
            {fieldError("dosesPerPackage")}
          </div>

          <div className="field field--narrow">
            <label htmlFor="product-units-per-box">Unidades por caixa</label>
            <input
              id="product-units-per-box"
              type="text"
              inputMode="numeric"
              value={form.unitsPerShippingBox}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, unitsPerShippingBox: event.target.value }))
              }
              {...fieldProps("unitsPerShippingBox")}
            />
            {fieldError("unitsPerShippingBox")}
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Industrial"
        subtitle="Referências de fabricação — ainda sem efeito automático em OP ou validade de lote."
      >
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="product-target-age">Público-alvo</label>
            <select
              id="product-target-age"
              value={form.targetAgeGroup}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, targetAgeGroup: event.target.value }))
              }
            >
              <option value="">Não informado</option>
              {TARGET_AGE_GROUPS.map((option) => (
                <option key={option} value={option}>
                  {TARGET_AGE_GROUP_LABELS[option]}
                </option>
              ))}
            </select>
            {/* Descritivo: nenhuma regra regulatória depende disto agora. */}
            <p className="field__hint">Informativo — sem validação regulatória nesta fase.</p>
          </div>

          <div className="field field--narrow">
            <label htmlFor="product-shelf-life">Vida útil (meses)</label>
            <input
              id="product-shelf-life"
              type="text"
              inputMode="numeric"
              value={form.shelfLifeMonths}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, shelfLifeMonths: event.target.value }))
              }
              {...fieldProps("shelfLifeMonths")}
            />
            {fieldError("shelfLifeMonths")}
          </div>

          <div className="field field--narrow">
            <label htmlFor="product-minimum-batch">Lote mínimo</label>
            <input
              id="product-minimum-batch"
              type="text"
              inputMode="decimal"
              value={form.minimumBatchQuantity}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, minimumBatchQuantity: event.target.value }))
              }
              {...fieldProps("minimumBatchQuantity")}
            />
            {/* Na unidade do item de produto acabado — sem UOM duplicada. */}
            <p className="field__hint">Na unidade do item de produto acabado.</p>
            {fieldError("minimumBatchQuantity")}
          </div>
        </div>
      </FormSection>

      <FormSection title="Observações">
        <div className="field">
          <label htmlFor="product-notes">Notas internas</label>
          <textarea
            id="product-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </FormSection>

      {/* Estrutura de custos é documento versionado: aqui só o resumo e
          o caminho para a página própria. */}
      {mode === "edit" && product && <ProductIndustrialCostSummary productId={product.id} />}

      {mode === "edit" && product && (
        <AttachmentsSection
          context="products"
          contextId={product.id}
          title="Documentos"
          subtitle="Arte de rótulo e ficha técnica são referência — não travam nenhuma operação."
          types={PRODUCT_ATTACHMENT_TYPES}
        />
      )}

      {mode === "edit" && product && (
        <FormSection title="Status">
          <div className="status-line">
            <span className={product.active ? "badge badge--active" : "badge badge--inactive"}>
              {product.active ? "Ativo" : "Inativo"}
            </span>
            <span className="field__hint">
              Use "Inativar"/"Reativar" na lista para alterar o status.
            </span>
          </div>
        </FormSection>
      )}
    </form>
  );
}
