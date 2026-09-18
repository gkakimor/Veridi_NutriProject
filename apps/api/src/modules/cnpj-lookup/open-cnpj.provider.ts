import type { CnpjEstablishmentType, CnpjLookupCompany } from "@veridi/shared";
import {
  CNAE_CODE_PATTERN,
  CNPJ_REGISTRATION_TEXT_MAX_LENGTHS,
  ehDiaCivil,
  isValidBrPhone,
  normalizePhone,
} from "@veridi/shared";
import { CnpjNotFoundError, CnpjLookupUnavailableError } from "./cnpj-lookup.errors.js";
import type { CnpjLookupProviderAdapter } from "./cnpj-lookup.provider.js";

/**
 * Adaptador do OpenCNPJ — CUSTOMER-CNPJ-LOOKUP-01, primeiro provedor.
 *
 * Contrato conferido na documentação oficial (https://opencnpj.org, aba API,
 * e o JSON Schema em https://api.opencnpj.org/schema) em 2026-09-17:
 *
 * - `GET https://api.opencnpj.org/{CNPJ}` — o CNPJ com 14 posições, com ou
 *   sem máscara, numérico ou alfanumérico;
 * - `?datasets=receita` — sem o filtro o padrão já é a Receita Federal;
 *   declará-lo reduz o payload e fixa o que este adaptador sabe ler;
 * - sem chave, sem token, sem cadastro;
 * - `200` encontrado, `404 {"error":"not found"}` não encontrado,
 *   `400 {"error":"invalid cnpj"}` número malformado, `429` quando a origem
 *   mantém volume alto por período contínuo. A política declarada não tem
 *   cota fixa para consulta pontual por CNPJ, que é exatamente este uso —
 *   uma consulta por clique, dentro do cadastro.
 *
 * Chaves dos dados cadastrais (CUSTOMER-CNPJ-PERSISTED-DATA-01), conferidas no
 * mesmo JSON Schema em 2026-09-17 — todas `required`, todas `string`, e todas
 * podem vir vazias:
 *
 * - `matriz_filial` — exemplos `"Matriz"`, `"Filial"`;
 * - `opcao_simples` e `opcao_mei` — uma letra, exemplos `"S"`, `"N"`, `""`;
 * - `situacao_cadastral` — `"Nula"`, `"Ativa"`, `"Suspensa"`, `"Inapta"`,
 *   `"Baixada"`, com outros valores possíveis como fallback;
 * - `data_situacao_cadastral` e `data_inicio_atividade` — `YYYY-MM-DD` ou `""`;
 * - `porte_empresa` — `"Não informado"`, `"Microempresa (ME)"`, `"Empresa de
 *   Pequeno Porte (EPP)"`, `"Demais"`;
 * - `cnae_principal` — sete dígitos ou `""`; `natureza_juridica` — texto.
 *
 * O OpenCNPJ publica dados PÚBLICOS PROCESSADOS em releases. Ele mesmo diz
 * que não substitui validação jurídica nem consulta oficial em tempo real, e
 * é assim que a tela o apresenta.
 *
 * Nada do payload cru sai daqui: quem chama recebe `CnpjLookupCompany`. O que
 * não se interpreta com segurança — letra fora de S/N, data inexistente, texto
 * acima do teto do cadastro — vira `null`, nunca um palpite.
 */

const OPEN_CNPJ_BASE_URL = "https://api.opencnpj.org";

/** A consulta acontece enquanto alguém espera olhando o diálogo. */
const TIMEOUT_MS = 8000;

/**
 * Teto do corpo lido, em bytes.
 *
 * A resposta da Receita cresce com o quadro societário: ~5 KB numa empresa
 * comum, ~10 KB num banco com 40 sócios. 512 KB é folga larga para o caso
 * legítimo e continua sendo um teto — resposta que não para de chegar é
 * abortada em vez de virar memória da API.
 */
const MAX_RESPONSE_BYTES = 512 * 1024;

/** Identifica o chamador para o mantenedor do serviço público. */
const USER_AGENT = "Veridi-ERP/1.0 (+consulta assistida de CNPJ)";

/**
 * Lê o corpo com teto de tamanho.
 *
 * `response.text()` leria o que viesse: `content-length` é opcional (o
 * OpenCNPJ responde em chunks e não o envia no 200), então confiar no
 * cabeçalho não protege nada. Aqui o limite é aplicado sobre o que
 * efetivamente chega.
 */
