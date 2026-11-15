// @ts-check
import { ChevronDown } from "lucide-react";

/**
 * @param {string} section
 */
export function talkSectionIds(section) {
  return {
    panelId: `talk-section-${section}-panel`,
    toggleId: `talk-section-${section}-toggle`,
  };
}

/**
 * Accessible collapse/expand control for a Talk-screen chrome section.
 *
 * @param {{
 *   section: string,
 *   label: string,
 *   collapsed: boolean,
 *   onToggle: () => void,
 * }} props
 */
export function TalkSectionToggle({ section, label, collapsed, onToggle }) {
  const { panelId, toggleId } = talkSectionIds(section);
  const action = collapsed ? "Expand" : "Collapse";
  return (
    <button
      type="button"
      id={toggleId}
      data-testid={toggleId}
      aria-expanded={!collapsed}
      aria-controls={panelId}
      onClick={onToggle}
      title={`${action} ${label}`}
      aria-label={`${action} ${label}`}
      className="flex-shrink-0 p-1.5 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 transition-colors duration-200 motion-reduce:transition-none focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
    >
      <ChevronDown
        aria-hidden="true"
        className={`w-3.5 h-3.5 transition-transform duration-200 motion-reduce:transition-none ${collapsed ? "-rotate-90" : "rotate-0"}`}
      />
    </button>
  );
}

/**
 * Compact one-line bar shown when a Talk section is collapsed.
 *
 * @param {{
 *   section: string,
 *   label: string,
 *   collapsed: boolean,
 *   onToggle: () => void,
 *   children: import("react").ReactNode,
 *   className?: string,
 * }} props
 */
export function TalkSectionSummaryBar({ section, label, collapsed, onToggle, children, className = "" }) {
  return (
    <div
      data-testid={`talk-section-${section}-summary`}
      className={`flex items-center gap-2 min-w-0 ${className}`}
    >
      <div className="flex-1 min-w-0">{children}</div>
      <TalkSectionToggle section={section} label={label} collapsed={collapsed} onToggle={onToggle} />
    </div>
  );
}

/**
 * Shared Talk chrome wrapper. When collapsed, a compact summary stays visible
 * and the full section is hidden (kept mounted) so the chat feed can grow.
 *
 * @param {{
 *   section: string,
 *   label: string,
 *   collapsed: boolean,
 *   onToggle: () => void,
 *   summary: import("react").ReactNode,
 *   children: import("react").ReactNode,
 *   className?: string,
 *   barClassName?: string,
 * }} props
 */
export default function CollapsibleTalkSection({
  section,
  label,
  collapsed,
  onToggle,
  summary,
  children,
  className = "",
  barClassName = "",
  expandedClassName = "",
}) {
  const { panelId, toggleId } = talkSectionIds(section);

  return (
    <div
      className={`flex-shrink-0 ${className}`}
      data-testid={`talk-section-${section}`}
      data-collapsed={collapsed ? "true" : "false"}
    >
      {collapsed && (
        <TalkSectionSummaryBar
          section={section}
          label={label}
          collapsed={collapsed}
          onToggle={onToggle}
          className={barClassName}
        >
          {summary}
        </TalkSectionSummaryBar>
      )}

      <div className={collapsed ? "hidden" : ["flex items-stretch min-w-0", expandedClassName].filter(Boolean).join(" ")}>
        <div
          id={panelId}
          role="region"
          aria-labelledby={toggleId}
          aria-label={label}
          hidden={collapsed}
          inert={collapsed || undefined}
          className="flex-1 min-w-0"
        >
          {children}
        </div>
        {!collapsed && (
          <div className="flex items-center flex-shrink-0 pl-1 pr-1">
            <TalkSectionToggle section={section} label={label} collapsed={collapsed} onToggle={onToggle} />
          </div>
        )}
      </div>
    </div>
  );
}
