import assert from "node:assert/strict";
import { check, KEYS } from "./gate.js";
assert.equal(Object.keys(KEYS).length, 3);
assert.equal(await check("373737"), "Key provided by Yash. Welcome!");
assert.equal(await check(" 373738 "), "Access granted by Sankarshan. Welcome!");
assert.equal(await check("373739"), "Access granted by Megh. Welcome!");
assert.equal(await check("373730"), null); assert.equal(await check(""), null);
console.log("gate ok");
