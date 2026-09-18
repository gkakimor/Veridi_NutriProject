import type {
  CnpjEstablishmentType,
  CnpjLookupCompany,
  CnpjRegistrationField,
  CnpjRegistrationValue,
  CnpjRegistrationValues,
  CustomerCnpjRegistration,
} from "@veridi/shared";
import {
  BR_STATE_CODES,
  CNPJ_ESTABLISHMENT_TYPES,
  CNPJ_ESTABLISHMENT_TYPE_LABELS,
  CNPJ_REGISTRATION_FIELDS,
  CUSTOMER_FIELD_MAX_LENGTHS,
  formatBrPhone,
  formatCnaeCode,
  isValidBrPhone,
  isValidEmail,
  maskCnaeInput,
  maskZipCodeInput,
  normalizeCnaeCode,
  normalizePhone,
  normalizeZipCode,
} from "@veridi/shared";
import { formatDate } from "../../lib/dates";

/**
 * A comparação Atual × Retornado da consulta de CNPJ — §111 e §122
 * (CUSTOMER-CNPJ-LOOKUP-01, CUSTOMER-CNPJ-EDITABLE-HISTORY-01).
 *
 * Módulo puro de propósito: é aqui que mora a decisão de negócio ("o que a
 * fonte pode trocar?"), e ela se prova sem montar tela nenhuma.
 *
 * A consulta é ADITIVA. O OpenCNPJ sugere; quem cadastra decide:
 *
 * 1. **Atual vazio, fonte com valor que o campo guarda**: marcado por padrão —
 *    completar o cadastro é o caso comum.
 * 2. **Atual preenchido, fonte diferente**: NÃO marcado. Trocar é
 *    "Substituir", escolha explícita de quem cadastra.
 * 3. **Equivalentes**: os dois à vista, e a linha pode ser marcada para
 *    "Confirmar" pela fonte — nunca escondida só por serem iguais.
 * 4. **Fonte vazia**: "—", sem operação nenhuma. Vazio da fonte NUNCA apaga.
 * 5. **O que o campo não guardaria** (CEP incompleto, UF desconhecida, telefone
 *    inválido, texto acima do limite) aparece com o valor e o motivo, sem caixa
 *    — aplicar algo que o "Salvar" recusaria é entregar um erro que ninguém pediu.
 *
 * Normalizar é só para COMPARAR: o que a tela mostra e aplica é o valor da
 * fonte no formato do próprio campo, sem reescrita silenciosa.
 */

/** Os campos do cadastro que a consulta sabe preencher. */
export const CAMPOS_DA_CONSULTA_DE_CNPJ = [
  "legalName",
  "tradeName",
  "zipCode",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
  "phone",
  "email",
] as const;

export type CampoDaConsultaDeCnpj = (typeof CAMPOS_DA_CONSULTA_DE_CNPJ)[number];

/** O valor da fonte já no formato do campo, ou o motivo de não caber nele. */
type ValorParaOCampo =
  | { cabe: true; valor: string }
  | { cabe: false; motivo: string };

/** As chaves de TEXTO do contrato — só elas preenchem campo do cadastro. */
type ChaveDeTextoDaEmpresa = {
  [K in keyof CnpjLookupCompany]: CnpjLookupCompany[K] extends string | null ? K : never;
}[keyof CnpjLookupCompany];

interface DefinicaoDeCampo {
  rotulo: string;
  /** De onde o valor vem no contrato normalizado. */
  origem: ChaveDeTextoDaEmpresa;
  /** O valor da fonte no formato que o campo guarda, ou o motivo da recusa. */
  paraOCampo: (valorDaFonte: string) => ValorParaOCampo;
  /** A forma canônica usada SÓ para responder "é o mesmo valor?". */
  canonico: (valor: string) => string;
}

/**
 * Forma canônica de texto livre: sem espaço sobrando, sem caixa e sem acento.
 *
 * Caixa e acento saem porque a base pública escreve tudo em maiúsculas e sem
 * acentuação — "TATUI" e "Tatuí" são a MESMA cidade. Isto não muda o que se
 * mostra nem o que se aplica: é só a resposta à pergunta "mudou?".
 */
