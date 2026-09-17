# LABEL-ATTACHMENTS-ARCHITECTURE-DISCOVERY-01 — arquivo versionado do Item Rótulo e armazenamento de objetos

## 1. Status

`IMPLEMENTADO` — LABEL-ATTACHMENTS-01, entregue em 2026-09-16 (na `main`, fora de PROD; `release/prod` segue
`5b7c1a3`). Regra durável em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §103.

**Origem deste documento.** O discovery de arquitetura foi conduzido e decidido no chat e **não chegou ao
repositório** (nenhum commit, nenhuma menção no Git até 2026-09-16). Este arquivo foi persistido na rodada de
implementação, a partir do handoff de LABEL-ATTACHMENTS-01 — que traz as decisões do PO — e do que a
implementação encontrou no código. Alternativas e perguntas do discovery original que o handoff não repetiu não
foram preservadas; se ainda valerem, voltam ao PO.

**Infra externa pronta** (declarada pelo PO no handoff): **Cloudflare R2 aprovado**; **bucket de homologação
criado** — `veridi-homologacao`, privado (acesso público desligado, sem `r2.dev`), classe Standard, dica de
localização ENAM; token da API S3 com *Object Read & Write* restrito a esse bucket. Nenhuma credencial está neste
repositório, e nenhuma foi pedida, lida ou registrada na rodada.

## 2. Objetivo

Guardar o arquivo do rótulo (a arte que vai para a gráfica) no cadastro do Item Rótulo com versões imutáveis, e
fazê-lo sobre um armazenamento sustentável: disco local em desenvolvimento e testes, Cloudflare R2 no ambiente
hospedado, com uma abstração só que os anexos genéricos possam usar depois.

## 3. PO baseline

Decidido no handoff de LABEL-ATTACHMENTS-01:

- **Domínio.** Rótulo = `Item.type = PACKAGING` e `packagingSubtype = LABEL`; nunca pelo nome. Sem `supplierId`.
  `AttachmentType.LABEL_ART` do Produto não muda: o fluxo novo é do Item Rótulo.
- **Versionamento.** Versões imutáveis V1, V2, V3; vigente = maior versão não anulada; nunca sobrescrever bytes;
  substituir = nova versão; restaurar = NOVA versão a partir da antiga; anular exige motivo e não apaga o objeto;
  sem exclusão física normal de versão.
- **Storage.** Abstração única (`putObject`, leitura em streaming, `headObject`, `deleteObject` só para rollback
  técnico); provedores `LOCAL_FS` e `R2`; `VERIDI_UPLOAD_DIR` segue autoridade local; R2 pela API compatível com
  S3, região `auto`, bucket fora do domínio; chave estável sem nome de arquivo nem dado sensível.
- **Envio.** PDF, PNG e JPEG; 25 MB; extensão, Content-Type e assinatura; nome original só metadado; só Item
  Rótulo ativo — inativo consulta o histórico e não recebe versão.
- **Permissões.** Leitura e download: toda sessão que consulta o Item. Enviar e restaurar: ADMIN, PURCHASING,
  QUALITY, COMMERCIAL. Anular: ADMIN, QUALITY.
- **Download.** Bucket privado; navegador nunca recebe credencial nem URL pública; passa pela API autenticada, em
  streaming, com Content-Type, Content-Length e Content-Disposition seguros.
- **Atomicidade.** Gravar o objeto, depois a versão; banco falhou depois do objeto, remover o objeto; storage
  falhou, nenhuma versão.
- **UI.** Seção "Arquivo do rótulo" no cadastro do Item Rótulo; "Adicionar nova versão", nunca "substituir";
  histórico Vigente/Histórica/Anulada; outros Itens não mostram nada.
- **Fora.** Railway sem configuração nesta capability; anexos existentes não migram.

## 4. Estado atual (antes da capability)

- `Attachment` (`apps/api/prisma/schema.prisma`): anexo polimórfico por CHECK (lote, recebimento, produto, projeto,
  amostra), arquivar em vez de excluir, sem versão. `AttachmentType.LABEL_ART` existe no Produto, Projeto e Amostra.
- `apps/api/src/lib/file-storage.ts`: três funções sobre o disco (`storeFile`, `readFile`, `deleteStoredFile`),
  chave `<uuid>.<ext>` na raiz de `VERIDI_UPLOAD_DIR`, extensão × MIME conferidos, **sem assinatura**, 10 MB.