async function lerCorpoComTeto(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new CnpjLookupUnavailableError("resposta acima do limite de tamanho");
      }
      pedacos.push(value);
    }
  } finally {
    // Corpo abandonado sem cancelar deixa o socket preso até o GC.
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(pedacos).toString("utf8");
}

/**
 * Texto do payload externo, sem confiar no tipo declarado.
 *
 * Só `string` é aceita — número, `null`, objeto e array viram `null`. Campo
 * ausente e campo vazio são a mesma coisa para esta capacidade: "a fonte não
 * informou", e o que não é informado nunca vira substituição.
 */
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo.length === 0 ? null : limpo;
}

/** Texto com teto: acima dele não é dado que se guarde sem cortar — e cortar é reescrever. */
function textoComTeto(valor: unknown, teto: number): string | null {
  const limpo = texto(valor);
  return limpo !== null && limpo.length <= teto ? limpo : null;
}

/** Forma de comparação de uma palavra da fonte: sem acento, sem caixa. */
function palavra(valor: unknown): string | null {
  const limpo = texto(valor);
  return limpo === null ? null : limpo.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/**
 * `S`/`N` da Receita. `null` é "não informado" e NÃO é `false`: a letra vazia
 * não diz que a empresa deixou de optar, diz que a fonte não sabe.
 */
function simOuNao(valor: unknown): boolean | null {
  const letra = palavra(valor);
  if (letra === "S") return true;
  if (letra === "N") return false;
  return null;
}

/** Só os dois valores que o schema documenta; o resto não é adivinhado. */
function matrizOuFilial(valor: unknown): CnpjEstablishmentType | null {
  const tipo = palavra(valor);
  if (tipo === "MATRIZ") return "HEADQUARTERS";
  if (tipo === "FILIAL") return "BRANCH";
  return null;
}

/** Dia civil `YYYY-MM-DD` que existe no calendário — `2024-02-30` não é dado, é ruído. */
function diaCivilDaFonte(valor: unknown): string | null {
  const limpo = texto(valor);
  return limpo !== null && ehDiaCivil(limpo) ? limpo : null;
}

/** Os sete dígitos da subclasse CNAE; a máscara (`1099-6/99`) sai, o resto é recusado. */
function codigoCnae(valor: unknown): string | null {
  const limpo = texto(valor)?.replace(/[.\-/\s]/g, "") ?? null;
  return limpo !== null && CNAE_CODE_PATTERN.test(limpo) ? limpo : null;
}

/**
 * Porte. "Não informado" é o código 00 da Receita — a ausência do dado escrita
 * por extenso. Guardá-lo como valor faria uma consulta sem porte parecer uma
 * informação nova, e substituir o porte que o cadastro já tinha.
 */
function porte(valor: unknown): string | null {
  if (palavra(valor) === "NAO INFORMADO") return null;
  return textoComTeto(valor, CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.companySize);
}

/**
 * Logradouro completo: o OpenCNPJ guarda o tipo separado do nome, como a base
 * da Receita — `AVENIDA` + `REPUBLICA DO CHILE`. Juntar é reconstruir o
 * campo, não reescrevê-lo; um dos dois vazio devolve o outro sozinho.
 */
function logradouroCompleto(tipo: string | null, nome: string | null): string | null {
  return texto([tipo, nome].filter(Boolean).join(" "));
}

/**
 * O telefone da empresa: o primeiro que NÃO é fax e que o Veridi aceitaria.
 *
 * O cadastro tem um campo de telefone e a fonte devolve uma lista. Fax não
 * serve para contato comercial, e número que a própria validação do Cliente
 * recusaria (DDD inexistente, tamanho errado) não é oferecido: aplicá-lo
 * encheria o formulário com um erro que o operador não tem como corrigir sem
 * apagar o que o sistema acabou de escrever.
 */
function telefonePrincipal(valor: unknown): string | null {
  if (!Array.isArray(valor)) return null;
  for (const entrada of valor) {
    if (typeof entrada !== "object" || entrada === null) continue;
    const registro = entrada as Record<string, unknown>;
    if (registro["is_fax"] === true) continue;
    const digitos = normalizePhone(`${texto(registro["ddd"]) ?? ""}${texto(registro["numero"]) ?? ""}`);
    if (isValidBrPhone(digitos)) return digitos;
  }
  return null;
}

/**
 * Descrição do CNAE principal.
 *
 * Vem de `cnaes[]`, que o payload real traz mas o schema publicado NÃO
 * declara (`additionalProperties: true`). Por isso é melhor-esforço puro: a
 * ausência não estraga nada — o código segue sem a descrição, e descrição
 * vazia da fonte nunca apaga a que o cadastro já guarda (§119).
 */
function descricaoDoCnaePrincipal(valor: unknown, codigoPrincipal: string | null): string | null {
  if (!Array.isArray(valor)) return null;
  for (const entrada of valor) {
    if (typeof entrada !== "object" || entrada === null) continue;
    const registro = entrada as Record<string, unknown>;
    const ehPrincipal =
      registro["is_principal"] === true ||
      (codigoPrincipal !== null && codigoCnae(registro["codigo"]) === codigoPrincipal);
    if (ehPrincipal) {
      return textoComTeto(registro["descricao"], CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.mainCnaeDescription);
    }
  }
  return null;
}

/** O payload do OpenCNPJ no contrato normalizado. Nenhuma chave crua atravessa. */
export function normalizarRespostaDoOpenCnpj(payload: unknown): CnpjLookupCompany {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new CnpjLookupUnavailableError("resposta do provedor não é um objeto");
  }
  const bruto = payload as Record<string, unknown>;

  const uf = texto(bruto["uf"]);
  const cnaePrincipal = codigoCnae(bruto["cnae_principal"]);

  return {
    legalName: texto(bruto["razao_social"]),
    tradeName: texto(bruto["nome_fantasia"]),
    registrationStatus: textoComTeto(
      bruto["situacao_cadastral"],
      CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.registrationStatus,
    ),
    registrationStatusDate: diaCivilDaFonte(bruto["data_situacao_cadastral"]),
    openedAt: diaCivilDaFonte(bruto["data_inicio_atividade"]),
    establishmentType: matrizOuFilial(bruto["matriz_filial"]),
    simplesOptIn: simOuNao(bruto["opcao_simples"]),
    meiOptIn: simOuNao(bruto["opcao_mei"]),
    // O Cliente guarda o CEP só com dígitos; a máscara é da tela.
    postalCode: texto((texto(bruto["cep"]) ?? "").replace(/\D/g, "")),
    street: logradouroCompleto(texto(bruto["tipo_logradouro"]), texto(bruto["logradouro"])),
    number: texto(bruto["numero"]),
    complement: texto(bruto["complemento"]),
    neighborhood: texto(bruto["bairro"]),
    city: texto(bruto["municipio"]),
    state: uf ? uf.toUpperCase() : null,
    phone: telefonePrincipal(bruto["telefones"]),
    email: texto(bruto["email"]),
    mainCnaeCode: cnaePrincipal,
    mainCnaeDescription: descricaoDoCnaePrincipal(bruto["cnaes"], cnaePrincipal),
    legalNature: textoComTeto(bruto["natureza_juridica"], CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.legalNature),
    companySize: porte(bruto["porte_empresa"]),
  };
}

