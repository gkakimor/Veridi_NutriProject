import type { CnpjLookupCompany } from "@veridi/shared";
import {
  BR_STATE_CODES,
  CUSTOMER_FIELD_MAX_LENGTHS,
  formatBrPhone,
  isValidBrPhone,
  isValidEmail,
  maskZipCodeInput,
  normalizePhone,
  normalizeZipCode,
} from "@veridi/shared";

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

interface DefinicaoDeCampo {
  rotulo: string;
  /** De onde o valor vem no contrato normalizado. */
  origem: keyof CnpjLookupCompany;
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
