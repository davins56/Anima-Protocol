import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";

export function useDailyCompilation(sessionId, calendar, activeCharacterId) {
  const [summary, setSummary] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const lastDayRef = useRef(null);

  useEffect(() => {
    if (!sessionId || !calendar) return;

    const currentDay = calendar.day_of_season;
    const currentSeason = calendar.current_season;

    // Initialize lastDay on first load
    if (lastDayRef.current === null) {
      lastDayRef.current = currentDay;
      return;
    }

    // Detect day change (new day started)
    if (currentDay !== lastDayRef.current) {
      // Day has changed, generate summary for the previous day
      generateDailySummary(sessionId, activeCharacterId);
      lastDayRef.current = currentDay;
    }
  }, [calendar?.day_of_season, calendar?.current_season, sessionId, activeCharacterId]);

  const generateDailySummary = async (sid, charId) => {
    try {
      const result = await base44.functions.invoke("dailyJournalCompilation", {
        session_id: sid,
        character_id: charId,
      });

      if (result?.data?.summary) {
        setSummary({
          ...result.data.summary,
          season: calendar?.current_season,
          day_of_season: lastDayRef.current,
        });
        setShowSummary(true);
      }
    } catch (err) {
      console.error("Error generating daily summary:", err);
    }
  };

  const closeSummary = () => {
    setShowSummary(false);
  };

  return {
    summary,
    showSummary,
    closeSummary,
  };
}