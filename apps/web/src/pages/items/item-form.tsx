import { useState } from "react";
import type { FormEvent } from "react";
import type { ItemDTO, ItemType, UnitOfMeasureDTO } from "@veridi/shared";
import {
  ITEM_LABEL_FILE_ACCEPT,
  ITEM_LABEL_FILE_UPLOAD_ROLES,
  ITEM_TYPE_DEFAULTS,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  ITEM_FAMILIES,
  ITEM_FAMILY_LABELS,
  PACKAGING_SUBTYPES,
  PACKAGING_SUBTYPE_LABELS,
} from "@veridi/shared";
import { createItem, updateItem } from "../../lib/items-api";
import { uploadItemLabelFileVersion } from "../../lib/item-label-files-api";
import { useCallback, useRef } from "react";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { assinaturaDoFormulario } from "../../lib/dirty-fields";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import {
  LIMITE_DO_ARQUIVO_DO_ROTULO_EM_MB,
  problemaDoArquivoDoRotulo,
  useAutoridadeNoArquivoDoRotulo,
} from "../../lib/arquivo-do-rotulo";
import { formatFileSize } from "../../lib/file-size";
import { perfisPorExtenso } from "../../lib/perfis";
import {
  formatDecimalPtBr,
  numericInvalidMessage,
  parsePtBrNumber,
  toPtBrEditText,
} from "../../lib/numeric-ptbr";
import {
  CASAS_CUSTO_UNITARIO,
  CASAS_PERCENTUAL_TECNICO,
  OPCOES_CUSTO_UNITARIO,
  OPCOES_PERCENTUAL_TECNICO,
} from "../../lib/numeric-scales";
import { MoneyField, PercentField } from "../../components/NumericField";
import { RelatedLinks } from "../../components/RelatedLinks";
import { FormSection } from "../../components/FormSection";
import { ItemLabelFileSection } from "../../components/ItemLabelFileSection";
import { ToggleCard } from "../../components/ToggleCard";
import {
  QUEM_ALTERA_CONTROLES_DO_ITEM,
  QUEM_EDITA_ITEM,
  QUEM_MARCA_CONSUMO_NA_PRODUCAO,
  useAutoridadeNoItem,
} from "./item-permissions";

/**
 * O formulário de Item de estoque, uma vez só.
 *
 * Existe porque o cadastro passou a ter duas portas: o modal, aberto de
 * dentro de outra tela, e a página `/cadastros/itens/novo`, que tem URL
 * própria e por isso sobrevive a refresh e a link direto. Duas
 * implementações dos mesmos campos divergiriam — e uma delas acabaria
 * oferecendo Produto acabado na criação manual, que é justamente o que este
 * cadastro não pode fazer.
 *
 * A divisão é a que o HTML já permitia: `useItemForm` guarda estado, payload
 * e submit; `ItemFormFields` desenha os campos dentro do `<form>`; e quem
 * hospeda monta o próprio rodapé. O botão de commit não precisa estar dentro
 * do `<form>` — `type="submit" form="item-form"` aciona um formulário em que
 * o botão não está aninhado. Por isso o rodapé precisa de UMA coisa daqui:
 * `saving`.
 *
 * As unidades entram por parâmetro em vez de serem carregadas aqui: a
 * listagem já as tinha em mãos para o modal, e um `fetch` dentro do
 * formulário faria a mesma chamada duas vezes na mesma tela.
 */

/** O `<form>` que o botão de commit aciona pelo atributo `form`. */
export const ITEM_FORM_ID = "item-form";

/** Os campos que são NÚMERO — comparados pelo valor, não pelo texto. */
const DECIMAIS = ["defaultPurityPercent", "initialCostReference"] as const;

/**
 * Os tipos que a criação manual oferece.
 *
 * Produto acabado sai da lista: ele nasce junto com o Produto, que é quem tem
 * cliente, formulação e custo. Criar o item solto produzia um acabado sem
 * dono, e a dúvida "preciso cadastrar o produto acabado duas vezes?".
 *
 * Uma lista só, usada pelo seletor e por quem valida o tipo pré-escolhido:
 * duas listas divergiriam, e a divergência apareceria como um acabado criado
 * por um caminho que ninguém revisou.
 */
export const CREATABLE_ITEM_TYPES: readonly ItemType[] = ITEM_TYPES.filter(
  (type) => type !== "FINISHED_PRODUCT",
);

/**
 * O tipo pré-escolhido que chega pela URL (`?tipo=RAW_MATERIAL`).
 *
 * Conveniência para quem saiu de um campo que só aceita matéria-prima — não
 * regra: valor desconhecido, ou de um tipo que a criação manual não oferece,
 * é simplesmente ignorado e a tela se comporta como criação normal. Quem
 * decide o que é aceito continua sendo o servidor.
 */
export function parseCreatableItemType(raw: string | null | undefined): ItemType | null {
  if (!raw) return null;
  return CREATABLE_ITEM_TYPES.find((type) => type === raw) ?? null;
}

interface FormState {
  type: ItemType | "";
  name: string;
  unitCode: string;
  controlsLot: boolean;
  controlsExpiry: boolean;
  requiresQualityRelease: boolean;
  requiresCoa: boolean;
  sourceName: string;
  declaredNutrient: string;
  family: string;
  defaultPurityPercent: string;
  packagingSubtype: string;
  consumedInProduction: boolean;
  externalBarcode: string;
  /** Só na criação. Vazio = sem referência; o item continua válido. */
  initialCostReference: string;
  initialCostReferenceNote: string;
}

/**
 * Os campos que pertencem a um tipo só — ITEM-FORM-BY-TYPE-01.
 *
 * O Tipo decide o formulário, nunca a Família: a matéria-prima tem a
 * classificação que a formulação lê; a embalagem, o subtipo e a marca de
 * consumo. Na criação, trocar de tipo devolve ao vazio os campos dos outros
 * tipos — dado que a tela escondeu não pode seguir no envio. Um tipo novo
 * ganha aqui os seus campos e, no formulário, a sua seção.
 *
 * Tipo SEM campo próprio fica de fora deste mapa e ainda assim pode ter
 * seção: uso e consumo é o caso — não há campo dele para limpar, e a seção
 * existe para dizer o alcance do tipo (INTERNAL-CONSUMABLE-ITEM-TYPE-01).
 */
