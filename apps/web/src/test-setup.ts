import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/*
 * Duas implementações de web API no mesmo ambiente.
 *
 * O `AbortController` do teste é o do jsdom; o `Request` é o do Node, e o do
 * Node recusa qualquer sinal que não tenha nascido dele — "Expected signal
 * (\"AbortSignal {}\") to be an instance of AbortSignal". O router de dados
 * monta um `Request` com sinal próprio a CADA navegação, então, sem isto,
 * nenhuma navegação chega ao fim em teste: a promessa rejeita e a tela nunca
 * troca. No navegador as duas metades são a mesma implementação e nada disso
 * acontece.
 *
 * Só o sinal incompatível é descartado, e só depois de a construção normal
 * falhar. Nada no app depende dele: não há `loader` nem `action`, que é para
 * onde esse sinal iria.
 */
const RequestDoNode = globalThis.Request;

function RequestTolerante(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
  try {
    return new RequestDoNode(input, init);
  } catch (erro) {
    if (!init?.signal) throw erro;
    const { signal: _incompativel, ...resto } = init;
    return new RequestDoNode(input, resto);
  }
}
RequestTolerante.prototype = RequestDoNode.prototype;
globalThis.Request = RequestTolerante as unknown as typeof Request;

afterEach(() => {
  cleanup();
});
