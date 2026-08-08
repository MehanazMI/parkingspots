import { APICallError, RetryError, createAgentUIStreamResponse } from "ai";
import { buildParkingAgent } from "@/lib/agents/parking-agent";

export const maxDuration = 30;

function parseFacilityFilter(value: unknown): "street" | "garage" | "both" {
  return value === "street" || value === "garage" ? value : "both";
}

function isRateLimitError(error: unknown): boolean {
  if (APICallError.isInstance(error) && error.statusCode === 429) return true;
  // After exhausting retries, the SDK wraps the underlying attempts in a
  // RetryError rather than surfacing the raw APICallError directly.
  if (RetryError.isInstance(error)) {
    return error.errors.some((e) => APICallError.isInstance(e) && e.statusCode === 429);
  }
  return false;
}

// Default onError just returns "An error occurred." (the AI SDK redacts
// details from the client by default, for good reason — internal error
// messages could leak API keys/infra info). Map the specific, safe-to-show
// cases we actually want the user to see; everything else stays generic.
function describeError(error: unknown): string {
  if (isRateLimitError(error)) {
    return "Rate limit reached — the assistant is temporarily unavailable. Try again in a bit.";
  }
  return "Something went wrong — try again.";
}

export async function POST(request: Request) {
  const { messages, facilityFilter } = await request.json();

  return createAgentUIStreamResponse({
    agent: buildParkingAgent(parseFacilityFilter(facilityFilter)),
    uiMessages: messages,
    onError: describeError,
  });
}
