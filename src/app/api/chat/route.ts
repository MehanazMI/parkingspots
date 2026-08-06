import { createAgentUIStreamResponse } from "ai";
import { parkingAgent } from "@/lib/agents/parking-agent";

export const maxDuration = 30;

export async function POST(request: Request) {
  const { messages } = await request.json();

  return createAgentUIStreamResponse({
    agent: parkingAgent,
    uiMessages: messages,
  });
}