- PROD grava anexos no volume do Railway (`VERIDI_UPLOAD_DIR=/data/uploads`, [`DEPLOY.md`](../DEPLOY.md) §6), que
  já citava o R2 como saída.
- O Item não tinha arquivo nenhum; o subtipo `LABEL` existia sem comportamento próprio.

## 5. Evidências

- `apps/api/prisma/schema.prisma` — `Attachment`, `AttachmentType`, `Item.packagingSubtype`, `PackagingSubtype`.
- `apps/api/src/modules/attachments/*` — rotas por contexto, `readUpload` com `request.file`, download por buffer.
- `apps/api/src/app.ts` — `@fastify/multipart` com limite global de 10 MB e 1 arquivo.
- `packages/shared/src/attachments.ts` — `PRODUCT_DOCUMENT_UPLOAD_ROLES` (Comercial, Qualidade, ADMIN) e
  `ATTACHMENT_ARCHIVE_ROLES` (Qualidade, ADMIN).
- `packages/shared/src/items.ts` — `ITEM_EDIT_ROLES` (Compras, Qualidade, Produção, ADMIN).
- `apps/web/src/pages/items/ItemFormModal.tsx` — seções com permissão própria no modal do Item (referência de custo).

## 6. Findings

- **F1.** Nenhuma abstração de storage além de três funções de disco; trocar para nuvem mexeria no domínio.
- **F2.** O anexo atual não confere assinatura: PDF com conteúdo de outro tipo entra.
- **F3.** O download de anexo lê o arquivo inteiro em memória antes de responder.
- **F4.** As listas de perfil do handoff divergem das vizinhas — ver §11.
- **F5.** `@fastify/multipart` com `files: 1`: o segundo arquivo destrói o primeiro em leitura e a rota responde 500
  "Premature close" (visto na implementação; contornado com `files: 2` e recusa própria).
- **F6.** O subtipo do Item pode mudar depois de haver versões (subtipo não é campo estrutural): as versões ficam,
  e a seção deixa de aparecer. Registrado, sem posição (§15).

## 7. Gaps

- Armazenamento em nuvem sem código; volume do Railway como único destino.
- Arquivo do rótulo sem lugar próprio, sem versão e sem anulação com motivo.
- Validação por assinatura inexistente.

## 8. Riscos

| Risco | Tratamento |
|---|---|
| Credencial no Git, no log, no banco ou no navegador | Só variáveis de ambiente; mensagens citam o nome da variável, nunca o valor; erro do SDK vira detalhe de operação, nome e status; navegador fala só com a API |
| Versão apontando para objeto inexistente | Objeto primeiro, versão depois; restauração confere `headObject`; download recusa objeto ausente ou de tamanho diferente |
| Objeto órfão depois de falha do banco | Compensação apaga o objeto recém-gravado se o banco não confirma a versão (COMMIT perdido não apaga) |
| Sobrescrita de bytes | `LOCAL_FS` abre com `wx`; R2 grava com `If-None-Match: *`; chave com UUID |
| Troca de provedor esconder arquivos antigos | Cada versão guarda o provedor em que nasceu e é lida dele |
| Arquivo disfarçado | Extensão, tipo declarado e assinatura têm de concordar |
| Duas versões com o mesmo número | Transação trava o Item (`FOR NO KEY UPDATE`) e há `@@unique([itemId, versionNumber])` |

## 9. Alternativas consideradas (na implementação)

- **Restaurar copiando o objeto** (`CopyObject`) × **referenciar o mesmo objeto**: escolhido referenciar. O objeto é
  imutável e nenhuma regra de negócio o apaga; a cópia só acrescentaria custo e um ponto de falha.
- **SDK oficial** (`@aws-sdk/client-s3`) × **assinatura SigV4 própria** × `aws4fetch`: escolhido o SDK — é o que a
  documentação do R2 usa para Node, e assinatura própria é código de segurança sem necessidade.
- **Endereço por subdomínio do bucket** × **bucket no caminho**: escolhido o caminho (`forcePathStyle`), forma base
  do R2 — DNS e certificado não dependem do nome do bucket.