function textoCanonico(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Texto simples com teto de tamanho — o teto é o do próprio campo do Cliente. */
function textoComTeto(limite: number, oQueE: string): DefinicaoDeCampo["paraOCampo"] {
  return (valorDaFonte) => {
    const valor = valorDaFonte.trim().replace(/\s+/g, " ");
    if (valor.length > limite) {
      return {
        cabe: false,
        motivo: `A fonte devolveu ${oQueE} com ${valor.length} caracteres, e o campo aceita ${limite}.`,
      };
    }
    return { cabe: true, valor };
  };
}

export const DEFINICOES_DA_CONSULTA_DE_CNPJ: Record<CampoDaConsultaDeCnpj, DefinicaoDeCampo> = {
  legalName: {
    rotulo: "Razão Social / Nome",
    origem: "legalName",
    paraOCampo: textoComTeto(CUSTOMER_FIELD_MAX_LENGTHS.legalName, "uma razão social"),
    canonico: textoCanonico,
  },
  tradeName: {
    rotulo: "Nome Fantasia",
    origem: "tradeName",
    paraOCampo: textoComTeto(CUSTOMER_FIELD_MAX_LENGTHS.tradeName, "um nome fantasia"),
    canonico: textoCanonico,
  },
  zipCode: {
    rotulo: "CEP",
    origem: "postalCode",
    paraOCampo: (valorDaFonte) => {
      const digitos = normalizeZipCode(valorDaFonte);
      if (digitos.length !== 8) {
        return { cabe: false, motivo: "A fonte devolveu um CEP incompleto." };
      }
      // O campo mostra e guarda com máscara; a API recebe só dígitos.
      return { cabe: true, valor: maskZipCodeInput(digitos) };
    },
    canonico: normalizeZipCode,
  },
  street: {
    rotulo: "Logradouro",
    origem: "street",
    paraOCampo: textoComTeto(CUSTOMER_FIELD_MAX_LENGTHS.street, "um logradouro"),
    canonico: textoCanonico,
  },
  number: {
    rotulo: "Número",
    origem: "number",
    paraOCampo: textoComTeto(CUSTOMER_FIELD_MAX_LENGTHS.number, "um número"),
    canonico: textoCanonico,
  },
  complement: {
    rotulo: "Complemento",
    origem: "complement",
    paraOCampo: textoComTeto(CUSTOMER_FIELD_MAX_LENGTHS.complement, "um complemento"),
    canonico: textoCanonico,
  },
  district: {
    rotulo: "Bairro",
    origem: "neighborhood",
    paraOCampo: textoComTeto(CUSTOMER_FIELD_MAX_LENGTHS.district, "um bairro"),
    canonico: textoCanonico,
  },
  city: {
    rotulo: "Cidade",
    origem: "city",
    paraOCampo: textoComTeto(CUSTOMER_FIELD_MAX_LENGTHS.city, "uma cidade"),
    canonico: textoCanonico,
  },
  state: {
    rotulo: "UF",
    origem: "state",
    paraOCampo: (valorDaFonte) => {
      const uf = valorDaFonte.trim().toUpperCase();
      if (!(BR_STATE_CODES as readonly string[]).includes(uf)) {
        return { cabe: false, motivo: "A fonte devolveu uma UF que o cadastro não reconhece." };
      }
      return { cabe: true, valor: uf };
    },
    canonico: (valor) => valor.trim().toUpperCase(),
  },
  phone: {
    rotulo: "Telefone",
    origem: "phone",
    paraOCampo: (valorDaFonte) => {
      const digitos = normalizePhone(valorDaFonte);
      if (!isValidBrPhone(digitos)) {
        return { cabe: false, motivo: "A fonte devolveu um telefone que o cadastro não aceita." };
      }
      // O campo guarda com máscara, como quando alguém digita.
      return { cabe: true, valor: formatBrPhone(digitos) ?? digitos };
    },
    canonico: normalizePhone,
  },
  email: {
    rotulo: "Email",
    origem: "email",
    paraOCampo: (valorDaFonte) => {
      const email = valorDaFonte.trim();
      if (!isValidEmail(email)) {
        return { cabe: false, motivo: "A fonte devolveu um e-mail em formato inválido." };
      }
      if (email.length > CUSTOMER_FIELD_MAX_LENGTHS.email) {
        return {
          cabe: false,
          motivo: `A fonte devolveu um e-mail com ${email.length} caracteres, e o campo aceita ${CUSTOMER_FIELD_MAX_LENGTHS.email}.`,
        };
      }
      return { cabe: true, valor: email };
    },
    // E-mail não tem caixa significativa na prática, e a base pública grava
    // tudo em maiúsculas: "CONTATO@X.COM.BR" e "contato@x.com.br" é o mesmo
    // endereço.
    canonico: (valor) => valor.trim().toLowerCase(),
  },
};

/** O desfecho de UMA linha da comparação. */
export type SituacaoDaLinha =
  /** Atual vazio e a fonte traz valor que o campo guarda: completar, marcado por padrão. */
  | "preencher"
  /** Atual preenchido e a fonte traz outro valor: trocar só por escolha explícita. */
  | "substituir"
  /** Atual e fonte equivalentes: dá para confirmar pela fonte. */
  | "confirmar"
  /** A fonte não informou este campo: nada a fazer, e nada se apaga. */
  | "sem_valor"
  /** A fonte informou, mas o cadastro não guardaria aquilo. */
  | "nao_aplicavel";

/** As situações que aceitam escolha — e o verbo da caixa de cada uma. */
export const VERBO_DA_ESCOLHA = {
  preencher: "Aplicar",
  substituir: "Substituir",
  confirmar: "Confirmar",
} as const;

export type SituacaoSelecionavel = keyof typeof VERBO_DA_ESCOLHA;

export function linhaSelecionavel(situacao: SituacaoDaLinha): situacao is SituacaoSelecionavel {
  return situacao === "preencher" || situacao === "substituir" || situacao === "confirmar";
}

/** A situação de uma linha em que a fonte informou algo que o campo guarda. */
function situacaoComFonte(atualVazio: boolean, equivalentes: boolean): SituacaoSelecionavel {
  if (atualVazio) return "preencher";
  return equivalentes ? "confirmar" : "substituir";
}

export interface LinhaDaComparacao {
  campo: CampoDaConsultaDeCnpj;
  rotulo: string;
  /** O que está NO FORMULÁRIO agora — não o que está gravado no banco. */
  atual: string;
  /** O que a fonte devolveu, no formato do campo. `""` quando não informou. */
  retornado: string;
  situacao: SituacaoDaLinha;
  /** Só em `nao_aplicavel`: por que a linha não aceita escolha. */
  motivo?: string;
}

/** O estado do formulário nos campos que a consulta compara. */
export type ValoresDoFormulario = Record<CampoDaConsultaDeCnpj, string>;

/**
 * A comparação dos campos do cadastro, na ordem em que a tela mostra.
 *
 * `atual` vem do FORMULÁRIO, nunca do registro salvo: quem editou a razão
 * social e ainda não salvou compara contra o que está vendo.
 */
export function compararComOCadastro(
  atual: ValoresDoFormulario,
  company: CnpjLookupCompany,
): LinhaDaComparacao[] {
  return CAMPOS_DA_CONSULTA_DE_CNPJ.map((campo) => {
    const definicao = DEFINICOES_DA_CONSULTA_DE_CNPJ[campo];
    const noFormulario = atual[campo] ?? "";
    const daFonte = (company[definicao.origem] ?? "").trim();
    const base = { campo, rotulo: definicao.rotulo, atual: noFormulario };

    if (daFonte === "") {
      return { ...base, retornado: "", situacao: "sem_valor" as const };
    }

    const preparado = definicao.paraOCampo(daFonte);
    if (!preparado.cabe) {
      return { ...base, retornado: daFonte, situacao: "nao_aplicavel" as const, motivo: preparado.motivo };
    }

    const equivalentes = definicao.canonico(preparado.valor) === definicao.canonico(noFormulario);
    return {
      ...base,
      retornado: preparado.valor,
      situacao: situacaoComFonte(noFormulario.trim() === "", equivalentes),
    };
  });
}

/**
 * A seleção inicial: SÓ o que completa o cadastro.
 *
 * Valor já preenchido nunca nasce marcado para troca — a fonte é sugestão, e
 * quem decide substituir é a pessoa, linha a linha.
 */
export function selecaoInicial<Campo extends string>(
  linhas: readonly { campo: Campo; situacao: SituacaoDaLinha }[],
): Set<Campo> {
  return new Set(linhas.filter((linha) => linha.situacao === "preencher").map((linha) => linha.campo));
}

/** O que aplicar ao formulário — só o que foi marcado, e só em linha que aceita escolha. */
export function valoresParaAplicar(
  linhas: LinhaDaComparacao[],
  selecionados: ReadonlySet<CampoDaConsultaDeCnpj>,
): Partial<ValoresDoFormulario> {
  const valores: Partial<ValoresDoFormulario> = {};
  for (const linha of linhas) {
    if (!linhaSelecionavel(linha.situacao) || !selecionados.has(linha.campo)) continue;
    valores[linha.campo] = linha.retornado;
  }
  return valores;
}

/* ------------------------------------------------------------------------ */
/* Dados cadastrais do CNPJ — §119 e §122.                                   */
/* ------------------------------------------------------------------------ */

/**
 * Sim / Não / Não informado. `null` NUNCA é "Não": "a fonte não informou se a
 * empresa é optante" e "a empresa não é optante" são respostas diferentes.
 */
export function simNaoOuNaoInformado(valor: boolean | null | undefined): string {
  if (valor === true) return "Sim";
  if (valor === false) return "Não";
  return "Não informado";
}

/** Os dados cadastrais como o formulário os guarda: o texto de cada campo, `""` = vazio. */
export type ValoresDosDadosDoCnpj = Record<CnpjRegistrationField, string>;

export const DADOS_DO_CNPJ_VAZIOS = Object.fromEntries(
  CNPJ_REGISTRATION_FIELDS.map((campo) => [campo, ""]),
) as ValoresDosDadosDoCnpj;

/**
 * Texto do campo → valor do contrato. Simples e MEI: `"true"`, `"false"` ou
 * `""` (não informado); Matriz/Filial: o enum ou `""`; CNAE: só os dígitos.
 */
export function valorDoCampoDoCnpj(campo: CnpjRegistrationField, texto: string): CnpjRegistrationValue {
  const limpo = texto.trim();
  if (limpo === "") return null;
  if (campo === "mainCnaeCode") return normalizeCnaeCode(limpo) || null;
  if (campo === "simplesOptIn" || campo === "meiOptIn") {
    return limpo === "true" ? true : limpo === "false" ? false : null;
  }
  if (campo === "establishmentType") {
    return (CNPJ_ESTABLISHMENT_TYPES as readonly string[]).includes(limpo) ? limpo : null;
  }
  return limpo;
}

/** Valor do contrato → texto do campo (o CNAE com a máscara de digitação). */
export function textoDoCampoDoCnpj(
  campo: CnpjRegistrationField,
  valor: CnpjRegistrationValue | undefined,
): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "boolean") return valor ? "true" : "false";
  return campo === "mainCnaeCode" ? maskCnaeInput(valor) : valor;
}

