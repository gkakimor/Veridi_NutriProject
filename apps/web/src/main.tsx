import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { instalarMensagensObrigatorias } from "./lib/native-validation-ptbr";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

// O sistema inteiro fala português — inclusive o balão de campo obrigatório.
instalarMensagensObrigatorias();

const container = document.getElementById("root");

if (!container) {
  throw new Error('Elemento #root nao encontrado em index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
