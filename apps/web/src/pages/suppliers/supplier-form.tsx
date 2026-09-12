import { useState } from "react";
import type { FormEvent } from "react";
import type { SupplierDTO } from "@veridi/shared";
import {
  BR_STATE_CODES,
  formatBrPhone,
  formatZipCode,
  maskPhoneInput,
  maskZipCodeInput,
  normalizeZipCode,
} from "@veridi/shared";
import { RelatedLinks } from "../../components/RelatedLinks";
import { createSupplier, updateSupplier } from "../../lib/suppliers-api";
import { useCallback, useRef } from "react";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { assinaturaDoFormulario } from "../../lib/dirty-fields";
import { ApiValidationError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";
import { isCompleteZipCode, lookupCep } from "../../lib/cep-api";

/**
 * O formulário de Fornecedor, uma vez só.
 *
 * Existe porque o cadastro passou a ter duas portas: o modal, aberto de
 * dentro de outra tela, e a página `/cadastros/fornecedores/novo`, que tem
 * URL própria e por isso sobrevive a refresh e a link direto. Duas
 * implementações dos mesmos campos divergiriam — uma ganharia uma validação
 * que a outra não tem, e a diferença só apareceria meses depois, num
 * registro que entrou por onde não devia.
 *
 * A divisão é a que o HTML já permitia: `useSupplierForm` guarda estado,
 * payload e submit; `SupplierFormFields` desenha os campos dentro do
 * `<form>`; e quem hospeda monta o próprio rodapé. O botão de commit não
 * precisa estar dentro do `<form>` — `type="submit" form="supplier-form"`
 * aciona um formulário em que o botão não está aninhado. Por isso o rodapé
 * precisa de UMA coisa daqui: `saving`.
 */

/** O `<form>` que o botão de commit aciona pelo atributo `form`. */
export const SUPPLIER_FORM_ID = "supplier-form";

/** Nenhum campo do Fornecedor é número: CNPJ, CEP e telefone são texto com máscara. */
const DECIMAIS: readonly string[] = [];

interface FormState {
  legalName: string;
  tradeName: string;
  cnpj: string;
  email: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  notes: string;
}

/**
 * O bloco de endereço — os seis campos que pertencem a UM CEP.
 *
 * Número e complemento entram na lista mesmo sem a consulta os conhecer, e é
 * justamente por isso: um número digitado para o CEP anterior não é prova de
 * nada no CEP novo. Deixá-lo na tela produz o endereço híbrido — a rua e a
 * cidade de um CEP com o número de outro —, que é pior que o campo vazio,
 * porque parece preenchido.
 */
type AddressField =
  | "street"
  | "number"
  | "complement"
  | "district"
  | "city"
  | "state";

const CEP_OWNED_FIELDS: AddressField[] = [
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
];

/** O subconjunto que a consulta sabe responder. Número nunca entra. */
const CEP_ANSWERED_FIELDS = ["street", "district", "city", "state"] as const;

type CepStatus = "idle" | "loading" | "found" | "not_found" | "unavailable";

const CEP_MESSAGES: Record<Exclude<CepStatus, "idle" | "found">, string> = {
  loading: "Buscando endereço…",
  not_found: "CEP não encontrado. Preencha o endereço manualmente.",
  unavailable:
    "Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.",
};

function initialState(supplier: SupplierDTO | null): FormState {
  if (supplier) {
    return {
      legalName: supplier.legalName,
      tradeName: supplier.tradeName ?? "",
      cnpj: supplier.cnpj ?? "",
      email: supplier.email ?? "",
      phone: formatBrPhone(supplier.phone) ?? "",
      // Guardado só com dígitos; exibido com máscara.
      zipCode: formatZipCode(supplier.zipCode) ?? "",
      street: supplier.street ?? "",
      number: supplier.number ?? "",
      complement: supplier.complement ?? "",
      district: supplier.district ?? "",
      city: supplier.city ?? "",
      state: supplier.state ?? "",
      notes: supplier.notes ?? "",
    };
  }
  return {
    legalName: "",
    tradeName: "",
    cnpj: "",
    email: "",
    phone: "",
    zipCode: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    notes: "",
  };
}

export function useSupplierForm({
  mode,
  supplier,
  onSaved,
}: {
  mode: "create" | "edit";
  supplier: SupplierDTO | null;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: SupplierDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(supplier));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [zipError, setZipError] = useState<string | null>(null);
  const [cepStatus, setCepStatus] = useState<CepStatus>("idle");

  /**
   * O cadastro como ele está na tela, em forma comparável.
   *
   * Identificação, contato, ENDEREÇO e notas — tudo que a pessoa edita. A
   * assinatura percorre o `FormState` inteiro, então os sete campos de
   * endereço passaram a contar sozinhos: digitar a rua é alteração pendente
   * como digitar a razão social, e apagá-la de volta volta a ser limpo.
   */
  const assinaturaAtual = assinaturaDoFormulario(form, DECIMAIS);

  /*
   * A referência da comparação: o formulário como ele abriu. Criar parte dos
   * defaults canônicos, editar parte do registro carregado — e ABRIR não é
   * alterar em nenhum dos dois.
   */
  const baseline = useRef(assinaturaAtual);

  const { confirmarDescarte, liberarGuarda } = useUnsavedChangesGuard({
    isDirty: baseline.current !== assinaturaAtual,
    substantivo: "fornecedor",
  });

  /**
   * Cancelar, ✕ e Esc: o router não vê nada disso — a guarda vê.
   *
   * Memorizado porque vai para `onClose` do modal, e `onClose` novo a cada
   * renderização é o defeito que a Wave 01 fechou.
   */
  const confirmarSaida = useCallback(
    (acao: () => void) => confirmarDescarte(acao),
    [confirmarDescarte],
  );

  /** Gravou: o que está na tela virou registro, e sair dele não perde nada. */
  function concluir(acao: () => void) {
    baseline.current = assinaturaAtual;
    liberarGuarda(acao);
  }

  /**
   * Duas identidades de CEP, e só duas — a mesma regra do Cliente.
   *
   * `typedZip` é o CEP que está no campo AGORA. `addressZip` é o CEP a que o
   * bloco de endereço na tela pertence — `""` quando ele não pertence a CEP
   * nenhum, que é o endereço digitado à mão. Enquanto os dois são iguais, o
   * endereço é do CEP que está na tela; quando divergem, ele deixou de ser
   * confiável e some ANTES de qualquer consulta.
   *
   * `ref`, não estado: nenhum dos dois se desenha, e a resposta da consulta
   * precisa ler o valor do instante em que ela VOLTA, não o da renderização em
   * que ela partiu.
   */
  const initialZip = normalizeZipCode(supplier?.zipCode ?? "");
  const typedZip = useRef(initialZip);
  const addressZip = useRef(initialZip);

  /**
   * O CEP mudou no campo. Aplica a máscara e, se o endereço na tela deixou de
   * pertencer ao que está sendo digitado, apaga o bloco inteiro — aqui, sem
   * rede no meio.
   */
  function setZipCode(raw: string) {
    const masked = maskZipCodeInput(raw);
    setForm((prev) => ({ ...prev, zipCode: masked }));
    setZipError(null);
    if (fieldErrors["zipCode"]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next["zipCode"];
        return next;
      });
    }

    const digits = normalizeZipCode(masked);
    if (digits === typedZip.current) return;
    typedZip.current = digits;
    setCepStatus("idle");

    /*
     * Endereço sem CEP dono é cadastro manual: um CEP digitado depois não o
     * invalida, ele apenas completa o que estiver vazio. E endereço que ainda
     * pertence ao CEP digitado continua sendo dele.
     */
    if (addressZip.current === "" || digits === addressZip.current) return;

    addressZip.current = "";
    setForm((prev) => {
      const next = { ...prev };
      for (const field of CEP_OWNED_FIELDS) next[field] = "";
      return next;
    });
  }

  /** CEP incompleto é erro de tela; o servidor recusa pela mesma regra. */
  function handleZipBlur() {
    const digits = normalizeZipCode(form.zipCode);
    setZipError(
      digits.length === 0 || isCompleteZipCode(digits) ? null : "CEP deve ter 8 dígitos.",
    );
  }

  async function handleZipLookup(raw: string) {
    const digits = normalizeZipCode(raw);
    if (!isCompleteZipCode(digits)) return;
    /*
     * O endereço na tela já é DESTE CEP: não reconsulta e, sobretudo, não
     * sobrescreve a correção que o operador fez sobre ele.
     */
    if (digits === addressZip.current) return;

    setCepStatus("loading");
    const result = await lookupCep(digits);

    /*
     * A guarda da corrida, antes de QUALQUER escrita — inclusive a do recado
     * de erro. Entre o pedido e a resposta o operador pode ter digitado outro
     * CEP, e resposta que não é do CEP atual não preenche campo nem fala na
     * tela.
     */
    if (digits !== typedZip.current) return;

    if (result.status !== "found") {
      setCepStatus(result.status);
      return;
    }

    addressZip.current = digits;
    setForm((prev) => {
      const next = { ...prev };
      for (const field of CEP_ANSWERED_FIELDS) {
        // Só o vazio é preenchido: sob o mesmo CEP o que o operador digitou é
        // dele. Na TROCA de CEP não há conflito — o bloco já foi apagado.
        if (prev[field].trim() === "") next[field] = result.address[field];
      }
      return next;
    });
    setCepStatus("found");
    setZipError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const digitos = normalizeZipCode(form.zipCode);
    if (digitos.length > 0 && !isCompleteZipCode(digitos)) {
      setZipError("CEP deve ter 8 dígitos.");
      setError("Corrija os campos destacados.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    // No edit sempre envia as chaves opcionais (mesmo vazias) para permitir
    // limpar um valor existente; no create so envia quando preenchido.
    const optionalField = (value: string) =>
      mode === "edit" || value.trim() ? { value: value.trim() } : null;

    const tradeName = optionalField(form.tradeName);
    const cnpj = optionalField(form.cnpj);
    const email = optionalField(form.email);
    const phone = optionalField(form.phone);
    const zipCode = optionalField(form.zipCode);
    const street = optionalField(form.street);
    const number = optionalField(form.number);
    const complement = optionalField(form.complement);
    const district = optionalField(form.district);
    const city = optionalField(form.city);
    const state = optionalField(form.state);
    const notes = optionalField(form.notes);

    const payload = {
      legalName: form.legalName.trim(),
      ...(tradeName ? { tradeName: tradeName.value } : {}),
      ...(cnpj ? { cnpj: cnpj.value } : {}),
      ...(email ? { email: email.value } : {}),
      ...(phone ? { phone: phone.value } : {}),
      ...(zipCode ? { zipCode: zipCode.value } : {}),
      ...(street ? { street: street.value } : {}),
      ...(number ? { number: number.value } : {}),
      ...(complement ? { complement: complement.value } : {}),
      ...(district ? { district: district.value } : {}),
      ...(city ? { city: city.value } : {}),
      ...(state ? { state: state.value } : {}),
      ...(notes ? { notes: notes.value } : {}),
    };

    try {
      if (mode === "create") {
        const created = await createSupplier(payload);
        concluir(() => onSaved(created));
      } else if (supplier) {
        await updateSupplier(supplier.id, payload);
        concluir(() => onSaved());
      } else {
        concluir(() => onSaved());
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
        setError(err instanceof Error ? err.message : "Falha ao salvar fornecedor");
      }
    } finally {
      setSaving(false);
    }
  }

  /** Erro da tela tem precedência: é o mais recente que o operador viu. */
  const zipMessage = zipError ?? fieldErrors["zipCode"];

  return {
    form,
    setForm,
    saving,
    error,
    fieldErrors,
    cepStatus,
    zipMessage,
    setZipCode,
    handleZipBlur,
    handleZipLookup,
    handleSubmit,
    mode,
    supplier,
    confirmarSaida,
    liberarGuarda,
  };
}

export type SupplierFormController = ReturnType<typeof useSupplierForm>;

export function SupplierFormFields({
  form,
  setForm,
  error,
  fieldErrors,
  cepStatus,
  zipMessage,
  setZipCode,
  handleZipBlur,
  handleZipLookup,
  handleSubmit,
  mode,
  supplier,
}: SupplierFormController) {
  return (
    <form id={SUPPLIER_FORM_ID} onSubmit={handleSubmit}>
      {error && <p className="form-alert" role="alert">{error}</p>}

      {supplier && (
        <RelatedLinks
          links={[
            { label: "Ordens de compra", to: `/compras/ordens?supplierId=${supplier.id}` },
            {
              label: "Itens homologados",
              to: `/compras/item-fornecedor?supplierId=${supplier.id}`,
            },
          ]}
        />
      )}

      <FormSection
        title="Identificação"
        subtitle="Dados básicos do fornecedor usados em compras e recebimento."
      >
        <div className="field-grid-2">
          <div className="field field--full">
            <label htmlFor="supplier-legal-name">
              Razão Social / Nome <span className="req">*</span>
            </label>
            <input
              id="supplier-legal-name"
              type="text"
              required
              value={form.legalName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, legalName: event.target.value }))
              }
            />
            {fieldErrors["legalName"] && (
              <p className="field__error">{fieldErrors["legalName"]}</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="supplier-trade-name">Nome Fantasia</label>
            <input
              id="supplier-trade-name"
              type="text"
              value={form.tradeName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, tradeName: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label htmlFor="supplier-cnpj">CNPJ</label>
            <input
              id="supplier-cnpj"
              type="text"
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              onChange={(event) => setForm((prev) => ({ ...prev, cnpj: event.target.value }))}
            />
            {fieldErrors["cnpj"] && <p className="field__error">{fieldErrors["cnpj"]}</p>}
          </div>
        </div>
      </FormSection>

      <FormSection title="Contato" subtitle="Usados para tratativas de compra e recebimento.">
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="supplier-email">Email</label>
            <input
              id="supplier-email"
              type="email"
              placeholder="contato@empresa.com.br"
              value={form.email}
              aria-invalid={fieldErrors["email"] ? true : undefined}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            {/* Sem isto, a recusa da API viraria "Corrija os campos
                destacados" sem nenhum campo destacado. */}
            {fieldErrors["email"] && <p className="field__error">{fieldErrors["email"]}</p>}
          </div>

          <div className="field">
            <label htmlFor="supplier-phone">Telefone</label>
            <input
              id="supplier-phone"
              type="text"
              inputMode="tel"
              placeholder="(11) 99999-8888"
              value={form.phone}
              aria-invalid={fieldErrors["phone"] ? true : undefined}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, phone: maskPhoneInput(event.target.value) }))
              }
            />
            {fieldErrors["phone"] && <p className="field__error">{fieldErrors["phone"]}</p>}
          </div>
        </div>
      </FormSection>

      {/* Endereço estruturado — MESMO modelo e MESMO layout do Cliente.
          Opcional do começo ao fim: o fornecedor existe sem endereço e nada
          em Compras depende dele. O endereço pertence a UM CEP: sob o mesmo
          CEP a consulta só preenche o que está vazio e a correção manual
          manda; trocar o CEP apaga o bloco inteiro, número e complemento
          inclusive. */}
      <FormSection
        title="Endereço"
        subtitle="Opcional. O fornecedor é válido sem endereço — preencha quando souber."
      >
        <div className="field-grid-2">
          <div className="field field--narrow">
            <label htmlFor="supplier-zip">CEP</label>
            <input
              id="supplier-zip"
              type="text"
              inputMode="numeric"
              placeholder="00000-000"
              value={form.zipCode}
              onChange={(event) => setZipCode(event.target.value)}
              onBlur={() => {
                handleZipBlur();
                void handleZipLookup(form.zipCode);
              }}
              {...(zipMessage ? { "aria-invalid": true as const } : {})}
              {...(zipMessage ? { "aria-describedby": "supplier-zipCode-error" } : {})}
            />
            {zipMessage ? (
              <p className="field__error" id="supplier-zipCode-error">
                {zipMessage}
              </p>
            ) : (
              /* Os campos ficarem em branco de uma vez assusta quem não sabe
                 por quê. Dizer antes é mais barato que explicar depois. */
              <p className="field__hint">
                Trocar o CEP limpa o endereço anterior antes da nova consulta.
              </p>
            )}
            {cepStatus !== "idle" && cepStatus !== "found" && (
              <p
                className={
                  cepStatus === "loading" ? "field__hint" : "field__hint field__hint--error"
                }
                role="status"
              >
                {CEP_MESSAGES[cepStatus]}
              </p>
            )}
          </div>

          <div className="field field--full">
            <label htmlFor="supplier-street">Logradouro</label>
            <input
              id="supplier-street"
              type="text"
              value={form.street}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, street: event.target.value }))
              }
            />
          </div>

          <div className="field field--narrow">
            <label htmlFor="supplier-number">Número</label>
            <input
              id="supplier-number"
              type="text"
              value={form.number}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, number: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label htmlFor="supplier-complement">Complemento</label>
            <input
              id="supplier-complement"
              type="text"
              value={form.complement}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, complement: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label htmlFor="supplier-district">Bairro</label>
            <input
              id="supplier-district"
              type="text"
              value={form.district}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, district: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label htmlFor="supplier-city">Cidade</label>
            <input
              id="supplier-city"
              type="text"
              value={form.city}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, city: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label htmlFor="supplier-state">UF</label>
            <select
              id="supplier-state"
              value={form.state}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, state: event.target.value }))
              }
              aria-invalid={fieldErrors["state"] ? true : undefined}
            >
              <option value="">Selecione…</option>
              {BR_STATE_CODES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
            {fieldErrors["state"] && <p className="field__error">{fieldErrors["state"]}</p>}
          </div>
        </div>
      </FormSection>

      <FormSection title="Observações">
        <div className="field">
          <label htmlFor="supplier-notes">Notas internas</label>
          <textarea
            id="supplier-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </FormSection>

      {mode === "edit" && supplier && (
        <FormSection title="Status">
          <div className="status-line">
            <span className={supplier.active ? "badge badge--active" : "badge badge--inactive"}>
              {supplier.active ? "Ativo" : "Inativo"}
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
