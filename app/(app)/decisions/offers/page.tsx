"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import RowList from "@/components/RowList";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { createRow, listRows } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase";
import type { Offer } from "@/lib/entities";

const SPECS: FieldSpec[] = [
  { key: "role_title", label: "Role title", kind: "text", required: true },
  { key: "received_at", label: "Received", kind: "date" },
  { key: "status", label: "Status", kind: "select", options: ["draft", "received", "negotiating"] },
  { key: "expiration_date", label: "Expires", kind: "date" },
];

export default function OffersPage() {
  const router = useRouter();
  const { bump } = useShell();
  const loader = useCallback((db: SupabaseClient) => listRows<Offer>(db, "offers", { includeArchived: true }), []);
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  return (
    <main>
      <PageHeader
        crumb="decisions"
        title="Offer Workbench"
        count={data.length}
        action={
          <SpecAddForm
            title="Record offer"
            specs={SPECS}
            onCreate={async (values) => {
              await createRow(getSupabase(), "offers", normalizeSpecValues(SPECS, values));
              bump();
            }}
          />
        }
      >
        <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-dim-500">
          <Link href="/decisions/visa" className="hover:text-dim-300">visa</Link>
          <Link href="/decisions/offers" className="text-signal-blue">offers</Link>
          <Link href="/decisions/benchmarks" className="hover:text-dim-300">benchmarks</Link>
        </div>
      </PageHeader>
      <div className="px-4 py-5 md:px-8">
        {data.length === 0 ? (
          <p className="max-w-xl border border-dashed border-ink-600 px-6 py-8 text-[13px] leading-relaxed text-dim-400">
            No offers recorded. The workbench stages scenarios and counter-proposals as records —
            you compute numbers externally, the app never sends anything, and acceptance is hard-blocked
            until Visa Gate 7 is attorney-confirmed with sponsorship and priority-date commitments in writing.
          </p>
        ) : (
          <RowList<Offer>
            rows={data}
            rowKey={(o) => o.id}
            status={(o) => (o.status === "accepted" ? "active" : o.status === "draft" ? "draft" : "active")}
            onOpen={(o) => router.push(`/decisions/offers/${o.id}`)}
            render={(o) => (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{o.role_title || "(untitled offer)"}</span>
                {o.base_salary !== null && <span className="font-mono text-[12px] text-dim-300">{o.base_currency} {Number(o.base_salary).toLocaleString()}</span>}
                <span className={`font-mono text-[10px] uppercase ${o.visa_sponsorship_committed_bool && o.priority_date_retention_committed_bool && o.attorney_reviewed_at ? "text-signal-green" : "text-signal-amber"}`}>
                  gate-7 {o.visa_sponsorship_committed_bool && o.priority_date_retention_committed_bool && o.attorney_reviewed_at ? "ready" : "incomplete"}
                </span>
                <StatusBadge value={o.status} />
              </span>
            )}
          />
        )}
      </div>
    </main>
  );
}