- **Tabela genérica de arquivo** × **tabela própria**: tabela própria (`item_label_file_versions`), como pedido.

## 10. Recomendação

Implementar como decidido (§3), com o provedor gravado por versão e a restauração por referência (§9), e deixar o
R2 pronto e desligado até o PO configurar o Railway.

## 11. Decisões PO

Todas no handoff (§3). Divergências registradas, **sem ampliar permissão existente**:

- Enviar e restaurar (`ITEM_LABEL_FILE_UPLOAD_ROLES`, `ITEM_LABEL_FILE_RESTORE_ROLES`) = Compras, Qualidade,
  Comercial e ADMIN. Difere de `ITEM_EDIT_ROLES` (a Produção edita o Item e não envia arte; o Comercial não edita o
  Item e envia) e de `PRODUCT_DOCUMENT_UPLOAD_ROLES` (Compras entra). É seção com permissão própria, como a
  referência de custo no Item.
- Anular (`ITEM_LABEL_FILE_VOID_ROLES`) = Qualidade e ADMIN, igual a `ATTACHMENT_ARCHIVE_ROLES`.
- Leitura aberta a toda sessão, como `GET /items/:id`.

## 12. Pendências PO

- **Configurar o R2 no Railway** (STORAGE-R2-ACTIVATION-01) — nada foi configurado nesta capability. O smoke real
  com a credencial de homologação passou (§16); no Railway, repetir com a credencial que o serviço usar.
- Publicação em PROD, quando decidir.

## 13. Escopo recomendado

O de §3, entregue em LABEL-ATTACHMENTS-01.

## 14. Fora do escopo

- Migrar `Attachment` para o adaptador ou para o R2 (ATTACHMENTS-R2-MIGRATION-01).
- Arquivo genérico para todo Item; versões em outros subtipos.
- URL assinada, CDN, acesso público, `r2.dev`.
- Antivírus e validação estrutural do PDF além da assinatura.

## 15. Próxima capability

- **Ativação do R2 no Railway** — decisão do PO, com o smoke `pnpm storage:r2:smoke`.
- **ATTACHMENTS-R2-MIGRATION-01** — levar anexos genéricos ao adaptador (e ao R2), se ainda fizer sentido.
- **LABEL-FILE-SUBTYPE-CHANGE-01** — sem posição: Item Rótulo com versões que troca de subtipo.

## 16. Implementação

LABEL-ATTACHMENTS-01 (2026-09-16):

- **Storage** — `apps/api/src/lib/storage/`: `StorageAdapter`, `LocalFsStorageAdapter`, `R2StorageAdapter`
  (`@aws-sdk/client-s3`) e seleção por provedor (`armazenamentoPara`); `config/storage-config.ts` valida
  `VERIDI_STORAGE_PROVIDER` e `VERIDI_R2_*` na subida.
- **Modelo** — `ItemLabelFileVersion` + enum `StorageProvider`, migration aditiva `20260925093033_item_label_file_versions`
  com CHECKs de número, tamanho, anulação e restauração.
- **API** — `apps/api/src/modules/items/item-label-files.*`: `GET /items/:id/label-file`,
  `POST /items/:id/label-file/versions`, `GET …/versions/:versionId/download`, `POST …/void`, `POST …/restore`.
- **Web** — `components/ItemLabelFileSection.tsx` no `ItemFormModal` só para Item Rótulo.
- **Smoke R2** — `pnpm storage:r2:smoke` (`scripts/storage-r2-smoke.ts`): grava em `_smoke/`, confere cabeçalho,
  bytes e recusa de sobrescrita, apaga no fim. **Rodado uma vez em 2026-09-16 contra `veridi-homologacao`, OK**:
  upload com `If-None-Match: *` e SHA-256, head, download com bytes e SHA-256 iguais, sobrescrita recusada (412),
  objeto apagado e ausência confirmada. Credencial injetada pelo PO num arquivo fora do repositório; nenhum valor foi
  lido, impresso ou registrado.

## 17. Histórico de decisões

| Data | Decisão |
|---|---|
| 2026-09-16 | Discovery decidido no chat; R2 aprovado; bucket `veridi-homologacao` criado pelo PO |
| 2026-09-16 | Persistido na rodada de implementação (LABEL-ATTACHMENTS-01), com as escolhas de §9 |
