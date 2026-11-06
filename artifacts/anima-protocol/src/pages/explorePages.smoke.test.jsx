/**
 * Smoke-renders every page listed under the Explore menu.
 *
 * Each page is mounted in jsdom with Clerk and the API client mocked, so this
 * catches what a static scan cannot: crashes on import, undefined props,
 * render-time assertions, and pages that mount to nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "@/lib/ConfirmDialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ProtocolApp also supplies the QueryClient; Chat reads it via useQueryClient().
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

vi.mock("@clerk/react", () => {
  const user = {
    id: "user_test",
    firstName: "Test",
    fullName: "Test User",
    username: "test",
    imageUrl: "",
    primaryEmailAddress: { emailAddress: "test@example.com" },
    publicMetadata: {},
    unsafeMetadata: {},
    createdAt: new Date("2024-01-01").toISOString(),
  };
  return {
    ClerkProvider: ({ children }) => children,
    useUser: () => ({ isLoaded: true, isSignedIn: true, user }),
    useAuth: () => ({
      isLoaded: true,
      isSignedIn: true,
      userId: "user_test",
      sessionId: "sess_test",
      getToken: async () => "token",
      signOut: async () => {},
    }),
    useClerk: () => ({
      signOut: async () => {},
      openUserProfile: () => {},
      loaded: true,
    }),
    useSession: () => ({ isLoaded: true, session: { id: "sess_test" } }),
    SignedIn: ({ children }) => children,
    SignedOut: () => null,
    SignIn: () => null,
    SignUp: () => null,
    UserButton: () => null,
  };
});

// Any property is callable and resolves to an empty list, so list/filter/get
// callers all take their empty branch instead of throwing.
function emptyNode() {
  const fn = () => Promise.resolve([]);
  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === "then" || prop === "toJSON") return undefined;
      return emptyNode();
    },
  });
}

vi.mock("@/api/animaClient", () => ({
  animaClient: emptyNode(),
  default: emptyNode(),
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user_test", firstName: "Test", fullName: "Test User" },
    isLoaded: true,
    isSignedIn: true,
    isSteward: false,
    signOut: async () => {},
  }),
  AuthProvider: ({ children }) => children,
}));

vi.mock("@/lib/analytics", () => ({
  track: () => {},
  identifyUser: () => {},
  resetUser: () => {},
  setProfile: () => {},
  initAnalytics: () => {},
}));

vi.mock("@/lib/mixpanel", () => ({ track: () => {} }));

const PAGES = [
  ["Chat", () => import("@/pages/Chat")],
  ["HallOfOrigins", () => import("@/pages/HallOfOrigins")],
  ["MemoryCrystals", () => import("@/pages/MemoryCrystals")],
  ["ConstellationMap", () => import("@/pages/ConstellationMap")],
  ["BookOfEchoes", () => import("@/pages/BookOfEchoes")],
  ["Codespace", () => import("@/pages/Codespace")],
  ["RepoCodespace", () => import("@/pages/RepoCodespace")],
  ["NetBattle", () => import("@/pages/NetBattle")],
  ["Settings", () => import("@/pages/Settings")],
  ["Storyboard", () => import("@/pages/Storyboard")],
  ["NarrativeProgress", () => import("@/pages/NarrativeProgress")],
  ["StoryFlowchart", () => import("@/pages/StoryFlowchart")],
  ["ScenarioHub", () => import("@/pages/ScenarioHub")],
  ["QuestJournal", () => import("@/pages/QuestJournal")],
  ["WorldMap", () => import("@/pages/WorldMap")],
  ["LocationsMap", () => import("@/pages/LocationsMap")],
  ["IntegratedWorldCalendar", () => import("@/pages/IntegratedWorldCalendar")],
  ["Chronicles", () => import("@/pages/Chronicles")],
  ["WorldCodex", () => import("@/pages/WorldCodex")],
  ["LoreBook", () => import("@/pages/LoreBook")],
  ["Journals", () => import("@/pages/Journals")],
  ["Wiki", () => import("@/pages/Wiki")],
  ["GlobalWiki", () => import("@/pages/GlobalWiki")],
  ["CharacterMemoryMap", () => import("@/pages/CharacterMemoryMap")],
  ["InventoryPanel", () => import("@/pages/InventoryPanel")],
  ["EnergyFragments", () => import("@/pages/EnergyFragments")],
  ["EchoKeys", () => import("@/pages/EchoKeys")],
  ["Characters", () => import("@/pages/Characters")],
  ["CustomiseAnima", () => import("@/pages/CustomiseAnima")],
  ["CheckIn", () => import("@/pages/CheckIn")],
  ["Therapy", () => import("@/pages/Therapy")],
  ["ReflectionLog", () => import("@/pages/ReflectionLog")],
];

afterEach(() => cleanup());

describe("Explore pages mount", () => {
  it.each(PAGES)("%s renders without crashing", async (name, load) => {
    const mod = await load();
    const Page = mod.default;
    expect(typeof Page, `${name} has a default export`).toBe("function");

    // ProtocolApp wraps <Routes> in ConfirmProvider; pages calling useConfirm()
    // throw without it.
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/x"]}>
          <ConfirmProvider>
            <Page />
          </ConfirmProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // A page that mounts to an empty tree is a blank screen for the user.
    expect(container.innerHTML.trim().length, `${name} rendered nothing`).toBeGreaterThan(0);
  });
});
