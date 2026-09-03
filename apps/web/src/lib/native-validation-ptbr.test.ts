import { afterEach, describe, expect, it, vi } from "vitest";
import { instalarMensagensObrigatorias } from "./native-validation-ptbr";

/**
 * O defeito que estes testes fecham escapou de uma bateria de testes unitários
 * inteira, e vale entender por quê: o jsdom implementa `reportValidity()` como
 * um método que NÃO redispara o evento `invalid`. O navegador de verdade
 * redispara. A recursão só existia fora do ambiente de teste, e por isso
 * "os testes passam" significou "não reproduzimos" durante meses.
 *
 * A correção aqui é fazer o ambiente se comportar como o navegador: o primeiro
 * teste instala um `reportValidity` que dispara `invalid`, que é exatamente o
 * ciclo real. Com a chamada recursiva de volta no código, ele estoura a pilha.
 */

let desinstalar: (() => void) | null = null;

afterEach(() => {
  desinstalar?.();
  desinstalar = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Um formulário com dois campos obrigatórios vazios — o caso do login. */
function montarFormulario(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="f">
      <label for="email">E-mail</label>
      <input id="email" name="email" required />
      <label for="senha">Senha *</label>
      <input id="senha" name="senha" type="password" required />
      <label for="tipo">Tipo</label>
      <select id="tipo" name="tipo" required><option value="">—</option></select>
      <button type="submit">Entrar</button>
    </form>
  `;
  return document.getElementById("f") as HTMLFormElement;
}

describe("mensagens de campo obrigatório em português", () => {
  it("não recursa quando o navegador redispara invalid dentro de reportValidity", () => {
    montarFormulario();
    desinstalar = instalarMensagensObrigatorias();

    // O comportamento do navegador de verdade: revalidar dispara `invalid` de
    // novo. Se o handler chamar `reportValidity()`, isto é um laço infinito.
    let vezes = 0;
    const original = HTMLInputElement.prototype.reportValidity;
    HTMLInputElement.prototype.reportValidity = function reportValidityComEvento(this: HTMLInputElement) {
      vezes += 1;
      // Trava de segurança: sem ela o teste derruba o processo em vez de falhar.
      if (vezes > 50) throw new Error("recursão: reportValidity disparou invalid 50 vezes");
      this.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
      return false;
    };

    try {
      const campo = document.getElementById("email") as HTMLInputElement;
      expect(() => {
        campo.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
      }).not.toThrow();
      // O handler não pode ter chamado `reportValidity` nenhuma vez.
      expect(vezes).toBe(0);
    } finally {
      HTMLInputElement.prototype.reportValidity = original;
    }
  });

  it("traduz o campo obrigatório usando o próprio rótulo", () => {
    montarFormulario();
    desinstalar = instalarMensagensObrigatorias();

    const email = document.getElementById("email") as HTMLInputElement;
    email.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    expect(email.validationMessage).toBe('Preencha o campo "E-mail".');
  });

  it("tira o asterisco do rótulo obrigatório", () => {
    montarFormulario();
    desinstalar = instalarMensagensObrigatorias();

    const senha = document.getElementById("senha") as HTMLInputElement;
    senha.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    expect(senha.validationMessage).toBe('Preencha o campo "Senha".');
  });

  it("select pede para selecionar, input pede para preencher", () => {
    montarFormulario();
    desinstalar = instalarMensagensObrigatorias();

    const tipo = document.getElementById("tipo") as HTMLSelectElement;
    tipo.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    expect(tipo.validationMessage).toBe('Selecione uma opção em "Tipo".');
  });

  it("dois campos vazios geram duas mensagens e nenhuma exceção", () => {
    montarFormulario();
    desinstalar = instalarMensagensObrigatorias();

    const email = document.getElementById("email") as HTMLInputElement;
    const senha = document.getElementById("senha") as HTMLInputElement;

    expect(() => {
      email.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
      senha.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    }).not.toThrow();

    expect(email.validationMessage).toContain("E-mail");
    expect(senha.validationMessage).toContain("Senha");
  });

  it("digitar limpa a mensagem — sem isso o campo seguiria inválido depois de preenchido", () => {
    montarFormulario();
    desinstalar = instalarMensagensObrigatorias();

    const email = document.getElementById("email") as HTMLInputElement;
    email.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    expect(email.validationMessage).not.toBe("");

    email.value = "alguem@exemplo.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    expect(email.validationMessage).toBe("");
  });

  it("não toca em validação que não é campo vazio", () => {
    document.body.innerHTML = `
      <form><label for="n">Número</label><input id="n" type="number" min="10" value="5" /></form>
    `;
    desinstalar = instalarMensagensObrigatorias();

    const campo = document.getElementById("n") as HTMLInputElement;
    campo.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    // Faixa e formato têm mensagem própria do navegador: o handler sai fora.
    expect(campo.validationMessage).not.toContain("Preencha o campo");
  });

  it("desinstalar remove os três ouvintes", () => {
    montarFormulario();
    const remover = instalarMensagensObrigatorias();
    remover();

    const email = document.getElementById("email") as HTMLInputElement;
    email.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    // Volta a mensagem nativa do ambiente — o que importa é não ser mais a
    // tradução, provando que o ouvinte saiu.
    expect(email.validationMessage).not.toContain("Preencha o campo");
  });
});