const CAMPOS_PROPRIOS_DO_TIPO: Partial<Record<ItemType, Partial<FormState>>> = {
  RAW_MATERIAL: { sourceName: "", declaredNutrient: "", family: "", defaultPurityPercent: "" },
  PACKAGING: { packagingSubtype: "", consumedInProduction: false },
};

/** Os campos dos OUTROS tipos, vazios — o que a troca para `tipo` limpa. */
function camposDosOutrosTipos(tipo: ItemType): Partial<FormState> {
  return Object.entries(CAMPOS_PROPRIOS_DO_TIPO)
    .filter(([dono]) => dono !== tipo)
    .reduce<Partial<FormState>>((vazios, [, campos]) => ({ ...vazios, ...campos }), {});
}

/** O Item foi criado e o arquivo do Rótulo escolhido na criação não subiu. */
export interface ItemCriadoSemArquivo {
  item: ItemDTO;
  /** Por que o envio caiu, na língua da API. */
  motivo: string;
  /** Uma nova tentativa, pela seção do Item criado, já enviou o arquivo. */
  reenviado: boolean;
}

function initialState(item: ItemDTO | null, initialType: ItemType | null): FormState {
  if (item) {
    return {
      type: item.type,
      name: item.name,
      unitCode: item.unitCode,
      controlsLot: item.controlsLot,
      controlsExpiry: item.controlsExpiry,
      requiresQualityRelease: item.requiresQualityRelease,
      requiresCoa: item.requiresCoa,
      sourceName: item.sourceName ?? "",
      declaredNutrient: item.declaredNutrient ?? "",
      family: item.family ?? "",
      defaultPurityPercent: toPtBrEditText(item.defaultPurityPercent, OPCOES_PERCENTUAL_TECNICO),
      packagingSubtype: item.packagingSubtype ?? "",
      consumedInProduction: item.consumedInProduction,
      externalBarcode: item.externalBarcode ?? "",
      initialCostReference: "",
      initialCostReferenceNote: "",
    };
  }
  /*
   * Tipo pré-escolhido traz os mesmos defaults que trazia se tivesse sido
   * escolhido no seletor. Sem isto, chegar por `?tipo=PACKAGING` daria um
   * item com controles de matéria-prima — a URL mudaria o cadastro, não só o
   * caminho até ele.
   */
  const defaults = initialType ? ITEM_TYPE_DEFAULTS[initialType] : null;
  return {
    type: initialType ?? "",
    name: "",
    unitCode: "",
    controlsLot: defaults?.controlsLot ?? true,
    controlsExpiry: defaults?.controlsExpiry ?? true,
    requiresQualityRelease: defaults?.requiresQualityRelease ?? true,
    // Exigir laudo é decisão explícita — nunca inferida do tipo do item.
    requiresCoa: false,
    sourceName: "",
    declaredNutrient: "",
    family: "",
    defaultPurityPercent: "",
    packagingSubtype: "",
    // Nunca inferido do tipo: declarar que o material entra no processo é
    // escolha de quem cadastra, e o default preserva a embalagem comercial.
    consumedInProduction: false,
    externalBarcode: "",
    initialCostReference: "",
    initialCostReferenceNote: "",
  };
}