export const openCnpjProvider: CnpjLookupProviderAdapter = {
  provider: "OPEN_CNPJ",

  async fetchCompany(cnpj: string): Promise<CnpjLookupCompany> {
    /*
     * A URL é montada a partir do CNPJ já normalizado e validado pelo serviço
     * (`^[0-9A-Z]{12}\d{2}$`): não há entrada arbitrária no caminho. O
     * `encodeURIComponent` fica como segunda barreira, para que uma mudança
     * futura na validação não vire injeção de caminho aqui.
     */
    const url = `${OPEN_CNPJ_BASE_URL}/${encodeURIComponent(cnpj)}?datasets=receita`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      });
    } catch (error) {
      // AbortError, DNS, TLS, conexão recusada: indistinguíveis para quem cadastra.
      throw new CnpjLookupUnavailableError(
        error instanceof Error ? `falha de rede: ${error.name}` : "falha de rede",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 404) throw new CnpjNotFoundError(cnpj);
    if (!response.ok) {
      // Inclui o 429 do limite de uso e o 400 de "invalid cnpj", que só
      // aconteceria se a validação local e a do provedor discordassem.
      throw new CnpjLookupUnavailableError(`HTTP ${response.status}`);
    }

    const corpo = await lerCorpoComTeto(response);

    let payload: unknown;
    try {
      payload = JSON.parse(corpo);
    } catch {
      throw new CnpjLookupUnavailableError("resposta não é JSON válido");
    }

    return normalizarRespostaDoOpenCnpj(payload);
  },
};
