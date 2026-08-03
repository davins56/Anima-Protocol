import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

export default function ResponsiveGrid({ children, gap = 4 }) {
  const { device } = useResponsiveLayout();

  const gridCols = {
    mobile: "grid-cols-1",
    tablet: "grid-cols-2",
    desktop: "grid-cols-3",
  };

  const gapClass = {
    1: "gap-1",
    2: "gap-2",
    3: "gap-3",
    4: "gap-4",
    6: "gap-6",
  };

  return (
    <div className={`grid ${gridCols[device] || "grid-cols-1"} ${gapClass[gap] || "gap-4"}`}>
      {children}
    </div>
  );
}