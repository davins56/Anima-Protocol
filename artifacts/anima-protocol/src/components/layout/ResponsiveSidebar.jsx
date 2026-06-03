// @ts-check
import { useState } from "react";
import { X, Menu } from "lucide-react";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import Sidebar from "./Sidebar";

/**
 * @param {import('react').ComponentProps<typeof Sidebar>} props
 */
export default function ResponsiveSidebar({ ...props }) {
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const { isMobile, isTablet } = useResponsiveLayout();

  // Desktop: always visible
  if (!isMobile && !isTablet) {
    return <Sidebar {...props} />;
  }

  // Mobile/Tablet: collapsible
  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setShowMobileMenu(true)}
        className="lg:hidden fixed top-4 left-4 z-40 p-2 border border-primary/20 text-primary/40 hover:text-primary transition-colors"
        aria-label="Toggle menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile/Tablet Overlay */}
      {showMobileMenu && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className={isTablet ? "w-80" : "w-64"}>
            <Sidebar
              {...props}
              onNavigate={() => setShowMobileMenu(false)}
            />
          </div>
          <div
            className="flex-1 bg-black/60"
            onClick={() => setShowMobileMenu(false)}
          />
        </div>
      )}
    </>
  );
}