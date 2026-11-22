"use client";

// Vaults — the product catalogue. Existing cycles keep their snapshot
// (rate/duration copied at opening — SQL-guaranteed), so edits and
// retirements only affect FUTURE openings.

import { useCallback, useEffect, useState } from "react";
import { Btn, Card } from "@/components/ui";
import { adminListProducts, adminUpsertProduct } from "@/lib/app/adminApi";
import { fmtRate, fmtUGX } from "@/lib/format";
import type { AdminProductRow } from "@/lib/api/types";
import { Field, inputCls } from "./parts";
import type { DeskApi } from "./useDesk";

const EMPTY = {
  slug: "",
  name: "",
  min_principal: "",
  max_principal: "",
  duration_days: "",
  total_rate_pct: "",
  early_exit_percent: "90",
  terms: "",
};

export function ProductsSection({ desk }: { desk: DeskApi }) {
  const [products, setProducts] = useState<AdminProductRow[]>([]);
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = useCallback(async () => {
    try {
      setProducts(await adminListProducts(desk.cfg));
    } catch (e) {
      desk.setErrorMsg(`Products: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.cfg]);

  useEffect(() => {
    // Intentional fetch-on-mount; setState happens after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async () => {
    const done = await desk.mutate("Save product", (cfg) =>
      adminUpsertProduct(
        {
          slug: form.slug.trim(),
          name: form.name.trim(),
          min_principal: Number(form.min_principal),
          max_principal: Number(form.max_principal),
          duration_days: Number(form.duration_days),
          total_rate_pct: Number(form.total_rate_pct),
          early_exit_percent: Number(form.early_exit_percent || 90),
          terms: form.terms.trim() || null,
        },
        cfg
      )
    );
    if (done) {
      setForm(EMPTY);
      await load();
    }
  };

  const setActive = async (p: AdminProductRow, active: boolean) => {
    const done = await desk.mutate(active ? "Activate" : "Retire", (cfg) =>
      adminUpsertProduct({ ...p, active }, cfg)
    );
    if (done) await load();
  };

  return (
    <div className="space-y-4">
      <Card title="Catalogue" hint="Retiring keeps history — open cycles pay from their snapshot, never from this table. Rates are TOTAL over the term.">
        <ul className="divide-y divide-[#1d2c55] text-sm">
          {products.map((p) => (
            <li key={p.slug} className="flex items-center justify-between gap-2 py-2">
              <div>
                <span className="font-bold">{p.name}</span>
                <span className="ml-2 text-[#6b7fae]">
                  {fmtUGX(p.min_principal)}–{fmtUGX(p.max_principal)} · {p.duration_days}d · +
                  {fmtRate(p.total_rate_pct)} total · exit {fmtRate(p.early_exit_percent)}
                </span>
                {!p.active && <span className="ml-2 rounded bg-[#12204a] px-1.5 text-[10px] text-[#6b7fae]">RETIRED</span>}
                {!p.visible && <span className="ml-2 rounded bg-[#12204a] px-1.5 text-[10px] text-[#6b7fae]">HIDDEN</span>}
              </div>
              <Btn variant="ghost" onClick={() => setActive(p, !p.active)}>
                {p.active ? "Retire" : "Restore"}
              </Btn>
            </li>
          ))}
          {products.length === 0 && <li className="py-3 text-[#6b7fae]">No products yet.</li>}
        </ul>
      </Card>

      <Card title="New / update product" hint="Updating an existing slug overwrites the offer for FUTURE openings only. A new vault is refused unless its full payout is already covered by the reserve.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Slug"><input className={inputCls} placeholder="anchor-540" value={form.slug} onChange={set("slug")} /></Field>
          <Field label="Name"><input className={inputCls} placeholder="Anchor 540" value={form.name} onChange={set("name")} /></Field>
          <Field label="Min principal"><input className={inputCls} inputMode="numeric" value={form.min_principal} onChange={set("min_principal")} /></Field>
          <Field label="Max principal"><input className={inputCls} inputMode="numeric" value={form.max_principal} onChange={set("max_principal")} /></Field>
          <Field label="Days (7-730)"><input className={inputCls} inputMode="numeric" value={form.duration_days} onChange={set("duration_days")} /></Field>
          <Field label="Total rate % (0-100)"><input className={inputCls} inputMode="decimal" value={form.total_rate_pct} onChange={set("total_rate_pct")} /></Field>
          <Field label="Early exit %"><input className={inputCls} inputMode="numeric" value={form.early_exit_percent} onChange={set("early_exit_percent")} /></Field>
          <Field label="Terms (optional)"><input className={inputCls} value={form.terms} onChange={set("terms")} /></Field>
        </div>
        <Btn
          className="mt-3"
          disabled={!form.slug || !form.name || !form.min_principal || !form.max_principal || !form.duration_days || form.total_rate_pct === ""}
          onClick={save}
        >
          Save product
        </Btn>
      </Card>
    </div>
  );
}
