import assert from "node:assert/strict";
import { Agent } from "./agent.js";

async function main() {
  const agent = new Agent({
    baseUrl: "https://example.invalid",
    apiKey: "test",
    model: "gpt-4.1",
    temperature: 0.2,
    contextStrategy: "sticky_facts",
  });

  const answers = ["PLAN", "DRAFT", "VALIDATION", "FINAL"];
  agent._runTaskLLMStep = async () => answers.shift() || "";

  agent.startTask("Собрать PRD");
  assert.equal(agent.taskState.stage, "planning");
  assert.equal(agent.taskState.step, 1);
  assert.equal(agent.taskState.expectedAction, "generate_plan");
  assert.equal(agent.taskState.artifacts.userGoal, "Собрать PRD");

  assert.equal(agent.pauseTask(), true);
  assert.equal(agent.taskState.stage, "paused");
  assert.deepEqual(agent.taskState.pausedFrom, { stage: "planning", step: 1 });

  assert.equal(agent.continueTask(), true);
  assert.equal(agent.taskState.stage, "planning");
  assert.equal(agent.taskState.step, 1);
  assert.equal(agent.taskState.expectedAction, "generate_plan");

  const p = await agent.runTaskStep({ userMessage: "go" });
  assert.equal(p.text, "PLAN");
  assert.equal(agent.taskState.artifacts.plan, "PLAN");
  assert.equal(agent.taskState.stage, "execution");
  assert.equal(agent.taskState.step, 2);

  const e = await agent.runTaskStep({ userMessage: "next" });
  assert.equal(e.text, "DRAFT");
  assert.equal(agent.taskState.artifacts.draft, "DRAFT");
  assert.equal(agent.taskState.stage, "validation");
  assert.equal(agent.taskState.step, 3);

  const v = await agent.runTaskStep({ userMessage: "validate" });
  assert.match(v.text, /Validation review:\nVALIDATION/);
  assert.match(v.text, /Final result:\nFINAL/);
  assert.equal(agent.taskState.artifacts.validation, "VALIDATION");
  assert.equal(agent.taskState.artifacts.draft, "FINAL");
  assert.equal(agent.taskState.stage, "done");
  assert.equal(agent.taskState.expectedAction, null);

  assert.equal(agent.pauseTask(), false);
  assert.equal(agent.continueTask(), false);

  agent.resetTask();
  assert.equal(agent.taskState.stage, "idle");
  assert.equal(agent.taskState.step, 0);
  assert.equal(agent.taskState.artifacts.userGoal, null);
  assert.equal(agent.taskState.artifacts.plan, null);
  assert.equal(agent.taskState.artifacts.draft, null);
  assert.equal(agent.taskState.artifacts.validation, null);
}

main();
