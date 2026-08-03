# Inventory Management System Guide

## Overview

The inventory management system lets characters acquire, trade, and lose items throughout their story. Items have stat modifiers, special effects, and influence narrative choices automatically.

## Features

### 1. **Item Management**
- **Types**: gear, consumable, weapon, armor, artifact, misc
- **Rarity Levels**: common, uncommon, rare, legendary
- **Stat Modifiers**: Items can modify character stats (strength, dexterity, constitution, intelligence, wisdom, charisma) when equipped
- **Effects**: Special abilities (fire_resistance, dark_vision, poison_immunity, etc.)
- **Trade Value**: Currency value for economy
- **Condition**: Item durability (0-100%)
- **Crafting**: Mark items as craftable with required components

### 2. **Trading System**
Characters can trade items with other characters in the session.

**How Trading Works**:
1. Initiator selects recipient and items to offer
2. Recipient receives trade offer notification
3. Recipient can counter-offer or accept
4. Trade completes and items transfer between characters

**Files Involved**:
- Entity: `Trade` (tracks all trades)
- Function: `inventoryTrading.js` (execute trades)
- Component: `InventoryTradePanel.jsx` (UI)

### 3. **Stat Calculation & Equipment Impact**
When items are equipped, their stat modifiers automatically affect the character's overall stats.

**Stat Ranges**:
- Base: 0
- Max Bonus/Penalty: +/-20 (capped)
- Common Modifications: +1 to +5 per item

**Function**: `calculateInventoryStats.js`
- Calculates equipped stat totals
- Collects active effects
- Tracks total trade value
- Returns all data for narrative/mechanical decisions

### 4. **Narrative Integration**
Items influence story choices and character abilities.

**How It Works**:
1. **Item-Driven Choices**: When special items are equipped, narrative choices appear that leverage those items
2. **Automatic Effects**: Items with narrative_triggers create story hooks
3. **Dynamic Prompting**: AI uses item context to generate contextual story branches

**Component**: `InventoryNarrativePanel.jsx`
- Shows item-influenced choices
- Requires special items (rare/legendary)
- Displays stat bonuses for each choice
- Updates with recent story context

### 5. **Item Loss Processing**
Items are automatically tracked as lost, destroyed, or stolen based on narrative.

**Loss Types**:
- `destroy`: Permanent removal (broken)
- `drop`: Lost (can sometimes be recovered)
- `steal`: Stolen by enemies/NPCs
- `consume`: Used up (consumables)
- `narrative`: Auto-detected from story

**Function**: `processItemLoss.js`
- Detects loss keywords in narrative
- Removes quantity from inventory
- Unequips lost items
- Creates narrative events for tracking

### 6. **Crafting System**
Characters can craft new items from components.

**Components**:
- Require gathered items (wood, ore, cloth, etc.)
- Multiple items can form one recipe
- Output is a new crafted item

**Function**: `craftItem.js`
- Validates component availability
- Consumes components
- Creates new item with crafted tag

## Integration in Chat

### Imports
```javascript
import InventoryStatDisplay from "@/components/inventory/InventoryStatDisplay";
import InventoryNarrativePanel from "@/components/inventory/InventoryNarrativePanel";
import InventoryTradePanel from "@/components/inventory/InventoryTradePanel";
import { useInventoryIntegration } from "@/hooks/useInventoryIntegration";
```

### Usage Hook
```javascript
const { 
  detectAndProcessItemLoss, 
  calculateEquipmentImpact, 
  generateInventoryNarrativeChoices 
} = useInventoryIntegration();

// After AI message generation:
await detectAndProcessItemLoss(aiResponse, characterId, sessionId);

// In narrative analysis:
const equippedStats = await calculateEquipmentImpact(characterId, sessionId);

// When generating choices:
const itemChoices = await generateInventoryNarrativeChoices(
  characterId, 
  sessionId, 
  recentMessages
);
```

