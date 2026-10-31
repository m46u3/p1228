import { startCommunity } from './p1228/bots/community/index.js';
import { startTts } from './p1228/bots/tts/index.js';
import { startMinase } from './p1228/bots/minase/index.js';
import { startAi } from './p1228/bots/ai/index.js';
import { startMusic } from './p1228/bots/music/index.js';
import { startEntertainment } from './p1228/bots/entertainment/index.js';
import { startDebug } from './p1228/bots/debug/index.js';

const starts = {
  community: startCommunity,
  tts: startTts,
  minase: startMinase,
  ai: startAi,
  music: startMusic,
  entertainment: startEntertainment,
  debug: startDebug,
};
const selected = process.argv[2]?.toLowerCase();
if (selected) {
  if (!starts[selected])
    throw new Error(`Unknown bot: ${selected}. Choose: ${Object.keys(starts).join(', ')}`);
  await starts[selected]();
} else {
  // Start one process per bot in production/Docker; this mode is convenient for local testing.
  await Promise.all(Object.values(starts).map((start) => start()));
}