export function useItemForm({
  mode,
  item,
  units,
  initialType = null,
  onSaved,
  readOnly = false,
}: {
  mode: "create" | "edit";
  item: ItemDTO | null;
  units: UnitOfMeasureDTO[];
  /** Tipo já escolhido ao abrir. Só a criação usa; a edição parte do item. */
  initialType?: ItemType | null;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: ItemDTO) => void;
  /**
   * Consulta: o perfil não edita o Item (MASTER-DATA-EDIT-PERMISSIONS-01). Os
   * campos viram valores e nada é enviado — a API recusaria com 403.
   */
  readOnly?: boolean;
}) {
  const [form, setForm] = useState<FormState>(() =>
    initialState(item, mode === "create" ? initialType : null),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /*
   * Dentro do cadastro, três partes têm dono mais estreito. Quem edita o Item
   * sem ser o dono vê o valor e não o altera: os controles ficam com a
   * Qualidade (e, na criação, no padrão do tipo), a marca de consumo com a
   * Produção, e o custo inicial nem é oferecido fora do custeio.
   */
  const autoridade = useAutoridadeNoItem();
  const controlesTravadosPorPerfil = !autoridade.controles;
  const consumoTravadoPorPerfil = !autoridade.consumoNaProducao;
  const ofereceCustoInicial = autoridade.custoDeReferencia;

  const structuralLocked = mode === "edit" && (item?.operationallyUsed ?? false);

  /*
   * Arquivo do Rótulo escolhido na criação (ITEM-FORM-BY-TYPE-01). Fica só na
   * tela: o envio precisa do id, e o id só existe depois de criar. Nada sobe
   * antes do Item existir, e nada sobe se o subtipo deixou de ser Rótulo. O
   * envio é o da seção do Item gravado — mesma rota, mesmas regras.
   */
  const autoridadeNoArquivo = useAutoridadeNoArquivoDoRotulo();
  const [arquivoDoRotulo, setArquivoDoRotulo] = useState<File | null>(null);
  const [erroDoArquivoDoRotulo, setErroDoArquivoDoRotulo] = useState<string | null>(null);
  const [arquivoDoRotuloDescartado, setArquivoDoRotuloDescartado] = useState(false);
  /**
   * Criou e o arquivo não subiu. Daqui em diante a tela não cria mais nada:
   * mostra o Item criado e a seção oficial do arquivo para tentar de novo.
   */
  const [criadoSemArquivo, setCriadoSemArquivo] = useState<ItemCriadoSemArquivo | null>(null);

  /** Embalagem com subtipo Rótulo, pelo tipo e pelo subtipo — nunca pelo nome. */
  const rotuloNaCriacao =
    mode === "create" && form.type === "PACKAGING" && form.packagingSubtype === "LABEL";

  /**
   * O cadastro como ele está na tela, em forma comparável.
   *
   * Pureza e custo de referência inicial são NÚMERO: `98` e `98,0` são o mesmo
   * item, e perguntar por causa do separador ensinaria a ignorar a pergunta
   * que importa. Código e situação não estão aqui porque não se editam: o
   * código nasce no servidor e ativar/inativar é ação com confirmação própria.
   */
  const assinaturaAtual = assinaturaDoFormulario(form, DECIMAIS);

  /*
   * A referência da comparação: o formulário como ele abriu. Criar parte dos
   * defaults canônicos, editar parte do registro carregado — e ABRIR não é
   * alterar em nenhum dos dois.
   */
  const baseline = useRef(assinaturaAtual);

  /*
   * Arquivo do Rótulo escolhido não precisa entrar aqui: ele só existe com o
   * subtipo Rótulo, e a criação sempre abre sem subtipo — já está sujo.
   */
  const { confirmarDescarte, liberarGuarda } = useUnsavedChangesGuard({
    isDirty: baseline.current !== assinaturaAtual,
    substantivo: "item",
  });

  /**
   * Cancelar, ✕ e Esc: o router não vê nada disso — a guarda vê.
   *
   * Memorizado porque vai para `onClose` do modal, e `onClose` novo a cada
   * renderização é o defeito que a Wave 01 fechou.
   */
  const confirmarSaida = useCallback(
    (acao: () => void) => confirmarDescarte(acao),
    [confirmarDescarte],
  );

  /** Gravou: o que está na tela virou registro, e sair dele não perde nada. */
  function concluir(acao: () => void) {
    baseline.current = assinaturaAtual;
    liberarGuarda(acao);
  }
  const structuralLockHint =
    "Este campo não pode ser alterado porque o item já possui histórico operacional.";

  function handleTypeChange(nextType: ItemType) {
    if (mode === "edit") {
      /*
       * Na edição nada some do registro: o que o tipo novo não mostra fica como
       * está gravado — a API só recebe os campos que a tela mostra. Item com
       * histórico nem chega aqui: o tipo trava.
       */
      setForm((prev) => ({ ...prev, type: nextType }));
      return;
    }
    const defaults = ITEM_TYPE_DEFAULTS[nextType];
    setForm((prev) => ({
      ...prev,
      type: nextType,
      controlsLot: defaults.controlsLot,
      controlsExpiry: defaults.controlsExpiry,
      requiresQualityRelease: defaults.requiresQualityRelease,
      ...camposDosOutrosTipos(nextType),
    }));
    if (nextType !== "PACKAGING") descartarArquivoDoRotulo(false);
  }

  /**
   * Tira o arquivo escolhido na criação. `avisar` quando a pessoa não pediu —
   * o subtipo mudou e o arquivo saiu junto com a seção.
   */
  function descartarArquivoDoRotulo(avisar: boolean) {
    setArquivoDoRotuloDescartado(avisar && arquivoDoRotulo !== null);
    setArquivoDoRotulo(null);
    setErroDoArquivoDoRotulo(null);
  }

  function handlePackagingSubtypeChange(nextSubtype: string) {
    setForm((prev) => ({ ...prev, packagingSubtype: nextSubtype }));
    // Arquivo escondido não viaja: deixou de ser Rótulo, o arquivo escolhido sai.
    if (nextSubtype !== "LABEL") descartarArquivoDoRotulo(true);
    else setArquivoDoRotuloDescartado(false);
  }

  /** Recusa na hora o que a API recusaria, e guarda o arquivo para depois de criar. */
  function escolherArquivoDoRotulo(arquivo: File | null) {
    setArquivoDoRotuloDescartado(false);
    setArquivoDoRotulo(arquivo);
    setErroDoArquivoDoRotulo(arquivo ? problemaDoArquivoDoRotulo(arquivo) : null);
  }

  /** Sai do Item criado sem o arquivo para o mesmo destino de uma criação completa. */
  function concluirCriacao() {
    if (criadoSemArquivo) onSaved(criadoSemArquivo.item);
  }

  function registrarReenvioDoArquivo() {
    setCriadoSemArquivo((atual) => (atual ? { ...atual, reenviado: true } : atual));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Item já criado nunca é criado de novo, nem por um Enter perdido.
    if (readOnly || criadoSemArquivo) return;
    if (!form.type) {
      setError("Selecione o tipo do item.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const materiaPrima = form.type === "RAW_MATERIAL";
    const embalagem = form.type === "PACKAGING";

    /*
     * Pureza passa pelo parser central — mesma leitura da vírgula em toda a
     * web. Vazio continua sendo vazio (no edit é o que limpa o campo); o que
     * o parser não consegue ler para aqui, com o nome do campo. Só a
     * matéria-prima tem pureza: em outro tipo o campo nem está na tela.
     */
    const pureza = parsePtBrNumber(
      materiaPrima ? form.defaultPurityPercent : "",
      OPCOES_PERCENTUAL_TECNICO,
    );
    if (pureza.tipo === "invalido") {
      setFieldErrors({
        defaultPurityPercent: numericInvalidMessage(
          "Pureza padrão (%)",
          pureza.motivo,
          OPCOES_PERCENTUAL_TECNICO,
        ),
      });
      setError("Corrija os campos destacados.");
      setSaving(false);
      return;
    }
    const purezaNormalizada = pureza.tipo === "valido" ? pureza.valor : "";

    // Referência inicial passa pelo mesmo parser de decimal da pureza. Vazio
    // é "sem referência" — nunca zero.
    const referencia = parsePtBrNumber(form.initialCostReference, OPCOES_CUSTO_UNITARIO);
    if (referencia.tipo === "invalido") {
      setFieldErrors({
        initialCostReference: numericInvalidMessage(
          "Custo de referência inicial",
          referencia.motivo,
          OPCOES_CUSTO_UNITARIO,
        ),
      });
      setError("Corrija os campos destacados.");
      setSaving(false);
      return;
    }
    const referenciaNormalizada = referencia.tipo === "valido" ? referencia.valor : "";

    /*
     * O arquivo do Rótulo é conferido ANTES de criar: recusado depois, o Item
     * já existiria sem o arquivo que a pessoa escolheu. Quem não envia arquivo
     * de rótulo nem recebe o campo — e aqui o arquivo também não passa.
     */
    const arquivoParaEnviar =
      rotuloNaCriacao && autoridadeNoArquivo.enviar ? arquivoDoRotulo : null;
    const problemaDoArquivo = arquivoParaEnviar ? problemaDoArquivoDoRotulo(arquivoParaEnviar) : null;
    if (problemaDoArquivo) {
      setErroDoArquivoDoRotulo(problemaDoArquivo);
      setError("Corrija os campos destacados.");
      setSaving(false);
      return;
    }

    const trimmedBarcode = form.externalBarcode.trim();
    const payload = {
      type: form.type,
      name: form.name.trim(),
      unitCode: form.unitCode,
      controlsLot: form.controlsLot,
      controlsExpiry: form.controlsExpiry,
      requiresQualityRelease: form.requiresQualityRelease,
      requiresCoa: form.requiresCoa,
      /*
       * Só viaja o que a tela mostra para o tipo (ITEM-FORM-BY-TYPE-01). Na
       * matéria-prima o edit sempre envia (mesmo vazio) para permitir limpar;
       * o create só quando preenchido. Vazio vira null — nunca um default
       * silencioso. Nos outros tipos a classificação nem viaja: na criação
       * está vazia, e na edição o gravado fica como está.
       */
      ...(materiaPrima && (mode === "edit" || form.sourceName.trim())
        ? { sourceName: form.sourceName.trim() }
        : {}),
      ...(materiaPrima && (mode === "edit" || form.declaredNutrient.trim())
        ? { declaredNutrient: form.declaredNutrient.trim() }
        : {}),
      ...(materiaPrima && (mode === "edit" || form.family) ? { family: form.family } : {}),
      ...(materiaPrima && (mode === "edit" || form.defaultPurityPercent.trim())
        ? { defaultPurityPercent: purezaNormalizada }
        : {}),
      ...(mode === "edit" || (embalagem && form.packagingSubtype)
        ? { packagingSubtype: embalagem ? form.packagingSubtype : "" }
        : {}),
      // A marca só é oferecida na embalagem, onde a ambiguidade existe; trocar
      // o tipo depois de marcá-la não pode deixar a marca para trás.
      ...(mode === "edit" || (embalagem && form.consumedInProduction)
        ? { consumedInProduction: embalagem && form.consumedInProduction }
        : {}),
      // No edit sempre envia a chave (mesmo vazia) para permitir limpar um
      // barcode existente; no create so envia quando preenchido.
      ...(mode === "edit" || trimmedBarcode
        ? { externalBarcode: trimmedBarcode }
        : {}),
    };

    try {
      if (mode === "create") {
        const created = await createItem({
          ...payload,
          ...(referenciaNormalizada && ofereceCustoInicial
            ? {
                initialCostReference: {
                  unitCost: referenciaNormalizada,
                  uomCode: form.unitCode,
                  ...(form.initialCostReferenceNote.trim()
                    ? { note: form.initialCostReferenceNote.trim() }
                    : {}),
                },
              }
            : {}),
        });
        if (arquivoParaEnviar) {
          try {
            await uploadItemLabelFileVersion(created.id, arquivoParaEnviar);
          } catch (err) {
            /*
             * O Item EXISTE. Nada de "falha ao criar", nada de criar de novo: a
             * tela deixa de ser criação, e o arquivo segue pela seção oficial
             * do Item criado. O que estava na tela virou registro — sair não
             * perde nada.
             */
            baseline.current = assinaturaAtual;
            setArquivoDoRotulo(null);
            setCriadoSemArquivo({
              item: created,
              motivo: apiErrorMessage(err, "Falha ao enviar o arquivo."),
              reenviado: false,
            });
            return;
          }
        }
        concluir(() => onSaved(created));
      } else if (item) {
        await updateItem(item.id, payload);
        concluir(() => onSaved());
      } else {
        concluir(() => onSaved());
      }
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          nextFieldErrors[issue.path] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao salvar item");
      }
    } finally {
      setSaving(false);
    }
  }

  return {
    form,
    setForm,
    saving,
    confirmarSaida,
    liberarGuarda,
    error,
    fieldErrors,
    handleTypeChange,
    handlePackagingSubtypeChange,
    handleSubmit,
    structuralLocked,
    structuralLockHint,
    controlesTravadosPorPerfil,
    consumoTravadoPorPerfil,
    ofereceCustoInicial,
    rotuloNaCriacao,
    podeEnviarArquivoDoRotulo: autoridadeNoArquivo.enviar,
    arquivoDoRotulo,
    erroDoArquivoDoRotulo,
    arquivoDoRotuloDescartado,
    escolherArquivoDoRotulo,
    removerArquivoDoRotulo: () => descartarArquivoDoRotulo(false),
    criadoSemArquivo,
    concluirCriacao,
    registrarReenvioDoArquivo,
    mode,
    item,
    units,
    readOnly,
  };
}

export type ItemFormController = ReturnType<typeof useItemForm>;

/** Estoque, lotes, movimentações e fornecedores do item — iguais em edição e em consulta. */
function AtalhosDoItem({ item }: { item: ItemDTO }) {
  return (
    <RelatedLinks
      links={[
        // Estoque do item tem tela própria: melhor destino que uma lista
        // filtrada.
        { label: "Estoque", to: `/estoque/${item.id}` },
        { label: "Lotes", to: `/estoque/lotes?itemId=${item.id}` },
        { label: "Movimentações", to: `/estoque/movimentacoes?itemId=${item.id}` },
        { label: "Fornecedores do item", to: `/compras/item-fornecedor?itemId=${item.id}` },
      ]}
    />
  );
}

function StatusDoItem({ item }: { item: ItemDTO }) {
  return (
    <FormSection title="Status">
      <div className="status-line">
        <span className={item.active ? "badge badge--active" : "badge badge--inactive"}>
          {item.active ? "Ativo" : "Inativo"}
        </span>
        <span className="field__hint">
          Use "Inativar"/"Reativar" na lista para alterar o status. Itens
          inativos continuam visíveis no histórico.
        </span>
      </div>
    </FormSection>
  );
}

/** Um campo em consulta: o mesmo rótulo do formulário e o valor, sem caixa de edição. */
function ValorConsultado({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{valor?.trim() ? valor : "—"}</dd>
    </>
  );
}

const simOuNao = (valor: boolean) => (valor ? "Sim" : "Não");

const SUBTITULO_DOS_DADOS_DA_EMBALAGEM =
  "Subtipo da embalagem e se ela é consumida no processo de produção.";

const SUBTITULO_DOS_DADOS_DE_USO_E_CONSUMO =
  "Onde este material entra e onde ele não entra (INTERNAL-CONSUMABLE-ITEM-TYPE-01).";

/**
 * O alcance do tipo Uso e consumo, dito na tela.
 *
 * A seção própria dele não tem campo nenhum: a diferença entre uso e consumo e
 * os outros tipos não está no cadastro, está no que o sistema FAZ com o item.
 * Sem esta seção a pessoa escolheria o tipo pelo nome e descobriria só na
 * Formulação que o item não aparece lá. Uma lista só, usada na criação, na
 * edição e na consulta — três cópias divergiriam.
 */
const USO_E_CONSUMO_ENTRA =
  "Compra e fornecedores, recebimento, estoque, inventário e custo de aquisição.";

const USO_E_CONSUMO_NAO_ENTRA =
  "Formulação, Modelo de Formulação, Produto acabado, CMV industrial, Amostra, " +
  "sugestão de compra da produção e material fornecido pelo cliente.";

/**
 * O Item foi criado e o arquivo do Rótulo não subiu — ITEM-FORM-BY-TYPE-01.
 *
 * A tela deixa de ser criação: sem formulário e sem "Criar item" que
 * duplicaria o cadastro. Fica o Item criado e a seção oficial do arquivo, já
 * aberta para tentar de novo. Quem hospeda troca o rodapé por "Concluir".
 */
function ItemCriadoSemArquivoDoRotulo({
  criado,
  onReenviado,
}: {
  criado: ItemCriadoSemArquivo;
  onReenviado: () => void;
}) {
  const { item, motivo, reenviado } = criado;
  return (
    <div>
      {!reenviado && (
        <>
          <p className="form-alert" role="alert">
            Item criado, mas o arquivo do rótulo não pôde ser enviado. {motivo}
          </p>
          <p className="field__hint">
            Tente de novo em "Arquivo do rótulo", abaixo, ou conclua e envie depois pelo cadastro
            do item.
          </p>
        </>
      )}

      <FormSection title="Item criado" subtitle="O cadastro já existe e não precisa ser criado de novo.">
        <dl className="definition-list">
          <ValorConsultado rotulo="Código" valor={item.code} />
          <ValorConsultado rotulo="Nome" valor={item.name} />
          <ValorConsultado rotulo="Tipo" valor={ITEM_TYPE_LABELS[item.type]} />
          <ValorConsultado
            rotulo="Subtipo de embalagem"
            valor={item.packagingSubtype ? PACKAGING_SUBTYPE_LABELS[item.packagingSubtype] : null}
          />
        </dl>
      </FormSection>

      <ItemLabelFileSection itemId={item.id} abrirNovaVersao onVersaoEnviada={onReenviado} />
    </div>
  );
}

/**
 * O Item em CONSULTA — MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * Mesmas seções, mesma ordem e mesmos rótulos do formulário, com os valores no
 * lugar das caixas: quem não edita o Item lê tudo o que o formulário mostraria,
 * sem campo que aceite digitação e sem "Salvar alterações" que terminaria em
 * 403. Fornecedores e custo de referência vêm do modal, com as regras deles.
 */
function ItemConsultaFields({ item }: { item: ItemDTO }) {
  return (
    <div>
      <AtalhosDoItem item={item} />

      <p className="field__hint">
        Consulta. Só os perfis {QUEM_EDITA_ITEM} alteram o cadastro do item.
      </p>

      <FormSection
        title="Identificação"
        subtitle="Dados básicos do item usados em compras, estoque e produção."
      >
        <dl className="definition-list">
          <ValorConsultado rotulo="Tipo" valor={ITEM_TYPE_LABELS[item.type]} />
          <ValorConsultado rotulo="Unidade" valor={`${item.unit.code} — ${item.unit.label}`} />
          <ValorConsultado rotulo="Nome" valor={item.name} />
        </dl>
      </FormSection>

      {/* A mesma seção por tipo do formulário (ITEM-FORM-BY-TYPE-01). */}
      {item.type === "RAW_MATERIAL" && (
        <FormSection
          title="Classificação industrial"
          subtitle="Fonte, nutriente declarado e pureza padrão usados pela formulação."
        >
          <dl className="definition-list">
            <ValorConsultado rotulo="Fonte" valor={item.sourceName} />
            <ValorConsultado rotulo="Nutriente declarado" valor={item.declaredNutrient} />
            <ValorConsultado
              rotulo="Família"
              valor={item.family ? ITEM_FAMILY_LABELS[item.family] : "Não informada"}
            />
            {/* Pureza sem valor é DESCONHECIDA — nunca 100%. */}
            <ValorConsultado
              rotulo="Pureza padrão (%)"
              valor={
                item.defaultPurityPercent
                  ? formatDecimalPtBr(item.defaultPurityPercent, OPCOES_PERCENTUAL_TECNICO)
                  : "Desconhecida"
              }
            />
          </dl>
        </FormSection>
      )}

      {item.type === "PACKAGING" && (
        <FormSection title="Dados da embalagem" subtitle={SUBTITULO_DOS_DADOS_DA_EMBALAGEM}>
          <dl className="definition-list">
            <ValorConsultado
              rotulo="Subtipo de embalagem"
              valor={
                item.packagingSubtype
                  ? PACKAGING_SUBTYPE_LABELS[item.packagingSubtype]
                  : "Não informado"
              }
            />
            <ValorConsultado
              rotulo="Consumido na produção"
              valor={simOuNao(item.consumedInProduction)}
            />
          </dl>
        </FormSection>
      )}

      {item.type === "INTERNAL_CONSUMABLE" && (
        <FormSection
          title="Dados de uso e consumo"
          subtitle={SUBTITULO_DOS_DADOS_DE_USO_E_CONSUMO}
        >
          <dl className="definition-list">
            <ValorConsultado rotulo="Entra em" valor={USO_E_CONSUMO_ENTRA} />
            <ValorConsultado rotulo="Não entra em" valor={USO_E_CONSUMO_NAO_ENTRA} />
          </dl>
        </FormSection>
      )}

      <FormSection
        title="Controles de rastreabilidade"
        subtitle="Definem como o estoque deste item será acompanhado."
      >
        <dl className="definition-list">
          <ValorConsultado rotulo="Controla lote" valor={simOuNao(item.controlsLot)} />
          <ValorConsultado rotulo="Controla validade" valor={simOuNao(item.controlsExpiry)} />
          <ValorConsultado
            rotulo="Requer liberação da Qualidade"
            valor={simOuNao(item.requiresQualityRelease)}
          />
          <ValorConsultado rotulo="Exige CoA / Laudo" valor={simOuNao(item.requiresCoa)} />
        </dl>
      </FormSection>

      <FormSection
        title="Códigos"
        subtitle="Identificadores externos para leitura no recebimento."
      >
        <dl className="definition-list">
          <ValorConsultado rotulo="Barcode externo" valor={item.externalBarcode} />
        </dl>
      </FormSection>

      <StatusDoItem item={item} />
    </div>
  );
}

export function ItemFormFields({
  form,
  setForm,
  error,
  fieldErrors,
  handleTypeChange,
  handlePackagingSubtypeChange,
  handleSubmit,
  structuralLocked,
  structuralLockHint,
  controlesTravadosPorPerfil,
  consumoTravadoPorPerfil,
  ofereceCustoInicial,
  rotuloNaCriacao,
  podeEnviarArquivoDoRotulo,
  arquivoDoRotulo,
  erroDoArquivoDoRotulo,
  arquivoDoRotuloDescartado,
  escolherArquivoDoRotulo,
  removerArquivoDoRotulo,
  criadoSemArquivo,
  registrarReenvioDoArquivo,
  mode,
  item,
  units,
  readOnly,
}: ItemFormController) {
  if (readOnly && item) return <ItemConsultaFields item={item} />;
  if (criadoSemArquivo) {
    return (
      <ItemCriadoSemArquivoDoRotulo criado={criadoSemArquivo} onReenviado={registrarReenvioDoArquivo} />
    );
  }

  /** Liga input, `aria-invalid` e a mensagem, para leitor de tela também. */
  function fieldProps(field: string) {
    const message = fieldErrors[field];
    return {
      ...(message ? { "aria-invalid": true as const } : {}),
      ...(message ? { "aria-describedby": `item-${field}-error` } : {}),
    };
  }

  function fieldError(field: string) {
    const message = fieldErrors[field];
    if (!message) return null;
    return (
      <p className="field__error" id={`item-${field}-error`}>
        {message}
      </p>
    );
  }

  return (
    <form id={ITEM_FORM_ID} onSubmit={handleSubmit}>
      {error && <p className="form-alert" role="alert">{error}</p>}

      {item && <AtalhosDoItem item={item} />}

      <FormSection
        title="Identificação"
        subtitle="Dados básicos do item usados em compras, estoque e produção."
      >
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="item-type">
              Tipo <span className="req">*</span>
            </label>
            <select
              id="item-type"
              required
              disabled={structuralLocked}
              value={form.type}
              onChange={(event) => handleTypeChange(event.target.value as ItemType)}
              {...fieldProps("type")}
            >
              <option value="" disabled>
                Selecione…
              </option>
              {/*
               * Na EDIÇÃO o tipo continua aparecendo inteiro — item já
               * existente não pode perder a própria identidade na tela.
               * Na criação vale `CREATABLE_ITEM_TYPES`, sem Produto acabado.
               */}
              {(mode === "edit" ? ITEM_TYPES : CREATABLE_ITEM_TYPES).map((value) => (
                <option key={value} value={value}>
                  {ITEM_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
            {mode === "create" && (
              <p className="field__hint">
                Produtos acabados são criados automaticamente pelo cadastro
                de Produtos.
              </p>
            )}
            {fieldError("type")}
            {structuralLocked && <p className="field__hint">{structuralLockHint}</p>}
          </div>

          <div className="field">
            <label htmlFor="item-unit">
              Unidade <span className="req">*</span>
            </label>
            <select
              id="item-unit"
              required
              disabled={structuralLocked}
              value={form.unitCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, unitCode: event.target.value }))
              }
              {...fieldProps("unitCode")}
            >
              <option value="" disabled>
                Selecione…
              </option>
              {units.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unit.code} — {unit.label}
                </option>
              ))}
            </select>
            {fieldError("unitCode")}
            {structuralLocked && <p className="field__hint">{structuralLockHint}</p>}
          </div>

          <div className="field field--full">
            <label htmlFor="item-name">
              Nome <span className="req">*</span>
            </label>
            <input
              id="item-name"
              type="text"
              required
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              {...fieldProps("name")}
            />
            {fieldError("name")}
          </div>
        </div>
      </FormSection>

      {/*
        A seção própria do tipo (ITEM-FORM-BY-TYPE-01): quem decide é o Tipo,
        nunca a Família. Sem tipo escolhido — ou Produto acabado, na edição —
        não há seção própria. Um tipo novo ganha a sua aqui, com os campos
        dele em `CAMPOS_PROPRIOS_DO_TIPO`.

        Classificação industrial (capacidade 33) — insumo das capacidades de
        formulação e custeio, tudo opcional — é da matéria-prima: fonte,
        nutriente declarado e pureza padrão descrevem um item ENQUANTO
        COMPONENTE ativo de uma receita, e a pureza é o que corrige a
        quantidade da linha. Na embalagem e no produto acabado esses campos
        não teriam onde ser lidos; oferecê-los convida a preencher um dado que
        o sistema inteiro ignora.
      */}
      {form.type === "RAW_MATERIAL" && (
        <FormSection
          title="Classificação industrial"
          subtitle="Fonte, nutriente declarado e pureza padrão usados pela formulação."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="item-source-name">Fonte</label>
              <input
                id="item-source-name"
                type="text"
                placeholder="Ex.: Cloridrato de tiamina"
                value={form.sourceName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sourceName: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="item-declared-nutrient">Nutriente declarado</label>
              <input
                id="item-declared-nutrient"
                type="text"
                placeholder="Ex.: Vitamina B1"
                value={form.declaredNutrient}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, declaredNutrient: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="item-family">Família</label>
              <select
                id="item-family"
                value={form.family}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, family: event.target.value }))
                }
              >
                <option value="">Não informada</option>
                {ITEM_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {ITEM_FAMILY_LABELS[family]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field field--narrow">
              <label htmlFor="item-purity">Pureza padrão (%)</label>
              <PercentField
                id="item-purity"
                scale={CASAS_PERCENTUAL_TECNICO}
                placeholder="Ex.: 98,5"
                value={form.defaultPurityPercent}
                onChangeValue={(defaultPurityPercent) =>
                  setForm((prev) => ({ ...prev, defaultPurityPercent }))
                }
                {...fieldProps("defaultPurityPercent")}
              />
              {/* Vazio = desconhecida. Nunca é assumida como 100%. */}
              <p className="field__hint">
                Em branco significa pureza desconhecida — nunca 100%.
              </p>
              {fieldError("defaultPurityPercent")}
            </div>
          </div>
        </FormSection>
      )}

      {form.type === "PACKAGING" && (
        <FormSection title="Dados da embalagem" subtitle={SUBTITULO_DOS_DADOS_DA_EMBALAGEM}>
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="item-packaging-subtype">Subtipo de embalagem</label>
              <select
                id="item-packaging-subtype"
                value={form.packagingSubtype}
                onChange={(event) => handlePackagingSubtypeChange(event.target.value)}
              >
                <option value="">Não informado</option>
                {PACKAGING_SUBTYPES.map((subtype) => (
                  <option key={subtype} value={subtype}>
                    {PACKAGING_SUBTYPE_LABELS[subtype]}
                  </option>
                ))}
              </select>
              {arquivoDoRotuloDescartado && (
                <p className="field__hint" role="status">
                  O arquivo do rótulo escolhido foi descartado: o subtipo deixou de ser Rótulo.
                </p>
              )}
            </div>
          </div>

          {/*
            Só na embalagem: é onde a ambiguidade existe. A cápsula vazia e o
            pote são os dois `PACKAGING`, e nenhum subtipo os separava. Em
            matéria-prima a marca seria ruído — a base declarada na receita já
            faz o ingrediente acompanhar a produção.
          */}
          <div className="toggle-row">
            <ToggleCard
              id="item-consumed-in-production"
              checked={form.consumedInProduction}
              disabled={consumoTravadoPorPerfil}
              onChange={(checked) =>
                setForm((prev) => ({ ...prev, consumedInProduction: checked }))
              }
              label="Consumido na produção"
              description="Entra no processo junto com cada unidade produzida, como a cápsula vazia: a perda prevista aumenta a necessidade dele. Pote, tampa, rótulo e caixa acompanham a quantidade vendida e ficam desmarcados."
            />
          </div>
          {consumoTravadoPorPerfil && (
            <p className="field__hint">
              Só {QUEM_MARCA_CONSUMO_NA_PRODUCAO} alteram "Consumido na produção".
            </p>
          )}
        </FormSection>
      )}

      {/*
        Uso e consumo não tem campo próprio — por isso não entra em
        `CAMPOS_PROPRIOS_DO_TIPO`. A seção existe mesmo assim porque a escolha
        do tipo é irreversível na prática (o código já nasce UC) e a diferença
        dele está no ALCANCE, não no cadastro: sem isto a pessoa descobriria na
        Formulação que o item não aparece lá.
      */}
      {form.type === "INTERNAL_CONSUMABLE" && (
        <FormSection
          title="Dados de uso e consumo"
          subtitle={SUBTITULO_DOS_DADOS_DE_USO_E_CONSUMO}
        >
          <dl className="definition-list">
            <dt>Entra em</dt>
            <dd>{USO_E_CONSUMO_ENTRA}</dd>
            <dt>Não entra em</dt>
            <dd>{USO_E_CONSUMO_NAO_ENTRA}</dd>
          </dl>
        </FormSection>
      )}

      {/*
        Arquivo do rótulo já na criação (ITEM-FORM-BY-TYPE-01), logo depois dos
        dados da embalagem — só embalagem com subtipo Rótulo, nunca pelo nome.
        O arquivo fica na tela até o Item existir: "Criar item" cria e só então
        envia, pela mesma rota da seção do Item gravado. Opcional. Na edição
        quem mostra o arquivo é a seção do Item gravado, com o histórico.
      */}
      {rotuloNaCriacao && (
        <FormSection
          title="Arquivo do rótulo"
          subtitle="Anexe a arte ou documento correspondente a este rótulo."
        >
          {!podeEnviarArquivoDoRotulo ? (
            <p className="field__hint">
              Para anexar o arquivo, solicite a{" "}
              {perfisPorExtenso(ITEM_LABEL_FILE_UPLOAD_ROLES, "ou")} depois de criar o item.
            </p>
          ) : arquivoDoRotulo ? (
            <div className="field">
              <dl className="definition-list" aria-label="Arquivo do rótulo escolhido">
                <dt>Arquivo escolhido</dt>
                <dd>
                  {arquivoDoRotulo.name} · {formatFileSize(arquivoDoRotulo.size)}
                </dd>
              </dl>
              {erroDoArquivoDoRotulo ? (
                <p className="field__error" role="alert">
                  {erroDoArquivoDoRotulo}
                </p>
              ) : (
                <p className="field__hint">Vai como V1, logo depois de criar o item.</p>
              )}
              <div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={removerArquivoDoRotulo}
                >
                  Remover arquivo
                </button>
              </div>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="item-label-file">Arquivo (será a V1)</label>
              <input
                id="item-label-file"
                type="file"
                accept={ITEM_LABEL_FILE_ACCEPT}
                aria-describedby="item-label-file-hint"
                onChange={(event) => escolherArquivoDoRotulo(event.target.files?.[0] ?? null)}
              />
              <p id="item-label-file-hint" className="field__hint">
                PDF, PNG ou JPEG · até {LIMITE_DO_ARQUIVO_DO_ROTULO_EM_MB} MB. Opcional: o arquivo é
                enviado logo depois de criar o item.
              </p>
            </div>
          )}
        </FormSection>
      )}

      <FormSection
        title="Controles de rastreabilidade"
        subtitle={
          structuralLocked
            ? `Lote e validade: ${structuralLockHint.charAt(0).toLowerCase()}${structuralLockHint.slice(1)}`
            : "Definem como o estoque deste item será acompanhado."
        }
      >
        <div className="toggle-row">
          <ToggleCard
            id="item-controls-lot"
            checked={form.controlsLot}
            disabled={structuralLocked || controlesTravadosPorPerfil}
            onChange={(checked) =>
              setForm((prev) => ({ ...prev, controlsLot: checked }))
            }
            label="Controla lote"
            description="Cada recebimento gera lote interno com QR Code próprio."
          />
          <ToggleCard
            id="item-controls-expiry"
            checked={form.controlsExpiry}
            disabled={structuralLocked || controlesTravadosPorPerfil}
            onChange={(checked) =>
              setForm((prev) => ({ ...prev, controlsExpiry: checked }))
            }
            label="Controla validade"
            description="Habilita FEFO: o sistema sugere primeiro o lote que vence antes."
          />
          <ToggleCard
            id="item-requires-quality-release"
            checked={form.requiresQualityRelease}
            disabled={controlesTravadosPorPerfil}
            onChange={(checked) =>
              setForm((prev) => ({ ...prev, requiresQualityRelease: checked }))
            }
            label="Requer liberação da Qualidade"
            description="Novos lotes recebidos ficam indisponíveis até serem liberados."
          />
          <ToggleCard
            id="item-requires-coa"
            checked={form.requiresCoa}
            disabled={controlesTravadosPorPerfil}
            onChange={(checked) => setForm((prev) => ({ ...prev, requiresCoa: checked }))}
            label="Exige CoA / Laudo"
            description="Lotes deste item só são liberados com o laudo aprovado pela Qualidade."
          />
        </div>
        {/* Quem edita o Item sem decidir os controles lê o porquê: na criação
            o item nasce no padrão do tipo, e depois só a Qualidade muda. */}
        {controlesTravadosPorPerfil && (
          <p className="field__hint">
            {mode === "create"
              ? `O item nasce com os controles padrão do tipo. Só ${QUEM_ALTERA_CONTROLES_DO_ITEM} alteram os controles de rastreabilidade.`
              : `Só ${QUEM_ALTERA_CONTROLES_DO_ITEM} alteram os controles de rastreabilidade.`}
          </p>
        )}
      </FormSection>

      <FormSection
        title="Códigos"
        subtitle="Identificadores externos para leitura no recebimento."
      >
        <div className="field">
          <label htmlFor="item-barcode">Barcode externo</label>
          <input
            id="item-barcode"
            type="text"
            placeholder="Ex.: 7891234567890"
            value={form.externalBarcode}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, externalBarcode: event.target.value }))
            }
          />
          <p className="field__hint">Código de barras do fornecedor. Opcional.</p>
        </div>
      </FormSection>

      {/*
        Referência inicial é opcional e vive só na criação: depois que o item
        existe, alterar a referência é uma vigência nova, com histórico, na
        seção "Custo de referência" da edição. Produto acabado não é comprado.
        Definir custo é do custeio (Comercial e Administrador): para os outros
        perfis a seção não aparece — a API recusaria o pedido com 403.
      */}
      {mode === "create" && form.type !== "FINISHED_PRODUCT" && ofereceCustoInicial && (
        <FormSection
          title="Custo de referência"
          subtitle="Opcional. Estimativa usada quando não houver compra real nem oferta válida de fornecedor com prioridade maior."
        >
          <div className="field-grid-2">
            <div className="field field--narrow">
              <label htmlFor="item-initial-cost-reference">
                Custo de referência inicial (R$ por {form.unitCode || "unidade"})
              </label>
              <MoneyField
                id="item-initial-cost-reference"
                scale={CASAS_CUSTO_UNITARIO}
                placeholder="Ex.: 1200,00"
                value={form.initialCostReference}
                onChangeValue={(initialCostReference) =>
                  setForm((prev) => ({ ...prev, initialCostReference }))
                }
                {...fieldProps("initialCostReference")}
              />
              <p className="field__hint">
                Em branco significa "Não informado" — nunca R$ 0,00. Não é compra nem custo real.
              </p>
              {fieldError("initialCostReference")}
            </div>
            <div className="field">
              <label htmlFor="item-initial-cost-reference-note">Observação da referência</label>
              <input
                id="item-initial-cost-reference-note"
                type="text"
                placeholder="Ex.: cotação verbal do fornecedor"
                value={form.initialCostReferenceNote}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, initialCostReferenceNote: event.target.value }))
                }
              />
            </div>
          </div>
        </FormSection>
      )}

      {mode === "edit" && item && <StatusDoItem item={item} />}
    </form>
  );
}
