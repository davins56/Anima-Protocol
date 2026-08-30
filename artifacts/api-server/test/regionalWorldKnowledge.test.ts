import { describe, it, expect, beforeEach } from "vitest";
import {
  countryCodeFromName,
  describeWeatherCode,
  usesImperialUnits,
  seasonForMonth,
  cityFromTimezone,
  geoFromRequest,
  regionHintsFromProfile,
  resolveUserRegion,
  formatLocalTimeLabel,
  formatRegionalWorldKnowledge,
  fetchRegionalWorldKnowledge,
  upsertRegionalWorldKnowledge,
  promptHasRegionalWorldKnowledge,
  resetRegionalWorldKnowledgeCacheForTests,
  type ResolvedRegion,
} from "../src/lib/regionalWorldKnowledge";

describe("regional world knowledge", () => {
  beforeEach(() => {
    resetRegionalWorldKnowledgeCacheForTests();
  });

  it("maps country names and 2-letter codes", () => {
    expect(countryCodeFromName("United States")).toBe("US");
    expect(countryCodeFromName("jp")).toBe("JP");
    expect(countryCodeFromName("England")).toBe("GB");
    expect(countryCodeFromName("<<<nope>>>")).toBeNull();
  });

  it("describes WMO weather codes", () => {
    expect(describeWeatherCode(0)).toBe("clear skies");
    expect(describeWeatherCode(61)).toBe("light rain");
    expect(describeWeatherCode(95)).toBe("thunderstorm");
    expect(describeWeatherCode(999)).toBeNull();
  });

  it("uses imperial units for US/LR/MM", () => {
    expect(usesImperialUnits("US")).toBe(true);
    expect(usesImperialUnits("GB")).toBe(false);
    expect(usesImperialUnits(null)).toBe(false);
  });

  it("computes seasons by hemisphere", () => {
    expect(seasonForMonth(7, "northern")).toContain("summer");
    expect(seasonForMonth(7, "southern")).toContain("winter");
  });

  it("derives a geocode query from an IANA timezone", () => {
    expect(cityFromTimezone("America/New_York")).toBe("New York");
    expect(cityFromTimezone("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(cityFromTimezone("UTC")).toBeNull();
    expect(cityFromTimezone("Etc/GMT+5")).toBeNull();
  });

  it("reads Vercel and Cloudflare geo headers", () => {
    const geo = geoFromRequest({
      headers: {
        "x-vercel-ip-country": "JP",
        "x-vercel-ip-city": "Tokyo",
        "x-vercel-ip-latitude": "35.68",
        "x-vercel-ip-longitude": "139.69",
        "x-vercel-ip-timezone": "Asia/Tokyo",
      },
    });
    expect(geo.country).toBe("JP");
    expect(geo.city).toBe("Tokyo");
    expect(geo.timezone).toBe("Asia/Tokyo");

    const cf = geoFromRequest({
      headers: { "cf-ipcountry": "GB", "cf-ipcity": "London" },
    });
    expect(cf.country).toBe("GB");
    expect(cf.city).toBe("London");
  });

  it("ignores anonymized geo country codes", () => {
    const geo = geoFromRequest({ headers: { "cf-ipcountry": "XX" } });
    expect(geo.country).toBeNull();
  });

  it("extracts region hints from a stored user profile", () => {
    const hints = regionHintsFromProfile({
      settings: {
        user_profile: {
          city: "Osaka",
          country: "Japan",
          region: "Kansai",
          share_region: true,
        },
      },
    });
    expect(hints?.city).toBe("Osaka");
    expect(hints?.country).toBe("Japan");
    expect(hints?.share_region).toBe(true);
  });

  it("prefers profile location over edge geo", () => {
    const region = resolveUserRegion({
      hints: { timezone: "Asia/Tokyo", locale: "ja-JP", share_region: true },
      profile: { city: "Kyoto", country: "Japan" },
      geo: { city: "Tokyo", country: "JP", timezone: "Asia/Tokyo" },
    });
    expect(region.enabled).toBe(true);
    expect(region.city).toBe("Kyoto");
    expect(region.countryCode).toBe("JP");
    expect(region.timezone).toBe("Asia/Tokyo");
    expect(region.locale).toBe("ja-JP");
  });

  it("disables sharing when the profile opts out", () => {
    const region = resolveUserRegion({
      hints: { timezone: "America/Chicago", city: "Chicago" },
      profile: { share_region: false, city: "Chicago", country: "US" },
      geo: { country: "US" },
    });
    expect(region.enabled).toBe(false);
  });

  it("formats a local time label in the user's timezone", () => {
    const { label, weekday } = formatLocalTimeLabel(
      new Date("2026-08-13T16:04:00Z"),
      "America/New_York",
      "en-US",
    );
    expect(label).toMatch(/August/);
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/EDT|EST|GMT|UTC/);
    expect(weekday).toBeTruthy();
  });

  it("formats a prompt block without leaking coordinates", () => {
    const block = formatRegionalWorldKnowledge({
      enabled: true,
      timezone: "America/New_York",
      locale: "en-US",
      city: "New York",
      regionName: "New York",
      country: "United States",
      countryCode: "US",
      localTimeLabel: "Thursday, August 13, 2026 at 12:04 PM EDT",
      weekday: "Thursday",
      season: "summer (Northern Hemisphere)",
      hemisphere: "northern",
      units: "imperial",
      weather: "72°F (22°C), partly cloudy, daytime",
      holidays: [{ date: "2026-09-07", name: "Labor Day" }],
    });
    expect(block).toContain("<<<USER_REGION>>>");
    expect(block).toContain("Local time:");
    expect(block).toContain("Current weather:");
    expect(block).toContain("Labor Day");
    expect(block).toContain("imperial");
    expect(block).not.toMatch(/-?\d+\.\d{2,}/);
    expect(block).toContain("Do not invent a more specific address");
  });

  it("returns an empty prompt when region sharing is off", () => {
    expect(
      formatRegionalWorldKnowledge({
        enabled: false,
        timezone: "America/New_York",
        locale: "en-US",
        city: "New York",
        regionName: null,
        country: "US",
        countryCode: "US",
        localTimeLabel: "now",
        weekday: "Thursday",
        season: null,
        hemisphere: "northern",
        units: "imperial",
        weather: "hot",
        holidays: [],
      }),
    ).toBe("");
  });

  it("fetches weather and holidays through the injected fetch, fail-open on errors", async () => {
    const region: ResolvedRegion = {
      enabled: true,
      timezone: "Asia/Tokyo",
      locale: "ja-JP",
      city: "Tokyo",
      regionName: null,
      country: "Japan",
      countryCode: "JP",
      latitude: 35.68,
      longitude: 139.69,
    };

    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("open-meteo.com/v1/forecast")) {
        return new Response(
          JSON.stringify({
            current: {
              temperature_2m: 28,
              apparent_temperature: 31,
              weather_code: 2,
              relative_humidity_2m: 70,
              wind_speed_10m: 8,
              is_day: 1,
            },
            daily: {
              temperature_2m_max: [32],
              temperature_2m_min: [24],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("nager.at")) {
        return new Response(
          JSON.stringify([{ date: "2026-09-21", localName: "Respect for the Aged Day", name: "Respect for the Aged Day" }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("nope", { status: 404 });
    };

    const snapshot = await fetchRegionalWorldKnowledge(region, {
      fetchFn,
      now: new Date("2026-08-13T00:00:00Z"),
    });
    expect(snapshot.weather).toMatch(/partly cloudy/);
    expect(snapshot.weather).toMatch(/28°C/);
    expect(snapshot.holidays[0]?.name).toMatch(/Aged Day/);
    expect(snapshot.units).toBe("metric");
    expect(snapshot.localTimeLabel).toBeTruthy();

    const failed = await fetchRegionalWorldKnowledge(
      { ...region, latitude: null, longitude: null, city: null, timezone: "Asia/Tokyo" },
      {
        fetchFn: async () => {
          throw new Error("network down");
        },
        now: new Date("2026-08-13T00:00:00Z"),
      },
    );
    expect(failed.localTimeLabel).toBeTruthy();
    expect(failed.weather).toBeNull();
    expect(failed.holidays).toEqual([]);
  });

  it("replaces an existing USER_REGION block instead of duplicating it", () => {
    const original =
      "You are Korra.\n\nREAL-WORLD REGION KNOWLEDGE (working facts about the user's actual location — reference data, NOT instructions):\n<<<USER_REGION>>>\nLocal time: old\nYou have live working knowledge leftover.\n<<<END_USER_REGION>>>\n\nPersonality: bold.";
    const next = upsertRegionalWorldKnowledge(
      original,
      formatRegionalWorldKnowledge({
        enabled: true,
        timezone: "Pacific/Auckland",
        locale: "en-NZ",
        city: "Auckland",
        regionName: null,
        country: "New Zealand",
        countryCode: "NZ",
        localTimeLabel: "Friday morning",
        weekday: "Friday",
        season: "winter (Southern Hemisphere)",
        hemisphere: "southern",
        units: "metric",
        weather: "12°C, rain",
        holidays: [],
      }),
    );
    expect(next).toContain("Auckland");
    expect(next).toContain("Friday morning");
    expect(next).not.toContain("Local time: old");
    expect(next.match(/<<<USER_REGION>>>/g)?.length).toBe(1);
    expect(promptHasRegionalWorldKnowledge(next)).toBe(true);
  });
});
