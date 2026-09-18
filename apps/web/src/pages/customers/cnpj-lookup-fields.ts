import type {
  CnpjEstablishmentType,
  CnpjLookupCompany,
  CnpjLookupResult,
  CnpjRegistrationField,
  CustomerCnpjRegistration,
} from "@veridi/shared";
import {
  BR_STATE_CODES,
  CNPJ_ESTABLISHMENT_TYPE_LABELS,
  CNPJ_REGISTRATION_FIELDS,
  CUSTOMER_FIELD_MAX_LENGTHS,
  formatBrPhone,
  formatCnaeCode,
  isValidBrPhone,
  isValidEmail,
  maskZipCodeInput,
  normalizePhone,
  normalizeZipCode,
} from "@veridi/shared";
import { formatDate } from "../../lib/dates";

/**
 * A comparação Atual × Retornado da consulta de CNPJ — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * Módulo puro de propósito: é aqui que mora a decisão de negócio ("este valor
 * pode substituir aquele?"), e ela se prova sem montar tela nenhuma.
 *
 * Três regras mandam, nesta ordem:
 *
 * 1. **Valor vazio da fonte nunca apaga valor existente.** Não é escolha do
 *    usuário — a substituição simplesmente não é oferecida.
 * 2. **O que a fonte devolveu só é oferecido se o campo puder guardá-lo.** Um
 *    telefone com DDD inexistente, um CEP com 7 dígitos, uma UF que não é do
 *    Brasil ou um complemento mais longo do que o campo aceita seriam
 *    recusados no "Salvar" — aplicá-los entrega ao operador um erro que ele
 *    não causou. A linha aparece assim mesmo, com o valor visível e o motivo,
 *    em vez de sumir sem explicação.
 * 3. **Normalizar é só para COMPARAR.** O que a tela mostra e o que ela aplica
 *    é o valor da fonte no formato do próprio campo — nada é reescrito em
 *    silêncio para "ficar bonito".
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
 * acentuação — "TATUI" e "Tatuí" são a MESMA cidade, e tratá-los como
 * diferentes faria a tela marcar por padrão uma substituição que só piora o
 * cadastro. Isto não muda o que se mostra nem o que se aplica: é só a resposta
 * à pergunta "mudou?".
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
    // endereço, e trocar um pelo outro não é atualizar cadastro nenhum.
    canonico: (valor) => valor.trim().toLowerCase(),
  },
};

/** O desfecho de UMA linha da comparação. */
export type SituacaoDaLinha =
  /** A fonte trouxe algo diferente, e o campo aceita: dá para aplicar. */
  | "aplicavel"
  /** A fonte trouxe o mesmo valor do formulário. */
  | "igual"
  /** A fonte não informou este campo. */
  | "sem_valor"
  /** A fonte informou, mas o cadastro não guardaria aquilo. */
  | "nao_aplicavel";

export interface LinhaDaComparacao {
  campo: CampoDaConsultaDeCnpj;
  rotulo: string;
  /** O que está NO FORMULÁRIO agora — não o que está gravado no banco. */
  atual: string;
  /** O que a fonte devolveu, no formato do campo. `""` quando não informou. */
  retornado: string;
  situacao: SituacaoDaLinha;
  /** Só em `nao_aplicavel`: por que a substituição não é oferecida. */
  motivo?: string;
}

/** O estado do formulário nos campos que a consulta compara. */
export type ValoresDoFormulario = Record<CampoDaConsultaDeCnpj, string>;

/**
 * A comparação inteira, na ordem em que a tela mostra.
 *
 * `atual` vem do FORMULÁRIO, nunca do registro salvo: quem editou a razão
 * social e ainda não salvou precisa comparar contra o que está vendo, senão a
 * tela discute com um valor que já não existe em lugar nenhum.
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

    // Regra 1: o que a fonte não informou não tem como apagar o que existe.
    if (daFonte === "") {
      return { ...base, retornado: "", situacao: "sem_valor" as const };
    }

    // Regra 2: só se oferece o que o campo guardaria.
    const preparado = definicao.paraOCampo(daFonte);
    if (!preparado.cabe) {
      return {
        ...base,
        retornado: daFonte,
        situacao: "nao_aplicavel" as const,
        motivo: preparado.motivo,
      };
    }

    // Regra 3: normalizar é só para responder "mudou?".
    const situacao =
      definicao.canonico(preparado.valor) === definicao.canonico(noFormulario)
        ? ("igual" as const)
        : ("aplicavel" as const);

    return { ...base, retornado: preparado.valor, situacao };
  });
}

/**
 * A seleção inicial: toda diferença aplicável começa marcada.
 *
 * É o caso comum — quem consultou quer os dados. Desmarcar uma linha é um
 * clique; remarcar onze seria trabalho manual para o caso que quase sempre
 * acontece. "Quero atualizar o endereço, mas não o telefone" continua
 * atendido, porque cada linha é independente.
 */
export function selecaoInicial(linhas: LinhaDaComparacao[]): Set<CampoDaConsultaDeCnpj> {
  return new Set(
    linhas.filter((linha) => linha.situacao === "aplicavel").map((linha) => linha.campo),
  );
}

/** O que aplicar ao formulário — só o que foi marcado, e só o que é aplicável. */
export function valoresParaAplicar(
  linhas: LinhaDaComparacao[],
  selecionados: ReadonlySet<CampoDaConsultaDeCnpj>,
): Partial<ValoresDoFormulario> {
  const valores: Partial<ValoresDoFormulario> = {};
  for (const linha of linhas) {
    if (linha.situacao !== "aplicavel") continue;
    if (!selecionados.has(linha.campo)) continue;
    valores[linha.campo] = linha.retornado;
  }
  return valores;
}

