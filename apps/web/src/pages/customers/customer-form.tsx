import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  CnpjRegistrationField,
  CnpjRegistrationValueSource,
  CreateCustomerInput,
  CustomerDTO,
  CustomerTaxProfile,
  PaymentInstrument,
  QuotePaymentMethod,
} from "@veridi/shared";
import {
  BR_STATE_CODES,
  CNPJ_ESTABLISHMENT_TYPES,
  CNPJ_ESTABLISHMENT_TYPE_LABELS,
  CNPJ_REGISTRATION_FIELDS,
  CNPJ_REGISTRATION_TEXT_MAX_LENGTHS,
  CUSTOMER_EDIT_ROLES,
  CUSTOMER_STATUS_CHANGE_ROLES,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TAX_PROFILES,
  CUSTOMER_TAX_PROFILE_LABELS,
  DEFAULT_CUSTOMER_TAX_PROFILE,
  Decimal,
  LIMITES_INTEIROS_DAS_CONDICOES,
  PARCELADO_SEM_PARCELAS_MESSAGE,
  PAYMENT_INSTRUMENTS,
  PAYMENT_INSTRUMENT_LABELS,
  QUOTE_PAYMENT_METHOD_LABELS,
  USER_ROLE_LABELS,
  ehDiaCivil,
  formatBrPhone,
  formatCnpj,
  isValidBrPhone,
  isValidCnpj,
  isValidEmail,
  maskCnaeInput,
  maskCnpjInput,
  maskPhoneInput,
  maskZipCodeInput,
  formatZipCode,
  normalizeCnaeCode,
  normalizeCnpj,
  normalizeZipCode,
} from "@veridi/shared";
import { RelatedLinks } from "../../components/RelatedLinks";
import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { useCallback } from "react";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { assinaturaDoFormulario } from "../../lib/dirty-fields";
import { ApiValidationError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";
import { formatDateTime } from "../../lib/dates";
import { isCompleteZipCode, lookupCep } from "../../lib/cep-api";
import { erroDoDecimal } from "../../lib/decimal-field";
import { erroDeInteiro, lerInteiroOpcional } from "../../lib/integer-input";
import { parsePtBrNumber, toPtBrEditText } from "../../lib/numeric-ptbr";
import { CASAS_PERCENTUAL, OPCOES_PERCENTUAL } from "../../lib/numeric-scales";
import {
  condicaoPadraoPorExtenso,
  formaDePagamentoPorExtenso,
} from "../../lib/payment-condition";
import { IntegerField, PercentField } from "../../components/NumericField";
import { customerStatusBadgeClass } from "./customer-status-badge";
import { CnpjLookupDialog } from "./CnpjLookupDialog";
import { CnpjRegistrationHistoryDialog } from "./CnpjRegistrationHistoryDialog";
import {
  CAMPOS_DA_CONSULTA_DE_CNPJ,
  DADOS_DO_CNPJ_VAZIOS,
  DEFINICOES_DOS_DADOS_DO_CNPJ,
  dadosDoCnpjDoFormulario,
  dadosDoCnpjNoFormulario,
  simNaoOuNaoInformado,
} from "./cnpj-lookup-fields";
import type {
  AplicacaoDaConsultaDeCnpj,
  ValoresDoFormulario,
  ValoresDosDadosDoCnpj,
} from "./cnpj-lookup-fields";

/** "Comercial e Administrador" — lido da mesma lista que a API aplica. */
const PERFIS_QUE_MUDAM_A_SITUACAO = CUSTOMER_STATUS_CHANGE_ROLES.map(
  (role) => USER_ROLE_LABELS[role],
).join(" e ");

/** Quem altera o cadastro — a lista do cadastro, que não é a da situação. */
const PERFIS_QUE_EDITAM_O_CADASTRO = CUSTOMER_EDIT_ROLES.map(
  (role) => USER_ROLE_LABELS[role],
).join(" e ");

/**
 * O formulário de Cliente, uma vez só.
 *
 * Existe porque o cadastro passou a ter duas portas: o modal, aberto de
 * dentro de outra tela, e a página `/cadastros/clientes/novo`, que tem URL
 * própria e por isso sobrevive a refresh e a link direto. Duas
 * implementações dos mesmos campos divergiriam — e aqui a divergência seria
 * cara: validação de CNPJ, máscara de telefone e a regra de sobrescrita do
 * preenchimento por CEP são detalhe fino demais para viver em dois lugares.
 *
 * A divisão é a que o HTML já permitia: `useCustomerForm` guarda estado,
 * payload e submit; `CustomerFormFields` desenha os campos dentro do
 * `<form>`; e quem hospeda monta o próprio rodapé. O botão de commit não
 * precisa estar dentro do `<form>` — `type="submit" form="customer-form"`
 * aciona um formulário em que o botão não está aninhado. Por isso o rodapé
 * precisa de UMA coisa daqui: `saving`.
 */

/** O `<form>` que o botão de commit aciona pelo atributo `form`. */
export const CUSTOMER_FORM_ID = "customer-form";

/**
 * Os campos do Cliente que são NÚMERO — só os do pagamento padrão. CNPJ, CEP e
 * telefone são texto com máscara. Número se compara em forma canônica: `30`
 * redigitado como `030`, ou `7,5` como `7,50`, não é alteração pendente.
 */
const DECIMAIS: readonly string[] = [
  "defaultDownPaymentPercent",
  "defaultInstallmentCount",
  "defaultInstallmentIntervalDays",
  "defaultMonthlyInterestPercent",
];

/**
 * O formulário inteiro, em texto. Os dez dados cadastrais do CNPJ (§119, §122)
 * são campos como os outros: editáveis, e comparados pela mesma assinatura.
 */
interface FormState extends ValoresDosDadosDoCnpj {
  legalName: string;
  tradeName: string;
  cnpj: string;
  email: string;
  phone: string;
  taxProfile: CustomerTaxProfile;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  notes: string;
  /** Pagamento padrão: `""` é "Não informada". */
  defaultPaymentInstrument: PaymentInstrument | "";
  defaultPaymentMethod: QuotePaymentMethod | "";
  defaultDownPaymentPercent: string;
  defaultInstallmentCount: string;
  defaultInstallmentIntervalDays: string;
  defaultMonthlyInterestPercent: string;
}

/** A consulta de CNPJ aplicada nesta edição: vira a "Última consulta CNPJ" no Salvar. */
interface ConsultaAplicada {
  consultedAt: string;
  /** CNPJ consultado, normalizado. */
  cnpj: string;
}

/**
 * Os dados cadastrais limpos pela troca do CNPJ (§122): de que número eram, e
 * o que devolver se o número voltar — enquanto ninguém mexeu nos campos.
 */
interface TrocaDeCnpj {
  de: string;
  valores: ValoresDosDadosDoCnpj;
  origens: OrigemDosDadosDoCnpj;
  consulta: ConsultaAplicada | null;
  restauravel: boolean;
}

/** De onde veio o valor de cada dado cadastral mexido nesta edição. */
type OrigemDosDadosDoCnpj = Partial<Record<CnpjRegistrationField, CnpjRegistrationValueSource>>;

/** Só os dados cadastrais do formulário. */
function dadosDoCnpjDoForm(form: FormState): ValoresDosDadosDoCnpj {
  return Object.fromEntries(CNPJ_REGISTRATION_FIELDS.map((campo) => [campo, form[campo]])) as ValoresDosDadosDoCnpj;
}

/** Percentual da API ("30.0000") no texto que o `PercentField` edita ("30"). */
function percentualNoCampo(valor: string | null | undefined): string {
  return valor ? toPtBrEditText(new Decimal(valor).toString(), OPCOES_PERCENTUAL) : "";
}

/**
 * Os quatro campos do parcelamento, com os rótulos e os limites das condições
 * do Orçamento — os mesmos componentes, a mesma leitura, a mesma recusa.
 */
const PARCELAMENTO_PADRAO = {
  defaultDownPaymentPercent: { rotulo: "Entrada (%)", tipo: "percentual" },
  defaultInstallmentCount: { rotulo: "Parcelas", tipo: "inteiro" },
  defaultInstallmentIntervalDays: { rotulo: "Intervalo (dias)", tipo: "inteiro" },
  defaultMonthlyInterestPercent: { rotulo: "Juros ao mês (%)", tipo: "percentual" },
} as const;

type CampoDoParcelamentoPadrao = keyof typeof PARCELAMENTO_PADRAO;

const LIMITE_DO_INTEIRO = {
  defaultInstallmentCount: LIMITES_INTEIROS_DAS_CONDICOES.installmentCount,
  defaultInstallmentIntervalDays: LIMITES_INTEIROS_DAS_CONDICOES.installmentIntervalDays,
} as const;

/**
 * O que a tela recusa no pagamento padrão, campo a campo — o mesmo que a API
 * recusaria. Só vale no parcelado: à vista ou não informada, o parcelamento não
 * aparece nem vai ao servidor.
 */
function errosDoPagamentoPadrao(form: FormState): Record<string, string> {
  const erros: Record<string, string> = {};
  if (form.defaultPaymentMethod !== "INSTALLMENTS") return erros;
  for (const campo of Object.keys(PARCELAMENTO_PADRAO) as CampoDoParcelamentoPadrao[]) {
    const { rotulo, tipo } = PARCELAMENTO_PADRAO[campo];
    const erro =
      tipo === "percentual"
        ? erroDoDecimal(rotulo, form[campo], OPCOES_PERCENTUAL)
        : erroDeInteiro(rotulo, form[campo], LIMITE_DO_INTEIRO[campo as keyof typeof LIMITE_DO_INTEIRO]);
    if (erro) erros[campo] = erro;
  }
  if (!erros["defaultInstallmentCount"] && lerInteiroOpcional(form.defaultInstallmentCount).tipo === "vazio") {
    erros["defaultInstallmentCount"] = PARCELADO_SEM_PARCELAS_MESSAGE;
  }
  return erros;
}

/**
 * O pagamento padrão no corpo do pedido.
 *
 * Na edição vai sempre inteiro — é assim que "Não informada" limpa. Na criação
 * só vai o que foi escolhido. À vista ou não informada, o parcelamento vai
 * `null` (o servidor limparia de qualquer forma): texto escondido não grava.
 */
function pagamentoPadraoDoCorpo(
  form: FormState,
  mode: "create" | "edit",
): Pick<
  CreateCustomerInput,
  | "defaultPaymentInstrument"
  | "defaultPaymentMethod"
  | "defaultDownPaymentPercent"
  | "defaultInstallmentCount"
  | "defaultInstallmentIntervalDays"
  | "defaultMonthlyInterestPercent"
> {
  const parcelado = form.defaultPaymentMethod === "INSTALLMENTS";
  const percentual = (texto: string) => {
    const leitura = parsePtBrNumber(texto, OPCOES_PERCENTUAL);
    return parcelado && leitura.tipo === "valido" ? leitura.valor : null;
  };
  const inteiro = (texto: string) => {
    const leitura = lerInteiroOpcional(texto);
    return parcelado && leitura.tipo === "valido" ? leitura.valor : null;
  };
  const corpo = {
    defaultPaymentInstrument: form.defaultPaymentInstrument || null,
    defaultPaymentMethod: form.defaultPaymentMethod || null,
    defaultDownPaymentPercent: percentual(form.defaultDownPaymentPercent),
    defaultInstallmentCount: inteiro(form.defaultInstallmentCount),
    defaultInstallmentIntervalDays: inteiro(form.defaultInstallmentIntervalDays),
    defaultMonthlyInterestPercent: percentual(form.defaultMonthlyInterestPercent),
  };
  if (mode === "edit") return corpo;
  return Object.fromEntries(Object.entries(corpo).filter(([, valor]) => valor !== null));
}

/**
 * O bloco de endereço — os seis campos que pertencem a UM CEP.
 *
 * Número e complemento entram na lista mesmo sem a consulta os conhecer, e é
 * justamente por isso: um número digitado para o CEP anterior não é prova de
 * nada no CEP novo. Deixá-lo na tela produz o endereço híbrido — a rua e a
 * cidade de um CEP com o número de outro —, que é pior que o campo vazio,
 * porque parece preenchido e vai impresso assim.
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

function initialState(customer: CustomerDTO | null): FormState {
  if (customer) {
    return {
      legalName: customer.legalName,
      tradeName: customer.tradeName ?? "",
      cnpj: customer.cnpj ?? "",
      email: customer.email ?? "",
      // Guardados crus; exibidos com máscara.
      phone: formatBrPhone(customer.phone) ?? "",
      taxProfile: customer.taxProfile,
      zipCode: formatZipCode(customer.zipCode) ?? "",
      street: customer.street ?? "",
      number: customer.number ?? "",
      complement: customer.complement ?? "",
      district: customer.district ?? "",
      city: customer.city ?? "",
      state: customer.state ?? "",
      notes: customer.notes ?? "",
      defaultPaymentInstrument: customer.defaultPaymentInstrument ?? "",
      defaultPaymentMethod: customer.defaultPaymentMethod ?? "",
      defaultDownPaymentPercent: percentualNoCampo(customer.defaultDownPaymentPercent),
      defaultInstallmentCount: customer.defaultInstallmentCount
        ? String(customer.defaultInstallmentCount)
        : "",
      defaultInstallmentIntervalDays: customer.defaultInstallmentIntervalDays
        ? String(customer.defaultInstallmentIntervalDays)
        : "",
      defaultMonthlyInterestPercent: percentualNoCampo(customer.defaultMonthlyInterestPercent),
      ...dadosDoCnpjNoFormulario(customer.cnpjRegistration),
    };
  }
  return {
    ...DADOS_DO_CNPJ_VAZIOS,
    legalName: "",
    tradeName: "",
    cnpj: "",
    email: "",
    phone: "",
    taxProfile: DEFAULT_CUSTOMER_TAX_PROFILE,
    zipCode: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    notes: "",
    defaultPaymentInstrument: "",
    defaultPaymentMethod: "",
    defaultDownPaymentPercent: "",
    defaultInstallmentCount: "",
    defaultInstallmentIntervalDays: "",
    defaultMonthlyInterestPercent: "",
  };
}

/**
 * Validação de tela. A regra continua valendo no servidor — isto aqui existe
 * para o operador ver o erro ao lado do campo, não para ser a autoridade.
 */
function validateField(field: keyof FormState, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (field === "email" && !isValidEmail(trimmed)) return "E-mail inválido.";
  if (field === "phone" && !isValidBrPhone(trimmed)) {
    return "Informe um telefone com DDD.";
  }
  if (field === "cnpj" && !isValidCnpj(trimmed)) return "CNPJ inválido.";
  if (field === "zipCode" && !isCompleteZipCode(trimmed)) {
    return "CEP deve ter 8 dígitos.";
  }
  if (field === "mainCnaeCode" && normalizeCnaeCode(trimmed).length !== 7) {
    return "CNAE deve ter 7 dígitos.";
  }
  if ((field === "openedAt" || field === "registrationStatusDate") && !ehDiaCivil(trimmed)) {
    return "Data inválida.";
  }
  return null;
}

const VALIDATED_FIELDS: (keyof FormState)[] = [
  "email",
  "phone",
  "cnpj",
  "zipCode",
  "mainCnaeCode",
  "openedAt",
  "registrationStatusDate",
];

export function useCustomerForm({
  mode,
  customer,
  onSaved,
  readOnly = false,
}: {
  mode: "create" | "edit";
  customer: CustomerDTO | null;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: CustomerDTO) => void;
  /**
   * Consulta: o perfil não edita o cadastro (CUSTOMER-EDIT-PERMISSIONS-01).
   * Os campos viram valores e nada é enviado — a API recusaria com 403.
   */
  readOnly?: boolean;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [cepStatus, setCepStatus] = useState<CepStatus>("idle");

  /*
   * Dados cadastrais do CNPJ (§119, §122). Os valores moram no `form`; aqui
   * fica o que o `form` não diz:
   *
   * - de onde veio cada valor mexido nesta edição (Manual ou OpenCNPJ), para o
   *   histórico registrar a origem POR CAMPO no Salvar;
   * - a consulta aplicada, cuja data vira a "Última consulta CNPJ" no Salvar —
   *   mesmo quando nada mudou;
   * - o CNPJ dono dos valores e, depois de uma troca de CNPJ, o que foi limpo.
   */
  const cnpjSalvo = mode === "edit" && customer?.cnpj ? normalizeCnpj(customer.cnpj) : null;
  const [origemDosDadosDoCnpj, setOrigemDosDadosDoCnpj] = useState<OrigemDosDadosDoCnpj>({});
  const [consultaAplicada, setConsultaAplicada] = useState<ConsultaAplicada | null>(null);
  const [trocaDeCnpj, setTrocaDeCnpj] = useState<TrocaDeCnpj | null>(null);
  /** O CNPJ a que os dados cadastrais na tela pertencem; `null` antes de haver um. */
  const cnpjDosDados = useRef<string | null>(cnpjSalvo);

  const cnpjNaTela = form.cnpj.trim() ? normalizeCnpj(form.cnpj) : null;
  /** A última consulta que vale para o CNPJ da tela: a aplicada agora, ou a gravada. */
  const ultimaConsultaDoCnpj =
    consultaAplicada && consultaAplicada.cnpj === cnpjNaTela
      ? consultaAplicada.consultedAt
      : cnpjNaTela !== null && cnpjNaTela === cnpjSalvo
        ? (customer?.cnpjRegistration?.lastConsultedAt ?? null)
        : null;

  /**
   * O cadastro como ele está na tela, em forma comparável.
   *
   * Os campos que a pessoa edita — os dados cadastrais do CNPJ inclusive — e a
   * consulta aplicada: aplicar uma consulta, ainda que sem diferença, muda a
   * data dela, e sair sem salvar perderia isso. A SITUAÇÃO COMERCIAL fica de
   * fora porque não é campo: ela é derivada do histórico do cliente pelo
   * servidor, muda sozinha, e contá-la faria a tela se declarar alterada sem
   * ninguém ter tocado em nada. O código também não está aqui — nasce no servidor.
   */
  const assinaturaAtual = `${assinaturaDoFormulario(form, DECIMAIS)}|${consultaAplicada?.consultedAt ?? ""}`;

  /*
   * A referência da comparação: o formulário como ele abriu. Criar parte dos
   * defaults canônicos, editar parte do registro carregado — e ABRIR não é
   * alterar em nenhum dos dois.
   */
  const baseline = useRef(assinaturaAtual);

  const { confirmarDescarte, liberarGuarda } = useUnsavedChangesGuard({
    isDirty: baseline.current !== assinaturaAtual,
    substantivo: "cliente",
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
   * Duas identidades de CEP, e só duas.
   *
   * `typedZip` é o CEP que está no campo AGORA. `addressZip` é o CEP a que o
   * bloco de endereço na tela pertence — `""` quando ele não pertence a CEP
   * nenhum, que é o endereço digitado à mão. Enquanto os dois são iguais, o
   * endereço é do CEP que está na tela; quando divergem, ele deixou de ser
   * confiável e some ANTES de qualquer consulta. Esperar a rede para parar de
   * mostrar o endereço de um CEP debaixo de outro é exibir informação errada
   * pelo tempo que o ViaCEP levar para responder — e ele pode não responder.
   *
   * Comparação por dígitos: `18270-000` e `18270000` são o mesmo CEP, e trocar
   * a máscara não é trocar de endereço.
   *
   * `ref`, não estado: nenhum dos dois se desenha, e a resposta da consulta
   * precisa ler o valor do instante em que ela VOLTA, não o da renderização em
   * que ela partiu — ler o valor antigo é exatamente a corrida.
   */
  const initialZip = normalizeZipCode(customer?.zipCode ?? "");
  const typedZip = useRef(initialZip);
  const addressZip = useRef(initialZip);

  function setField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Erro some assim que o operador começa a corrigir.
    if (clientErrors[field]) {
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function handleBlur(field: keyof FormState) {
    // O pagamento padrão se valida com o formulário inteiro: parcelas só
    // são exigidas no parcelado.
    const message = validateField(field, form[field]) ?? errosDoPagamentoPadrao(form)[field] ?? null;
    setClientErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  /**
   * O CEP mudou no campo. Aplica a máscara e, se o endereço na tela deixou de
   * pertencer ao que está sendo digitado, apaga o bloco inteiro — aqui, sem
   * rede no meio.
   */
  function setZipCode(raw: string) {
    const masked = maskZipCodeInput(raw);
    setField("zipCode", masked);

    const digits = normalizeZipCode(masked);
    if (digits === typedZip.current) return;
    typedZip.current = digits;
    setCepStatus("idle");

    /*
     * Endereço sem CEP dono é cadastro manual: um CEP digitado depois não o
     * invalida, ele apenas completa o que estiver vazio. E endereço que ainda
     * pertence ao CEP digitado continua sendo dele — trocar `18270-000` por
     * `18270000` não é trocar de endereço.
     */
    if (addressZip.current === "" || digits === addressZip.current) return;

    addressZip.current = "";
    setForm((prev) => {
      const next = { ...prev };
      for (const field of CEP_OWNED_FIELDS) next[field] = "";
      return next;
    });
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

    /**
     * A guarda da corrida, antes de QUALQUER escrita — inclusive a do recado
     * de erro. Entre o pedido e a resposta o operador pode ter digitado outro
     * CEP, e resposta que não é do CEP atual não preenche campo nem fala na
     * tela. Vale nos dois sentidos: a resposta atrasada de A não invade B, e a
     * resposta rápida de A não repovoa o endereço enquanto B é esperado.
     *
     * A identidade é o próprio CEP consultado, não a ordem de chegada: duas
     * respostas fora de ordem para o mesmo CEP dizem a mesma coisa, e a única
     * pergunta que importa é se esta resposta ainda é sobre o que está na tela.
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
    setClientErrors((prev) => {
      const next = { ...prev };
      delete next["zipCode"];
      return next;
    });
  }

  /**
   * O CNPJ está pronto para consultar? — CUSTOMER-CNPJ-LOOKUP-01.
   *
   * A consulta externa só parte de um CNPJ que o PRÓPRIO cadastro aceitaria:
   * reusa `isValidCnpj` (a mesma do submit e do servidor), nunca um segundo
   * algoritmo. Número ausente ou inconsistente termina na mensagem do campo,
   * como qualquer outra recusa da tela — e nada sai da máquina.
   */
  function validarCnpjParaConsulta(): boolean {
    const digitado = form.cnpj.trim();
    const mensagem =
      digitado === ""
        ? "Informe o CNPJ para consultar."
        : isValidCnpj(digitado)
          ? null
          : "CNPJ inválido.";

    setClientErrors((prev) => {
      const next = { ...prev };
      if (mensagem) next["cnpj"] = mensagem;
      else delete next["cnpj"];
      return next;
    });
    return mensagem === null;
  }

  /** O que foi substituído não carrega o erro do valor anterior. */
  function limparErros(campos: readonly string[]) {
    if (campos.length === 0) return;
    const limpar = (anterior: Record<string, string>) => {
      const next = { ...anterior };
      for (const campo of campos) delete next[campo];
      return next;
    };
    setClientErrors(limpar);
    setFieldErrors(limpar);
  }

  /**
   * O CNPJ mudou no campo — §122, troca de CNPJ.
   *
   * Os dados cadastrais pertencem a UM CNPJ. Troca REAL — um CNPJ completo e
   * válido diferente do dono dos dados, ou o campo apagado — os limpa na hora,
   * e a seção diz por quê; o "Salvar" leva a limpeza, que o histórico registra
   * como "CNPJ alterado". Número pela metade ainda não é outro CNPJ: apagar e
   * redigitar um dígito não limpa nada. Voltar ao número anterior, sem ninguém
   * ter mexido nos campos, devolve o que era dele.
   */
  function setCnpj(raw: string) {
    const masked = maskCnpjInput(raw);
    setField("cnpj", masked);

    const novo = masked.trim() ? normalizeCnpj(masked) : null;
    if (novo !== null && !isValidCnpj(novo)) return;
    const dono = cnpjDosDados.current;
    if (novo === dono) return;
    cnpjDosDados.current = novo;
    // O primeiro número adota o que já estiver digitado: não havia dono a trocar.
    if (dono === null) return;

    if (trocaDeCnpj?.restauravel && novo === trocaDeCnpj.de) {
      const devolver = trocaDeCnpj;
      setForm((prev) => ({ ...prev, ...devolver.valores }));
      setOrigemDosDadosDoCnpj(devolver.origens);
      setConsultaAplicada(devolver.consulta);
      setTrocaDeCnpj(null);
      return;
    }

    const valores = dadosDoCnpjDoForm(form);
    const temDados =
      CNPJ_REGISTRATION_FIELDS.some((campo) => valores[campo].trim() !== "") || consultaAplicada !== null;
    // Sem nada a limpar, a troca anterior (se houve) continua sendo a que conta.
    if (!temDados) return;

    setTrocaDeCnpj({
      de: dono,
      valores,
      origens: origemDosDadosDoCnpj,
      consulta: consultaAplicada,
      restauravel: true,
    });
    setForm((prev) => ({ ...prev, ...DADOS_DO_CNPJ_VAZIOS }));
    setOrigemDosDadosDoCnpj({});
    setConsultaAplicada(null);
    limparErros(CNPJ_REGISTRATION_FIELDS);
  }

  /** Edição à mão de um dado cadastral: a origem do valor passa a ser Manual (§122). */
  function setDadoDoCnpj(campo: CnpjRegistrationField, valor: string) {
    setField(campo, campo === "mainCnaeCode" ? maskCnaeInput(valor) : valor);
    setOrigemDosDadosDoCnpj((prev) => ({ ...prev, [campo]: "MANUAL" }));
    if (trocaDeCnpj?.restauravel) setTrocaDeCnpj({ ...trocaDeCnpj, restauravel: false });
  }

  /**
   * Aplica ao formulário SÓ o que a pessoa marcou no diálogo — e registra a
   * consulta, mesmo sem nada marcado.
   *
   * Não grava nada: escreve no estado da tela, e o cadastro continua exigindo
   * "Salvar". O que não foi marcado fica exatamente como estava — inclusive o
   * que a fonte trouxe e a pessoa recusou, e todo valor que ela não mandou
   * substituir.
   *
   * A consulta entra mesmo sem diferença nenhuma (§122): ela confirma que os
   * dados foram conferidos naquela data, e é essa data que vira a "Última
   * consulta CNPJ" no Salvar. Os dados cadastrais aplicados ganham a origem
   * OpenCNPJ; editar um deles depois, antes de salvar, a torna Manual.
   *
   * O endereço aplicado passa a ser MANUAL (`addressZip` vazio), e é o certo:
   * ele não veio de uma consulta de CEP, e pode ser uma mistura deliberada —
   * o CEP da fonte com a rua que já estava na tela, por exemplo. Marcá-lo como
   * "endereço deste CEP" faria a próxima consulta de CEP se calar sobre um
   * bloco que ela não respondeu. Como manual, o CEP digitado depois apenas
   * COMPLETA o que estiver vazio, e nada do que foi aplicado é sobrescrito.
   */
  function aplicarConsultaDeCnpj({ valores, dadosDoCnpj, consultedAt, cnpj }: AplicacaoDaConsultaDeCnpj) {
    const consultado = normalizeCnpj(cnpj);
    const camposDoCnpj = Object.keys(dadosDoCnpj) as CnpjRegistrationField[];
    const campos = Object.keys(valores) as (keyof ValoresDoFormulario)[];

    setForm((prev) => ({ ...prev, ...valores, ...dadosDoCnpj }));
    setOrigemDosDadosDoCnpj((prev) => ({
      ...prev,
      ...Object.fromEntries(camposDoCnpj.map((campo) => [campo, "OPEN_CNPJ"])),
    }));
    setConsultaAplicada({ consultedAt, cnpj: consultado });
    cnpjDosDados.current = consultado;
    if (trocaDeCnpj?.restauravel) setTrocaDeCnpj({ ...trocaDeCnpj, restauravel: false });
    limparErros([...campos, ...camposDoCnpj]);

    if (valores.zipCode !== undefined) typedZip.current = normalizeZipCode(valores.zipCode);
    if (campos.some((campo) => campo === "zipCode" || CEP_OWNED_FIELDS.includes(campo as AddressField))) {
      addressZip.current = "";
      setCepStatus("idle");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || readOnly) return;

    const nextClientErrors: Record<string, string> = errosDoPagamentoPadrao(form);
    for (const field of VALIDATED_FIELDS) {
      const message = validateField(field, form[field]);
      if (message) nextClientErrors[field] = message;
    }
    // Dado cadastral do CNPJ sem CNPJ não tem a quem pertencer (§119).
    const temDadoDoCnpj = CNPJ_REGISTRATION_FIELDS.some((campo) => form[campo].trim() !== "");
    if (temDadoDoCnpj && cnpjNaTela === null && !nextClientErrors["cnpj"]) {
      nextClientErrors["cnpj"] = "Informe o CNPJ para registrar os dados cadastrais do CNPJ.";
    }
    if (Object.keys(nextClientErrors).length > 0) {
      setClientErrors(nextClientErrors);
      setError("Corrija os campos destacados.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    setClientErrors({});

    // No edit sempre envia as chaves opcionais (mesmo vazias) para permitir
    // limpar um valor existente; no create so envia quando preenchido.
    const optionalField = (value: string) =>
      mode === "edit" || value.trim() ? { value: value.trim() } : null;

    const tradeName = optionalField(form.tradeName);
    // CNPJ e telefone viajam normalizados: a máscara é só da tela.
    const cnpj = optionalField(form.cnpj.trim() ? normalizeCnpj(form.cnpj) : "");
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

    /*
     * Perfil tributário (§83) só viaja quando muda o que já vale: no edit, o
     * gravado; no create, o default do servidor. Não é texto — não existe
     * "vazio" para limpar, e "Não informado" é um valor como os outros.
     */
    const taxProfileInForce = customer?.taxProfile ?? DEFAULT_CUSTOMER_TAX_PROFILE;
    const taxProfileChanged = form.taxProfile !== taxProfileInForce;

    /*
     * Dados cadastrais do CNPJ (§122) viajam inteiros quando algum mudou em
     * relação ao gravado, ou quando uma consulta foi aplicada — aí a data dela
     * vira a "Última consulta CNPJ", mesmo sem mudança de valor. `sources` diz a
     * origem de cada campo alterado: OpenCNPJ o que veio da consulta e não foi
     * mexido depois; Manual todo o resto. Sem nada disso a chave nem vai: outra
     * pessoa pode ter gravado esses dados com esta tela aberta.
     */
    const valoresDoCnpj = dadosDoCnpjDoFormulario(form);
    const salvosDoCnpj = dadosDoCnpjDoFormulario(
      dadosDoCnpjNoFormulario(mode === "edit" ? customer?.cnpjRegistration : null),
    );
    const alteradosDoCnpj = CNPJ_REGISTRATION_FIELDS.filter(
      (campo) => valoresDoCnpj[campo] !== salvosDoCnpj[campo],
    );
    const consultaDoCnpjDaTela =
      consultaAplicada && consultaAplicada.cnpj === cnpjNaTela ? consultaAplicada : null;
    const dadosDoCnpjDoCorpo =
      cnpjNaTela !== null && (alteradosDoCnpj.length > 0 || consultaDoCnpjDaTela !== null)
        ? {
            cnpjRegistration: {
              cnpj: cnpjNaTela,
              ...valoresDoCnpj,
              ...(consultaDoCnpjDaTela ? { consultedAt: consultaDoCnpjDaTela.consultedAt } : {}),
              sources: Object.fromEntries(
                alteradosDoCnpj.map((campo) => [
                  campo,
                  consultaDoCnpjDaTela ? (origemDosDadosDoCnpj[campo] ?? "MANUAL") : "MANUAL",
                ]),
              ),
            },
          }
        : {};

    const payload = {
      legalName: form.legalName.trim(),
      ...(tradeName ? { tradeName: tradeName.value } : {}),
      ...(cnpj ? { cnpj: cnpj.value } : {}),
      ...(email ? { email: email.value } : {}),
      ...(phone ? { phone: phone.value } : {}),
      ...(taxProfileChanged ? { taxProfile: form.taxProfile } : {}),
      ...dadosDoCnpjDoCorpo,
      ...(zipCode ? { zipCode: zipCode.value } : {}),
      ...(street ? { street: street.value } : {}),
      ...(number ? { number: number.value } : {}),
      ...(complement ? { complement: complement.value } : {}),
      ...(district ? { district: district.value } : {}),
      ...(city ? { city: city.value } : {}),
      ...(state ? { state: state.value } : {}),
      ...(notes ? { notes: notes.value } : {}),
      ...pagamentoPadraoDoCorpo(form, mode),
    };

    try {
      if (mode === "create") {
        const created = await createCustomer(payload);
        concluir(() => onSaved(created));
      } else if (customer) {
        await updateCustomer(customer.id, payload);
        concluir(() => onSaved());
      } else {
        concluir(() => onSaved());
      }
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          // Os dados cadastrais do CNPJ são campos do próprio formulário.
          nextFieldErrors[issue.path.replace(/^cnpjRegistration\./, "")] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao salvar cliente");
      }
    } finally {
      setSaving(false);
    }
  }

  /** Erro da tela tem precedência: é o mais recente que o operador viu. */
  const errorFor = (field: string): string | undefined =>
    clientErrors[field] ?? fieldErrors[field];

  return {
    form,
    confirmarSaida,
    liberarGuarda,
    setField,
    saving,
    error,
    fieldErrors,
    cepStatus,
    setZipCode,
    handleBlur,
    handleZipLookup,
    handleSubmit,
    validarCnpjParaConsulta,
    aplicarConsultaDeCnpj,
    setCnpj,
    setDadoDoCnpj,
    /** O CNPJ cujos dados cadastrais a troca limpou — o aviso da seção. */
    cnpjDosDadosLimpos: trocaDeCnpj?.de ?? null,
    ultimaConsultaDoCnpj,
    consultaDoCnpjPendente: consultaAplicada !== null,
    errorFor,
    mode,
    customer,
    readOnly,
  };
}

export type CustomerFormController = ReturnType<typeof useCustomerForm>;

/**
 * Os quatro atalhos continuam levando ao módulo, como sempre levaram: "quero
 * ir trabalhar em Pedidos deste cliente". A Visão do Cliente é a alternativa,
 * não a substituta — "quero acompanhar o cliente como contexto".
 */
function AtalhosDoCliente({ customer }: { customer: CustomerDTO }) {
  return (
    <RelatedLinks
      links={[
        {
          label: "Visão do Cliente",
          to: `/consultas/clientes/${customer.id}/resumo`,
          highlight: true,
        },
        { label: "Projetos", to: `/comercial/projetos?customerId=${customer.id}` },
        { label: "Pedidos", to: `/comercial/pedidos?customerId=${customer.id}` },
        { label: "Faturamentos", to: `/comercial/faturamento?customerId=${customer.id}` },
        {
          label: "Materiais do cliente",
          to: `/estoque/materiais-de-clientes?customerId=${customer.id}`,
        },
      ]}
    />
  );
}

/**
 * A situação CADASTRAL (§95), a mesma da coluna da lista — um cliente
 * bloqueado não aparece aqui como "Ativo". A frase vale para qualquer perfil:
 * diz onde a situação muda e quem pode mudá-la.
 */
function SituacaoDoCadastro({ customer }: { customer: CustomerDTO }) {
  return (
    <FormSection title="Situação cadastral">
      <div className="status-line">
        <span className={customerStatusBadgeClass(customer.status)}>
          {CUSTOMER_STATUS_LABELS[customer.status]}
        </span>
        <span className="field__hint">
          Bloquear, desbloquear, inativar e reativar ficam no menu “⋯” da linha, na lista
          de Clientes — sempre com motivo, e só para os perfis {PERFIS_QUE_MUDAM_A_SITUACAO}.
        </span>
      </div>
      {customer.status === "BLOCKED" && customer.block && (
        <p className="field__hint">Motivo do bloqueio: {customer.block.reason}</p>
      )}
    </FormSection>
  );
}

/**
 * Só depois de existir registro: em "Novo cliente" não há o que mostrar, e um
 * bloco de metadados vazio só ocupa a tela.
 */
function InformacoesDoCadastro({ customer }: { customer: CustomerDTO }) {
  return (
    <FormSection
      title="Informações do cadastro"
      subtitle="Quem registrou e quando. Preenchido a partir do usuário autenticado."
    >
      <dl className="definition-list">
        <dt>Cadastrado em</dt>
        <dd>{formatDateTime(customer.createdAt)}</dd>
        <dt>Por</dt>
        <dd>{customer.createdByName ?? "Não disponível"}</dd>
        <dt>Última alteração</dt>
        <dd>{formatDateTime(customer.updatedAt)}</dd>
        <dt>Por</dt>
        <dd>{customer.updatedByName ?? "Não disponível"}</dd>
      </dl>
      {!customer.createdByName && (
        <p className="field__hint">
          Cliente cadastrado antes do registro de autoria, ou importado do sistema
          anterior. O autor não foi atribuído a ninguém.
        </p>
      )}
    </FormSection>
  );
}

/** A frase da seção de pagamento padrão, igual no formulário e na consulta. */
const PAGAMENTO_PADRAO_SUBTITULO =
  "Sugestão para novos orçamentos deste cliente. Alterar aqui não muda orçamentos já criados.";

/** Um campo em consulta: o mesmo rótulo do formulário e o valor, sem caixa de edição. */
function ValorConsultado({
  rotulo,
  valor,
  multilinha = false,
}: {
  rotulo: string;
  valor: string | null;
  multilinha?: boolean;
}) {
  const texto = valor?.trim() ? valor : "—";
  return (
    <>
      <dt>{rotulo}</dt>
      <dd {...(multilinha ? { className: "is-multiline" } : {})}>{texto}</dd>
    </>
  );
}

/** O título e a frase da seção dos dados cadastrais do CNPJ (§119, §122). */
const DADOS_DO_CNPJ_TITULO = "Dados cadastrais do CNPJ";
const DADOS_DO_CNPJ_SUBTITULO =
  "Preencha à mão ou com “Consultar CNPJ”: a consulta completa o que estiver vazio e só troca o que você escolher. Não definem o perfil tributário.";

/**
 * O rodapé da seção: a "Última consulta CNPJ", que é do SISTEMA — texto, não
 * campo —, e a ação discreta "Ver histórico".
 */
function RodapeDosDadosDoCnpj({
  ultimaConsulta,
  pendente = false,
  onVerHistorico,
}: {
  ultimaConsulta: string | null;
  /** Consulta aplicada ao formulário e ainda não salva. */
  pendente?: boolean;
  /** Ausente quando o cliente ainda não existe: não há histórico a ver. */
  onVerHistorico?: () => void;
}) {
  return (
    <div className="dados-do-cnpj__rodape">
      <p className="field__hint">
        {ultimaConsulta ? `Última consulta: ${formatDateTime(ultimaConsulta)}` : "Nenhuma consulta de CNPJ aplicada."}
        {pendente && " — aplicada ao formulário; só fica registrada quando você salvar."}
      </p>
      {onVerHistorico && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onVerHistorico}>
          Ver histórico
        </button>
      )}
    </div>
  );
}

/**
 * Os dados cadastrais do CNPJ em CONSULTA — os mesmos rótulos do formulário,
 * com os valores no lugar dos campos. Simples e MEI dizem Sim, Não ou Não
 * informado; `null` nunca aparece como "Não".
 */
function DadosCadastraisDoCnpjEmConsulta({ customer }: { customer: CustomerDTO }) {
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const dados = customer.cnpjRegistration ?? null;
  const exibir = (campo: CnpjRegistrationField) => {
    if (campo === "simplesOptIn" || campo === "meiOptIn") return simNaoOuNaoInformado(dados?.[campo]);
    return DEFINICOES_DOS_DADOS_DO_CNPJ[campo].exibir(dados?.[campo] ?? null) || null;
  };
  return (
    <FormSection title={DADOS_DO_CNPJ_TITULO} subtitle="Não definem o perfil tributário.">
      <dl className="definition-list">
        {CNPJ_REGISTRATION_FIELDS.map((campo) => (
          <ValorConsultado key={campo} rotulo={DEFINICOES_DOS_DADOS_DO_CNPJ[campo].rotulo} valor={exibir(campo)} />
        ))}
      </dl>
      <RodapeDosDadosDoCnpj
        ultimaConsulta={dados?.lastConsultedAt ?? null}
        onVerHistorico={() => setHistoricoAberto(true)}
      />
      {historicoAberto && (
        <CnpjRegistrationHistoryDialog customer={customer} onClose={() => setHistoricoAberto(false)} />
      )}
    </FormSection>
  );
}

/**
 * O Cliente em CONSULTA — CUSTOMER-EDIT-PERMISSIONS-01.
 *
 * Mesmas seções, mesma ordem e mesmos rótulos do formulário, com os valores
 * no lugar das caixas: quem não edita o cadastro lê tudo o que o formulário
 * mostraria, sem campo que aceite digitação e sem "Salvar alterações" que
 * terminaria em 403. Nenhuma consulta de CEP parte daqui.
 */
function CustomerConsultaFields({ customer }: { customer: CustomerDTO }) {
  return (
    <div>
      <AtalhosDoCliente customer={customer} />

      <p className="field__hint">
        Consulta. Só os perfis {PERFIS_QUE_EDITAM_O_CADASTRO} alteram o cadastro do cliente.
      </p>

      <FormSection
        title="Identificação"
        subtitle="Dados básicos do cliente usados em produtos e ordens de produção."
      >
        <dl className="definition-list">
          <ValorConsultado rotulo="Razão Social / Nome" valor={customer.legalName} />
          <ValorConsultado rotulo="Nome Fantasia" valor={customer.tradeName} />
          <ValorConsultado
            rotulo="CNPJ"
            valor={customer.cnpj ? formatCnpj(customer.cnpj) : null}
          />
          <ValorConsultado
            rotulo="Perfil tributário"
            valor={CUSTOMER_TAX_PROFILE_LABELS[customer.taxProfile]}
          />
        </dl>
      </FormSection>

      <FormSection title="Contato">
        <dl className="definition-list">
          <ValorConsultado rotulo="Email" valor={customer.email} />
          <ValorConsultado rotulo="Telefone" valor={formatBrPhone(customer.phone)} />
        </dl>
      </FormSection>

      <FormSection title="Endereço">
        <dl className="definition-list">
          <ValorConsultado rotulo="CEP" valor={formatZipCode(customer.zipCode)} />
          <ValorConsultado rotulo="Logradouro" valor={customer.street} />
          <ValorConsultado rotulo="Número" valor={customer.number} />
          <ValorConsultado rotulo="Complemento" valor={customer.complement} />
          <ValorConsultado rotulo="Bairro" valor={customer.district} />
          <ValorConsultado rotulo="Cidade" valor={customer.city} />
          <ValorConsultado rotulo="UF" valor={customer.state} />
        </dl>
      </FormSection>

      {/* Quem não edita o cadastro lê o padrão — ele aparece no rascunho de
          orçamento de quem negocia. */}
      <FormSection title="Pagamento padrão" subtitle={PAGAMENTO_PADRAO_SUBTITULO}>
        <dl className="definition-list">
          <ValorConsultado
            rotulo="Forma de pagamento padrão"
            valor={formaDePagamentoPorExtenso(customer.defaultPaymentInstrument)}
          />
          <ValorConsultado
            rotulo="Condição de pagamento padrão"
            valor={condicaoPadraoPorExtenso(customer)}
          />
        </dl>
      </FormSection>

      <DadosCadastraisDoCnpjEmConsulta customer={customer} />

      <FormSection title="Observações">
        <dl className="definition-list">
          <ValorConsultado rotulo="Notas internas" valor={customer.notes} multilinha />
        </dl>
      </FormSection>

      <SituacaoDoCadastro customer={customer} />
      <InformacoesDoCadastro customer={customer} />
    </div>
  );
}

/**
 * O recorte do formulário que a consulta de CNPJ compara.
 *
 * Deriva da lista de campos da própria consulta: campo novo lá entra aqui
 * sozinho, e não existe um segundo lugar para esquecer de atualizar.
 */
function valoresDaConsultaDeCnpj(form: FormState): ValoresDoFormulario {
  return Object.fromEntries(
    CAMPOS_DA_CONSULTA_DE_CNPJ.map((campo) => [campo, form[campo]]),
  ) as ValoresDoFormulario;
}

export function CustomerFormFields({
  form,
  setField,
  error,
  cepStatus,
  setZipCode,
  handleBlur,
  handleZipLookup,
  handleSubmit,
  errorFor,
  mode,
  customer,
  readOnly,
  validarCnpjParaConsulta,
  aplicarConsultaDeCnpj,
  setCnpj,
  setDadoDoCnpj,
  cnpjDosDadosLimpos,
  ultimaConsultaDoCnpj,
  consultaDoCnpjPendente,
}: CustomerFormController) {
  /*
   * O diálogo de "Consultar CNPJ" (CUSTOMER-CNPJ-LOOKUP-01). Aberto é o CNPJ
   * já validado que ele vai consultar — guardar o número, e não um booleano,
   * garante que a consulta é sobre o que estava na tela no clique.
   */
  const [consultaDeCnpj, setConsultaDeCnpj] = useState<string | null>(null);
  /** O histórico dos dados cadastrais do CNPJ (§122), em diálogo. */
  const [historicoAberto, setHistoricoAberto] = useState(false);

  if (readOnly && customer) return <CustomerConsultaFields customer={customer} />;

  /** Liga input, `aria-invalid` e a mensagem, para leitor de tela também. */
  function fieldProps(field: keyof FormState) {
    const message = errorFor(field);
    return {
      ...(message ? { "aria-invalid": true as const } : {}),
      ...(message ? { "aria-describedby": `customer-${field}-error` } : {}),
      onBlur: () => handleBlur(field),
    };
  }

  function fieldError(field: keyof FormState) {
    const message = errorFor(field);
    if (!message) return null;
    return (
      <p className="field__error" id={`customer-${field}-error`}>
        {message}
      </p>
    );
  }

  return (
    <>
    <form id={CUSTOMER_FORM_ID} onSubmit={handleSubmit}>
      {error && <p className="form-alert" role="alert">{error}</p>}

      {customer && <AtalhosDoCliente customer={customer} />}

      <FormSection
        title="Identificação"
        subtitle="Dados básicos do cliente usados em produtos e ordens de produção."
      >
        <div className="field-grid-2">
          <div className="field field--full">
            <label htmlFor="customer-legal-name">
              Razão Social / Nome <span className="req">*</span>
            </label>
            {/* Usa o helper do próprio arquivo: o servidor recusa razão
                social vazia (só espaços também) ou longa demais — nome
                repetido, não: a única unicidade do cadastro é o CNPJ, quando
                informado. Sem isto a recusa aparecia na tela e não era ligada
                ao campo para quem usa leitor de tela — no campo obrigatório
                do formulário que é referência dos outros. */}
            <input
              id="customer-legal-name"
              type="text"
              required
              value={form.legalName}
              onChange={(event) => setField("legalName", event.target.value)}
              {...fieldProps("legalName")}
            />
            {fieldError("legalName")}
          </div>

          <div className="field">
            <label htmlFor="customer-trade-name">Nome Fantasia</label>
            <input
              id="customer-trade-name"
              type="text"
              value={form.tradeName}
              onChange={(event) => setField("tradeName", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-cnpj">CNPJ</label>
            {/* `type="text"`: o CNPJ alfanumérico tem letras nas 12
                primeiras posições, e `type="number"` as descartaria. */}
            <input
              id="customer-cnpj"
              type="text"
              autoCapitalize="characters"
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              onChange={(event) => setCnpj(event.target.value)}
              {...fieldProps("cnpj")}
            />
            {/* Assistência de preenchimento: consultar não altera o cadastro,
                e nada é gravado antes de "Salvar". O botão não fica
                desabilitado — clicar com o campo vazio ou com número
                inconsistente responde no PRÓPRIO campo, que é onde a pessoa
                pode corrigir; botão apagado sem motivo não ensina nada. */}
            <div className="field__acao">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  if (validarCnpjParaConsulta()) setConsultaDeCnpj(form.cnpj.trim());
                }}
              >
                Consultar CNPJ
              </button>
            </div>
            {fieldError("cnpj") ?? (
              <p className="field__hint">
                Aceita o formato numérico e o alfanumérico. A consulta preenche o
                formulário com dados públicos que você escolhe — e não salva nada.
              </p>
            )}
          </div>

          {/* Perfil tributário (§83): junto da identificação fiscal, nunca
              na Precificação. `<select>` nativo, porque é enum pequeno
              (UI_BRAND §15.1) — teclado, foco e leitor de tela vêm do
              navegador. A dica diz o que o campo NÃO faz. */}
          <div className="field">
            <label htmlFor="customer-tax-profile">Perfil tributário</label>
            <select
              id="customer-tax-profile"
              value={form.taxProfile}
              onChange={(event) => setField("taxProfile", event.target.value)}
              aria-describedby="customer-tax-profile-hint"
              {...fieldProps("taxProfile")}
            >
              {CUSTOMER_TAX_PROFILES.map((profile) => (
                <option key={profile} value={profile}>
                  {CUSTOMER_TAX_PROFILE_LABELS[profile]}
                </option>
              ))}
            </select>
            {fieldError("taxProfile") ?? (
              <p className="field__hint" id="customer-tax-profile-hint">
                Classificação informada pela empresa. Não calcula impostos
                automaticamente.
              </p>
            )}
          </div>
        </div>
      </FormSection>

      <FormSection title="Contato">
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="customer-email">Email</label>
            <input
              id="customer-email"
              type="email"
              placeholder="contato@empresa.com.br"
              value={form.email}
              onChange={(event) => setField("email", event.target.value)}
              {...fieldProps("email")}
            />
            {fieldError("email")}
          </div>

          <div className="field">
            <label htmlFor="customer-phone">Telefone</label>
            <input
              id="customer-phone"
              type="text"
              inputMode="tel"
              placeholder="(11) 99999-8888"
              value={form.phone}
              onChange={(event) => setField("phone", maskPhoneInput(event.target.value))}
              {...fieldProps("phone")}
            />
            {fieldError("phone")}
          </div>
        </div>
      </FormSection>

      {/* Endereço estruturado — usado depois em OP, documentos GMP e
          expedição. O endereço pertence a UM CEP: sob o mesmo CEP a consulta
          só preenche o que está vazio e a correção manual manda; trocar o CEP
          apaga o bloco inteiro, número e complemento inclusive. */}
      <FormSection title="Endereço">
        <div className="field-grid-2">
          <div className="field field--narrow">
            <label htmlFor="customer-zip">CEP</label>
            <input
              id="customer-zip"
              type="text"
              inputMode="numeric"
              placeholder="00000-000"
              value={form.zipCode}
              onChange={(event) => setZipCode(event.target.value)}
              onBlur={() => {
                handleBlur("zipCode");
                void handleZipLookup(form.zipCode);
              }}
              {...(errorFor("zipCode") ? { "aria-invalid": true as const } : {})}
              {...(errorFor("zipCode")
                ? { "aria-describedby": "customer-zipCode-error" }
                : {})}
            />
            {fieldError("zipCode") ?? (
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
            <label htmlFor="customer-street">Logradouro</label>
            <input
              id="customer-street"
              type="text"
              value={form.street}
              onChange={(event) => setField("street", event.target.value)}
            />
          </div>

          <div className="field field--narrow">
            <label htmlFor="customer-number">Número</label>
            <input
              id="customer-number"
              type="text"
              value={form.number}
              onChange={(event) => setField("number", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-complement">Complemento</label>
            <input
              id="customer-complement"
              type="text"
              value={form.complement}
              onChange={(event) => setField("complement", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-district">Bairro</label>
            <input
              id="customer-district"
              type="text"
              value={form.district}
              onChange={(event) => setField("district", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-city">Cidade</label>
            <input
              id="customer-city"
              type="text"
              value={form.city}
              onChange={(event) => setField("city", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-state">UF</label>
            <select
              id="customer-state"
              value={form.state}
              onChange={(event) => setField("state", event.target.value)}
              {...fieldProps("state")}
            >
              <option value="">Selecione…</option>
              {BR_STATE_CODES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
            {fieldError("state")}
          </div>
        </div>
      </FormSection>

      {/* Pagamento padrão — sugestão copiada para a V1 dos orçamentos novos,
          nunca lida ao vivo. `<select>` nativo (enum pequeno, UI_BRAND §15.1);
          o parcelamento usa os mesmos campos, limites e dicas das condições do
          Orçamento, e só aparece no parcelado. */}
      <FormSection title="Pagamento padrão" subtitle={PAGAMENTO_PADRAO_SUBTITULO}>
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="customer-default-payment-instrument">Forma de pagamento padrão</label>
            <select
              id="customer-default-payment-instrument"
              value={form.defaultPaymentInstrument}
              onChange={(event) => setField("defaultPaymentInstrument", event.target.value)}
              {...fieldProps("defaultPaymentInstrument")}
            >
              <option value="">Não informada</option>
              {PAYMENT_INSTRUMENTS.map((forma) => (
                <option key={forma} value={forma}>
                  {PAYMENT_INSTRUMENT_LABELS[forma]}
                </option>
              ))}
            </select>
            {fieldError("defaultPaymentInstrument")}
          </div>

          <div className="field">
            <label htmlFor="customer-default-payment-method">Condição de pagamento padrão</label>
            <select
              id="customer-default-payment-method"
              value={form.defaultPaymentMethod}
              onChange={(event) => setField("defaultPaymentMethod", event.target.value)}
              {...fieldProps("defaultPaymentMethod")}
            >
              <option value="">Não informada</option>
              {(Object.keys(QUOTE_PAYMENT_METHOD_LABELS) as QuotePaymentMethod[]).map((metodo) => (
                <option key={metodo} value={metodo}>
                  {QUOTE_PAYMENT_METHOD_LABELS[metodo]}
                </option>
              ))}
            </select>
            {fieldError("defaultPaymentMethod")}
          </div>

          {form.defaultPaymentMethod === "INSTALLMENTS" && (
            <>
              <div className="field">
                <label htmlFor="customer-default-down-payment">Entrada (%)</label>
                <PercentField
                  id="customer-default-down-payment"
                  scale={CASAS_PERCENTUAL}
                  value={form.defaultDownPaymentPercent}
                  onChangeValue={(valor) => setField("defaultDownPaymentPercent", valor)}
                  {...fieldProps("defaultDownPaymentPercent")}
                />
                {fieldError("defaultDownPaymentPercent") ?? (
                  <p className="field__hint">Vazio = sem entrada.</p>
                )}
              </div>
              <div className="field">
                <label htmlFor="customer-default-installments">Parcelas</label>
                <IntegerField
                  id="customer-default-installments"
                  value={form.defaultInstallmentCount}
                  onChangeValue={(valor) => setField("defaultInstallmentCount", valor)}
                  {...fieldProps("defaultInstallmentCount")}
                />
                {fieldError("defaultInstallmentCount")}
              </div>
              <div className="field">
                <label htmlFor="customer-default-interval">Intervalo (dias)</label>
                <IntegerField
                  id="customer-default-interval"
                  value={form.defaultInstallmentIntervalDays}
                  onChangeValue={(valor) => setField("defaultInstallmentIntervalDays", valor)}
                  {...fieldProps("defaultInstallmentIntervalDays")}
                />
                {fieldError("defaultInstallmentIntervalDays") ?? (
                  <p className="field__hint">Vazio = 30 dias.</p>
                )}
              </div>
              <div className="field">
                <label htmlFor="customer-default-interest">Juros ao mês (%)</label>
                <PercentField
                  id="customer-default-interest"
                  scale={CASAS_PERCENTUAL}
                  value={form.defaultMonthlyInterestPercent}
                  onChangeValue={(valor) => setField("defaultMonthlyInterestPercent", valor)}
                  {...fieldProps("defaultMonthlyInterestPercent")}
                />
                {fieldError("defaultMonthlyInterestPercent") ?? (
                  <p className="field__hint">Vazio ou 0 = sem juros.</p>
                )}
              </div>
            </>
          )}
        </div>
      </FormSection>

      {/* Dados cadastrais do CNPJ (§119, §122): campos do cadastro, EDITÁVEIS,
          logo antes de Observações. A consulta de CNPJ só sugere; a "Última
          consulta" é do sistema e fica no rodapé, como texto. */}
      <FormSection title={DADOS_DO_CNPJ_TITULO} subtitle={DADOS_DO_CNPJ_SUBTITULO}>
        {cnpjDosDadosLimpos && (
          <p className="callout" role="status">
            O CNPJ mudou: os dados cadastrais do CNPJ anterior ({formatCnpj(cnpjDosDadosLimpos)}) foram
            limpos e, ao salvar, a limpeza entra no histórico. Consulte o novo CNPJ ou preencha à mão.
          </p>
        )}
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="customer-cnae-code">CNAE principal</label>
            <input
              id="customer-cnae-code"
              type="text"
              inputMode="numeric"
              placeholder="0000-0/00"
              value={form.mainCnaeCode}
              onChange={(event) => setDadoDoCnpj("mainCnaeCode", event.target.value)}
              {...fieldProps("mainCnaeCode")}
            />
            {fieldError("mainCnaeCode")}
          </div>

          <div className="field">
            <label htmlFor="customer-cnae-description">Descrição do CNAE</label>
            <input
              id="customer-cnae-description"
              type="text"
              maxLength={CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.mainCnaeDescription}
              value={form.mainCnaeDescription}
              onChange={(event) => setDadoDoCnpj("mainCnaeDescription", event.target.value)}
              {...fieldProps("mainCnaeDescription")}
            />
            {fieldError("mainCnaeDescription")}
          </div>

          <div className="field">
            <label htmlFor="customer-legal-nature">Natureza jurídica</label>
            <input
              id="customer-legal-nature"
              type="text"
              maxLength={CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.legalNature}
              value={form.legalNature}
              onChange={(event) => setDadoDoCnpj("legalNature", event.target.value)}
              {...fieldProps("legalNature")}
            />
            {fieldError("legalNature")}
          </div>

          <div className="field">
            <label htmlFor="customer-company-size">Porte</label>
            <input
              id="customer-company-size"
              type="text"
              maxLength={CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.companySize}
              value={form.companySize}
              onChange={(event) => setDadoDoCnpj("companySize", event.target.value)}
              {...fieldProps("companySize")}
            />
            {fieldError("companySize")}
          </div>

          <div className="field">
            <label htmlFor="customer-opened-at">Data de abertura</label>
            <input
              id="customer-opened-at"
              type="date"
              value={form.openedAt}
              onChange={(event) => setDadoDoCnpj("openedAt", event.target.value)}
              {...fieldProps("openedAt")}
            />
            {fieldError("openedAt")}
          </div>

          {/* `<select>` nativo com "Não informado" explícito: vazio não é
              Matriz nem Filial, e Simples/MEI vazio não é "Não". */}
          <div className="field">
            <label htmlFor="customer-establishment-type">Matriz/Filial</label>
            <select
              id="customer-establishment-type"
              value={form.establishmentType}
              onChange={(event) => setDadoDoCnpj("establishmentType", event.target.value)}
              {...fieldProps("establishmentType")}
            >
              <option value="">Não informado</option>
              {CNPJ_ESTABLISHMENT_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {CNPJ_ESTABLISHMENT_TYPE_LABELS[tipo]}
                </option>
              ))}
            </select>
            {fieldError("establishmentType")}
          </div>

          {(["simplesOptIn", "meiOptIn"] as const).map((campo) => (
            <div className="field" key={campo}>
              <label htmlFor={`customer-${campo}`}>{DEFINICOES_DOS_DADOS_DO_CNPJ[campo].rotulo}</label>
              <select
                id={`customer-${campo}`}
                value={form[campo]}
                onChange={(event) => setDadoDoCnpj(campo, event.target.value)}
                {...fieldProps(campo)}
              >
                <option value="">Não informado</option>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
              {fieldError(campo)}
            </div>
          ))}

          <div className="field">
            <label htmlFor="customer-registration-status">Situação na RFB</label>
            <input
              id="customer-registration-status"
              type="text"
              maxLength={CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.registrationStatus}
              value={form.registrationStatus}
              onChange={(event) => setDadoDoCnpj("registrationStatus", event.target.value)}
              {...fieldProps("registrationStatus")}
            />
            {fieldError("registrationStatus")}
          </div>

          <div className="field">
            <label htmlFor="customer-registration-status-date">Data da situação</label>
            <input
              id="customer-registration-status-date"
              type="date"
              value={form.registrationStatusDate}
              onChange={(event) => setDadoDoCnpj("registrationStatusDate", event.target.value)}
              {...fieldProps("registrationStatusDate")}
            />
            {fieldError("registrationStatusDate")}
          </div>
        </div>
        <RodapeDosDadosDoCnpj
          ultimaConsulta={ultimaConsultaDoCnpj}
          pendente={consultaDoCnpjPendente}
          {...(mode === "edit" && customer ? { onVerHistorico: () => setHistoricoAberto(true) } : {})}
        />
      </FormSection>

      <FormSection title="Observações">
        <div className="field">
          <label htmlFor="customer-notes">Notas internas</label>
          <textarea
            id="customer-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => setField("notes", event.target.value)}
          />
        </div>
      </FormSection>

      {mode === "edit" && customer && <SituacaoDoCadastro customer={customer} />}
      {mode === "edit" && customer && <InformacoesDoCadastro customer={customer} />}
    </form>

    {/* Abre POR CIMA do cadastro: o que foi digitado continua na tela, e a
        comparação é contra o ESTADO DO FORMULÁRIO — não contra o registro
        salvo. Quem editou a razão social e ainda não salvou compara com o
        que está vendo. */}
    {consultaDeCnpj !== null && (
      <CnpjLookupDialog
        cnpj={consultaDeCnpj}
        valoresAtuais={valoresDaConsultaDeCnpj(form)}
        dadosDoCnpjAtuais={dadosDoCnpjDoForm(form)}
        onClose={() => setConsultaDeCnpj(null)}
        onApply={(aplicacao) => {
          aplicarConsultaDeCnpj(aplicacao);
          setConsultaDeCnpj(null);
        }}
      />
    )}
    {historicoAberto && customer && (
      <CnpjRegistrationHistoryDialog customer={customer} onClose={() => setHistoricoAberto(false)} />
    )}
    </>
  );
}
