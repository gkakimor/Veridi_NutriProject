import { env } from "../../config/env.js";
import type { StorageProviderName } from "../../config/storage-config.js";
import { LocalFsStorageAdapter } from "./local-fs-storage.js";
import { criarAdaptadorR2 } from "./r2-storage.js";
import type { StorageAdapter } from "./storage-adapter.js";
import { StorageUnavailableError } from "./storage-adapter.js";

export type { StorageProviderName } from "../../config/storage-config.js";
export * from "./storage-adapter.js";

/**
 * O provedor de cada leitura e gravação.
 *
 * Arquivo NOVO vai para o provedor ativo (`VERIDI_STORAGE_PROVIDER`). Arquivo
 * JÁ GRAVADO é lido do provedor em que nasceu, gravado junto com ele — trocar a
 * variável não move nada nem esconde o que já existe.
 *
 * `LOCAL_FS` sempre existe (`VERIDI_UPLOAD_DIR` tem padrão). `R2` existe só com
 * as variáveis completas; sem elas, pedir o R2 é `StorageUnavailableError`, e a
 * rota responde 503.
 */

let local: LocalFsStorageAdapter | null = null;
let r2: StorageAdapter | null = null;

export function provedorDeArmazenamentoAtivo(): StorageProviderName {
  return env.storage.provider;
}

export function armazenamentoPara(provider: StorageProviderName): StorageAdapter {
  if (provider === "LOCAL_FS") {
    local ??= new LocalFsStorageAdapter(env.VERIDI_UPLOAD_DIR);
    return local;
  }
  if (!env.storage.r2) throw new StorageUnavailableError("R2", "configuracao-ausente");
  r2 ??= criarAdaptadorR2(env.storage.r2);
  return r2;
}
