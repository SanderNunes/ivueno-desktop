const { DemoEngine } = require('./demo');

/**
 * The engine interface every implementation must satisfy (the real one lives in a local Python service, see docs/ENGINE.md):
 *   id, label, realTranscription, needsAudio
 *   modelStatus() -> {state: 'ready'|'missing'|'downloading'|'paused', progress?, demo?}
 *   start(meeting, {partial(p|null), final(segment)}, elapsedMs) / pause() / resume() / stop()
 *   writeNotes(meeting, nameOf) -> {title, summary, blocks, extra, tasks, engine}
 *   runRecipe(meeting, recipeId, {live}, nameOf) -> {text, unavailable?}
 *   ask(meeting, question, nameOf) -> {text, cite?}
 */
function createEngine(kind, options = {}) {
  if (kind === 'demo' || !kind) return new DemoEngine(options);
  const e = new Error(`engine "${kind}" is not installed`); e.code = 'engine_missing';
  throw e;
}

module.exports = { createEngine };
