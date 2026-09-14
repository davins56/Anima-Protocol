type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

let isLoading = false;
let messages: ChatMessage[] = [];
let input = "";
let error = "";

async function requestAnimaResponse(messages: ChatMessage[]) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "The Anima failed to respond.");
  }

  return data.message as string;
}async function handleSend() {
  const text = input.trim();

  if (!text || isLoading) return;

  const userMessage: ChatMessage = {
    role: "user",
    content: text,
  };

  const nextMessages = [...messages, userMessage];

  messages = nextMessages;
  setInput("");
  setIsLoading(true);

  try {
    const answer = await requestAnimaResponse(nextMessages);

    messages = [
      ...messages,
      {
        role: "assistant",
        content: answer,
      },
    ];
  } catch (error) {
    setError(
      error instanceof Error
        ? error.message
        : "The Anima failed to respond.",
    );
  } finally {
    setIsLoading(false);
  }
}

function setIsLoading(arg0: boolean) {
  isLoading = arg0;
}
function setInput(arg0: string) {
 input = arg0;
}

function setError(arg0: string) {
  error = arg0;
}

