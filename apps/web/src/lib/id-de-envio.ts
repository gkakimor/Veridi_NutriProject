/**
 * Identificador de um envio de contagem — UUID v4 (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * É ele que torna o reenvio seguro: o servidor que já gravou aquele envio
 * devolve o registro existente, sem duplicar. Por isso o identificador nasce
 * ANTES do envio e fica na fila local junto da contagem.
 *
 * `crypto.randomUUID` só existe em contexto seguro (HTTPS ou localhost). O
 * tablet do depósito que abre o sistema por `http://<IP da rede local>` não
 * tem — e a contagem não pode depender disso. `crypto.getRandomValues` existe
 * em qualquer contexto, e com ele o UUID v4 sai na mão: 122 bits aleatórios,
 * versão 4 e variante RFC 4122 nos bits certos, que é o que o schema da API
 * aceita.
 */

type CryptoDisponivel = Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string };

function hex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

/** UUID v4 a partir de 16 bytes aleatórios — exportado para o teste provar o formato. */
export function uuidV4DeBytes(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error("UUID v4 precisa de 16 bytes");
  const b = Uint8Array.from(bytes);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // versão 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, hex).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function novoIdDeEnvio(fonte: CryptoDisponivel | undefined = globalThis.crypto): string {
  if (!fonte) throw new Error("Este navegador não oferece gerador aleatório seguro.");
  if (typeof fonte.randomUUID === "function") {
    try {
      return fonte.randomUUID();
    } catch {
      // Fora de contexto seguro alguns navegadores expõem a função e recusam a chamada.
    }
  }
  return uuidV4DeBytes(fonte.getRandomValues(new Uint8Array(16)));
}
