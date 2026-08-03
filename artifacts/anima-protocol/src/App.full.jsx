import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Suspense, lazy, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSwipeGestures } from "@/hooks/useSwipeGestures";
import { initializeColorScheme } from "@/lib/colorScheme";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import BottomTabBar from "@/components/layout/BottomTabBar";
import MobileHeader from "@/components/layout/MobileHeader";
import { useKeyboardAvoidance } from "@/hooks/useKeyboardAvoidance";
import { seedCharactersIfNeeded } from "@/lib/seedCharacters";

// Lazy-loaded pages for code splitting
const Chat = lazy(() => import("./pages/Chat"));
const Landing = lazy(() => import("./pages/Landing"));
const NewChat = lazy(() => import("./pages/NewChat"));

// Keep the rest of your app's pages lazy-loaded
const Characters = lazy(() => import("./pages/Characters"));
const CharacterGroups = lazy(() => import("./pages/CharacterGroups"));
const Storyboard = lazy(() => import("./pages/Storyboard"));
const Network = lazy(() => import("./pages/Network"));
const Settings = lazy(() => import("./pages/Settings"));
const Animas = lazy(() => import("./pages/Animas"));
const LoreBook = lazy(() => import("./pages/LoreBook"));
const WorldMap = lazy(() => import("./pages/WorldMap"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const OnboardingFlow = lazy(() => import("./pages/OnboardingFlow"));
const ModeSelect = lazy(() => import("./pages/ModeSelect"));
const Home = lazy(() => import("./pages/Home"));
const CheckIn = lazy(() => import("./pages/CheckIn"));
const Journals = lazy(() => import("./pages/Journals"));
const Wiki = lazy(() => import("./pages/Wiki"));
const NarrativeProgress = lazy(() => import("./pages/NarrativeProgress"));
const StoryFlowchart = lazy(() => import("./pages/StoryFlowchart"));
const StoryboardManager = lazy(() => import("./pages/StoryboardManager"));
const RelationshipNetwork = lazy(() => import("./pages/RelationshipNetwork"));
const CharacterGraphVisualization = lazy(
  () => import("./pages/CharacterGraphVisualization"),
);
const LoreArchive = lazy(() => import("./pages/LoreArchive"));
const Insights = lazy(() => import("./pages/Insights"));
const Reflections = lazy(() => import("./pages/Reflections"));
const DiscoveryQueue = lazy(() => import("./pages/DiscoveryQueue"));
const LocationsMap = lazy(() => import("./pages/LocationsMap"));
const RelationshipVisualization = lazy(
  () => import("./pages/RelationshipVisualization"),
);
const GlobalWiki = lazy(() => import("./pages/GlobalWiki"));
const WorldCalendar = lazy(() => import("./pages/WorldCalendar"));
const WorldCodex = lazy(() => import("./pages/WorldCodex"));
const RelationshipGraph = lazy(() => import("./pages/RelationshipGraph"));
const InventoryPanel = lazy(() => import("./pages/InventoryPanel"));
const CalendarView = lazy(() => import("./pages/CalendarView"));
const StoryBranching = lazy(() => import("./pages/StoryBranching"));
const CharacterMemoryMap = lazy(() => import("./pages/CharacterMemoryMap"));
const WorldPulse = lazy(() => import("./pages/WorldPulse"));
const NarrativeBranchingMap = lazy(
  () => import("./pages/NarrativeBranchingMap"),
);
const RelationshipGraphPage = lazy(
  () => import("./pages/RelationshipGraphPage"),
);
const YnStoriesLibrary = lazy(() => import("./pages/YnStoriesLibrary"));
const WorldTimeline = lazy(() => import("./pages/WorldTimeline"));
const CharacterRepository = lazy(() => import("./pages/CharacterRepository"));
const StoryAnalyticsDashboard = lazy(
  () => import("./pages/StoryAnalyticsDashboard"),
);
const FactionNetwork = lazy(() => import("./pages/FactionNetwork"));
const NarrativeFlowchartPage = lazy(
  () => import("./pages/NarrativeFlowchartPage"),
);
const CharacterMemories = lazy(() => import("./pages/CharacterMemories"));
const CharacterCustomization = lazy(
  () => import("./pages/CharacterCustomization"),
);
const SceneOrchestrator = lazy(() => import("./pages/SceneOrchestrator"));
const MemoryGraphDashboard = lazy(() => import("./pages/MemoryGraphDashboard"));
const CreateScenario = lazy(() => import("./pages/CreateScenario"));
const QuestTrackingDashboard = lazy(
  () => import("./pages/QuestTrackingDashboard"),
);
const CharacterLookCustomizer = lazy(
  () => import("./pages/CharacterLookCustomizer"),
);
const AIBehaviorSettings = lazy(() => import("./pages/AIBehaviorSettings"));
const RelationshipAndLocationDashboard = lazy(
  () => import("./pages/RelationshipAndLocationDashboard"),
);
const InteractiveGraphVisualization = lazy(
  () => import("./pages/InteractiveGraphVisualization"),
);
const IntegratedWorldCalendar = lazy(
  () => import("./pages/IntegratedWorldCalendar"),
);
const QuestLog = lazy(() => import("./pages/QuestLog"));
const CharacterMemoriesDashboard = lazy(
  () => import("./pages/CharacterMemoriesDashboard"),
);
const StoryBranchingGraph = lazy(() => import("./pages/StoryBranchingGraph"));
const CharacterRelationshipForceGraph = lazy(
  () => import("./pages/CharacterRelationshipForceGraph"),
);
const WorldCalendarDashboard = lazy(
  () => import("./pages/WorldCalendarDashboard"),
);
const NarrativeConflictDashboard = lazy(
  () => import("./pages/NarrativeConflictDashboard"),
);
const InteractiveInventory = lazy(() => import("./pages/InteractiveInventory"));
const QuestLogPage = lazy(() => import("./pages/QuestLogPage"));
const LoreArchivesDashboard = lazy(
  () => import("./pages/LoreArchivesDashboard"),
);
const Meditation = lazy(() => import("./pages/Meditation"));
const Subscription = lazy(() => import("./pages/Subscription"));
const LifetimeAccess = lazy(() => import("./pages/LifetimeAccess"));
const ProgressDashboard = lazy(() => import("./pages/ProgressDashboard"));
const PremiumPlans = lazy(() => import("./pages/PremiumPlans"));
const TemplateHub = lazy(() => import("./pages/TemplateHub"));
const NarrativeWorldMap = lazy(() => import("./pages/NarrativeWorldMap"));
const CompanionGenerator = lazy(() => import("./pages/CompanionGenerator"));
const StoryReader = lazy(() => import("./pages/StoryReader"));
const QuestJournal = lazy(() => import("./pages/QuestJournal"));
const TimelineDashboard = lazy(() => import("./pages/TimelineDashboard"));
const RelationshipNodeGraphPage = lazy(
  () => import("./pages/RelationshipNodeGraphPage"),
);
const WhatIfScenarios = lazy(() => import("./pages/WhatIfScenarios"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));
const Chronicles = lazy(() => import("./pages/Chronicles"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Disclaimer = lazy(() => import("./pages/Disclaimer"));

import AIDisclaimerModal from "@/components/legal/AIDisclaimerModal";
import InAppBrowserWarning from "@/components/InAppBrowserWarning";
import TapTargetValidator from "@/components/mobile/TapTargetValidator";

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="text-center">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
      <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
        Loading...
      </p>
    </div>
  </div>
);

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } =
    useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Navigation history for swipe back/forward
  const navigationStack = useRef(["/"]);
  const appContainerRef = useRef(null);
  useKeyboardAvoidance(appContainerRef);

  // Initialize color scheme on mount
  useEffect(() => {
    initializeColorScheme();
    seedCharactersIfNeeded();
  }, []);

  // Track route changes
  useEffect(() => {
    const currentPath = location.pathname;
    if (
      navigationStack.current[navigationStack.current.length - 1] !==
      currentPath
    ) {
      navigationStack.current.push(currentPath);
    }
  }, [location.pathname]);

  // Setup swipe gestures — must be in useEffect to avoid hook violations
  const handleSwipeRight = () => {
    if (navigationStack.current.length > 1) {
      navigationStack.current.pop();
      navigate(navigationStack.current[navigationStack.current.length - 1]);
    }
  };

  const handleSwipeLeft = () => {
    navigate("/");
  };

  useSwipeGestures({
    onSwipeRight: handleSwipeRight,
    onSwipeLeft: handleSwipeLeft,
    excludeSelector: "input, textarea, [data-no-swipe]",
  });

  if (authError) {
    if (authError.type === "user_not_registered") {
      return <UserNotRegisteredError />;
    } else if (authError.type === "auth_required") {
      return <Landing />;
    }
  }

  return (
    <>
      <AIDisclaimerModal onAccept={() => {}} />
      <MobileHeader />
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname.split("/")[1] || "home"}
          ref={appContainerRef}
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -20, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeInOut" }}
          className="flex-1 min-h-0 flex flex-col"
          style={{ paddingBottom: "var(--tab-bar-height, 0px)" }}
        >
          <Routes location={location}>
            {/* Root MUST show login/landing */}
            <Route
              path="/"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Landing />
                </Suspense>
              }
            />
            <Route
              path="/landing"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Landing />
                </Suspense>
              }
            />

            {/* After login, your app goes to chat */}
            <Route
              path="/login"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Landing />
                </Suspense>
              }
            />
            <Route
              path="/chat"
              element={
                <Suspense fallback={<PageLoader />}>
                  <NewChat />
                </Suspense>
              }
            />
            <Route
              path="/chat/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Chat />
                </Suspense>
              }
            />

            {/* Everything else remains as-is */}
            <Route
              path="/onboarding"
              element={
                <Suspense fallback={<PageLoader />}>
                  <OnboardingFlow />
                </Suspense>
              }
            />
            <Route
              path="/legacy-onboarding"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Onboarding />
                </Suspense>
              }
            />
            <Route
              path="/mode-select"
              element={
                <Suspense fallback={<PageLoader />}>
                  <ModeSelect />
                </Suspense>
              }
            />
            <Route
              path="/home"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Home />
                </Suspense>
              }
            />
            <Route
              path="/check-in"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CheckIn />
                </Suspense>
              }
            />
            <Route
              path="/characters"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Characters />
                </Suspense>
              }
            />
            <Route
              path="/groups"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CharacterGroups />
                </Suspense>
              }
            />
            <Route
              path="/storyboard"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Storyboard />
                </Suspense>
              }
            />
            <Route
              path="/storyboard-manager/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StoryboardManager />
                </Suspense>
              }
            />
            <Route
              path="/network"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Network />
                </Suspense>
              }
            />
            <Route
              path="/settings"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Settings />
                </Suspense>
              }
            />
            <Route
              path="/animas"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Animas />
                </Suspense>
              }
            />
            <Route
              path="/lorebook"
              element={
                <Suspense fallback={<PageLoader />}>
                  <LoreBook />
                </Suspense>
              }
            />
            <Route
              path="/worldmap"
              element={
                <Suspense fallback={<PageLoader />}>
                  <WorldMap />
                </Suspense>
              }
            />
            <Route
              path="/journals"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Journals />
                </Suspense>
              }
            />
            <Route
              path="/wiki"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Wiki />
                </Suspense>
              }
            />
            <Route
              path="/narrative"
              element={
                <Suspense fallback={<PageLoader />}>
                  <NarrativeProgress />
                </Suspense>
              }
            />
            <Route
              path="/flowchart"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StoryFlowchart />
                </Suspense>
              }
            />
            <Route
              path="/relationships"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RelationshipNetwork />
                </Suspense>
              }
            />
            <Route
              path="/graph"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CharacterGraphVisualization />
                </Suspense>
              }
            />
            <Route
              path="/archive"
              element={
                <Suspense fallback={<PageLoader />}>
                  <LoreArchive />
                </Suspense>
              }
            />
            <Route
              path="/insights"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Insights />
                </Suspense>
              }
            />
            <Route
              path="/reflections"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Reflections />
                </Suspense>
              }
            />
            <Route
              path="/discoveries"
              element={
                <Suspense fallback={<PageLoader />}>
                  <DiscoveryQueue />
                </Suspense>
              }
            />
            <Route
              path="/locationsmap"
              element={
                <Suspense fallback={<PageLoader />}>
                  <LocationsMap />
                </Suspense>
              }
            />
            <Route
              path="/relationshipviz"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RelationshipVisualization />
                </Suspense>
              }
            />
            <Route
              path="/globalwiki"
              element={
                <Suspense fallback={<PageLoader />}>
                  <GlobalWiki />
                </Suspense>
              }
            />
            <Route
              path="/worldcalendar"
              element={
                <Suspense fallback={<PageLoader />}>
                  <WorldCalendar />
                </Suspense>
              }
            />
            <Route
              path="/worldcodex"
              element={
                <Suspense fallback={<PageLoader />}>
                  <WorldCodex />
                </Suspense>
              }
            />
            <Route
              path="/relationshipgraph"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RelationshipGraph />
                </Suspense>
              }
            />
            <Route
              path="/inventory"
              element={
                <Suspense fallback={<PageLoader />}>
                  <InventoryPanel />
                </Suspense>
              }
            />
            <Route
              path="/calenderview"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CalendarView />
                </Suspense>
              }
            />
            <Route
              path="/branching"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StoryBranching />
                </Suspense>
              }
            />
            <Route
              path="/memory-map"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CharacterMemoryMap />
                </Suspense>
              }
            />
            <Route
              path="/world-pulse"
              element={
                <Suspense fallback={<PageLoader />}>
                  <WorldPulse />
                </Suspense>
              }
            />
            <Route
              path="/branching-map"
              element={
                <Suspense fallback={<PageLoader />}>
                  <NarrativeBranchingMap />
                </Suspense>
              }
            />
            <Route
              path="/relationship-graph"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RelationshipGraphPage />
                </Suspense>
              }
            />
            <Route
              path="/yn-library"
              element={
                <Suspense fallback={<PageLoader />}>
                  <YnStoriesLibrary />
                </Suspense>
              }
            />
            <Route
              path="/world-timeline"
              element={
                <Suspense fallback={<PageLoader />}>
                  <WorldTimeline />
                </Suspense>
              }
            />
            <Route
              path="/characters-repository"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CharacterRepository />
                </Suspense>
              }
            />
            <Route
              path="/analytics"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StoryAnalyticsDashboard />
                </Suspense>
              }
            />
            <Route
              path="/faction-network"
              element={
                <Suspense fallback={<PageLoader />}>
                  <FactionNetwork />
                </Suspense>
              }
            />
            <Route
              path="/story-control"
              element={
                <Suspense fallback={<PageLoader />}>
                  <NarrativeFlowchartPage />
                </Suspense>
              }
            />
            <Route
              path="/character-memories"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CharacterMemories />
                </Suspense>
              }
            />
            <Route
              path="/customize"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CharacterCustomization />
                </Suspense>
              }
            />
            <Route
              path="/orchestrate/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SceneOrchestrator />
                </Suspense>
              }
            />
            <Route
              path="/memory-graph/:characterId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <MemoryGraphDashboard />
                </Suspense>
              }
            />
            <Route
              path="/create-scenario"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CreateScenario />
                </Suspense>
              }
            />
            <Route
              path="/quests/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <QuestTrackingDashboard />
                </Suspense>
              }
            />
            <Route
              path="/looks"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CharacterLookCustomizer />
                </Suspense>
              }
            />
            <Route
              path="/ai-behavior"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AIBehaviorSettings />
                </Suspense>
              }
            />
            <Route
              path="/dashboard/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RelationshipAndLocationDashboard />
                </Suspense>
              }
            />
            <Route
              path="/graph-visualization"
              element={
                <Suspense fallback={<PageLoader />}>
                  <InteractiveGraphVisualization />
                </Suspense>
              }
            />
            <Route
              path="/graph-visualization/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <InteractiveGraphVisualization />
                </Suspense>
              }
            />
            <Route
              path="/integrated-calendar"
              element={
                <Suspense fallback={<PageLoader />}>
                  <IntegratedWorldCalendar />
                </Suspense>
              }
            />
            <Route
              path="/integrated-calendar/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <IntegratedWorldCalendar />
                </Suspense>
              }
            />
            <Route
              path="/quest-log"
              element={
                <Suspense fallback={<PageLoader />}>
                  <QuestLog />
                </Suspense>
              }
            />
            <Route
              path="/quest-log/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <QuestLog />
                </Suspense>
              }
            />
            <Route
              path="/memories"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CharacterMemoriesDashboard />
                </Suspense>
              }
            />
            <Route
              path="/story-branching/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StoryBranchingGraph />
                </Suspense>
              }
            />
            <Route
              path="/story-branching"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StoryBranchingGraph />
                </Suspense>
              }
            />
            <Route
              path="/world-calendar-dashboard"
              element={
                <Suspense fallback={<PageLoader />}>
                  <WorldCalendarDashboard />
                </Suspense>
              }
            />
            <Route
              path="/world-calendar-dashboard/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <WorldCalendarDashboard />
                </Suspense>
              }
            />
            <Route
              path="/conflict-dashboard"
              element={
                <Suspense fallback={<PageLoader />}>
                  <NarrativeConflictDashboard />
                </Suspense>
              }
            />
            <Route
              path="/interactive-inventory"
              element={
                <Suspense fallback={<PageLoader />}>
                  <InteractiveInventory />
                </Suspense>
              }
            />
            <Route
              path="/interactive-inventory/:sessionId/:characterId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <InteractiveInventory />
                </Suspense>
              }
            />
            <Route
              path="/quest-log-page"
              element={
                <Suspense fallback={<PageLoader />}>
                  <QuestLogPage />
                </Suspense>
              }
            />
            <Route
              path="/quest-log-page/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <QuestLogPage />
                </Suspense>
              }
            />
            <Route
              path="/lore-archives"
              element={
                <Suspense fallback={<PageLoader />}>
                  <LoreArchivesDashboard />
                </Suspense>
              }
            />
            <Route
              path="/meditation"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Meditation />
                </Suspense>
              }
            />
            <Route
              path="/subscription"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Subscription />
                </Suspense>
              }
            />
            <Route
              path="/lifetime-access"
              element={
                <Suspense fallback={<PageLoader />}>
                  <LifetimeAccess />
                </Suspense>
              }
            />
            <Route
              path="/narrative-world-map/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <NarrativeWorldMap />
                </Suspense>
              }
            />
            <Route
              path="/companion-generator"
              element={
                <Suspense fallback={<PageLoader />}>
                  <CompanionGenerator />
                </Suspense>
              }
            />
            <Route
              path="/what-if"
              element={
                <Suspense fallback={<PageLoader />}>
                  <WhatIfScenarios />
                </Suspense>
              }
            />
            <Route
              path="/story-reader/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StoryReader />
                </Suspense>
              }
            />
            <Route
              path="/quest-journal"
              element={
                <Suspense fallback={<PageLoader />}>
                  <QuestJournal />
                </Suspense>
              }
            />
            <Route
              path="/timeline/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <TimelineDashboard />
                </Suspense>
              }
            />
            <Route
              path="/relationship-graph/:sessionId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RelationshipNodeGraphPage />
                </Suspense>
              }
            />
            <Route
              path="/relationship-graph"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RelationshipNodeGraphPage />
                </Suspense>
              }
            />
            <Route
              path="/terms"
              element={
                <Suspense fallback={<PageLoader />}>
                  <TermsOfUse />
                </Suspense>
              }
            />
            <Route
              path="/chronicles"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Chronicles />
                </Suspense>
              }
            />
            <Route
              path="/privacy-policy"
              element={
                <Suspense fallback={<PageLoader />}>
                  <PrivacyPolicy />
                </Suspense>
              }
            />
            <Route
              path="/disclaimer"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Disclaimer />
                </Suspense>
              }
            />
            <Route
              path="/progress"
              element={
                <Suspense fallback={<PageLoader />}>
                  <ProgressDashboard />
                </Suspense>
              }
            />
            <Route
              path="/premium"
              element={
                <Suspense fallback={<PageLoader />}>
                  <PremiumPlans />
                </Suspense>
              }
            />
            <Route
              path="/templates"
              element={
                <Suspense fallback={<PageLoader />}>
                  <TemplateHub />
                </Suspense>
              }
            />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
      {!['/', '/landing', '/login'].includes(location.pathname) && <BottomTabBar />}
    </>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <InAppBrowserWarning />
          <TapTargetValidator />
          <div
            className="flex flex-col h-[100dvh]"
            style={{
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            <AuthenticatedApp />
          </div>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
