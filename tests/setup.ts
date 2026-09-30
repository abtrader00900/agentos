import { tmpdir } from "node:os";
import path from "node:path";

// No test may touch the developer's real ~/.agentos: `agentos run` registers every
// project it runs in, and a global registry created as a side effect makes
// projectRoot() resolve unrelated temp dirs (which live under the home directory)
// to the home directory itself. Tests that care pass an explicit home anyway.
process.env.AGENTOS_HOME = path.join(tmpdir(), `agentos-test-home-${process.pid}`);
