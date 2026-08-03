// @ts-check
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import Sidebar from "./Sidebar";

/** @param {import('react').ComponentProps<typeof Sidebar>} props */
export default function TabletSidebar(props) {
  const { isTablet } = useResponsiveLayout();

  if (!isTablet) return null;

  return (
    <div className="hidden tablet:flex w-64 desktop:w-72 flex-shrink-0">
      <Sidebar {...props} />
    </div>
  );
}