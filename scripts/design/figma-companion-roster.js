// Pending Figma update for feature/companion-roster (Figma MCP Starter-plan call limit hit before it ran).
// Run via the Figma MCP `use_figma` tool on file VkJdHFwuUvVrNUiXwSgo82 (Plugin API). Does not share/publish.
// - Components page: "Chip · Aelindra" (5:339) -> "Chip · Aeland" (propagates to the Vessel Studio instance 6:600)
// - adds "Chip · Scarlet" next to it
// - Primitives collection: scarlet/200, scarlet/400, scarlet/500, scarlet/900 (match design/anima-tokens.json)
const comps = figma.root.children.find((p) => p.name === "Components");
await figma.setCurrentPageAsync(comps);
const chip = await figma.getNodeByIdAsync("5:339");
const txt = chip.findOne((n) => n.type === "TEXT");
await figma.loadFontAsync(txt.fontName);
txt.characters = "Aeland";
chip.name = "Chip · Aeland";
const sc = chip.clone();
chip.parent.insertChild(chip.parent.children.indexOf(chip) + 1, sc);
sc.name = "Chip · Scarlet";
const st = sc.findOne((n) => n.type === "TEXT");
await figma.loadFontAsync(st.fontName);
st.characters = "Scarlet";
if (!chip.parent.layoutMode || chip.parent.layoutMode === "NONE") { sc.x = chip.x + chip.width + 8; sc.y = chip.y; }
const col = await figma.variables.getVariableCollectionByIdAsync("VariableCollectionId:1:6");
const existing = (await figma.variables.getLocalVariablesAsync("COLOR")).map((v) => v.name);
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });
for (const [n, h] of [["scarlet/200", "#FECACA"], ["scarlet/400", "#FDE047"], ["scarlet/500", "#F97316"], ["scarlet/900", "#7F1D1D"]]) {
  if (existing.includes(n)) continue;
  const v = figma.variables.createVariable(n, col, "COLOR");
  v.setValueForMode("1:0", hex(h));
  v.description = "Scarlet (built-in companion, flame vessel)";
  v.setVariableCodeSyntax("WEB", `var(--anima-${n.replace("/", "-")})`);
}
return { chip: chip.id, scarlet: sc.id };