/** O que o Cliente tem gravado, nos textos do formulário. */
export function dadosDoCnpjNoFormulario(
  dados: CustomerCnpjRegistration | null | undefined,
): ValoresDosDadosDoCnpj {
  return Object.fromEntries(
    CNPJ_REGISTRATION_FIELDS.map((campo) => [campo, textoDoCampoDoCnpj(campo, dados?.[campo])]),
  ) as ValoresDosDadosDoCnpj;
}

/** O formulário no contrato do POST/PATCH. */
export function dadosDoCnpjDoFormulario(valores: ValoresDosDadosDoCnpj): CnpjRegistrationValues {
  return Object.fromEntries(
    CNPJ_REGISTRATION_FIELDS.map((campo) => [campo, valorDoCampoDoCnpj(campo, valores[campo] ?? "")]),
  ) as CnpjRegistrationValues;
}

interface DefinicaoDeDadoDoCnpj {
  rotulo: string;
  /** Como a tela escreve o valor (comparação e histórico). Vazio é `""`. */
  exibir: (valor: CnpjRegistrationValue) => string;
  /** A forma canônica usada SÓ para responder "é o mesmo valor?". */
  canonico: (valor: CnpjRegistrationValue) => string;
}

const textoDoDado = (valor: CnpjRegistrationValue) => (typeof valor === "string" ? valor : "");