/* ------------------------------------------------------------------------ */
/* Dados cadastrais do CNPJ — CUSTOMER-CNPJ-PERSISTED-DATA-01, §119.         */
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

type ValorDoDadoDoCnpj = string | boolean | null;

interface DefinicaoDeDadoDoCnpj {
  rotulo: string;
  /** Como a tela escreve o valor. Texto ausente é `""` (a tabela mostra "—"). */
  exibir: (valor: ValorDoDadoDoCnpj) => string;
  /** A forma canônica usada SÓ para responder "é o mesmo valor?". */
  canonico: (valor: ValorDoDadoDoCnpj) => string;
}

const textoDoDado = (valor: ValorDoDadoDoCnpj) => (typeof valor === "string" ? valor : "");

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
  exibir: (valor) => simNaoOuNaoInformado(typeof valor === "boolean" ? valor : null),
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
  /** O que o formulário tem AGORA para este CNPJ, já escrito para a tela. */
  atual: string;
  /** O que a fonte devolveu, escrito para a tela. `""` quando não informou. */
  retornado: string;
  situacao: Exclude<SituacaoDaLinha, "nao_aplicavel">;
}

/** O valor tratado como "a fonte não informou" — inclusive o campo que a API antiga nem mandava. */
function informado(valor: ValorDoDadoDoCnpj | undefined): valor is string | boolean {
  if (valor === null || valor === undefined) return false;
  return typeof valor !== "string" || valor.trim() !== "";
}

/**
 * Atual × Retornado dos dados cadastrais, com as MESMAS regras dos campos do
 * cadastro: diferença útil é aplicável (e nasce marcada), equivalente é "Sem
 * alteração", e o que a fonte não informou não apaga o que existe.
 *
 * `atual` é o bloco que vale para o CNPJ da tela — `null` quando não há, ou
 * quando o que havia era de outro CNPJ e foi descartado.
 */
export function compararDadosDoCnpj(
  atual: CustomerCnpjRegistration | null,
  company: CnpjLookupCompany,
): LinhaDosDadosDoCnpj[] {
  return CNPJ_REGISTRATION_FIELDS.map((campo) => {
    const definicao = DEFINICOES_DOS_DADOS_DO_CNPJ[campo];
    const noFormulario = atual ? atual[campo] : null;
    const daFonte = company[campo] as ValorDoDadoDoCnpj | undefined;
    const base = { campo, rotulo: definicao.rotulo, atual: atual ? definicao.exibir(noFormulario) : "" };

    if (!informado(daFonte)) return { ...base, retornado: "", situacao: "sem_valor" as const };

    const igual =
      informado(noFormulario) && definicao.canonico(daFonte) === definicao.canonico(noFormulario);
    return {
      ...base,
      retornado: definicao.exibir(daFonte),
      situacao: igual ? ("igual" as const) : ("aplicavel" as const),
    };
  });
}

/** A seleção inicial dos dados cadastrais: toda diferença começa marcada. */
export function selecaoInicialDosDadosDoCnpj(
  linhas: LinhaDosDadosDoCnpj[],
): Set<CnpjRegistrationField> {
  return new Set(
    linhas.filter((linha) => linha.situacao === "aplicavel").map((linha) => linha.campo),
  );
}

/**
 * O bloco que "Aplicar" deixa no formulário.
 *
 * SEMPRE um bloco, mesmo sem diferença nenhuma: a consulta aplicada confirma
 * que os dados foram revistos naquela data, e é o `consultedAt` dela que vira
 * a "Última consulta CNPJ" quando o cadastro for salvo.
 *
 * Campo a campo: o que foi marcado vem da fonte; o resto — equivalente, não
 * informado pela fonte ou desmarcado — fica como estava no formulário. Vazio
 * da fonte nunca apaga.
 */
export function dadosDoCnpjParaAplicar(
  atual: CustomerCnpjRegistration | null,
  resultado: CnpjLookupResult,
  linhas: LinhaDosDadosDoCnpj[],
  selecionados: ReadonlySet<CnpjRegistrationField>,
): CustomerCnpjRegistration {
  const daFonte = new Set(
    linhas
      .filter((linha) => linha.situacao === "aplicavel" && selecionados.has(linha.campo))
      .map((linha) => linha.campo),
  );
  const campos = Object.fromEntries(
    CNPJ_REGISTRATION_FIELDS.map((campo) => [
      campo,
      daFonte.has(campo) ? (resultado.company[campo] ?? null) : (atual?.[campo] ?? null),
    ]),
  ) as Pick<CustomerCnpjRegistration, CnpjRegistrationField>;
  return { ...campos, consultedAt: resultado.consultedAt };
}

/**
 * Assinatura do bloco para responder "mudou?": valores na ordem fixa dos
 * campos, e não o JSON do objeto — o bloco que volta da API e o que a tela
 * monta ao aplicar têm as chaves em ordens diferentes.
 */
export function assinaturaDosDadosDoCnpj(bloco: CustomerCnpjRegistration | null | undefined): string {
  if (!bloco) return "null";
  return JSON.stringify([
    ...CNPJ_REGISTRATION_FIELDS.map((campo) => bloco[campo] ?? null),
    bloco.consultedAt,
  ]);
}

/** O que o diálogo entrega ao formulário quando a pessoa aplica a consulta. */
export interface AplicacaoDaConsultaDeCnpj {
  /** Só os campos do cadastro marcados — podem ser nenhum. */
  valores: Partial<ValoresDoFormulario>;
  /** O bloco dos dados cadastrais, sempre presente, com o instante da consulta. */
  dadosDoCnpj: CustomerCnpjRegistration;
  /** O CNPJ consultado, normalizado: é a ele que o bloco pertence. */
  cnpj: string;
}
