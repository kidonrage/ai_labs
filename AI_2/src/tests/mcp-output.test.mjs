import assert from "node:assert/strict";
import { Agent } from "../agent.js";

async function main() {
  assert.equal(
    Agent.extractUserVisibleAnswer({
      output: [
        { type: "mcp_call", name: "geocode_location" },
        { type: "mcp_call", name: "get_weather_forecast" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Прогноз готов." }],
        },
      ],
    }),
    "geocode_location\nget_weather_forecast\n\nПрогноз готов.",
  );

  assert.equal(
    Agent.extractUserVisibleAnswer({
      output: [{ type: "mcp_call", name: "get_air_quality" }],
    }),
    "get_air_quality",
  );
}

main();
