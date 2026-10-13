// Parses a DEF off the main thread and returns flat typed arrays.
import { parseDef } from "./def-parser.js";
import { flatten } from "./layout-data.js";
self.onmessage = (e) => {
  try { const { d, transfer } = flatten(parseDef(e.data)); self.postMessage({ d }, transfer); }
  catch (err) { self.postMessage({ error: String(err) }); }
};
