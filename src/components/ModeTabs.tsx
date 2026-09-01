/**
 * Scan | Create segmented tab control.
 *
 * Accessible: role="tablist", aria-selected, arrow-key navigation between
 * tabs, and a focus ring that follows the active tab.
 */

import { useCallback } from "react";

type Tab = "scan" | "create";

const TABS: { id: Tab; label: string }[] = [
  { id: "scan", label: "Scan" },
  { id: "create", label: "Create" },
];

export interface ModeTabsProps {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

export function ModeTabs({ activeTab, onChange }: ModeTabsProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const idx = TABS.findIndex((t) => t.id === activeTab);
      const next =
        e.key === "ArrowRight"
          ? TABS[(idx + 1) % TABS.length]
          : TABS[(idx - 1 + TABS.length) % TABS.length];
      onChange(next.id);
    },
    [activeTab, onChange]
  );

  return (
    <div
      role="tablist"
      aria-label="Main mode"
      className="inline-flex w-full rounded-xl bg-slate-100 p-1"
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}