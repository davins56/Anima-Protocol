import { useState, useEffect } from "react";

// Visual states represent UI activity, not inferred emotions or consciousness.
export function useLivingAnima(animaId) {
  const [activity, setActivity] = useState("idle");
  useEffect(() => { setActivity("idle"); }, [animaId]);
  const emotion = activity === "focused" ? "curious" : activity === "celebrating" ? "happy" : "calm";
  return { activity, setActivity, emotion };
}
