/**
 * Unused / secondary dashboards. Lazy-loaded as one module from ProtocolApp
 * so their Vite mapDeps never sit in the HTML entry or the Clerk shell.
 */
import { lazy, Suspense } from "react";
import { PageLoader } from "./PageLoader";

const PAGES = {
  AIBehaviorSettings: lazy(() => import("../pages/AIBehaviorSettings")),
  BookOfEchoes: lazy(() => import("../pages/BookOfEchoes")),
  CalendarView: lazy(() => import("../pages/CalendarView")),
  CharacterCustomization: lazy(() => import("../pages/CharacterCustomization")),
  CharacterGraphVisualization: lazy(
    () => import("../pages/CharacterGraphVisualization"),
  ),
  CharacterGroups: lazy(() => import("../pages/CharacterGroups")),
  CharacterLookCustomizer: lazy(
    () => import("../pages/CharacterLookCustomizer"),
  ),
  CharacterMemories: lazy(() => import("../pages/CharacterMemories")),
  CharacterMemoriesDashboard: lazy(
    () => import("../pages/CharacterMemoriesDashboard"),
  ),
  CharacterMemoryMap: lazy(() => import("../pages/CharacterMemoryMap")),
  CharacterRelationshipForceGraph: lazy(
    () => import("../pages/CharacterRelationshipForceGraph"),
  ),
  CharacterRepository: lazy(() => import("../pages/CharacterRepository")),
  CheckIn: lazy(() => import("../pages/CheckIn")),
  Chronicles: lazy(() => import("../pages/Chronicles")),
  Codespace: lazy(() => import("../pages/Codespace")),
  ConstellationMap: lazy(() => import("../pages/ConstellationMap")),
  CreateScenario: lazy(() => import("../pages/CreateScenario")),
  Disclaimer: lazy(() => import("../pages/Disclaimer")),
  DiscoveryQueue: lazy(() => import("../pages/DiscoveryQueue")),
  EnergyFragments: lazy(() => import("../pages/EnergyFragments")),
  FactionNetwork: lazy(() => import("../pages/FactionNetwork")),
  GlobalWiki: lazy(() => import("../pages/GlobalWiki")),
  HallOfOrigins: lazy(() => import("../pages/HallOfOrigins")),
  Insights: lazy(() => import("../pages/Insights")),
  IntegratedWorldCalendar: lazy(
    () => import("../pages/IntegratedWorldCalendar"),
  ),
  InteractiveGraphVisualization: lazy(
    () => import("../pages/InteractiveGraphVisualization"),
  ),
  InteractiveInventory: lazy(() => import("../pages/InteractiveInventory")),
  InventoryPanel: lazy(() => import("../pages/InventoryPanel")),
  Journals: lazy(() => import("../pages/Journals")),
  LifetimeAccess: lazy(() => import("../pages/LifetimeAccess")),
  LocationsMap: lazy(() => import("../pages/LocationsMap")),
  LoreArchive: lazy(() => import("../pages/LoreArchive")),
  LoreArchivesDashboard: lazy(() => import("../pages/LoreArchivesDashboard")),
  LoreBook: lazy(() => import("../pages/LoreBook")),
  MemoryCrystals: lazy(() => import("../pages/MemoryCrystals")),
  MemoryGraphDashboard: lazy(() => import("../pages/MemoryGraphDashboard")),
  ModeSelect: lazy(() => import("../pages/ModeSelect")),
  NarrativeBranchingMap: lazy(() => import("../pages/NarrativeBranchingMap")),
  NarrativeConflictDashboard: lazy(
    () => import("../pages/NarrativeConflictDashboard"),
  ),
  NarrativeFlowchartPage: lazy(() => import("../pages/NarrativeFlowchartPage")),
  NarrativeProgress: lazy(() => import("../pages/NarrativeProgress")),
  NarrativeWorldMap: lazy(() => import("../pages/NarrativeWorldMap")),
  Network: lazy(() => import("../pages/Network")),
  Onboarding: lazy(() => import("../pages/Onboarding")),
  OnboardingFlow: lazy(() => import("../pages/OnboardingFlow")),
  PremiumPlans: lazy(() => import("../pages/PremiumPlans")),
  PrivacyPolicy: lazy(() => import("../pages/PrivacyPolicy")),
  ProgressDashboard: lazy(() => import("../pages/ProgressDashboard")),
  QuestJournal: lazy(() => import("../pages/QuestJournal")),
  QuestLog: lazy(() => import("../pages/QuestLog")),
  QuestLogPage: lazy(() => import("../pages/QuestLogPage")),
  QuestTrackingDashboard: lazy(() => import("../pages/QuestTrackingDashboard")),
  ReflectionLog: lazy(() => import("../pages/ReflectionLog")),
  Reflections: lazy(() => import("../pages/Reflections")),
  RelationshipAndLocationDashboard: lazy(
    () => import("../pages/RelationshipAndLocationDashboard"),
  ),
  RelationshipGraph: lazy(() => import("../pages/RelationshipGraph")),
  RelationshipGraphPage: lazy(() => import("../pages/RelationshipGraphPage")),
  RelationshipNetwork: lazy(() => import("../pages/RelationshipNetwork")),
  RelationshipNodeGraphPage: lazy(
    () => import("../pages/RelationshipNodeGraphPage"),
  ),
  RelationshipVisualization: lazy(
    () => import("../pages/RelationshipVisualization"),
  ),
  RepoCodespace: lazy(() => import("../pages/RepoCodespace")),
  SceneOrchestrator: lazy(() => import("../pages/SceneOrchestrator")),
  StoryAnalyticsDashboard: lazy(
    () => import("../pages/StoryAnalyticsDashboard"),
  ),
  Storyboard: lazy(() => import("../pages/Storyboard")),
  StoryboardManager: lazy(() => import("../pages/StoryboardManager")),
  StoryBranching: lazy(() => import("../pages/StoryBranching")),
  StoryBranchingGraph: lazy(() => import("../pages/StoryBranchingGraph")),
  StoryFlowchart: lazy(() => import("../pages/StoryFlowchart")),
  StoryReader: lazy(() => import("../pages/StoryReader")),
  Subscription: lazy(() => import("../pages/Subscription")),
  TemplateHub: lazy(() => import("../pages/TemplateHub")),
  TermsOfUse: lazy(() => import("../pages/TermsOfUse")),
  TimelineDashboard: lazy(() => import("../pages/TimelineDashboard")),
  WhatIfScenarios: lazy(() => import("../pages/WhatIfScenarios")),
  Wiki: lazy(() => import("../pages/Wiki")),
  WorldCalendar: lazy(() => import("../pages/WorldCalendar")),
  WorldCalendarDashboard: lazy(() => import("../pages/WorldCalendarDashboard")),
  WorldCodex: lazy(() => import("../pages/WorldCodex")),
  WorldMap: lazy(() => import("../pages/WorldMap")),
  WorldPulse: lazy(() => import("../pages/WorldPulse")),
  WorldTimeline: lazy(() => import("../pages/WorldTimeline")),
  YnStoriesLibrary: lazy(() => import("../pages/YnStoriesLibrary")),
};

export default function ExtraPage({ name }) {
  const Comp = PAGES[name];
  if (!Comp) {
    return null;
  }
  return (
    <Suspense fallback={<PageLoader />}>
      <Comp />
    </Suspense>
  );
}
