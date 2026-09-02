import { useEffect, useMemo, useState } from "react";
import { RelatedLinks } from "../../components/RelatedLinks";
import { Link } from "react-router-dom";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { CustomerFormModal } from "../customers/CustomerFormModal";
import type { FormEvent } from "react";
import type {
  DosageForm,
  PresentationType,
  ProductDTO,
  TargetAgeGroup,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { createProduct, updateProduct } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { AttachmentsSection } from "../../components/AttachmentsSection";
import { ProductIndustrialCostSummary } from "./ProductIndustrialCostSummary";
import { FormSection } from "../../components/FormSection";
import { ToggleCard } from "../../components/ToggleCard";
import {
  DOSAGE_FORMS,
  DOSAGE_FORM_LABELS,
  PRESENTATION_TYPES,
  PRESENTATION_TYPE_LABELS,
  TARGET_AGE_GROUPS,
  TARGET_AGE_GROUP_LABELS,
  PRODUCT_ATTACHMENT_TYPES,
} from "@veridi/shared";
import { listUnits } from "../../lib/units-api";
import { formatDate } from "../../lib/dates";

interface ProductFormModalProps {
  mode: "create" | "edit";
  product: ProductDTO | null;
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: ProductDTO) => void;
}

interface CustomerOption {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  /** Entra na busca do campo: quem não lembra o nome lembra o CNPJ. */
  cnpj?: string | null;
  active: boolean;
}

interface FormState {
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
}

/** Número opcional vira texto do formulário; vazio continua vazio. */
function numberField(value: number | string | null): string {
  return value === null || value === undefined ? "" : String(value);
}

function initialState(product: ProductDTO | null): FormState {
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

/** Modal fullscreen de criacao/edicao de produto — mesmo padrao de Items. */
export function ProductFormModal({ mode, product, onClose, onSaved }: ProductFormModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  /** Cadastro de cliente aberto a partir do campo de busca. */
  const [newCustomerName, setNewCustomerName] = useState<string | null>(null);

  useEffect(() => {
    // A dose pode ser em mg/g/ml — unidades vêm do cadastro existente.
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  const [activeCustomers, setActiveCustomers] = useState<CustomerOption[]>([]);

  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) => setActiveCustomers(result.customers))
      .catch(() => setActiveCustomers([]));
  }, []);

  // Vinculo historico: se o cliente/item associado nao estiver mais na lista
  // de ativos (foi inativado depois), ele continua aparecendo no select.
  const customerOptions: CustomerOption[] = useMemo(() => {
    if (!product?.customer || activeCustomers.some((c) => c.id === product.customer?.id)) {
      return activeCustomers;
    }
    return [...activeCustomers, { ...product.customer, active: false }];
  }, [activeCustomers, product]);



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

    // Campo numérico: no edit sempre envia (vazio limpa), no create só
    // quando preenchido. Vírgula decimal do usuário vira ponto.
    const numeric = (value: string) => {
      const trimmed = value.trim().replace(",", ".");
      if (mode === "edit") return { value: trimmed };
      return trimmed ? { value: trimmed } : null;
    };
    const enumField = (value: string) =>
      mode === "edit" || value ? { value } : null;

    const dosageForm = enumField(form.dosageForm);
    const presentationType = enumField(form.presentationType);
    const targetAgeGroup = enumField(form.targetAgeGroup);
    const doseUomCode = enumField(form.doseUomCode);
    const capsulesPerDose = numeric(form.capsulesPerDose);
    const doseAmount = numeric(form.doseAmount);
    const dosesPerPackage = numeric(form.dosesPerPackage);
    const unitsPerShippingBox = numeric(form.unitsPerShippingBox);
    const shelfLifeMonths = numeric(form.shelfLifeMonths);
    const minimumBatchQuantity = numeric(form.minimumBatchQuantity);

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

  const codeChip =
    mode === "create" ? "Código gerado automaticamente ao salvar" : product?.code;

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
          <button type="submit" form="product-form" className="btn btn--accent" disabled={saving}>
            {saving ? "Criando…" : "Criar produto"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração:{" "}
          {product ? formatDate(product.updatedAt) : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="product-form" className="btn btn--accent" disabled={saving}>
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
      <form id="product-form" onSubmit={handleSubmit}>
        {error && <p className="form-alert">{error}</p>}

      {newCustomerName !== null && (
        <CustomerFormModal
          mode="create"
          customer={null}
          onClose={() => setNewCustomerName(null)}
          onSaved={(created) => {
            setNewCustomerName(null);
            if (!created) return;
            // Volta selecionado, e o resto do formulário do produto continua
            // como estava: quem cadastrou o cliente queria ESTE cliente e não
            // quer redigitar o que já preencheu.
            setActiveCustomers((prev) => [
              created,
              ...prev.filter((row) => row.id !== created.id),
            ]);
            setForm((prev) => ({ ...prev, customerId: created.id }));
          }}
        />
      )}

        {product && (
          <RelatedLinks
            links={[
              { label: "Formulação", to: `/producao/formulacoes/${product.id}` },
              { label: "Custos", to: `/produtos/${product.id}/custos` },
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
                canCreate
                createLabel="Novo cliente"
                onCreateNew={(typed) => setNewCustomerName(typed)}
              />
              {fieldErrors["customerId"] && (
                <p className="field__error">{fieldErrors["customerId"]}</p>
              )}
            </div>

            <div className="field field--full">
              <label htmlFor="product-name">
                Nome <span className="req">*</span>
              </label>
              <input
                id="product-name"
                type="text"
                required
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
              {fieldErrors["name"] && <p className="field__error">{fieldErrors["name"]}</p>}
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
                  >
                    {units.map((unit) => (
                      <option key={unit.code} value={unit.code}>
                        {unit.code} — {unit.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors["finishedUnitCode"] && (
                    <p className="field__error">{fieldErrors["finishedUnitCode"]}</p>
                  )}
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
                <Link to={`/estoque/${product.finishedProductItem.id}`}>
                  Ver estoque e lotes
                </Link>
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
              />
              {fieldErrors["capsulesPerDose"] && (
                <p className="field__error">{fieldErrors["capsulesPerDose"]}</p>
              )}
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
              />
              {fieldErrors["doseAmount"] && (
                <p className="field__error">{fieldErrors["doseAmount"]}</p>
              )}
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
              />
              {fieldErrors["dosesPerPackage"] && (
                <p className="field__error">{fieldErrors["dosesPerPackage"]}</p>
              )}
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
              />
              {fieldErrors["unitsPerShippingBox"] && (
                <p className="field__error">{fieldErrors["unitsPerShippingBox"]}</p>
              )}
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
              />
              {fieldErrors["shelfLifeMonths"] && (
                <p className="field__error">{fieldErrors["shelfLifeMonths"]}</p>
              )}
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
              />
              {/* Na unidade do item de produto acabado — sem UOM duplicada. */}
              <p className="field__hint">Na unidade do item de produto acabado.</p>
              {fieldErrors["minimumBatchQuantity"] && (
                <p className="field__error">{fieldErrors["minimumBatchQuantity"]}</p>
              )}
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
              onChange={(event) =>
                setForm((prev) => ({ ...prev, notes: event.target.value }))
              }
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
    </FullWorkspaceModal>
  );
}
