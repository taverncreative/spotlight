import { CopyField } from "@/components/email/copy-field";
import type { DomainSetup } from "@/lib/dmarc/panel";

// The DNS guidance for a monitored domain. The PRIMARY path is the rua= fragment
// to merge into the operator's EXISTING DMARC record, keeping their current
// policy -- never a full record that could downgrade enforcement. The full
// record is offered only as a fallback for a domain with no DMARC yet. Record B
// (report authorisation on our ingest domain) is a Spotlight-side step, called
// out separately because a missing B is the usual reason reports never arrive.
export function DomainSetup({
  domain,
  setup,
}: {
  domain: string;
  setup: DomainSetup;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <p className="font-medium">
          1. Add this to your DMARC record{" "}
          <span className="font-normal text-muted-foreground">
            (keep your current policy)
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          If <span className="font-mono">{`_dmarc.${domain}`}</span> already has
          a record, keep its <span className="font-mono">p=</span> policy
          exactly as it is and add this <span className="font-mono">rua=</span>{" "}
          target. If it already has a <span className="font-mono">rua=</span>,
          add <span className="font-mono">{setup.ruaMailto}</span> to it,
          comma-separated.
        </p>
        <CopyField value={setup.ruaFragment} host={`_dmarc.${domain} (TXT)`} />
      </div>

      <details className="space-y-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          No DMARC record yet? Use this whole record
        </summary>
        <div className="pt-2">
          <CopyField
            value={setup.fullRecord}
            host={`_dmarc.${domain} (TXT)`}
            note="Only for a domain with no existing DMARC record. p=none is monitor-only and does not affect delivery."
          />
        </div>
      </details>

      <div className="space-y-2">
        <p className="font-medium">
          2. Report authorisation{" "}
          <span className="font-normal text-muted-foreground">
            (Spotlight DNS)
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Because reports go to an address on our domain, this record must exist
          on the Spotlight ingest domain or conforming reporters refuse to send.
        </p>
        <CopyField
          value={setup.reportAuthValue}
          host={`${setup.reportAuthHost} (TXT)`}
        />
      </div>
    </div>
  );
}