const TEXTO_DO_CNPJ: Omit<DefinicaoDeDadoDoCnpj, "rotulo"> = {
  exibir: textoDoDado,
  canonico: (valor) => textoCanonico(textoDoDado(valor)),
};

const DIA_DO_CNPJ: Omit<DefinicaoDeDadoDoCnpj, "rotulo"> = {
  // `08/03/2019`: dia civil, sem passar pelo fuso de quem lê.
  exibir: (valor) => (typeof valor === "string" && valor ? formatDate(valor) : ""),
  canonico: textoDoDado,
};

const SIM_OU_NAO_DO_CNPJ: Omit<DefinicaoDeDadoDoCnpj, "rotulo"> = {
  exibir: (valor) => (typeof valor === "boolean" ? simNaoOuNaoInformado(valor) : ""),
  canonico: (valor) => String(valor),
};

export const DEFINICOES_DOS_DADOS_DO_CNPJ: Record<CnpjRegistrationField, DefinicaoDeDadoDoCnpj> = {
  mainCnaeCode: {
    rotulo: "CNAE principal",
    exibir: (valor) => formatCnaeCode(textoDoDado(valor)) ?? "",
    canonico: textoDoDado,
  },
  mainCnaeDescription: { rotulo: "Descrição do CNAE", ...TEXTO_DO_CNPJ },
  legalNature: { rotulo: "Natureza jurídica", ...TEXTO_DO_CNPJ },
  companySize: { rotulo: "Porte", ...TEXTO_DO_CNPJ },
  openedAt: { rotulo: "Data de abertura", ...DIA_DO_CNPJ },
  establishmentType: {
    rotulo: "Matriz/Filial",
    exibir: (valor) =>
      typeof valor === "string" && valor in CNPJ_ESTABLISHMENT_TYPE_LABELS
        ? CNPJ_ESTABLISHMENT_TYPE_LABELS[valor as CnpjEstablishmentType]
        : "",
    canonico: textoDoDado,
  },
  simplesOptIn: { rotulo: "Simples", ...SIM_OU_NAO_DO_CNPJ },
  meiOptIn: { rotulo: "MEI", ...SIM_OU_NAO_DO_CNPJ },
  registrationStatus: { rotulo: "Situação na RFB", ...TEXTO_DO_CNPJ },
  registrationStatusDate: { rotulo: "Data da situação", ...DIA_DO_CNPJ },
};

