/**
 * Kit de ajuda contextual — porta de entrada única.
 *
 * A tela importa daqui e do registro de conteúdo (`help/help-content`);
 * nunca do arquivo de cada componente. Assim mover ou dividir um componente
 * não vira mutirão de imports pelas páginas.
 */
export { InfoHint } from "./InfoHint";
export { ContextHelp } from "./ContextHelp";
export { FlowSteps } from "./FlowSteps";
