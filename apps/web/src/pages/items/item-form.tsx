import { useState } from "react";
import type { FormEvent } from "react";
import type { ItemDTO, ItemType, UnitOfMeasureDTO } from "@veridi/shared";
import {
  ITEM_TYPE_DEFAULTS,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  ITEM_FAMILIES,
  ITEM_FAMILY_LABELS,
  PACKAGING_SUBTYPES,
  PACKAGING_SUBTYPE_LABELS,
} from "@veridi/shared";
import { createItem, updateItem } from "../../lib/items-api";
import { ApiValidationError } from "../../lib/api-errors";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import { RelatedLinks } from "../../components/RelatedLinks";
import { FormSection } from "../../components/FormSection";
import { ToggleCard } from "../../components/ToggleCard";

/**
 * O formulário de Item de estoque, uma vez só.
 *
 * Existe porque o cadastro passou a ter duas portas: o modal, aberto de
 * dentro de outra tela, e a página `/cadastros/itens/novo`, que tem URL
 * própria e por isso sobrevive a refresh e a link direto. Duas
 * implementações dos mesmos campos divergiriam — e uma delas acabaria
 * oferecendo Produto acabado na criação manual, que é justamente o que este
 * cadastro não pode fazer.
 *
 * A divisão é a que o HTML já permitia: `useItemForm` guarda estado, payload
 * e submit; `ItemFormFields` desenha os campos dentro do `<form>`; e quem
 * hospeda monta o próprio rodapé. O botão de commit não precisa estar dentro
 * do `<form>` — `type="submit" form="item-form"` aciona um formulário em que
 * o botão não está aninhado. Por isso o rodapé precisa de UMA coisa daqui:
 * `saving`.
 *
 * As unidades entram por parâmetro em vez de serem carregadas aqui: a
 * listagem já as tinha em mãos para o modal, e um `fetch` dentro do
 * formulário faria a mesma chamada duas vezes na mesma tela.
 */

/** O `<form>` que o botão de commit aciona pelo atributo `form`. */
export const ITEM_FORM_ID = "item-form";

/**
 * Os tipos que a criação manual oferece.
 *
 * Produto acabado sai da lista: ele nasce junto com o Produto, que é quem tem
 * cliente, formulação e custo. Criar o item solto produzia um acabado sem
 * dono, e a dúvida "preciso cadastrar o produto acabado duas vezes?".
 *
 * Uma lista só, usada pelo seletor e por quem valida o tipo pré-escolhido:
 * duas listas divergiriam, e a divergência apareceria como um acabado criado
 * por um caminho que ninguém revisou.
 */
export const CREATABLE_ITEM_TYPES: readonly ItemType[] = ITEM_TYPES.filter(
  (type) => type !== "FINISHED_PRODUCT",
);

/**
 * O tipo pré-escolhido que chega pela URL (`?tipo=RAW_MATERIAL`).
 *
 * Conveniência para quem saiu de um campo que só aceita matéria-prima — não
 * regra: valor desconhecido, ou de um tipo que a criação manual não oferece,
 * é simplesmente ignorado e a tela se comporta como criação normal. Quem
 * decide o que é aceito continua sendo o servidor.
 */
export function parseCreatableItemType(raw: string | null | undefined): ItemType | null {
  if (!raw) return null;
  return CREATABLE_ITEM_TYPES.find((type) => type === raw) ?? null;
}

interface FormState {
  type: ItemType | "";
  name: string;
  unitCode: string;
  controlsLot: boolean;
  controlsExpiry: boolean;
  requiresQualityRelease: boolean;
  requiresCoa: boolean;
  sourceName: string;
  declaredNutrient: string;
  family: string;
  defaultPurityPercent: string;
  packagingSubtype: string;
  externalBarcode: string;
}

