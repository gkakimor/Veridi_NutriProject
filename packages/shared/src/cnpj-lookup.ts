/**
 * Consulta assistida de CNPJ — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * O que isto é: ASSISTÊNCIA AO PREENCHIMENTO. O sistema consulta uma fonte
 * pública, mostra o que ela devolveu ao lado do que está na tela e deixa a
 * pessoa escolher, campo a campo, o que aplicar ao formulário. Nada é gravado
 * pela consulta — depois de aplicar, o cadastro continua exigindo "Salvar".
 *
 * O que isto NÃO é: validação jurídica, certificação cadastral, consulta
 * fiscal oficial, atualização automática nem motor tributário. O perfil
 * tributário do Cliente (`PRODUCT_RULES.md` §83) segue sendo classificação
 * INFORMADA pela Veridi — nada aqui o deduz do CNAE, do porte ou da natureza
 * jurídica.
 *
 * O contrato abaixo é NORMALIZADO: a tela recebe estes nomes e estes tipos,
 * seja qual for o provedor. Quem conhece o payload cru de cada fonte é o
 * adaptador, dentro da API. Acrescentar um segundo provedor (SERPRO) é
 * escrever outro adaptador que produza `CnpjLookupCompany` — a tela de
 * comparação, o endpoint e a lógica de aplicação não mudam.
 */

/**
 * Os provedores conhecidos. Hoje só existe um de verdade.
 *
 * SERPRO entra nesta lista quando o adaptador existir — nunca antes:
 * oferecer na tela uma fonte que não responde é pior que não oferecer,
 * porque ensina que o sistema está quebrado.
 */
export const CNPJ_LOOKUP_PROVIDERS = ["OPEN_CNPJ"] as const;

export type CnpjLookupProvider = (typeof CNPJ_LOOKUP_PROVIDERS)[number];

export const CNPJ_LOOKUP_PROVIDER_LABELS: Record<CnpjLookupProvider, string> = {
  OPEN_CNPJ: "OpenCNPJ",
};

/** O provedor pré-selecionado no diálogo e o assumido quando a chamada omite. */
export const DEFAULT_CNPJ_LOOKUP_PROVIDER: CnpjLookupProvider = "OPEN_CNPJ";

/**
 * Matriz ou filial — o estabelecimento a que o CNPJ consultado pertence
 * (CUSTOMER-CNPJ-PERSISTED-DATA-01). Conceito da Receita, não de um provedor:
 * o adaptador traduz o que a fonte escreve para um destes valores, e o que
 * ele não souber traduzir com segurança fica `null`.
 */
export const CNPJ_ESTABLISHMENT_TYPES = ["HEADQUARTERS", "BRANCH"] as const;

export type CnpjEstablishmentType = (typeof CNPJ_ESTABLISHMENT_TYPES)[number];

export const CNPJ_ESTABLISHMENT_TYPE_LABELS: Record<CnpjEstablishmentType, string> = {
  HEADQUARTERS: "Matriz",
  BRANCH: "Filial",
};

/**
 * Teto dos textos cadastrais do CNPJ que o Cliente guarda.
 *
 * Um número em dois lugares: o adaptador descarta (vira `null`) o texto da
 * fonte acima do teto — não dá para interpretá-lo com segurança, e cortar
 * seria reescrever o dado em silêncio —, e o Zod do Cliente recusa o mesmo
 * teto. O que a consulta devolve, portanto, sempre cabe no cadastro.
 */
export const CNPJ_REGISTRATION_TEXT_MAX_LENGTHS = {
  mainCnaeDescription: 300,
  legalNature: 300,
  companySize: 100,
  registrationStatus: 100,
} as const;

/** CNAE subclasse: sete dígitos, guardados sem máscara. */
export const CNAE_CODE_PATTERN = /^\d{7}$/;

/** `1099699` → `1099-6/99`, a máscara usual da subclasse CNAE. Outro formato passa como está. */
export function formatCnaeCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return CNAE_CODE_PATTERN.test(code)
    ? `${code.slice(0, 4)}-${code.slice(4, 5)}/${code.slice(5)}`
    : code;
}

