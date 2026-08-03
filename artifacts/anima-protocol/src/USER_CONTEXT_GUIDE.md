# User Context System Guide

## Overview

The User Context system allows you to upload personal documents—novels, essays, journals, biographies, or any writing—to give the Anima deeper understanding of who you are. This context is then automatically injected into all companion interactions, making the Anima's responses more personally attuned.

## How It Works

### 1. **Upload Your Documents**

Go to **Settings > Background** and click **Upload Document**.

- **Supported formats**: .txt, .md, .pdf (up to 5MB)
- **Document types**: 
  - Novel/Story
  - Biography
  - Essay
  - Journal/Diary
  - Character Background
  - World Building
  - Poetry
  - Other

### 2. **Automatic Processing**

Once uploaded, the system:
- Extracts key themes from your text
- Identifies personal values
- Highlights recurring concepts
- Generates a summary of the document

### 3. **Context Injection**

When interacting with the Anima:
- All your active documents are compiled into a consolidated context prompt
- This prompt is automatically injected into every conversation
- The Anima uses this to understand your writing style, values, and worldview

### 4. **Management**

In Settings > Background, you can:
- **Enable/Disable** documents (toggle on/off without deleting)
- **View summaries** of extracted themes and values
- **Delete documents** (permanent removal)
- See **processing status** as AI analyzes uploads

## Examples

### Example 1: Upload a Novel
You upload your sci-fi novel with themes of "resilience," "technology vs humanity," and "survival."
The Anima learns from this and responds with those values in mind.

### Example 2: Personal Essay
You upload an essay about your philosophy and worldview.
The Anima incorporates your expressed values and perspectives into conversations.

### Example 3: Character Background
You upload a character bio you've written for a story.
The Anima understands your narrative voice and storytelling preferences.

## API Integration

### Building the Context Prompt

```javascript
import { useUserContext } from '@/hooks/useUserContext';

const MyComponent = () => {
  const { contextPrompt, loading, documentCount, refresh } = useUserContext();
  
  // contextPrompt is ready to inject into LLM prompts
  if (loading) return <div>Loading context...</div>;
  
  return <div>{documentCount} documents loaded</div>;
};
```

### Using Context in Backend Functions

```javascript
// In a backend function (e.g., for Anima responses)
const { contextPrompt } = await base44.functions.invoke('buildUserContextPrompt', {});

const systemPrompt = `${contextPrompt}

You are the Anima, a companion guide. Use the user's background context above to deeply understand who they are and respond in a way that resonates with their values and worldview.`;
```

## Technical Details

### Entities

**UserContext**:
- `user_email` - User who uploaded
- `title` - Document title
- `document_type` - Type of document
- `file_url` - URL to uploaded file
- `extracted_summary` - AI-generated summary
- `key_themes` - Array of identified themes
- `characters_mentioned` - Names/personas found
- `personal_values` - Inferred values
- `is_active` - Whether context is used
- `processing_complete` - AI analysis complete

### Backend Functions

**processUserContext.js**:
- Reads uploaded file content
- Extracts themes, values, and summary
- Updates UserContext entity with analysis
- Uses LLM for intelligent extraction

**buildUserContextPrompt.js**:
- Fetches all active user contexts
- Consolidates into a single prompt
- Returns formatted context string
- Ready for injection into conversations

### Hook: useUserContext()

Returns:
- `contextPrompt` - The consolidated context string
- `loading` - Boolean indicating if fetching
- `documentCount` - Number of active documents
- `refresh()` - Function to reload context

## Best Practices

### 1. **Start Small**
Begin with 1-2 key documents that best represent your values or writing style.

### 2. **Update Regularly**
As you write more, upload new documents to keep context fresh.

### 3. **Organize By Type**
Use different document types to help the system categorize your uploads.

### 4. **Enable/Disable Contextually**
Toggle documents on/off depending on what kind of conversation you want.
- Want to discuss your novel? Enable the novel document.
- Want general guidance? Disable specific narratives.

### 5. **Monitor Summaries**
Check the extracted summaries—they show what the AI learned from your text.

## Privacy & Data

- All documents are stored securely in the database
- Only active documents are used in prompts
- You control what context is sent to the AI
- Delete documents anytime to remove them from context
- No document data is shared beyond your app

## Troubleshooting

### Document Processing Takes a While
Large documents (2000+ words) may take 20-30 seconds to process. Check "AI analysis in progress..."

### Themes Don't Match My Writing
The AI extraction is intelligent but not perfect. If themes seem off, you can delete and re-upload with a more focused excerpt.

### Context Not Being Used
Verify documents are marked as "active" (toggle on) in Settings > Background.

## Advanced: Custom Anima Responses

To use user context in custom Anima interactions:

```javascript
const { contextPrompt } = useUserContext();

const systemMessage = `
${contextPrompt}

You are Serenity, the Anima companion. You understand this person deeply based on their writing and values.
Respond with warmth, insight, and genuine understanding of who they are.
`;

// Pass systemMessage to your LLM call
const response = await base44.integrations.Core.InvokeLLM({
  prompt: userMessage,
  systemMessage,
});
```

## Future Features

Planned enhancements:
- Auto-extract character voice/style from documents
- Generate custom Anima personality from your writing
- Semantic search within your uploaded documents
- Export compiled context as a document
- Version history for document uploads