function initialState(item: ItemDTO | null, initialType: ItemType | null): FormState {
  if (item) {
    return {
      type: item.type,
      name: item.name,
      unitCode: item.unitCode,
      controlsLot: item.controlsLot,
      controlsExpiry: item.controlsExpiry,
      requiresQualityRelease: item.requiresQualityRelease,
      requiresCoa: item.requiresCoa,
      sourceName: item.sourceName ?? "",
      declaredNutrient: item.declaredNutrient ?? "",
      family: item.family ?? "",
      defaultPurityPercent: item.defaultPurityPercent ?? "",
      packagingSubtype: item.packagingSubtype ?? "",
      externalBarcode: item.externalBarcode ?? "",
    };
  }
  /*
   * Tipo pré-escolhido traz os mesmos defaults que trazia se tivesse sido
   * escolhido no seletor. Sem isto, chegar por `?tipo=PACKAGING` daria um
   * item com controles de matéria-prima — a URL mudaria o cadastro, não só o
   * caminho até ele.
   */
  const defaults = initialType ? ITEM_TYPE_DEFAULTS[initialType] : null;
  return {
    type: initialType ?? "",
    name: "",
    unitCode: "",
    controlsLot: defaults?.controlsLot ?? true,
    controlsExpiry: defaults?.controlsExpiry ?? true,
    requiresQualityRelease: defaults?.requiresQualityRelease ?? true,
    // Exigir laudo é decisão explícita — nunca inferida do tipo do item.
    requiresCoa: false,
    sourceName: "",
    declaredNutrient: "",
    family: "",
    defaultPurityPercent: "",
    packagingSubtype: "",
    externalBarcode: "",
  };
}