/**
 * Os dados cadastrais que a consulta devolve, já normalizados.
 *
 * Texto é `string | null`; Simples e MEI são `boolean | null`; matriz/filial é
 * o enum acima ou `null`. Em todos, `null` significa "a fonte não informou" —
 * ou informou algo que não se interpreta com segurança. **`null` nunca é
 * `false`**: "não informado" no Simples não quer dizer "não optante". Campo
 * nulo NUNCA vira substituição — valor vazio do provedor não apaga valor
 * existente no cadastro (regra de ouro desta capacidade).
 *
 * `postalCode` trafega só com dígitos, como o `zipCode` do Cliente.
 * `phone` trafega só com dígitos (DDD + número), como o `phone` do Cliente.
 * `openedAt` e `registrationStatusDate` são dias civis `YYYY-MM-DD` existentes.
 * `mainCnaeCode` são os sete dígitos da subclasse, sem máscara.
 */
export interface CnpjLookupCompany {
  /** Razão social. */
  legalName: string | null;
  /** Nome fantasia. */
  tradeName: string | null;
  /** Situação cadastral na Receita ("Ativa", "Baixada"…). */
  registrationStatus: string | null;
  /** Data da situação cadastral, `YYYY-MM-DD`. */
  registrationStatusDate: string | null;
  /** Data de início de atividade (abertura), `YYYY-MM-DD`. */
  openedAt: string | null;
  /** Matriz ou filial. */
  establishmentType: CnpjEstablishmentType | null;
  /** Optante pelo Simples Nacional: `true` Sim, `false` Não, `null` não informado. */
  simplesOptIn: boolean | null;
  /** Optante pelo MEI (SIMEI): `true` Sim, `false` Não, `null` não informado. */
  meiOptIn: boolean | null;
  postalCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  /** UF com 2 letras, maiúsculas. */
  state: string | null;
  phone: string | null;
  email: string | null;
  /** CNAE principal. O Veridi não classifica nada por CNAE. */
  mainCnaeCode: string | null;
  mainCnaeDescription: string | null;
  /** Natureza jurídica. */
  legalNature: string | null;
  /** Porte declarado na fonte — não é o perfil tributário (§83). */
  companySize: string | null;
}

/**
 * Os campos da consulta que o Cliente GUARDA como dados cadastrais do CNPJ
 * (CUSTOMER-CNPJ-PERSISTED-DATA-01). Os demais — razão social, endereço,
 * contato — preenchem os campos comerciais de sempre.
 */
export const CNPJ_REGISTRATION_FIELDS = [
  "mainCnaeCode",
  "mainCnaeDescription",
  "legalNature",
  "companySize",
  "openedAt",
  "establishmentType",
  "simplesOptIn",
  "meiOptIn",
  "registrationStatus",
  "registrationStatusDate",
] as const satisfies readonly (keyof CnpjLookupCompany)[];

export type CnpjRegistrationField = (typeof CNPJ_REGISTRATION_FIELDS)[number];

/** A resposta da consulta: de onde veio, quando, sobre qual CNPJ, e o quê. */
export interface CnpjLookupResult {
  provider: CnpjLookupProvider;
  /** Instante da consulta, ISO 8601. A proveniência aparece no resultado. */
  consultedAt: string;
  /** CNPJ normalizado (14 posições, sem máscara) que foi consultado. */
  cnpj: string;
  company: CnpjLookupCompany;
}

/**
 * Códigos de erro da consulta, na resposta da API.
 *
 * `cnpj_not_found` e `cnpj_lookup_unavailable` são os dois únicos desfechos
 * de falha que a tela precisa distinguir: "a fonte respondeu e não conhece
 * este CNPJ" e "não deu para perguntar". Timeout, 5xx do provedor, rede
 * caída, limite de uso e payload ilegível são todos o segundo caso — para
 * quem está cadastrando, a conduta é a mesma.
 */
export const CNPJ_NOT_FOUND_ERROR = "cnpj_not_found";
export const CNPJ_LOOKUP_UNAVAILABLE_ERROR = "cnpj_lookup_unavailable";

export const CNPJ_NOT_FOUND_MESSAGE =
  "CNPJ não encontrado na fonte consultada. Você pode continuar o preenchimento manualmente.";

export const CNPJ_LOOKUP_UNAVAILABLE_MESSAGE =
  "Não foi possível consultar o CNPJ agora. Você pode continuar o preenchimento manualmente.";

/**
 * A frase de proveniência, obrigatória no resultado.
 *
 * Existe para que ninguém confunda assistência de preenchimento com
 * certificação: o dado é público, processado por terceiro, e quem assina o
 * cadastro é quem clica em Salvar.
 */
export const CNPJ_LOOKUP_DISCLAIMER =
  "Dados obtidos de fonte pública. Confira as informações antes de salvar.";
