# Quest Sidebar System - Integration Guide

## Components Created

1. **QuestSidebar** (`components/quests/QuestSidebar.jsx`)
   - Displays active, completed, and abandoned quests
   - Shows quest progress bars, objectives, and rewards
   - Real-time updates via entity subscriptions
   - Stats header with quest counts

2. **QuestAutoDetector** (`components/quests/QuestAutoDetector.jsx`)
   - Background detector that runs automatically
   - Calls `detectQuestsFromNarrative` function every 5 seconds
   - Creates quests from detected narrative hooks
   - Prevents duplicates by checking existing quests

3. **Quest Entity** (`entities/Quest.json`)
   - Stores quest data with objectives, rewards, status tracking
   - Links to sessions, characters, and locations
   - Supports difficulty levels and narrative context

## How to Add to Chat Page

Since `pages/Chat.jsx` is too large to modify, here's how to integrate:

### Option 1: Create a Chat Layout Component

Create `components/layout/ChatWithQuestSidebar.jsx`:

```javascript
import Chat from "@/pages/Chat";
import QuestSidebar from "@/components/quests/QuestSidebar";
import QuestAutoDetector from "@/components/quests/QuestAutoDetector";

export default function ChatWithQuestSidebar() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);

  return (
    <div className="flex w-full h-screen">
      <Chat />
      <QuestAutoDetector 
        sessionId={sessionId} 
        characterId={session?.character_id}
        messages={session?.messages || []}
      />
      <QuestSidebar 
        sessionId={sessionId} 
        characterId={session?.character_id}
      />
    </div>
  );
}
```

### Option 2: Use CSS Grid in App.jsx

Modify the main app container in `App.jsx` to use grid layout and position the quest sidebar as a right column.

## Features

### Auto-Detection
- Monitors chat messages for quest opportunities
- 5-second cooldown to avoid spam
- Calls `detectQuestsFromNarrative` backend function
- Auto-creates quests with objectives, rewards, difficulty

### Quest Tracking
- **Active Quests**: Displayed with progress bars
- **Objectives**: Expandable list with completion status
- **Rewards**: XP and items displayed per quest
- **Stats**: Header shows active/completed/abandoned counts

### Real-Time Updates
- Subscribes to Quest entity changes
- Instant UI refresh when objectives complete or quests finish
- Live progress calculation

## Backend Function Used

**detectQuestsFromNarrative** (already exists)
- Input: session_id, character_id, recent_messages
- Output: detected_quests array with titles, descriptions, objectives, rewards
- Prevents duplicate creation

## Example Quest

```javascript
{
  "session_id": "chat-123",
  "title": "Recover the Lost Crown",
  "description": "Help the kingdom find the stolen crown",
  "status": "active",
  "difficulty": "hard",
  "objectives": [
    { "id": "1", "description": "Visit the Blackmarket", "completed": false },
    { "id": "2", "description": "Find the Crown's Location", "completed": true },
    { "id": "3", "description": "Retrieve the Crown", "completed": false }
  ],
  "rewards": {
    "xp": 500,
    "items": ["Noble's Seal", "Gold Reward"]
  }
}
```

## Styling

Uses the existing design system:
- Cyan primary color (#00E5E5)
- Black/dark backgrounds
- Monospace font for UI text
- Framer Motion for animations
- HUD-style borders and corners

The sidebar integrates seamlessly with the existing Anima Protocol aesthetic.