/** Uma linha dos dados cadastrais na comparação. Nunca "não aplicável": o adaptador só devolve o que cabe. */
export interface LinhaDosDadosDoCnpj {
  campo: CnpjRegistrationField;
  rotulo: string;
  /** O que o formulário tem AGORA, escrito para a tela. `""` quando vazio. */
  atual: string;
  /** O que a fonte devolveu, escrito para a tela. `""` quando não informou. */
  retornado: string;
  situacao: Exclude<SituacaoDaLinha, "nao_aplicavel">;
}

/** "A fonte não informou" — inclusive o campo que uma API antiga nem mandava. */
function informado(valor: CnpjRegistrationValue | undefined): valor is string | boolean {
  if (valor === null || valor === undefined) return false;
  return typeof valor !== "string" || valor.trim() !== "";
}

/**
 * Atual × Retornado dos dados cadastrais, com as MESMAS regras dos campos do
 * cadastro — a consulta é aditiva aqui também. `atuais` são os textos do
 * formulário agora (editáveis, possivelmente ainda não salvos).
 */
export function compararDadosDoCnpj(
  atuais: ValoresDosDadosDoCnpj,
  company: CnpjLookupCompany,
): LinhaDosDadosDoCnpj[] {
  return CNPJ_REGISTRATION_FIELDS.map((campo) => {
    const definicao = DEFINICOES_DOS_DADOS_DO_CNPJ[campo];
    const atual = valorDoCampoDoCnpj(campo, atuais[campo] ?? "");
    const daFonte = company[campo] as CnpjRegistrationValue | undefined;
    const base = { campo, rotulo: definicao.rotulo, atual: definicao.exibir(atual) };

    if (!informado(daFonte)) return { ...base, retornado: "", situacao: "sem_valor" as const };

    const equivalentes = atual !== null && definicao.canonico(daFonte) === definicao.canonico(atual);
    return {
      ...base,
      retornado: definicao.exibir(daFonte),
      situacao: situacaoComFonte(atual === null, equivalentes),
    };
  });
}

/** Os dados cadastrais marcados, já nos textos do formulário. */
export function dadosDoCnpjParaAplicar(
  linhas: LinhaDosDadosDoCnpj[],
  selecionados: ReadonlySet<CnpjRegistrationField>,
  company: CnpjLookupCompany,
): Partial<ValoresDosDadosDoCnpj> {
  const valores: Partial<ValoresDosDadosDoCnpj> = {};
  for (const linha of linhas) {
    if (!linhaSelecionavel(linha.situacao) || !selecionados.has(linha.campo)) continue;
    valores[linha.campo] = textoDoCampoDoCnpj(linha.campo, company[linha.campo]);
  }
  return valores;
}

/** O que o diálogo entrega ao formulário quando a pessoa aplica a consulta. */
export interface AplicacaoDaConsultaDeCnpj {
  /** Os campos do cadastro marcados — podem ser nenhum. */
  valores: Partial<ValoresDoFormulario>;
  /** Os dados cadastrais marcados — podem ser nenhum. */
  dadosDoCnpj: Partial<ValoresDosDadosDoCnpj>;
  /** Instante da consulta: vira a "Última consulta CNPJ" quando o cadastro for salvo. */
  consultedAt: string;
  /** O CNPJ consultado, normalizado. */
  cnpj: string;
}
