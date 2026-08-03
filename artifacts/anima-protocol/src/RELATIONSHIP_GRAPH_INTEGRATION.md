# Relationship Evolution Graph - Integration Guide

## Components Created

### 1. **RelationshipEvolutionGraph** (`components/relationships/RelationshipEvolutionGraph.jsx`)
- Interactive circular network graph visualization
- Shows character nodes with relationship edges
- Edge thickness & color represent relationship strength & tier
- Click nodes to view detailed relationship info
- Includes tier legend and summary statistics (strongest/average/weakest)

### 2. **RelationshipTimeline** (`components/relationships/RelationshipTimeline.jsx`)
- Vertical timeline of relationship evolution for a single character
- Shows all relationships with expandable details
- Displays score history, trust level, interaction count
- Lists recurring themes and turning points
- Animated progress bar showing -100 to +100 score range

### 3. **CharacterRelationship Entity** (`entities/CharacterRelationship.json`)
- Stores bidirectional relationships between characters
- Tracks score history with deltas and catalysts
- Records relationship arcs (forming → deepening → stable/deteriorating)
- Stores key turning points and recurring themes

## How to Integrate

### Add to Chat Page

Import both components at the top of `pages/Chat.jsx`:

```javascript
import RelationshipEvolutionGraph from "@/components/relationships/RelationshipEvolutionGraph";
import RelationshipTimeline from "@/components/relationships/RelationshipTimeline";
```

Then add them to the dashboard area in Chat (around line 1400):

```javascript
{/* Relationships Section */}
<RelationshipEvolutionGraph 
  sessionId={activeSession?.id} 
  characters={characters}
/>

{/* Individual Character Timeline */}
{activeSession?.character_id && (
  <RelationshipTimeline 
    sessionId={activeSession?.id}
    characterId={activeSession?.character_id}
  />
)}
```

## Features

### Relationship Tiers (Color-Coded)
- **Hostile** (#ff6b6b - Red): Deep mistrust, conflict
- **Cold** (#4ecdc4 - Teal): Distant, formal
- **Neutral** (#95a5a6 - Gray): No strong feelings
- **Warm** (#f39c12 - Orange): Positive regard
- **Close** (#9b59b6 - Purple): Trust and affection
- **Devoted** (#e91e63 - Pink): Deep commitment

### Relationship Arcs
- **Forming**: New relationship developing
- **Deepening**: Growing trust/connection
- **Stable**: Consistent, unchanged
- **Deteriorating**: Declining trust/affection
- **Recovering**: Mending after conflict
- **Transforming**: Fundamental shift in nature

### Data Structure

```javascript
{
  "session_id": "chat-123",
  "character_a_id": "char1",
  "character_b_id": "char2",
  "score": 65,           // -100 to +100
  "tier": "warm",
  "relationship_arc": "deepening",
  "interaction_count": 12,
  "trust_level": 0.78,   // 0 to 1
  "score_history": [
    {
      "session_id": "chat-123",
      "score": 45,
      "delta": 20,
      "catalyst": "Shared vulnerability moment"
    }
  ],
  "key_turning_points": [
    {
      "description": "Reconciliation after argument",
      "impact": 25
    }
  ]
}
```

## Backend Integration

The components use the `updateRelationship` backend function to track changes automatically:

```javascript
await base44.functions.invoke("updateRelationship", {
  character_id: charA_id,
  session_id: sessionId,
  character_name: charA_name,
  user_message: content,
  ai_response: result,
})
```

This function:
- Detects relationship changes in dialogue
- Updates scores based on sentiment & context
- Calculates tier changes automatically
- Stores score history with catalysts

## Visualization Details

### Graph Canvas
- **Circular Layout**: Characters arranged in circle
- **Edge Visualization**: Line thickness = relationship strength
- **Color Coding**: Edge color matches tier
- **Interactive**: Click nodes to see relationship details

### Timeline View
- **Score Bars**: Visual progress from -100 to +100
- **Trend Icons**: ↑ improving, ↓ declining, → stable
- **Event History**: Recent catalysts and score changes
- **Turning Points**: Major relationship shifts with impact values

## Usage Example

In a chat with multiple characters, the graph shows:
- Character A connected to B (strong tie - thick purple line = "close")
- Character A connected to C (weak tie - thin red line = "hostile")
- Character B connected to C (moderate tie - medium orange line = "warm")

Clicking Character A shows:
- All relationships involving A
- Timeline of how ties changed
- Turning points and themes
- Trust level and interaction frequency

## Styling

Uses existing design system:
- Cyan primary (#00E5E5)
- Dark backgrounds
- Monospace fonts
- Framer Motion animations
- HUD-style borders

The visualization integrates seamlessly with the Anima Protocol aesthetic.