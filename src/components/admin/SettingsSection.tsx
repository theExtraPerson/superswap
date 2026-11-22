"use client";

import { useEffect, useState } from "react";
import { Btn, Card } from "@/components/ui";
import { adminSetSetting, adminSettingsSpec } from "@/lib/app/adminApi";
import type { AdminSettingSpec } from "@/lib/api/types";
import type { DeskApi } from "./useDesk";
import { inputCls, labelCls } from "./parts";

/**
 * Settings — the money rules, edited WITHOUT a deploy. The editable-key
 * whitelist and value validation live in Postgres (app_admin_setting_spec);
 * this section just renders what the DB says is editable.
 */
export function SettingsSection({ desk }: { desk: DeskApi }) {
  const [specs, setSpecs] = useState<AdminSettingSpec[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const settings = desk.dash?.settings ?? {};

  // Fetch the editable-key whitelist once the dashboard is ready; setState
  // happens after the await, never synchronously in the effect body.
  useEffect(() => {
    if (specs || !desk.dash) return;
    let alive = true;
    adminSettingsSpec(desk.cfg)
      .then((s) => {
        if (alive) setSpecs(s);
      })
      .catch((e: Error) => desk.setErrorMsg(`Settings spec: ${e.message}`));
    return () => {
      alive = false;
    };
  }, [specs, desk]);

  const save = async (key: string) => {
    const value = drafts[key] ?? settings[key] ?? "";
    setSavingKey(key);
    await desk.mutate(`Save ${key}`, (cfg) => adminSetSetting(key, value, cfg));
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    setSavingKey(null);
  };

  const visible = specs ?? [];

  return (
    <Card title="Money rules" hint="platform_settings is the authority — this form only edits keys the DB whitelists. Changes are audited.">
      {!desk.dash ? (
        <p className="text-sm text-[#6b7fae]">Loading settings…</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((s) => {
            const current = settings[s.key] ?? "";
            const draft = drafts[s.key] ?? current;
            const dirty = draft !== current;
            return (
              <li key={s.key} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <div className={labelCls}>{s.label}</div>
                  {s.hint && <div className="text-[11px] text-[#42557f] mt-0.5">{s.hint}</div>}
                  {s.kind === "bool" ? (
                    <select
                      className={`${inputCls} mt-1`}
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                    >
                      <option value="false">off</option>
                      <option value="true">on</option>
                    </select>
                  ) : (
                    <input
                      className={`${inputCls} mt-1`}
                      type={s.kind === "number" ? "number" : s.kind === "time" ? "time" : "text"}
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                    />
                  )}
                  <div className="mt-0.5 text-[11px] text-[#42557f]">{s.key} = {current}</div>
                </div>
                <Btn variant="solid" disabled={!dirty || savingKey === s.key} onClick={() => save(s.key)}>
                  {savingKey === s.key ? "Saving…" : "Save"}
                </Btn>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="text-sm text-[#6b7fae]">Could not load the editable-key list — is admin.sql applied?</li>
          )}
        </ul>
      )}
    </Card>
  );
}
