import ScenarioHub from "./ScenarioHub";

// The What-If entry point is the hub; creating a scenario lives on its own
// route (/create-scenario), which saves and returns here.
export default function WhatIfScenarios() { return <ScenarioHub />; }