export function useItemForm({
  mode,
  item,
  units,
  initialType = null,
  onSaved,
}: {
  mode: "create" | "edit";
  item: ItemDTO | null;
  units: UnitOfMeasureDTO[];
  /** Tipo já escolhido ao abrir. Só a criação usa; a edição parte do item. */
  initialType?: ItemType | null;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: ItemDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    initialState(item, mode === "create" ? initialType : null),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const structuralLocked = mode === "edit" && (item?.operationallyUsed ?? false);
  const structuralLockHint =
    "Este campo não pode ser alterado porque o item já possui histórico operacional.";

  function handleTypeChange(nextType: ItemType) {
    setForm((prev) => {
      if (mode === "edit") return { ...prev, type: nextType };
      const defaults = ITEM_TYPE_DEFAULTS[nextType];
      return {
        ...prev,
        type: nextType,
        controlsLot: defaults.controlsLot,
        controlsExpiry: defaults.controlsExpiry,
        requiresQualityRelease: defaults.requiresQualityRelease,
      };
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.type) {
      setError("Selecione o tipo do item.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    /*
     * Pureza passa pelo parser central — mesma leitura da vírgula em toda a
     * web. Vazio continua sendo vazio (no edit é o que limpa o campo); o que
     * o parser não consegue ler para aqui, com o nome do campo.
     */
    const purezaNormalizada =
      form.defaultPurityPercent.trim() === ""
        ? ""
        : parseDecimalInput(form.defaultPurityPercent);
    if (purezaNormalizada === null) {
      setFieldErrors({ defaultPurityPercent: mensagemDecimalInvalido("Pureza padrão (%)") });
      setError("Corrija os campos destacados.");
      setSaving(false);
      return;
    }

    const trimmedBarcode = form.externalBarcode.trim();
    const payload = {
      type: form.type,
      name: form.name.trim(),
      unitCode: form.unitCode,
      controlsLot: form.controlsLot,
      controlsExpiry: form.controlsExpiry,
      requiresQualityRelease: form.requiresQualityRelease,
      requiresCoa: form.requiresCoa,
      // No edit sempre envia (mesmo vazio) para permitir limpar; no create
      // só quando preenchido. Vazio vira null — nunca um default silencioso.
      ...(mode === "edit" || form.sourceName.trim()
        ? { sourceName: form.sourceName.trim() }
        : {}),
      ...(mode === "edit" || form.declaredNutrient.trim()
        ? { declaredNutrient: form.declaredNutrient.trim() }
        : {}),
      ...(mode === "edit" || form.family ? { family: form.family } : {}),
      ...(mode === "edit" || form.defaultPurityPercent.trim()
        ? { defaultPurityPercent: purezaNormalizada }
        : {}),
      ...(mode === "edit" || form.packagingSubtype
        ? { packagingSubtype: form.type === "PACKAGING" ? form.packagingSubtype : "" }
        : {}),
      // No edit sempre envia a chave (mesmo vazia) para permitir limpar um
      // barcode existente; no create so envia quando preenchido.
      ...(mode === "edit" || trimmedBarcode
        ? { externalBarcode: trimmedBarcode }
        : {}),
    };

    try {
      if (mode === "create") {
        const created = await createItem(payload);
        onSaved(created);
      } else if (item) {
        await updateItem(item.id, payload);
        onSaved();
      } else {
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
        setError(err instanceof Error ? err.message : "Falha ao salvar item");
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
    handleTypeChange,
    handleSubmit,
    structuralLocked,
    structuralLockHint,
    mode,
    item,
    units,
  };
}

export type ItemFormController = ReturnType<typeof useItemForm>;

export function ItemFormFields({
  form,
  setForm,
  error,
  fieldErrors,
  handleTypeChange,
  handleSubmit,
  structuralLocked,
  structuralLockHint,
  mode,
  item,
  units,
}: ItemFormController) {
  return (
    <form id={ITEM_FORM_ID} onSubmit={handleSubmit}>
      {error && <p className="form-alert" role="alert">{error}</p>}

      {item && (
        <RelatedLinks
          links={[
            // Estoque do item tem tela própria: melhor destino que uma lista
            // filtrada.
            { label: "Estoque", to: `/estoque/${item.id}` },
            { label: "Lotes", to: `/estoque/lotes?itemId=${item.id}` },
            { label: "Movimentações", to: `/estoque/movimentacoes?itemId=${item.id}` },
            { label: "Fornecedores do item", to: `/compras/item-fornecedor?itemId=${item.id}` },
          ]}
        />
      )}

      <FormSection
        title="Identificação"
        subtitle="Dados básicos do item usados em compras, estoque e produção."
      >
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="item-type">
              Tipo <span className="req">*</span>
            </label>
            <select
              id="item-type"
              required
              disabled={structuralLocked}
              value={form.type}
              onChange={(event) => handleTypeChange(event.target.value as ItemType)}
            >
              <option value="" disabled>
                Selecione…
              </option>
              {/*
               * Na EDIÇÃO o tipo continua aparecendo inteiro — item já
               * existente não pode perder a própria identidade na tela.
               * Na criação vale `CREATABLE_ITEM_TYPES`, sem Produto acabado.
               */}
              {(mode === "edit" ? ITEM_TYPES : CREATABLE_ITEM_TYPES).map((value) => (
                <option key={value} value={value}>
                  {ITEM_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
            {mode === "create" && (
              <p className="field__hint">
                Produtos acabados são criados automaticamente pelo cadastro
                de Produtos.
              </p>
            )}
            {fieldErrors["type"] && (
              <p className="field__error">{fieldErrors["type"]}</p>
            )}
            {structuralLocked && <p className="field__hint">{structuralLockHint}</p>}
          </div>

          <div className="field">
            <label htmlFor="item-unit">
              Unidade <span className="req">*</span>
            </label>
            <select
              id="item-unit"
              required
              disabled={structuralLocked}
              value={form.unitCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, unitCode: event.target.value }))
              }
            >
              <option value="" disabled>
                Selecione…
              </option>
              {units.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unit.code} — {unit.label}
                </option>
              ))}
            </select>
            {fieldErrors["unitCode"] && (
              <p className="field__error">{fieldErrors["unitCode"]}</p>
            )}
            {structuralLocked && <p className="field__hint">{structuralLockHint}</p>}
          </div>

          <div className="field field--full">
            <label htmlFor="item-name">
              Nome <span className="req">*</span>
            </label>
            <input
              id="item-name"
              type="text"
              required
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
            {fieldErrors["name"] && (
              <p className="field__error">{fieldErrors["name"]}</p>
            )}
          </div>
        </div>
      </FormSection>

      {/*
        Classificação industrial (capacidade 33) — insumo das capacidades
        de formulação e custeio. Tudo opcional.

        Some no produto acabado: fonte, nutriente declarado e pureza padrão
        descrevem um item ENQUANTO COMPONENTE de uma receita — a pureza é o
        que corrige a quantidade da linha. Produto acabado nunca é
        componente de formulação nenhuma, então esses campos não teriam
        onde ser lidos. Oferecê-los convida a preencher um dado que o
        sistema inteiro ignora.
      */}
      {form.type !== "FINISHED_PRODUCT" && (
        <FormSection
          title="Classificação industrial"
          subtitle="Fonte, nutriente declarado e pureza padrão usados pela formulação."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="item-source-name">Fonte</label>
              <input
                id="item-source-name"
                type="text"
                placeholder="Ex.: Cloridrato de tiamina"
                value={form.sourceName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sourceName: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="item-declared-nutrient">Nutriente declarado</label>
              <input
                id="item-declared-nutrient"
                type="text"
                placeholder="Ex.: Vitamina B1"
                value={form.declaredNutrient}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, declaredNutrient: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="item-family">Família</label>
              <select
                id="item-family"
                value={form.family}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, family: event.target.value }))
                }
              >
                <option value="">Não informada</option>
                {ITEM_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {ITEM_FAMILY_LABELS[family]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field field--narrow">
              <label htmlFor="item-purity">Pureza padrão (%)</label>
              <input
                id="item-purity"
                type="text"
                inputMode="decimal"
                placeholder="Ex.: 98,5"
                value={form.defaultPurityPercent}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, defaultPurityPercent: event.target.value }))
                }
              />
              {/* Vazio = desconhecida. Nunca é assumida como 100%. */}
              <p className="field__hint">
                Em branco significa pureza desconhecida — nunca 100%.
              </p>
              {fieldErrors["defaultPurityPercent"] && (
                <p className="field__error">{fieldErrors["defaultPurityPercent"]}</p>
              )}
            </div>

            {form.type === "PACKAGING" && (
              <div className="field">
                <label htmlFor="item-packaging-subtype">Subtipo de embalagem</label>
                <select
                  id="item-packaging-subtype"
                  value={form.packagingSubtype}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, packagingSubtype: event.target.value }))
                  }
                >
                  <option value="">Não informado</option>
                  {PACKAGING_SUBTYPES.map((subtype) => (
                    <option key={subtype} value={subtype}>
                      {PACKAGING_SUBTYPE_LABELS[subtype]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </FormSection>
      )}

      <FormSection
        title="Controles de rastreabilidade"
        subtitle={
          structuralLocked
            ? `Lote e validade: ${structuralLockHint.charAt(0).toLowerCase()}${structuralLockHint.slice(1)}`
            : "Definem como o estoque deste item será acompanhado."
        }
      >
        <div className="toggle-row">
          <ToggleCard
            id="item-controls-lot"
            checked={form.controlsLot}
            disabled={structuralLocked}
            onChange={(checked) =>
              setForm((prev) => ({ ...prev, controlsLot: checked }))
            }
            label="Controla lote"
            description="Cada recebimento gera lote interno com QR Code próprio."
          />
          <ToggleCard
            id="item-controls-expiry"
            checked={form.controlsExpiry}
            disabled={structuralLocked}
            onChange={(checked) =>
              setForm((prev) => ({ ...prev, controlsExpiry: checked }))
            }
            label="Controla validade"
            description="Habilita FEFO: o sistema sugere primeiro o lote que vence antes."
          />
          <ToggleCard
            id="item-requires-quality-release"
            checked={form.requiresQualityRelease}
            onChange={(checked) =>
              setForm((prev) => ({ ...prev, requiresQualityRelease: checked }))
            }
            label="Requer liberação da Qualidade"
            description="Novos lotes recebidos ficam indisponíveis até serem liberados."
          />
          <ToggleCard
            id="item-requires-coa"
            checked={form.requiresCoa}
            onChange={(checked) => setForm((prev) => ({ ...prev, requiresCoa: checked }))}
            label="Exige CoA / Laudo"
            description="Lotes deste item só são liberados com o laudo aprovado pela Qualidade."
          />
        </div>
      </FormSection>

      <FormSection
        title="Códigos"
        subtitle="Identificadores externos para leitura no recebimento."
      >
        <div className="field">
          <label htmlFor="item-barcode">Barcode externo</label>
          <input
            id="item-barcode"
            type="text"
            placeholder="Ex.: 7891234567890"
            value={form.externalBarcode}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, externalBarcode: event.target.value }))
            }
          />
          <p className="field__hint">Código de barras do fornecedor. Opcional.</p>
        </div>
      </FormSection>

      {mode === "edit" && item && (
        <FormSection title="Status">
          <div className="status-line">
            <span className={item.active ? "badge badge--active" : "badge badge--inactive"}>
              {item.active ? "Ativo" : "Inativo"}
            </span>
            <span className="field__hint">
              Use "Inativar"/"Reativar" na lista para alterar o status. Itens
              inativos continuam visíveis no histórico.
            </span>
          </div>
        </FormSection>
      )}
    </form>
  );
}
