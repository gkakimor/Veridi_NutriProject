import { formatQuantity } from "../../lib/quantity";
import type { LotDTO } from "@veridi/shared";
import { ownerLabel } from "@veridi/shared";
import { QrCode } from "../../components/QrCode";
import { formatDate } from "../../lib/dates";


/**
 * Conteúdo da etiqueta de lote — humano-legível sem scanner. NÃO inclui
 * saldo disponível, reservado, preço, OC completa ou dado financeiro.
 * Lote produzido (origin=PRODUCTION) nunca mostra Lote fornecedor — mostra
 * Lote Veridi e a quantidade produzida acumulada em vez da recebida.
 *
 * Material de cliente mostra o proprietário de forma discreta. O QR
 * continua sendo só `LOT:<código>` — nunca carrega cliente.
 */
export function LotLabel({ lot }: { lot: LotDTO }) {
  const isProduction = lot.origin === "PRODUCTION";

  return (
    <div className="lot-label">
      <div className="lot-label__header">VERIDI NUTRITION</div>

      <div className="lot-label__item">
        <span className="lot-label__item-code">{lot.itemCode}</span>
        <span className="lot-label__item-name">{lot.itemName}</span>
      </div>

      <div className="lot-label__body">
        <dl className="lot-label__fields">
          {isProduction ? (
            <>
              <dt>Lote Veridi</dt>
              <dd>{lot.businessLotNumber ?? "—"}</dd>
              <dt>Lote interno</dt>
              <dd>{lot.code}</dd>
              <dt>Data de produção</dt>
              <dd>{formatDate(lot.createdAt)}</dd>
              <dt>Validade</dt>
              <dd>
                {formatDate(lot.expiryDate)}
                {lot.isExpired && <span className="lot-label__expired"> — VENCIDO</span>}
              </dd>
              <dt>Quantidade produzida</dt>
              <dd>
                {lot.producedQuantity ?? lot.initialReceivedQuantity} {lot.unitCode}
              </dd>
              <dt>Localização</dt>
              <dd>{lot.location ?? "—"}</dd>
            </>
          ) : (
            <>
              <dt>Lote fornecedor</dt>
              <dd>{lot.supplierLot ?? "—"}</dd>
              <dt>Lote interno</dt>
              <dd>{lot.code}</dd>
              <dt>Validade</dt>
              <dd>
                {formatDate(lot.expiryDate)}
                {lot.isExpired && <span className="lot-label__expired"> — VENCIDO</span>}
              </dd>
              <dt>Quantidade recebida</dt>
              <dd>
                {formatQuantity(lot.initialReceivedQuantity)} {lot.unitCode}
              </dd>
              <dt>Localização</dt>
              <dd>{lot.location ?? "—"}</dd>
            </>
          )}
          {lot.ownerType === "CUSTOMER" && (
            <>
              <dt>Proprietário</dt>
              <dd>{ownerLabel(lot.ownerType, lot.ownerCustomerName)}</dd>
            </>
          )}
        </dl>

        <div className="lot-label__qr">
          <QrCode value={lot.qrPayload} size={92} label={`Código QR do lote ${lot.code}`} />
        </div>
      </div>
    </div>
  );
}