### Components in Chat Page
```jsx
{/* Display equipment stats */}
<InventoryStatDisplay 
  characterId={activeSession.character_id} 
  sessionId={activeSession.id}
/>

{/* Show item-influenced narrative choices */}
<InventoryNarrativePanel
  characterId={activeSession.character_id}
  sessionId={activeSession.id}
  recentMessages={activeSession?.messages || []}
/>

{/* Trading panel */}
<InventoryTradePanel
  sessionId={activeSession.id}
  characterId={activeSession.character_id}
  characters={characters}
  onTradeComplete={() => loadInventory(activeSession.character_id)}
/>
```

## Entity Schemas

### Inventory
```json
{
  "character_id": "string (required)",
  "session_id": "string",
  "name": "string (required)",
  "type": "gear|consumable|weapon|armor|artifact|misc",
  "quantity": 1,
  "equipped": false,
  "slot": "head|chest|hands|feet|weapon|offhand|accessory|none",
  "rarity": "common|uncommon|rare|legendary",
  "stat_modifiers": { "strength": 5, "wisdom": -2 },
  "effects": ["fire_resistance", "dark_vision"],
  "trade_value": 10,
  "condition": 100,
  "craftable": false,
  "components": [{ "item_name": "Wood", "quantity": 2 }],
  "narrative_triggers": ["reveal_secret", "unlock_path"]
}
```

### Trade
```json
{
  "session_id": "string (required)",
  "initiator_id": "string (required)",
  "recipient_id": "string (required)",
  "initiator_items": [{ "inventory_id", "name", "quantity" }],
  "recipient_items": [{ "inventory_id", "name", "quantity" }],
  "status": "pending|accepted|rejected|completed|cancelled",
  "relationship_impact": -10 to 100,
  "completed_at": "date-time"
}
```

## Backend Functions

| Function | Purpose |
|----------|---------|
| `inventoryTrading.js` | Manage trade offers, counter-offers, and completion |
| `calculateInventoryStats.js` | Calculate stat totals from equipped items |
| `inventoryNarrativeImpact.js` | Generate narrative choices influenced by inventory |
| `processItemLoss.js` | Auto-detect and process item loss from narrative |
| `craftItem.js` | Validate and execute crafting recipes |

## Example: Adding an Item During Story

```javascript
// In narrative processing or directly in Chat:
await base44.entities.Inventory.create({
  character_id: activeChar.id,
  session_id: activeSession.id,
  name: "Ancient Sword",
  type: "weapon",
  rarity: "rare",
  description: "A glowing blade that hums with power",
  stat_modifiers: { strength: 3, charisma: 1 },
  effects: ["light_projection", "undead_slayer"],
  trade_value: 50,
  craftable: false,
  narrative_triggers: ["confront_shadow_self", "ultimate_battle"],
});
```

## Example: Trading Between Characters

```javascript
// Step 1: Initiate trade
await base44.functions.invoke('inventoryTrading', {
  action: 'initiate_trade',
  session_id: sessionId,
  initiator_id: char1Id,
  recipient_id: char2Id,
  initiator_items: [{ inventory_id: item1Id, name: 'Sword', quantity: 1 }],
});

// Step 2: Recipient accepts
await base44.functions.invoke('inventoryTrading', {
  action: 'accept_trade',
  trade_id: tradeId,
});
```

## Example: Item Loss from Story

```javascript
// AI narrative mentions the sword was destroyed
"The ancient sword shattered against the demon's scales..."

// This triggers automatic detection:
await base44.functions.invoke('processItemLoss', {
  character_id: characterId,
  session_id: sessionId,
  loss_type: 'destroy',
  item_name: 'Ancient Sword',
  quantity: 1,
  reason: 'Destroyed in final battle',
});
```

## Tips for Narrative Impact

1. **Rare Items**: Only rare/legendary items generate special narrative choices
2. **Stat Bonuses**: Display stat bonuses in choice descriptions to show mechanical impact
3. **Item Requirements**: Some narrative paths should require specific items
4. **Loss Events**: Lost items create dramatic moments — use sparingly for impact
5. **Trading Relationships**: Trades affect relationship stats between characters

## Future Enhancements

- Item degradation system (condition decreases with use)
- Multi-step crafting recipes with workbenches
- Enchantment system to augment items
- Item-specific abilities/skills
- Merchant NPCs with inventory
- Loot generation from encounters
- Equipment loadout management