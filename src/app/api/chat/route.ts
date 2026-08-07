import { createAgentUIStreamResponse } from "ai";
import { buildParkingAgent } from "@/lib/agents/parking-agent";

export const maxDuration = 30;

function parseFacilityFilter(value: unknown): "street" | "garage" | "both" {
  return value === "street" || value === "garage" ? value : "both";
}

export async function POST(request: Request) {
  const { messages, facilityFilter } = await request.json();

  return createAgentUIStreamResponse({
    agent: buildParkingAgent(parseFacilityFilter(facilityFilter)),
    uiMessages: messages,
  });
}
