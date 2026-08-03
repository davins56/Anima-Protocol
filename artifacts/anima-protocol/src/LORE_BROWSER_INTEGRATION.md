# Lore Browser Integration Guide

## Components Created

1. **LoreBrowserPanel** (`components/lore/LoreBrowserPanel.jsx`)
   - Searchable wiki-style database of discovered lore
   - Split-pane: entries list + details view
   - Supports filtering by category (People/Places/Events)
   - Auto-updates from WorldState entities

2. **ChatLoreBrowserIntegration** (`components/chat/ChatLoreBrowserIntegration.jsx`)
   - Toggle button wrapper for Chat page
   - State management for panel visibility
   - Ready to be imported into pages/Chat.jsx

## How to Add to Chat Page

Add this import to the top of `pages/Chat.jsx`:
```javascript
import ChatLoreBrowserIntegration from "@/components/chat/ChatLoreBrowserIntegration";
```

Then add this line in the header toolbar (around line 1585, in the `<div className="flex items-center gap-2">` section):
```javascript
<ChatLoreBrowserIntegration sessionId={activeSession?.id} />
```

Place it before the mental line button for best UX.

## Features

- **Real-time Lore Extraction**: Automatically syncs with WorldState entities created by `extractLore` function
- **Searchable Database**: Filter by keyword or category (People/Places/Events)
- **Wiki-Style Display**: Left pane shows list, right pane shows full details
- **Related Entries**: Click to navigate between related lore items
- **Category Stats**: Shows counts for each lore type
- **Discovery Tracking**: Displays when each entry was discovered

## How It Works

1. When you chat, the `extractLore` function automatically creates WorldState entries
2. LoreBrowserPanel queries these in real-time via entity subscriptions
3. Users can search, filter, and explore the discovered lore
4. Critical entries (importance: "critical") are always shown first